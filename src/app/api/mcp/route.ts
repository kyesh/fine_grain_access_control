/**
 * Production MCP Server — FGAC.ai Gmail Access Control
 *
 * Promoted from /api/spike/mcp with full Gmail tool support.
 * Uses the Pending Approval pattern validated in spikes #1 and #2.
 *
 * Auth chain: OAuth token → userId + clientId → agent_connections →
 *   proxy_key → key_email_access → Clerk Google token → Gmail API
 *
 * Tool metadata (names, titles, annotations) lives in ./toolDefs.ts and is
 * linted by scripts/mcp-tool-lint.ts against the Anthropic Connectors
 * Directory requirements. Raw Google API calls are classified deny-by-default
 * in ./googleApiPolicy.ts.
 */
import { createMcpHandler, experimental_withMcpAuth } from 'mcp-handler';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { db } from '@/db';
import {
  agentConnections, users, proxyKeys, keyEmailAccess,
  accessRules, keyRuleAssignments, emailDelegations,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { filterLiveDelegatedAccess } from '@/db/delegationQueries';
import { clerkClient } from '@clerk/nextjs/server';
import safeRegex from 'safe-regex';
import { resolveDbUser } from '@/db/userHelpers';
import { loadApplicableRules, checkReadRestrictions, type ApplicableRules } from '@/lib/gmailRules';
import { captureServerEvent } from '@/lib/posthogServer';
import { runWithToolCallProps, addToolCallProps, getToolCallProps } from '@/lib/toolCallContext';
import { ensureDefaultProfile } from '@/db/defaultProfile';
import { mintApprovalLink, approvalLinkMinutes, type ApprovalAction } from '@/lib/approvalLinks';
import { TOOL_DEFS, toolAnnotations, type FgacToolDef } from './toolDefs';
import {
  classifyGoogleApiCall, extractSendRecipients, sheetsApprovalAction, docsApprovalAction,
} from './googleApiPolicy';
import { DRIVE_FILE_KINDS, type DriveFileKind } from '@/lib/driveFileKinds';

/** Env URL values have shipped with trailing whitespace/newlines (pasted
 * Vercel vars); a whitespace-only value must also not win the fallback chain.
 * Sanitizing here fixes every consumer: approval links, pending-approval
 * dashboard URLs, everything built on DASHBOARD_URL. */
function cleanUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || null;
}

const DASHBOARD_URL = cleanUrl(process.env.NEXT_PUBLIC_APP_URL)
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}` : null)
  || 'http://localhost:3000';

// ─── Connection Resolution ──────────────────────────────────────────────────

interface ConnectionApproved {
  authorized: true;
  reason: 'approved';
  connectionId: string;
  proxyKeyId: string | null;
  nickname: string | null;
  user: { id: string; email: string; clerkUserId: string };
}

interface ConnectionDenied {
  authorized: false;
  reason: 'pending_approval' | 'blocked' | 'no_client_id' | 'user_not_found' | 'no_auth';
  dashboardUrl?: string;
  connectionId?: string;
}

type ConnectionResult = ConnectionApproved | ConnectionDenied;

async function resolveConnection(userId: string, clientId: string | undefined): Promise<ConnectionResult> {
  if (!clientId) {
    return { authorized: false, reason: 'no_client_id' };
  }

  let user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, userId),
  });

  if (!user) {
    try {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const email = clerkUser.emailAddresses[0]?.emailAddress;

      if (!email) {
        return { authorized: false, reason: 'user_not_found' };
      }

      user = await resolveDbUser(userId, email);
      console.log(`[MCP] Auto-created DB user for ${email}`);
    } catch (err) {
      console.error('[MCP] Failed to auto-create user:', err);
      return { authorized: false, reason: 'user_not_found' };
    }
  }

  let connection = await db.query.agentConnections.findFirst({
    where: and(
      eq(agentConnections.userId, user.id),
      eq(agentConnections.clientId, clientId),
    ),
  });

  if (!connection) {
    // Instant-start (connector-growth Phase B): the caller personally
    // completed OAuth for this client, which is per-client consent — so the
    // connection auto-attaches to the read-only Default Profile instead of
    // starting pending. Delegated mailboxes are still gated by delegation.
    const defaultKey = await ensureDefaultProfile(user.id, user.email);
    try {
      const [newConn] = await db.insert(agentConnections).values({
        userId: user.id,
        clientId,
        clientName: clientId,
        status: 'approved',
        proxyKeyId: defaultKey.id,
        approvedAt: new Date(),
      }).returning();
      connection = newConn;

      console.log(`[MCP] New connection: user=${user.email} client=${clientId} conn=${connection.id} auto-attached to default profile`);
      // account_age_seconds separates connector-flow sign-ups (Clerk hosted
      // OAuth → first MCP request within seconds/minutes of account creation;
      // no fgac.ai pageview ever) from established users adding a client. A
      // fresh account stamps signup_source once — the website flow's competing
      // $set_once fires from PostHogIdentify on the first dashboard visit,
      // and whichever touchpoint a new account reaches first wins.
      const accountAgeSeconds = Math.round((Date.now() - user.createdAt.getTime()) / 1000);
      captureServerEvent(user.clerkUserId, 'mcp_connection_created', {
        connection_id: newConn.id,
        client_id: clientId,
        auto_attached: true,
        account_age_seconds: accountAgeSeconds,
        ...(accountAgeSeconds < 600 ? { $set_once: { signup_source: 'claude_connector' } } : {}),
      });
    } catch (err) {
      // The auth-layer eager resolve and the tool handler can race this
      // insert on a client's very first request; the loser reads the
      // winner's row instead of surfacing a SQL error (QA cap 06 A3).
      connection = await db.query.agentConnections.findFirst({
        where: and(
          eq(agentConnections.userId, user.id),
          eq(agentConnections.clientId, clientId),
        ),
      });
      if (!connection) throw err;
    }
  }

  await db.update(agentConnections)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentConnections.id, connection.id));

  if (connection.status === 'pending') {
    return {
      authorized: false,
      reason: 'pending_approval',
      connectionId: connection.id,
      dashboardUrl: `${DASHBOARD_URL}/dashboard?tab=connections&highlight=${connection.id}`,
    };
  }

  if (connection.status === 'blocked') {
    return { authorized: false, reason: 'blocked', connectionId: connection.id };
  }

  // A connection is only as alive as the key behind it. The proxy path checks
  // revokedAt/expiresAt on every request; without this, a revoked key kept
  // working through hosted MCP for connections bound before the revocation.
  if (connection.proxyKeyId) {
    const boundKey = await db.query.proxyKeys.findFirst({
      where: eq(proxyKeys.id, connection.proxyKeyId),
    });
    if (!boundKey || boundKey.revokedAt) {
      return { authorized: false, reason: 'blocked', connectionId: connection.id };
    }
    if (boundKey.expiresAt && boundKey.expiresAt < new Date()) {
      return { authorized: false, reason: 'blocked', connectionId: connection.id };
    }
  }

  return {
    authorized: true,
    reason: 'approved',
    connectionId: connection.id,
    proxyKeyId: connection.proxyKeyId,
    nickname: connection.nickname,
    user: { id: user.id, email: user.email, clerkUserId: user.clerkUserId },
  };
}

// ─── Tool Result Helpers ────────────────────────────────────────────────────

/** Successful tool response, including FGAC policy denials — a denial is the
 * tool working as designed, not a tool failure. */
const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] });

/** Upstream/auth failure: marked isError so clients (and the directory's
 * health metrics) see it as a genuine tool error. */
const errorResult = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

const jsonResult = (data: unknown) => textResult(JSON.stringify(data, null, 2));

// ─── Pending Approval Message ───────────────────────────────────────────────

function pendingMessage(result: ConnectionDenied) {
  switch (result.reason) {
    case 'pending_approval':
      return [
        '⏳ This connection is awaiting user approval, so tools cannot run yet.',
        `Connection ID: ${result.connectionId}`,
        `The user can approve it by attaching it to a permission profile at: ${result.dashboardUrl}`,
      ].join('\n');
    case 'blocked':
      return '🚫 This connection has been blocked by the user.';
    case 'no_client_id':
      return '❌ No client_id found in auth token.';
    case 'user_not_found':
      return '❌ User not found. Please sign up at the FGAC dashboard first.';
    default:
      return '❌ Authentication failed.';
  }
}

// ─── Email & Permission Resolution ──────────────────────────────────────────

async function getAccessibleEmails(proxyKeyId: string) {
  const rows = await db.select().from(keyEmailAccess)
    .where(eq(keyEmailAccess.proxyKeyId, proxyKeyId));
  // Revoked delegations must not keep granting access — see delegationQueries.
  return filterLiveDelegatedAccess(rows);
}

async function checkEmailAccess(proxyKeyId: string, targetEmail: string) {
  const rows = await getAccessibleEmails(proxyKeyId);
  return rows.find(r => r.targetEmail.toLowerCase() === targetEmail.toLowerCase());
}

async function getGoogleToken(targetEmail: string, keyOwner: { id: string; email: string; clerkUserId: string }) {
  let tokenOwnerClerkId: string;

  if (targetEmail.toLowerCase() === keyOwner.email.toLowerCase()) {
    tokenOwnerClerkId = keyOwner.clerkUserId;
  } else {
    // Delegated email — find the email owner
    const emailOwner = await db.select().from(users)
      .where(eq(users.email, targetEmail))
      .limit(1).then(r => r[0]);

    if (!emailOwner) return null;

    // Verify active delegation
    const delegation = await db.select().from(emailDelegations)
      .where(and(
        eq(emailDelegations.ownerUserId, emailOwner.id),
        eq(emailDelegations.delegateUserId, keyOwner.id),
        eq(emailDelegations.status, 'active'),
      )).limit(1).then(r => r[0]);

    if (!delegation) return null;
    tokenOwnerClerkId = emailOwner.clerkUserId;
  }

  const client = await clerkClient();
  try {
    const tokenResponse = await client.users.getUserOauthAccessToken(tokenOwnerClerkId, 'oauth_google');
    const token = tokenResponse.data?.[0]?.token || null;
    if (!token) addToolCallProps({ google_token_error: 'no_token' });
    return token;
  } catch (err) {
    // Observability for the "Clerk cannot refresh the Google token" failure
    // mode (Clerk 422: grant stored without a refresh token — seen on the
    // dev instance 2026-08-20, cause unconfirmed in prod). Without this,
    // these failures are indistinguishable from generic errors in analytics.
    const message = err instanceof Error ? err.message : String(err);
    const reason = /refresh/i.test(message) ? 'refresh_failed' : 'clerk_error';
    addToolCallProps({ google_token_error: reason });
    captureServerEvent(keyOwner.clerkUserId, 'google_token_fetch_failed', {
      reason,
      via: 'mcp',
      account_delegated: targetEmail.toLowerCase() !== keyOwner.email.toLowerCase(),
    });
    console.error(`[MCP] Google token fetch failed (${reason}) for target mailbox:`, message);
    return null;
  }
}

// loadApplicableRules / checkReadRestrictions moved to src/lib/gmailRules.ts —
// shared with the push-notification filter so read policy and notification
// policy can never drift apart.

/**
 * Send-whitelist enforcement shared by gmail_send and google_api_modify.
 * Every recipient must match a whitelist pattern; unknown recipients deny.
 * Returns a denial ({ message, deniedRecipient? }) or null if sending is
 * allowed. deniedRecipient feeds the magic approval link — absent when we
 * could not even parse who the mail was for (no link in that case).
 */
type SendDenial = { message: string; deniedRecipient?: string; code: string };

function checkSendWhitelist(rules: ApplicableRules, recipients: string[] | null): SendDenial | null {
  const sendRules = rules.filter(r => r.service === 'gmail' && r.actionType === 'send_whitelist');

  if (!recipients || recipients.length === 0) {
    return { message: '🚫 Could not determine the message recipients, so sending was denied. Provide a standard RFC 2822 message with To/Cc/Bcc headers.', code: 'recipients_undetermined' };
  }

  if (sendRules.length === 0) {
    return {
      message: '🚫 Sending is disabled on this profile (no send whitelist configured). This is the safe default.',
      deniedRecipient: recipients[0],
      code: 'send_disabled',
    };
  }

  for (const recipient of recipients) {
    let isWhitelisted = false;
    for (const rule of sendRules) {
      if (!rule.regexPattern) continue;
      const regexStr = rule.regexPattern.replace(/\*/g, '.*');
      if (!safeRegex(regexStr)) continue;
      if (new RegExp(regexStr, 'i').test(recipient)) { isWhitelisted = true; break; }
    }
    if (!isWhitelisted) {
      return {
        message: `🚫 Unauthorized recipient. '${recipient}' is not in the send whitelist.`,
        deniedRecipient: recipient,
        code: 'recipient_not_whitelisted',
      };
    }
  }

  return null;
}

/**
 * Magic-link denial (connector-growth Phase C): policy denials that a user
 * would plausibly want to approve carry a signed, single-use, short-lived
 * link that pre-fills exactly that grant (15 min; sheets 30 — the approval
 * can include a Picker pick + consent round-trip). Explicit blocks and read
 * restrictions never get links — weakening those stays a deliberate
 * dashboard act.
 */
async function policyDenialWithLink(
  conn: ConnectionApproved,
  proxyKeyId: string,
  message: string,
  action: ApprovalAction | null,
) {
  if (!action) return textResult(message);
  try {
    const { url, jti } = await mintApprovalLink(DASHBOARD_URL, conn.user.id, proxyKeyId, action);
    captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', { action: action.action, link_id: jti });
    addToolCallProps({ approval_link_id: jti });
    return textResult(
      `${message}\n👉 Share this link with the user to approve it in one click (single-use, expires in ${approvalLinkMinutes(action.action)} minutes): ${url}\n` +
      AGENT_APPROVAL_PROTOCOL,
    );
  } catch (err) {
    console.error('[MCP] Failed to mint approval link:', err);
    return textResult(message);
  }
}

/**
 * Appended to every denial that carries an approval link. Timeline analysis of
 * the 2026-08 launch cohort showed most minted links were never opened: agents
 * paraphrased the denial (dropping the URL) and retried the denied call in a
 * loop, re-minting links the user never saw. Say the quiet part out loud.
 */
const AGENT_APPROVAL_PROTOCOL =
  'IMPORTANT — how to handle this: (1) Show the link above to the user VERBATIM as a clickable URL; only they can open it, and it is the only way to get access. ' +
  '(2) Do NOT retry the denied call until the user says they approved — retrying just fails again. ' +
  '(3) If the link expires before they open it, call request_access to mint a fresh one.';

/**
 * Send denials offer BOTH one-click options: approve just this recipient, or
 * flip the profile to "Send to Anyone" — the escape hatch for users who find
 * per-recipient whitelisting confusing. Each is its own signed single-use
 * link; only the human choosing one applies anything.
 */
async function sendDenialWithLinks(
  conn: ConnectionApproved,
  proxyKeyId: string,
  denial: SendDenial,
) {
  const lines = [denial.message];
  addToolCallProps({ denial_code: denial.code });
  try {
    if (denial.deniedRecipient) {
      const one = await mintApprovalLink(DASHBOARD_URL, conn.user.id, proxyKeyId, {
        action: 'send_whitelist', recipient: denial.deniedRecipient,
      });
      lines.push(`👉 Allow sending to '${denial.deniedRecipient}' only — share this one-click link with the user (single-use, expires in 15 minutes): ${one.url}`);
      captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', { action: 'send_whitelist', link_id: one.jti, via: 'send_denial' });
    }
    const all = await mintApprovalLink(DASHBOARD_URL, conn.user.id, proxyKeyId, { action: 'send_all' });
    lines.push(`👉 Or allow sending to ANY recipient from this profile — share this one-click link with the user instead (single-use, expires in 15 minutes): ${all.url}`);
    captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', { action: 'send_all', link_id: all.jti, via: 'send_denial' });
    lines.push('Present both options and let the user pick; "any recipient" is the convenient choice if they expect to send freely, and it stays revocable from the dashboard rules.');
    lines.push(AGENT_APPROVAL_PROTOCOL);
  } catch (err) {
    console.error('[MCP] Failed to mint approval link:', err);
  }
  return textResult(lines.join('\n'));
}

// ─── Google API Helpers ─────────────────────────────────────────────────────

type GoogleFetchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status?: number };

function describeGoogleError(status: number, data: unknown, targetEmail: string): string {
  const detail = (data as { error?: { message?: string } })?.error?.message
    || (typeof data === 'string' ? data.slice(0, 300) : '');
  switch (status) {
    case 401:
      return `❌ Google authorization expired for '${targetEmail}'. STOP — do not retry; it will keep failing. ` +
        `Ask the user to reconnect this Google account here: ${DASHBOARD_URL}/dashboard/accounts — then retry once after they confirm.`;
    case 403:
      return `❌ Google denied the request (403): ${detail || 'insufficient permissions or missing OAuth scope for this operation'}. ` +
        `This means Google's grant for '${targetEmail}' is missing a scope or was revoked — retrying will NOT fix it. ` +
        `Ask the user to reconnect the account here: ${DASHBOARD_URL}/dashboard/accounts — then retry once after they confirm.`;
    case 404:
      return `❌ Google resource not found (404)${detail ? `: ${detail}` : ''}. Check the ID and try again.`;
    case 429:
      return '❌ Google API rate limit exceeded (429). Wait a moment and retry.';
    default:
      return `❌ Google API error (${status})${detail ? `: ${detail}` : ''}.`;
  }
}

async function googleFetch(
  url: string, token: string, method = 'GET', body?: string, targetEmail = '',
): Promise<GoogleFetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (err) {
    addToolCallProps({ error_status: 'network' });
    return { ok: false, error: `❌ Could not reach the Google API: ${err instanceof Error ? err.message : 'network error'}.` };
  }

  const text = await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body: keep text */ }

  if (!res.ok) {
    addToolCallProps({ error_status: res.status });
    return { ok: false, error: describeGoogleError(res.status, data, targetEmail), status: res.status };
  }
  return { ok: true, data };
}

/**
 * Post-policy Google failure on a per-file (sheets/docs) call. A 403/404
 * HERE — after FGAC's own permission check passed — almost always means the
 * FGAC rule exists but Google never registered a drive.file grant for the
 * file (it was approved via magic link but never picked in the Google
 * Picker; a mistyped id looks identical from outside). The generic "check
 * the ID" text sent the whole 2026-08 connector cohort into a retry loop;
 * say what is actually wrong and where the one-click fix lives.
 */
function fileGrantErrorResult(kind: DriveFileKind, result: { error: string; status?: number }, fileId: string) {
  if (result.status === 403 || result.status === 404) {
    const d = DRIVE_FILE_KINDS[kind];
    const short = kind === 'sheet' ? 'sheet' : d.noun;
    // Only the sheets setup page embeds a demo video today — the error must
    // not promise docs users a video that isn't there (QA 19 A12 finding).
    const setupBlurb = kind === 'sheet' ? ' (includes a short how-to video)' : '';
    return errorResult(
      `❌ FGAC allows this ${d.noun}, but Google hasn't shared the ${short} itself with FGAC yet, so Google rejected the call (${result.status}). ` +
      `This is a one-time setup step only the user can do: they must pick this ${short} in Google's file picker. ` +
      `👉 Send the user here to finish setup${setupBlurb}: ${DASHBOARD_URL}${d.setupPath}?${d.setupIdParam}=${encodeURIComponent(fileId)} ` +
      `Note: a wrong ${d.noun} ID produces this same error — the setup page verifies real access before reporting success, so it resolves either case. Retry after the user confirms.`,
    );
  }
  return errorResult(result.error);
}

const sheetsErrorResult = (result: { error: string; status?: number }, spreadsheetId: string) =>
  fileGrantErrorResult('sheet', result, spreadsheetId);
const docsErrorResult = (result: { error: string; status?: number }, documentId: string) =>
  fileGrantErrorResult('doc', result, documentId);

async function gmailFetch(token: string, email: string, path: string, method = 'GET', body?: string): Promise<GoogleFetchResult> {
  const userId = email === 'me' ? 'me' : encodeURIComponent(email);
  return googleFetch(`https://www.googleapis.com/gmail/v1/users/${userId}/${path}`, token, method, body, email);
}

async function sheetsFetch(token: string, path: string, method = 'GET', body?: string, targetEmail = ''): Promise<GoogleFetchResult> {
  return googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, token, method, body, targetEmail);
}

async function docsFetch(token: string, path: string, method = 'GET', body?: string, targetEmail = ''): Promise<GoogleFetchResult> {
  return googleFetch(`https://docs.googleapis.com/v1/documents/${path}`, token, method, body, targetEmail);
}

/** How recently a matching per-file rule must have been created for a 403/404
 * to be treated as grant propagation rather than a genuinely missing grant. */
const SHEETS_GRACE_WINDOW_MS = 120_000;
const SHEETS_GRACE_RETRIES = 2;
const SHEETS_GRACE_DELAY_MS = 3_500;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * A per-file fetch with a propagation grace window. Approval-time
 * verification passes with the owner's token, yet the MCP call path can
 * still see 403/404 for tens of seconds while Google's per-file drive.file
 * grant settles (observed on three launch-cohort users: one error
 * immediately after approval, success seconds later). When the matching rule
 * is younger than the grace window, a 403/404 is retried with a short pause
 * instead of being surfaced — the agent sees a slower success, not an error.
 * Rules older than the window fail fast exactly as before.
 *
 * Analytics props are prefixed by the kind's service so sheets dashboards
 * keep their historical names (sheets_grace_*) and docs get docs_grace_*.
 */
async function withGrantGrace(
  kind: DriveFileKind,
  perm: FilePermission,
  doFetch: () => Promise<GoogleFetchResult>,
): Promise<GoogleFetchResult> {
  const service = DRIVE_FILE_KINDS[kind].service;
  let result = await doFetch();
  const ruleAt = perm.allowed ? perm.newestRuleAt : null;
  if (!ruleAt) return result;

  const grantAgeSeconds = () => Math.round((Date.now() - ruleAt.getTime()) / 1000);
  const inGrace = () => Date.now() - ruleAt.getTime() < SHEETS_GRACE_WINDOW_MS;
  const retriable = () => !result.ok && (result.status === 403 || result.status === 404);

  if (retriable()) addToolCallProps({ [`${service}_grant_age_seconds`]: grantAgeSeconds() });

  let retries = 0;
  while (retriable() && inGrace() && retries < SHEETS_GRACE_RETRIES) {
    await sleep(SHEETS_GRACE_DELAY_MS);
    retries += 1;
    result = await doFetch();
  }
  if (retries > 0) {
    addToolCallProps({ [`${service}_grace_retries`]: retries, [`${service}_grace_recovered`]: result.ok });
    if (result.ok) {
      // Don't let the first attempt's transient status ride on a success event.
      addToolCallProps({ error_status: undefined });
      console.log(`[MCP] ${service} grace retry recovered after ${retries} attempt(s) (rule age ${grantAgeSeconds()}s)`);
    }
  }
  return result;
}

const withSheetsGrace = (perm: FilePermission, doFetch: () => Promise<GoogleFetchResult>) =>
  withGrantGrace('sheet', perm, doFetch);
const withDocsGrace = (perm: FilePermission, doFetch: () => Promise<GoogleFetchResult>) =>
  withGrantGrace('doc', perm, doFetch);

async function checkFilePermission(kind: DriveFileKind, userId: string, proxyKeyId: string, fileId: string, isMutating: boolean) {
  const d = DRIVE_FILE_KINDS[kind];
  const allRules = await db.select().from(accessRules).where(eq(accessRules.userId, userId));
  const keyAssignments = await db.select().from(keyRuleAssignments).where(eq(keyRuleAssignments.proxyKeyId, proxyKeyId));
  const assignedRuleIds = new Set(keyAssignments.map(a => a.accessRuleId));
  const allAssignments = await db.select().from(keyRuleAssignments);
  const rulesWithAssignments = new Set(allAssignments.map(a => a.accessRuleId));

  const fileRules = allRules.filter(rule => {
    if (rule.service !== d.service) return false;
    const isGlobal = !rulesWithAssignments.has(rule.id);
    const isAssigned = assignedRuleIds.has(rule.id);
    const matchesId = rule.targetResourceId === fileId || rule.regexPattern === fileId;
    return (isGlobal || isAssigned) && matchesId;
  });

  const nounCap = d.noun.charAt(0).toUpperCase() + d.noun.slice(1);
  if (fileRules.length === 0) {
    addToolCallProps({ denial_code: `${d.service}_not_exposed` });
    return { allowed: false as const, denial: 'not_exposed' as const, reason: `🚫 Access Denied: ${nounCap} '${fileId}' is not exposed in your FGAC rules.` };
  }

  if (fileRules.some(r => r.actionType === d.actionTypes.block)) {
    addToolCallProps({ denial_code: `${d.service}_blocked` });
    return { allowed: false as const, denial: 'blocked' as const, reason: `🚫 Access Denied: Access to ${d.noun} '${fileId}' is explicitly blocked.` };
  }

  if (isMutating) {
    const hasReadWrite = fileRules.some(r => r.actionType === d.actionTypes.readWrite);
    if (!hasReadWrite) {
      addToolCallProps({ denial_code: `${d.service}_read_only` });
      return { allowed: false as const, denial: 'read_only' as const, reason: `🚫 Access Denied: Write access to ${d.noun} '${fileId}' is restricted (Read Only).` };
    }
  }

  // Newest matching rule's age drives the post-approval grace retry: a rule
  // created seconds ago means Google's drive.file grant may still be
  // propagating even though approval-time verification passed.
  const newestRuleAt = fileRules.reduce<Date | null>(
    (acc, r) => (!acc || r.createdAt > acc ? r.createdAt : acc), null,
  );
  return { allowed: true as const, newestRuleAt };
}

type FilePermission = Awaited<ReturnType<typeof checkFilePermission>>;
type SheetsPermission = FilePermission;

const checkSheetsPermission = (userId: string, proxyKeyId: string, spreadsheetId: string, isMutating: boolean) =>
  checkFilePermission('sheet', userId, proxyKeyId, spreadsheetId, isMutating);
const checkDocsPermission = (userId: string, proxyKeyId: string, documentId: string, isMutating: boolean) =>
  checkFilePermission('doc', userId, proxyKeyId, documentId, isMutating);

/** Map a sheets denial onto an approvable action matching the access level
 * the denied operation requires (see sheetsApprovalAction in googleApiPolicy). */
function sheetsDenialAction(perm: SheetsPermission, spreadsheetId: string, isMutating: boolean): ApprovalAction | null {
  if (perm.allowed) return null;
  return sheetsApprovalAction(perm.denial, spreadsheetId, isMutating);
}

/** Docs twin of sheetsDenialAction. */
function docsDenialAction(perm: FilePermission, documentId: string, isMutating: boolean): ApprovalAction | null {
  if (perm.allowed) return null;
  return docsApprovalAction(perm.denial, documentId, isMutating);
}

// ─── Gmail Message Parsing (token-frugal responses) ─────────────────────────

const MAX_BODY_CHARS = 20_000;
const MAX_ATTACHMENT_CHARS = 200_000; // base64url chars ≈ 150 KB decoded

function decodeB64Url(s: string): string {
  try { return Buffer.from(s, 'base64url').toString('utf8'); } catch { return ''; }
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

/**
 * Reduce a Gmail `format=full` message to headers, decoded body text, and
 * attachment metadata. The full payload (nested base64 parts, redundant
 * headers) routinely runs 10-50x the size of the content the model needs.
 */
function parseGmailMessage(msg: Record<string, unknown>) {
  const payload = msg.payload as (GmailPart & { headers?: Array<{ name?: string; value?: string }> }) | undefined;
  const headersArr = payload?.headers ?? [];
  const header = (name: string) =>
    headersArr.find(h => h.name?.toLowerCase() === name)?.value;

  let bodyText = '';
  let htmlFallback = '';
  const attachments: Array<{ filename: string; mimeType?: string; attachmentId: string; sizeBytes?: number }> = [];

  const stack: GmailPart[] = payload ? [payload] : [];
  while (stack.length) {
    const part = stack.pop()!;
    if (part.parts) stack.push(...part.parts);
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        sizeBytes: part.body.size,
      });
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      bodyText += decodeB64Url(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data && !htmlFallback) {
      htmlFallback = decodeB64Url(part.body.data);
    }
  }

  if (!bodyText && htmlFallback) {
    bodyText = htmlFallback
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const truncated = bodyText.length > MAX_BODY_CHARS;
  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds,
    snippet: msg.snippet,
    headers: {
      from: header('from'),
      to: header('to'),
      cc: header('cc'),
      subject: header('subject'),
      date: header('date'),
    },
    body: truncated
      ? `${bodyText.slice(0, MAX_BODY_CHARS)}\n…[truncated ${bodyText.length - MAX_BODY_CHARS} characters — use gmail_read with format "metadata" or narrow the request]`
      : bodyText,
    attachments,
  };
}

// ─── Require Approval Wrapper ───────────────────────────────────────────────

type AuthInfo = { extra?: { userId?: string }; clientId?: string };

async function requireApproval(authInfo: AuthInfo | undefined): Promise<ConnectionApproved | { content: Array<{ type: 'text'; text: string }> }> {
  const userId = authInfo?.extra?.userId as string | undefined;
  const clientId = authInfo?.clientId;

  if (!userId) {
    return textResult('❌ Authentication failed.');
  }

  const result = await resolveConnection(userId, clientId);
  if (!result.authorized) {
    return textResult(pendingMessage(result));
  }
  return result;
}

// ─── Analytics Instrumentation ──────────────────────────────────────────────

type ToolAnalyticsResult = { isError?: boolean; content?: Array<{ type?: string; text?: string }> };

/**
 * Tool responses follow a strict convention (textResult/errorResult above):
 * isError marks upstream/auth failures, and policy outcomes carry a leading
 * ⏳ (pending approval), 🚫 (denied by FGAC policy), or ❌/⚠️ (failed).
 */
function classifyToolOutcome(result: ToolAnalyticsResult): string {
  if (result.isError) return 'error';
  const text = result.content?.[0]?.text ?? '';
  if (text.startsWith('⏳')) return 'pending_approval';
  if (text.startsWith('🚫')) return 'denied_by_policy';
  if (text.startsWith('❌') || text.startsWith('⚠️')) return 'failed';
  return 'success';
}

function withToolAnalytics<R extends ToolAnalyticsResult>(
  tool: string,
  fn: (params: unknown, extra: { authInfo?: AuthInfo }) => Promise<R> | R,
) {
  return async (params: unknown, extra: { authInfo?: AuthInfo }): Promise<R> => runWithToolCallProps(async () => {
    const started = Date.now();
    // Distinct id = the caller's Clerk user id, matching the dashboard's
    // identify() — MCP usage lands on the same PostHog person.
    // Event/property names follow PostHog's canonical MCP Analytics schema
    // ($mcp_tool_call / $mcp_tool_name / …) so its built-in MCP views resolve
    // the tool name; `outcome` and `client_id` are FGAC-specific extras, and
    // context props (account_email / account_delegated, set during account
    // resolution) ride along so delegation usage is attributable per call.
    const track = (outcome: string) => captureServerEvent(
      extra?.authInfo?.extra?.userId ?? 'anonymous-mcp',
      '$mcp_tool_call',
      {
        $mcp_tool_name: tool,
        $mcp_duration_ms: Date.now() - started,
        $mcp_is_error: outcome === 'error' || outcome === 'exception',
        client_id: extra?.authInfo?.clientId,
        outcome,
        ...getToolCallProps(),
      },
    );
    try {
      const result = await fn(params, extra);
      // Response-size observability (plan google-docs-support v5, D7):
      // MCP clients impose their own tool-result caps (Claude Code rejects
      // results over ~25k tokens), so a server-side "success" can still be
      // silently discarded client-side. Stamp the serialized size on EVERY
      // tool result — monitoring only, no size-based behavior — so PostHog
      // can chart how often responses land in the client-rejection zone.
      const responseChars = Array.isArray((result as { content?: unknown }).content)
        ? ((result as { content: Array<{ text?: unknown }> }).content)
            .reduce((n, c) => n + (typeof c.text === 'string' ? c.text.length : 0), 0)
        : 0;
      addToolCallProps({
        response_chars: responseChars,
        response_kb: Math.round(responseChars / 1024),
      });
      track(classifyToolOutcome(result));
      return result;
    } catch (err) {
      track('exception');
      throw err;
    }
  });
}

type ResolvedAccount = { targetEmail: string; token: string; proxyKeyId: string };
type ResolvedError = { error: string };

async function resolveAccountAndToken(
  conn: ConnectionApproved,
  account?: string,
): Promise<ResolvedAccount | ResolvedError> {
  if (!conn.proxyKeyId) {
    return { error: '❌ No proxy key assigned to this connection. Ask the user to update it in the dashboard.' };
  }

  const emails = await getAccessibleEmails(conn.proxyKeyId);
  if (emails.length === 0) {
    return { error: '❌ No email accounts are accessible with this proxy key.' };
  }

  const targetEmail = account || conn.user.email;
  const access = await checkEmailAccess(conn.proxyKeyId, targetEmail);
  if (!access) {
    return { error: `❌ This proxy key does not have access to '${targetEmail}'. Accessible: ${emails.map(e => e.targetEmail).join(', ')}` };
  }

  // Delegation observability: record which account this call resolved to, so
  // the mcp_tool_call event can attribute usage across own vs delegated
  // mailboxes (one user may access several Gmail accounts).
  addToolCallProps({
    account_email: access.targetEmail,
    account_delegated: !!access.delegationId,
  });

  const token = await getGoogleToken(targetEmail, conn.user);
  if (!token) {
    return { error: `❌ Could not fetch Google token for '${targetEmail}'. The account owner may need to reconnect Google.` };
  }

  return { targetEmail, token, proxyKeyId: conn.proxyKeyId };
}

// ─── Raw Google API Execution ───────────────────────────────────────────────

function serializeBody(body?: string | Record<string, unknown>): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/**
 * Shared executor for google_api_get / google_api_modify. Classification is
 * deny-by-default (see googleApiPolicy.ts); every allowed family maps onto
 * the same FGAC enforcement the dedicated tools use.
 */
async function executeRawGoogleCall(
  conn: ConnectionApproved,
  resolved: ResolvedAccount,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  body?: string | Record<string, unknown>,
) {
  const cls = classifyGoogleApiCall(path, method);
  if (cls.kind === 'denied') {
    addToolCallProps({ denial_code: cls.code });
    return textResult(cls.reason);
  }

  const cleanPath = path.replace(/^\/+/, '');
  // Route a raw path to the host that owns its API family. Sheets and Docs
  // live on their own subdomains; everything else rides www.googleapis.com.
  const rawUrl = (p: string) =>
    p.includes('spreadsheets') ? `https://sheets.googleapis.com/${p.replace(/^sheets\//, '')}`
    : p.includes('documents') ? `https://docs.googleapis.com/${p.replace(/^docs\//, '')}`
    : `https://www.googleapis.com/${p}`;

  if (cls.kind === 'sheets_create') {
    // Agent-created sheets are allowed and auto-granted to the calling key
    // (read & write): the Sheets policy protects the user's EXISTING sheets,
    // not the agent's own output. The drive.file scope already limits the app
    // to picked files + files it created, so no new Google-side exposure.
    const url = `https://sheets.googleapis.com/${cleanPath.replace(/^sheets\//, '')}`;
    const result = await googleFetch(url, resolved.token, method, serializeBody(body), resolved.targetEmail);
    if (!result.ok) return errorResult(result.error);
    const created = result.data as { spreadsheetId?: unknown; properties?: { title?: unknown } };
    const newId = typeof created?.spreadsheetId === 'string' ? created.spreadsheetId : null;
    if (newId) {
      const title = typeof created?.properties?.title === 'string' ? created.properties.title : null;
      try {
        const [rule] = await db.insert(accessRules).values({
          userId: conn.user.id,
          ruleName: `Agent-created: ${title || newId}`,
          service: 'sheets',
          actionType: 'sheet_read_write',
          targetResourceId: newId,
          resourceName: title,
        }).returning();
        await db.insert(keyRuleAssignments).values({ proxyKeyId: resolved.proxyKeyId, accessRuleId: rule.id });
        captureServerEvent(conn.user.clerkUserId, 'agent_sheet_created', {
          spreadsheet_id: newId, auto_granted: true,
        });
        addToolCallProps({ sheet_created: true });
      } catch (err) {
        // The sheet exists either way; a failed auto-grant just means the next
        // access denies and mints an approval link — degraded, not broken.
        console.error('[MCP] Failed to auto-grant agent-created sheet:', err);
        captureServerEvent(conn.user.clerkUserId, 'agent_sheet_created', {
          spreadsheet_id: newId, auto_granted: false,
        });
      }
    }
    return jsonResult(result.data);
  }

  if (cls.kind === 'docs_create') {
    // Agent-created docs are allowed and auto-granted to the calling key
    // (read & write), mirroring sheets_create: the Docs policy protects the
    // user's EXISTING documents, not the agent's own output. drive.file
    // already limits the app to picked files + files it created.
    const result = await googleFetch(rawUrl(cleanPath), resolved.token, method, serializeBody(body), resolved.targetEmail);
    if (!result.ok) return errorResult(result.error);
    const created = result.data as { documentId?: unknown; title?: unknown };
    const newId = typeof created?.documentId === 'string' ? created.documentId : null;
    if (newId) {
      const title = typeof created?.title === 'string' ? created.title : null;
      try {
        const [rule] = await db.insert(accessRules).values({
          userId: conn.user.id,
          ruleName: `Agent-created: ${title || newId}`,
          service: 'docs',
          actionType: 'doc_read_write',
          targetResourceId: newId,
          resourceName: title,
        }).returning();
        await db.insert(keyRuleAssignments).values({ proxyKeyId: resolved.proxyKeyId, accessRuleId: rule.id });
        captureServerEvent(conn.user.clerkUserId, 'agent_doc_created', {
          document_id: newId, auto_granted: true,
        });
        addToolCallProps({ doc_created: true });
      } catch (err) {
        // The doc exists either way; a failed auto-grant just means the next
        // access denies and mints an approval link — degraded, not broken.
        console.error('[MCP] Failed to auto-grant agent-created doc:', err);
        captureServerEvent(conn.user.clerkUserId, 'agent_doc_created', {
          document_id: newId, auto_granted: false,
        });
      }
    }
    return jsonResult(result.data);
  }

  if (cls.kind === 'passthrough') {
    // Classify-don't-block: unknown Google API families are forwarded with
    // the account's token (Google's scopes are the enforcement backstop) and
    // tagged so demand is visible in analytics before we build rules for it.
    addToolCallProps({ raw_api_family: cls.family, raw_api_passthrough: true });
    const result = await googleFetch(rawUrl(cleanPath), resolved.token, method, serializeBody(body), resolved.targetEmail);
    if (!result.ok) return errorResult(result.error);
    return jsonResult(result.data);
  }

  if (cls.kind === 'sheets') {
    const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, cls.spreadsheetId, cls.isMutating);
    if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, cls.spreadsheetId, cls.isMutating));

    const result = await withSheetsGrace(perm, () => googleFetch(rawUrl(cleanPath), resolved.token, method, serializeBody(body), resolved.targetEmail));
    if (!result.ok) return sheetsErrorResult(result, cls.spreadsheetId);
    return jsonResult(result.data);
  }

  if (cls.kind === 'docs') {
    const perm = await checkDocsPermission(conn.user.id, resolved.proxyKeyId, cls.documentId, cls.isMutating);
    if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, docsDenialAction(perm, cls.documentId, cls.isMutating));

    const result = await withDocsGrace(perm, () => googleFetch(rawUrl(cleanPath), resolved.token, method, serializeBody(body), resolved.targetEmail));
    if (!result.ok) return docsErrorResult(result, cls.documentId);
    return jsonResult(result.data);
  }

  const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);

  if (cls.kind === 'gmail_send') {
    const denial = checkSendWhitelist(rules, extractSendRecipients(body));
    if (denial) return sendDenialWithLinks(conn, resolved.proxyKeyId, denial);
  }

  const url = `https://www.googleapis.com/${cleanPath}`;
  const result = await googleFetch(url, resolved.token, method, serializeBody(body), resolved.targetEmail);
  if (!result.ok) return errorResult(result.error);

  if (cls.kind === 'gmail_read') {
    const restriction = checkReadRestrictions(rules, result.data);
    if (restriction) {
      captureServerEvent(conn.user.clerkUserId, 'read_restriction_enforced', { via: 'google_api_get', restriction });
      return textResult(restriction);
    }
  }

  return jsonResult(result.data);
}

// ─── MCP Handler ────────────────────────────────────────────────────────────

function toolConfig<S extends z.ZodRawShape>(def: FgacToolDef, inputSchema: S) {
  return {
    title: def.title,
    description: def.description,
    inputSchema,
    annotations: toolAnnotations(def),
  };
}

const handler = createMcpHandler(
  (server) => {
    // Every registered tool is wrapped with a PostHog `$mcp_tool_call` capture.
    // Patching registerTool here keeps the registrations below untouched (their
    // schema-inferred param types intact) and instruments future tools too.
    const rawRegisterTool = server.registerTool.bind(server) as (
      name: string, config: unknown, cb: unknown,
    ) => ReturnType<typeof server.registerTool>;
    server.registerTool = ((name: string, config: unknown, cb: unknown) =>
      rawRegisterTool(name, config, withToolAnalytics(name, cb as Parameters<typeof withToolAnalytics>[1]))
    ) as unknown as typeof server.registerTool;

    // ── list_accounts ─────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.list_accounts.name,
      toolConfig(TOOL_DEFS.list_accounts, {}),
      async (_params, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;
        if (!conn.proxyKeyId) {
          return textResult('❌ No proxy key assigned.');
        }
        const emails = await getAccessibleEmails(conn.proxyKeyId);
        // Onboarding nudge: list_accounts is most new users' first (and for
        // many, only) call — 2026-08 launch analytics showed a large cohort
        // stopping right here. Tell the agent what a useful next step is and
        // how more mailboxes get added, so the dead end becomes a path.
        return jsonResult({
          accounts: emails.map(e => e.targetEmail),
          default: conn.user.email,
          nickname: conn.nickname,
          next_steps: {
            gmail: "Read a mailbox with gmail_list (pass account: '<address>' to target a specific one; defaults to the primary). Reads work out of the box.",
            sheets: 'Spreadsheet access is granted per sheet: call sheets_get_spreadsheet with a spreadsheetId, or request_access — a denial returns a one-click approval link for the user.',
            docs: 'Google Docs access is granted per document: call docs_read_document with a documentId, or request_access — a denial returns a one-click approval link for the user.',
            sending: 'Email sending is off by default; the first gmail_send returns a one-click approval link the user can use to whitelist the recipient.',
          },
          add_more_accounts: {
            own_account: `To add another Gmail account the user owns: ${DASHBOARD_URL}/dashboard/accounts → "Accessible Gmail Accounts" → add the account and complete Google sign-in for it.`,
            someone_elses: `To access someone else's mailbox: that person signs up at ${DASHBOARD_URL} and uses "Delegations You've Granted" on their own Accounts page to delegate their mailbox to this user. It then appears here automatically.`,
          },
        });
      }
    );

    // ── gmail_list ────────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.gmail_list.name,
      toolConfig(TOOL_DEFS.gmail_list, {
        account: z.string().optional().describe('Email account to use. Defaults to primary.'),
        query: z.string().optional().describe('Gmail search query (e.g., "is:unread")'),
        max: z.number().optional().describe('Max results (default: 10)'),
      }),
      async ({ account, query, max }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('maxResults', String(max || 10));

        const result = await gmailFetch(resolved.token, resolved.targetEmail, `messages?${params}`);
        if (!result.ok) return errorResult(result.error);
        return jsonResult(result.data);
      }
    );

    // ── gmail_read ────────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.gmail_read.name,
      toolConfig(TOOL_DEFS.gmail_read, {
        account: z.string().optional().describe('Email account to use.'),
        messageId: z.string().describe('Gmail message ID'),
        format: z.enum(['full', 'metadata', 'minimal']).optional().describe('Response format. "full" (default) returns parsed headers, body text, and attachment metadata.'),
      }),
      async ({ account, messageId, format }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        // Read-time enforcement: label blacklist/whitelist + content blacklist
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const result = await gmailFetch(resolved.token, resolved.targetEmail, `messages/${messageId}?format=${format || 'full'}`);
        if (!result.ok) return errorResult(result.error);

        const restriction = checkReadRestrictions(rules, result.data);
        if (restriction) {
          captureServerEvent(conn.user.clerkUserId, 'read_restriction_enforced', { via: 'gmail_read', restriction });
          return textResult(restriction);
        }

        // Rules were evaluated on the complete payload; the response is the
        // parsed, token-frugal view unless a lighter format was requested.
        if (!format || format === 'full') {
          return jsonResult(parseGmailMessage(result.data as Record<string, unknown>));
        }
        return jsonResult(result.data);
      }
    );

    // ── gmail_get_attachment ──────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.gmail_get_attachment.name,
      toolConfig(TOOL_DEFS.gmail_get_attachment, {
        messageId: z.string().describe('Gmail message ID containing the attachment'),
        attachmentId: z.string().describe('Attachment ID (from gmail_read attachments list)'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ messageId, attachmentId, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        // Read-time enforcement on the parent message (labels + content rules):
        // an attachment is only as readable as the email that carries it
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const parentResult = await gmailFetch(resolved.token, resolved.targetEmail, `messages/${messageId}?format=full`);
        if (!parentResult.ok) return errorResult(parentResult.error);

        const restriction = checkReadRestrictions(rules, parentResult.data);
        if (restriction) {
          captureServerEvent(conn.user.clerkUserId, 'read_restriction_enforced', { via: 'gmail_get_attachment', restriction });
          return textResult(restriction);
        }

        const attachmentResult = await gmailFetch(
          resolved.token,
          resolved.targetEmail,
          `messages/${messageId}/attachments/${attachmentId}`
        );
        if (!attachmentResult.ok) return errorResult(attachmentResult.error);

        const attachment = attachmentResult.data as { size?: number; data?: string };
        if (attachment.data && attachment.data.length > MAX_ATTACHMENT_CHARS) {
          const approxKb = Math.round((attachment.data.length * 3) / 4 / 1024);
          return textResult(`⚠️ Attachment is ~${approxKb} KB, which exceeds the ~150 KB limit for MCP responses. Ask the user to retrieve it directly from Gmail.`);
        }
        return jsonResult(attachment);
      }
    );

    // ── gmail_send ────────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.gmail_send.name,
      toolConfig(TOOL_DEFS.gmail_send, {
        account: z.string().optional().describe('Email account to send from.'),
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject line'),
        body: z.string().describe('Email body (plain text)'),
      }),
      async ({ account, to, subject, body }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        // Enforce send whitelist
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const denial = checkSendWhitelist(rules, [to]);
        if (denial) return sendDenialWithLinks(conn, resolved.proxyKeyId, denial);

        // Build RFC 2822 message
        const raw = Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url');

        const result = await gmailFetch(resolved.token, resolved.targetEmail, 'messages/send', 'POST', JSON.stringify({ raw }));
        if (!result.ok) return errorResult(result.error);
        return jsonResult(result.data);
      }
    );

    // ── gmail_labels ──────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.gmail_labels.name,
      toolConfig(TOOL_DEFS.gmail_labels, {
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const result = await gmailFetch(resolved.token, resolved.targetEmail, 'labels');
        if (!result.ok) return errorResult(result.error);
        return jsonResult(result.data);
      }
    );

    // ── sheets_get_spreadsheet ────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.sheets_get_spreadsheet.name,
      toolConfig(TOOL_DEFS.sheets_get_spreadsheet, {
        spreadsheetId: z.string().describe('Google Spreadsheet ID (e.g. 1BxiMVs0...)'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ spreadsheetId, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, false);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, spreadsheetId, false));

        const result = await withSheetsGrace(perm, () => sheetsFetch(resolved.token, `${spreadsheetId}`, 'GET', undefined, resolved.targetEmail));
        if (!result.ok) return sheetsErrorResult(result, spreadsheetId);
        return jsonResult(result.data);
      }
    );

    // ── sheets_read_range ─────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.sheets_read_range.name,
      toolConfig(TOOL_DEFS.sheets_read_range, {
        spreadsheetId: z.string().describe('Google Spreadsheet ID'),
        range: z.string().describe("Cell range (e.g. 'Sheet1'!A1:D20 or 'Sheet1')"),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ spreadsheetId, range, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, false);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, spreadsheetId, false));

        const encodedRange = encodeURIComponent(range);
        const result = await withSheetsGrace(perm, () => sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}`, 'GET', undefined, resolved.targetEmail));
        if (!result.ok) return sheetsErrorResult(result, spreadsheetId);
        return jsonResult(result.data);
      }
    );

    // ── sheets_update_range ───────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.sheets_update_range.name,
      toolConfig(TOOL_DEFS.sheets_update_range, {
        spreadsheetId: z.string().describe('Google Spreadsheet ID'),
        range: z.string().describe("Cell range (e.g. 'Sheet1'!A1:B2)"),
        values: z.array(z.array(z.any())).describe('2D array of cell values'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ spreadsheetId, range, values, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, spreadsheetId, true));

        const encodedRange = encodeURIComponent(range);
        const body = JSON.stringify({ values, range });
        const result = await withSheetsGrace(perm, () => sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`, 'PUT', body, resolved.targetEmail));
        if (!result.ok) return sheetsErrorResult(result, spreadsheetId);
        return jsonResult(result.data);
      }
    );

    // ── sheets_append_rows ────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.sheets_append_rows.name,
      toolConfig(TOOL_DEFS.sheets_append_rows, {
        spreadsheetId: z.string().describe('Google Spreadsheet ID'),
        range: z.string().describe("Sheet tab or range to append to (e.g. 'Sheet1')"),
        values: z.array(z.array(z.any())).describe('2D array of rows to append'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ spreadsheetId, range, values, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, spreadsheetId, true));

        const encodedRange = encodeURIComponent(range);
        const body = JSON.stringify({ values });
        const result = await withSheetsGrace(perm, () => sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`, 'POST', body, resolved.targetEmail));
        if (!result.ok) return sheetsErrorResult(result, spreadsheetId);
        return jsonResult(result.data);
      }
    );

    // ── docs_read_document ────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.docs_read_document.name,
      toolConfig(TOOL_DEFS.docs_read_document, {
        documentId: z.string().describe('Google Docs document ID (e.g. 1NQiAY...)'),
        fields: z.string().optional().describe('Optional Docs API field mask to trim the response (e.g. "title,body.content"). Use when a full read is too large.'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ documentId, fields, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const perm = await checkDocsPermission(conn.user.id, resolved.proxyKeyId, documentId, false);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, docsDenialAction(perm, documentId, false));

        const query = fields ? `?fields=${encodeURIComponent(fields)}` : '';
        const result = await withDocsGrace(perm, () => docsFetch(resolved.token, `${encodeURIComponent(documentId)}${query}`, 'GET', undefined, resolved.targetEmail));
        if (!result.ok) return docsErrorResult(result, documentId);
        return jsonResult(result.data);
      }
    );

    // ── docs_append_text ──────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.docs_append_text.name,
      toolConfig(TOOL_DEFS.docs_append_text, {
        documentId: z.string().describe('Google Docs document ID'),
        text: z.string().describe('Plain text to append at the end of the document'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ documentId, text, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const perm = await checkDocsPermission(conn.user.id, resolved.proxyKeyId, documentId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, docsDenialAction(perm, documentId, true));

        const body = JSON.stringify({
          requests: [{ insertText: { endOfSegmentLocation: { segmentId: '' }, text } }],
        });
        const result = await withDocsGrace(perm, () => docsFetch(resolved.token, `${encodeURIComponent(documentId)}:batchUpdate`, 'POST', body, resolved.targetEmail));
        if (!result.ok) return docsErrorResult(result, documentId);
        return jsonResult(result.data);
      }
    );

    // ── docs_replace_text ─────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.docs_replace_text.name,
      toolConfig(TOOL_DEFS.docs_replace_text, {
        documentId: z.string().describe('Google Docs document ID'),
        find: z.string().describe('Text to find (every occurrence is replaced)'),
        replace: z.string().describe('Replacement text'),
        matchCase: z.boolean().optional().describe('Case-sensitive match (default: true)'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ documentId, find, replace, matchCase, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        const perm = await checkDocsPermission(conn.user.id, resolved.proxyKeyId, documentId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, docsDenialAction(perm, documentId, true));

        const body = JSON.stringify({
          requests: [{ replaceAllText: { containsText: { text: find, matchCase: matchCase ?? true }, replaceText: replace } }],
        });
        const result = await withDocsGrace(perm, () => docsFetch(resolved.token, `${encodeURIComponent(documentId)}:batchUpdate`, 'POST', body, resolved.targetEmail));
        if (!result.ok) return docsErrorResult(result, documentId);
        return jsonResult(result.data);
      }
    );

    // ── google_api_get ────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.google_api_get.name,
      toolConfig(TOOL_DEFS.google_api_get, {
        path: z.string().describe('API path (e.g. "gmail/v1/users/me/messages" or "v4/spreadsheets/1BxiM.../values/Sheet1")'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ path, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        return executeRawGoogleCall(conn, resolved, path, 'GET');
      }
    );

    // ── google_api_modify ─────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.google_api_modify.name,
      toolConfig(TOOL_DEFS.google_api_modify, {
        path: z.string().describe('API path (e.g. "gmail/v1/users/me/messages/send" or "v4/spreadsheets/1BxiM.../values/Sheet1:append")'),
        method: z.enum(['POST', 'PUT', 'PATCH']).optional().describe('HTTP method (default: POST)'),
        body: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('Request body (JSON object or string)'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ path, method = 'POST', body, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        return executeRawGoogleCall(conn, resolved, path, method, body);
      }
    );

    // ── request_access ────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.request_access.name,
      toolConfig(TOOL_DEFS.request_access, {
        type: z.enum(['send', 'sheets_read', 'sheets_write', 'docs_read', 'docs_write']).describe('What to request: permission to send email to a recipient, or read / read-write access to a spreadsheet or document'),
        recipient: z.string().optional().describe('Email address to whitelist (required for type "send")'),
        spreadsheetId: z.string().optional().describe('Google Spreadsheet ID (required for sheets types)'),
        documentId: z.string().optional().describe('Google Docs document ID (required for docs types)'),
      }),
      async ({ type, recipient, spreadsheetId, documentId }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;
        if (!conn.proxyKeyId) {
          return textResult('❌ No proxy key assigned to this connection.');
        }

        const REQUESTABLE = 'Requestable permissions: sending to a specific recipient, or read/read-write access to a specific spreadsheet or document.';
        let action: ApprovalAction;
        if (type === 'send') {
          if (!recipient || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient)) {
            return textResult(`🚫 A valid "recipient" email address is required to request send access. ${REQUESTABLE}`);
          }
          action = { action: 'send_whitelist', recipient };
        } else if (type === 'docs_read' || type === 'docs_write') {
          if (!documentId) {
            return textResult(`🚫 A "documentId" is required to request document access. ${REQUESTABLE}`);
          }
          action = type === 'docs_read'
            ? { action: 'docs_expose', documentId }
            : { action: 'docs_write', documentId };
        } else {
          if (!spreadsheetId) {
            return textResult(`🚫 A "spreadsheetId" is required to request spreadsheet access. ${REQUESTABLE}`);
          }
          action = type === 'sheets_read'
            ? { action: 'sheets_expose', spreadsheetId }
            : { action: 'sheets_write', spreadsheetId };
        }

        const { url, jti } = await mintApprovalLink(DASHBOARD_URL, conn.user.id, conn.proxyKeyId, action);
        captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', { action: action.action, via: 'request_access', link_id: jti });
        addToolCallProps({ approval_link_id: jti });
        return jsonResult({
          status: 'approval_required',
          summary: action.action === 'send_whitelist'
            ? `Requesting permission to send email to ${recipient}`
            : action.action.startsWith('docs')
              ? `Requesting ${type === 'docs_read' ? 'read-only' : 'read & write'} access to document ${documentId}`
              : `Requesting ${type === 'sheets_read' ? 'read-only' : 'read & write'} access to spreadsheet ${spreadsheetId}`,
          approvalUrl: url,
          note: `Nothing has been granted. Show the approval link to the user VERBATIM as a clickable URL — it is single-use, expires in ${approvalLinkMinutes(action.action)} minutes, and only they can approve it. Do not retry the original operation until they confirm; if the link expires unused, call request_access again.`,
        });
      }
    );

    // ── get_my_permissions ────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.get_my_permissions.name,
      toolConfig(TOOL_DEFS.get_my_permissions, {}),
      async (_params, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;
        if (!conn.proxyKeyId) {
          return textResult('❌ No proxy key assigned.');
        }

        const emails = await getAccessibleEmails(conn.proxyKeyId);
        const key = await db.select().from(proxyKeys)
          .where(eq(proxyKeys.id, conn.proxyKeyId)).then(r => r[0]);

        // Only the rules that actually apply to THIS key: global rules
        // (no assignments) plus rules assigned to it. Returning the owner's
        // full rule set leaked rules scoped to other keys/profiles.
        const allRules = await db.select().from(accessRules)
          .where(eq(accessRules.userId, conn.user.id));
        const allAssignments = await db.select().from(keyRuleAssignments);
        const rulesWithAssignments = new Set(allAssignments.map(a => a.accessRuleId));
        const assignedToThisKey = new Set(
          allAssignments.filter(a => a.proxyKeyId === conn.proxyKeyId).map(a => a.accessRuleId),
        );
        const applicableRules = allRules.filter(r =>
          !rulesWithAssignments.has(r.id) || assignedToThisKey.has(r.id),
        );

        return jsonResult({
          connection: { id: conn.connectionId, nickname: conn.nickname },
          proxyKey: { id: key?.id, label: key?.label },
          accessibleEmails: emails.map(e => e.targetEmail),
          // Implicit posture, stated explicitly: an empty rules array does
          // NOT mean "no access" — auditors reading this output must see
          // what the key can reach by default (tester finding, 2026-08-15).
          defaults: {
            gmailRead: 'ALLOWED by default for every accessible email; read-block rules (label/content) below restrict it',
            gmailSend: 'DENIED unless a send_whitelist rule matches the recipient',
            sheets: 'DENIED unless a per-spreadsheet rule below exposes the sheet',
            docs: 'DENIED unless a per-document rule below exposes the document',
            deletion: 'NEVER available through any tool',
          },
          rules: applicableRules.map(r => ({
            name: r.ruleName,
            type: r.actionType,
            pattern: r.regexPattern,
            email: r.targetEmail || 'all',
            scope: rulesWithAssignments.has(r.id) ? 'this-key' : 'global',
            // Per-file rules: without the file id an agent cannot locate
            // the file it was granted access to.
            ...(r.service === 'sheets'
              ? { spreadsheetId: r.targetResourceId, resourceName: r.resourceName }
              : {}),
            ...(r.service === 'docs'
              ? { documentId: r.targetResourceId, resourceName: r.resourceName }
              : {}),
          })),
        });
      }
    );
  },
  {
    serverInfo: {
      name: 'fgac',
      version: '1.3.0',
    },
  },
  {
    basePath: '/api',
    verboseLogs: false,
  }
);

// ─── Authentication ─────────────────────────────────────────────────────────

/**
 * The only issuer this server accepts tokens from: the Clerk frontend API
 * derived from our own publishable key. Deriving the JWKS location from the
 * token's `iss` claim would let ANY issuer mint accepted tokens.
 */
function expectedClerkIssuer(): string | null {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!pk) return null;
  try {
    const domain = Buffer.from(pk.replace(/^pk_(test|live)_/, ''), 'base64')
      .toString('utf8')
      .replace(/\$$/, '');
    return domain ? `https://${domain}` : null;
  } catch {
    return null;
  }
}

/**
 * Direct JWT verification fallback for CLI/non-browser OAuth tokens.
 * Used when Clerk's auth()+verifyClerkToken fails to extract userId/clientId.
 * Fails closed unless the token's issuer is exactly our Clerk instance.
 */
async function verifyClerkJwtDirect(token: string) {
  try {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return undefined;
    const rawPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const issuer = rawPayload.iss;

    const expected = expectedClerkIssuer();
    if (!expected || issuer !== expected) {
      console.error(`[MCP] Rejecting token from unexpected issuer '${issuer}' (expected '${expected ?? 'unavailable'}')`);
      return undefined;
    }

    const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    const { payload: verified } = await jwtVerify(token, JWKS, { issuer, clockTolerance: 30 });
    const sub = verified.sub;
    const cid = (verified as Record<string, unknown>).client_id as string | undefined;
    if (!sub || !cid) return undefined;

    return {
      token,
      scopes: ((verified as Record<string, unknown>).scope as string || '').split(' '),
      clientId: cid,
      extra: { userId: sub },
    };
  } catch (err) {
    console.error('[MCP] Direct JWT verification failed:', err);
    return undefined;
  }
}

const verifyMcpAuth = async (req: Request, bearerToken?: string) => {
  let authInfo: ReturnType<typeof verifyClerkToken> | Awaited<ReturnType<typeof verifyClerkJwtDirect>> | undefined;

  // Strategy 1: Try Clerk's built-in auth() + verifyClerkToken
  try {
    const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
    const result = verifyClerkToken(clerkAuth, bearerToken);
    if (result?.extra?.userId) authInfo = result;
  } catch (error) {
    console.warn('[MCP] Clerk auth() failed, will try direct JWT:', error);
  }

  // Strategy 2: Direct JWT verification (fallback for CLI/non-browser contexts)
  if (!authInfo && bearerToken) {
    console.log('[MCP] Falling back to direct JWT verification');
    authInfo = await verifyClerkJwtDirect(bearerToken);
  }

  // Install-funnel measurement (pre-Clerk visibility): an unauthenticated MCP
  // request is the first FGAC-owned touchpoint when a client adds the
  // connector — the 401 issued below is what sends it into OAuth discovery.
  // Anonymous by design (distinct_id is already excluded from user metrics);
  // this is a rate metric, not an identity metric. reason='no_token' on POST
  // approximates fresh install attempts; 'invalid_token' is mostly token
  // expiry/refresh noise from established clients.
  if (!authInfo) {
    captureServerEvent('anonymous-mcp', 'connector_install_started', {
      touchpoint: 'mcp_401',
      reason: bearerToken ? 'invalid_token' : 'no_token',
      method: req.method,
      user_agent: req.headers.get('user-agent') ?? undefined,
    });
  }

  // Eagerly create/touch agent_connection on ANY authenticated request
  // (including initialize), so connections appear in the dashboard immediately.
  // Tool handlers still call requireApproval() as a fallback safety net.
  // Awaited: fire-and-forget raced the tool handler's own resolveConnection
  // on a client's very first call and surfaced a SQL error (QA cap 06 A3).
  if (authInfo) {
    const userId = authInfo.extra?.userId as string | undefined;
    const clientId = (authInfo as Record<string, unknown>).clientId as string | undefined;
    if (userId && clientId) {
      try {
        await resolveConnection(userId, clientId);
      } catch (err) {
        console.error('[MCP] Eager connection creation failed:', err);
      }
    }
  }

  return authInfo;
};

// All verbs run behind auth: unauthenticated requests — including the
// streamable-HTTP GET (SSE) and DELETE (session teardown) — must get the
// 401 + WWW-Authenticate handshake, not an unauthenticated handler.
const authedHandler = experimental_withMcpAuth(
  handler,
  verifyMcpAuth,
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  }
);

export const POST = authedHandler;
export const GET = authedHandler;
export const DELETE = authedHandler;

// Headroom for the sheets grant-propagation grace retries (≤ ~7 s added on
// top of normal Google latency) — never let them race the function timeout.
export const maxDuration = 60;
