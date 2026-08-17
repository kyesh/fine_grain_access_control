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
import { mintApprovalUrl, type ApprovalAction } from '@/lib/approvalLinks';
import { TOOL_DEFS, toolAnnotations, type FgacToolDef } from './toolDefs';
import {
  classifyGoogleApiCall, extractSendRecipients, sheetsApprovalAction,
} from './googleApiPolicy';

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

/** Upstream Google failure → tool result. States the user can fix (expired
 * Google auth, a sheet not shared with the connected account, a bad resource
 * id) are the connector guiding the user, not malfunctioning — returned as
 * plain text, so only genuine failures (network, 429, 5xx) carry isError. */
const upstreamResult = (r: { error: string; recoverable: boolean }) =>
  r.recoverable ? textResult(r.error) : errorResult(r.error);

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
  const tokenResponse = await client.users.getUserOauthAccessToken(tokenOwnerClerkId, 'oauth_google');
  return tokenResponse.data?.[0]?.token || null;
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
type SendDenial = { message: string; deniedRecipient?: string };

function checkSendWhitelist(rules: ApplicableRules, recipients: string[] | null): SendDenial | null {
  const sendRules = rules.filter(r => r.service === 'gmail' && r.actionType === 'send_whitelist');

  if (!recipients || recipients.length === 0) {
    return { message: '🚫 Could not determine the message recipients, so sending was denied. Provide a standard RFC 2822 message with To/Cc/Bcc headers.' };
  }

  if (sendRules.length === 0) {
    return {
      message: '🚫 Sending is disabled on this profile (no send whitelist configured). This is the safe default.',
      deniedRecipient: recipients[0],
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
      };
    }
  }

  return null;
}

/**
 * Magic-link denial (connector-growth Phase C): policy denials that a user
 * would plausibly want to approve carry a signed, single-use, 15-minute link
 * that pre-fills exactly that grant. Explicit blocks and read restrictions
 * never get links — weakening those stays a deliberate dashboard act.
 */
async function policyDenialWithLink(
  conn: ConnectionApproved,
  proxyKeyId: string,
  message: string,
  action: ApprovalAction | null,
) {
  if (!action) return textResult(message);
  try {
    const url = await mintApprovalUrl(DASHBOARD_URL, conn.user.id, proxyKeyId, action);
    captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', { action: action.action });
    return textResult(
      `${message}\n👉 Share this link with the user to approve it in one click (single-use, expires in 15 minutes): ${url}`,
    );
  } catch (err) {
    console.error('[MCP] Failed to mint approval link:', err);
    return textResult(message);
  }
}

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
  try {
    if (denial.deniedRecipient) {
      const oneUrl = await mintApprovalUrl(DASHBOARD_URL, conn.user.id, proxyKeyId, {
        action: 'send_whitelist', recipient: denial.deniedRecipient,
      });
      lines.push(`👉 Allow sending to '${denial.deniedRecipient}' only — share this one-click link with the user (single-use, expires in 15 minutes): ${oneUrl}`);
    }
    const allUrl = await mintApprovalUrl(DASHBOARD_URL, conn.user.id, proxyKeyId, { action: 'send_all' });
    lines.push(`👉 Or allow sending to ANY recipient from this profile — share this one-click link with the user instead (single-use, expires in 15 minutes): ${allUrl}`);
    lines.push('Present both options and let the user pick; "any recipient" is the convenient choice if they expect to send freely, and it stays revocable from the dashboard rules.');
    captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', { action: 'send' });
  } catch (err) {
    console.error('[MCP] Failed to mint approval link:', err);
  }
  return textResult(lines.join('\n'));
}

// ─── Google API Helpers ─────────────────────────────────────────────────────

type GoogleFetchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; recoverable: boolean };

/** Statuses a user can fix themselves (reconnect Google, share the sheet,
 * correct an id). Everything else — network, 429, 5xx — is a genuine failure. */
const RECOVERABLE_GOOGLE_STATUSES = new Set([401, 403, 404]);

function describeGoogleError(status: number, data: unknown, targetEmail: string): string {
  const detail = (data as { error?: { message?: string } })?.error?.message
    || (typeof data === 'string' ? data.slice(0, 300) : '');
  switch (status) {
    case 401:
      return `❌ Google authorization expired for '${targetEmail}'. The account owner needs to reconnect Google in the FGAC dashboard, then retry.`;
    case 403:
      return `❌ Google denied the request (403): ${detail || 'insufficient permissions or missing OAuth scope for this operation'}.${targetEmail ? ` If this is a spreadsheet, share it with '${targetEmail}' and retry; otherwise the account owner may need to reconnect Google from the FGAC dashboard to grant the needed scopes.` : ''}`;
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
    return { ok: false, error: `❌ Could not reach the Google API: ${err instanceof Error ? err.message : 'network error'}.`, recoverable: false };
  }

  const text = await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body: keep text */ }

  if (!res.ok) {
    return {
      ok: false,
      error: describeGoogleError(res.status, data, targetEmail),
      recoverable: RECOVERABLE_GOOGLE_STATUSES.has(res.status),
    };
  }
  return { ok: true, data };
}

async function gmailFetch(token: string, email: string, path: string, method = 'GET', body?: string): Promise<GoogleFetchResult> {
  const userId = email === 'me' ? 'me' : encodeURIComponent(email);
  return googleFetch(`https://www.googleapis.com/gmail/v1/users/${userId}/${path}`, token, method, body, email);
}

async function sheetsFetch(token: string, path: string, method = 'GET', body?: string, targetEmail = ''): Promise<GoogleFetchResult> {
  return googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, token, method, body, targetEmail);
}

async function checkSheetsPermission(userId: string, proxyKeyId: string, spreadsheetId: string, isMutating: boolean) {
  const allRules = await db.select().from(accessRules).where(eq(accessRules.userId, userId));
  const keyAssignments = await db.select().from(keyRuleAssignments).where(eq(keyRuleAssignments.proxyKeyId, proxyKeyId));
  const assignedRuleIds = new Set(keyAssignments.map(a => a.accessRuleId));
  const allAssignments = await db.select().from(keyRuleAssignments);
  const rulesWithAssignments = new Set(allAssignments.map(a => a.accessRuleId));

  const sheetsRules = allRules.filter(rule => {
    if (rule.service !== 'sheets') return false;
    const isGlobal = !rulesWithAssignments.has(rule.id);
    const isAssigned = assignedRuleIds.has(rule.id);
    const matchesId = rule.targetResourceId === spreadsheetId || rule.regexPattern === spreadsheetId;
    return (isGlobal || isAssigned) && matchesId;
  });

  if (sheetsRules.length === 0) {
    return { allowed: false as const, denial: 'not_exposed' as const, reason: `🚫 Access Denied: Spreadsheet '${spreadsheetId}' is not exposed in your FGAC rules.` };
  }

  if (sheetsRules.some(r => r.actionType === 'sheet_block')) {
    return { allowed: false as const, denial: 'blocked' as const, reason: `🚫 Access Denied: Access to spreadsheet '${spreadsheetId}' is explicitly blocked.` };
  }

  if (isMutating) {
    const hasReadWrite = sheetsRules.some(r => r.actionType === 'sheet_read_write');
    if (!hasReadWrite) {
      return { allowed: false as const, denial: 'read_only' as const, reason: `🚫 Access Denied: Write access to spreadsheet '${spreadsheetId}' is restricted (Read Only).` };
    }
  }

  return { allowed: true as const };
}

type SheetsPermission = Awaited<ReturnType<typeof checkSheetsPermission>>;

/** Map a sheets denial onto an approvable action matching the access level
 * the denied operation requires (see sheetsApprovalAction in googleApiPolicy). */
function sheetsDenialAction(perm: SheetsPermission, spreadsheetId: string, isMutating: boolean): ApprovalAction | null {
  if (perm.allowed) return null;
  return sheetsApprovalAction(perm.denial, spreadsheetId, isMutating);
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
  if (cls.kind === 'denied') return textResult(cls.reason);

  const cleanPath = path.replace(/^\/+/, '');

  if (cls.kind === 'sheets') {
    const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, cls.spreadsheetId, cls.isMutating);
    if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, cls.spreadsheetId, cls.isMutating));

    const url = `https://sheets.googleapis.com/${cleanPath.replace(/^sheets\//, '')}`;
    const result = await googleFetch(url, resolved.token, method, serializeBody(body), resolved.targetEmail);
    if (!result.ok) return upstreamResult(result);
    return jsonResult(result.data);
  }

  const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);

  if (cls.kind === 'gmail_send') {
    const denial = checkSendWhitelist(rules, extractSendRecipients(body));
    if (denial) return sendDenialWithLinks(conn, resolved.proxyKeyId, denial);
  }

  const url = `https://www.googleapis.com/${cleanPath}`;
  const result = await googleFetch(url, resolved.token, method, serializeBody(body), resolved.targetEmail);
  if (!result.ok) return upstreamResult(result);

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
        return jsonResult({
          accounts: emails.map(e => e.targetEmail),
          default: conn.user.email,
          nickname: conn.nickname,
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
        if (!result.ok) return upstreamResult(result);
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
        if (!result.ok) return upstreamResult(result);

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
        if (!parentResult.ok) return upstreamResult(parentResult);

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
        if (!attachmentResult.ok) return upstreamResult(attachmentResult);

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
        if (!result.ok) return upstreamResult(result);
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
        if (!result.ok) return upstreamResult(result);
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

        const result = await sheetsFetch(resolved.token, `${spreadsheetId}`, 'GET', undefined, resolved.targetEmail);
        if (!result.ok) return upstreamResult(result);
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
        const result = await sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}`, 'GET', undefined, resolved.targetEmail);
        if (!result.ok) return upstreamResult(result);
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
        const result = await sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`, 'PUT', body, resolved.targetEmail);
        if (!result.ok) return upstreamResult(result);
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
        const result = await sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`, 'POST', body, resolved.targetEmail);
        if (!result.ok) return upstreamResult(result);
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
        type: z.enum(['send', 'sheets_read', 'sheets_write']).describe('What to request: permission to send email to a recipient, or read / read-write access to a spreadsheet'),
        recipient: z.string().optional().describe('Email address to whitelist (required for type "send")'),
        spreadsheetId: z.string().optional().describe('Google Spreadsheet ID (required for sheets types)'),
      }),
      async ({ type, recipient, spreadsheetId }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;
        if (!conn.proxyKeyId) {
          return textResult('❌ No proxy key assigned to this connection.');
        }

        let action: ApprovalAction;
        if (type === 'send') {
          if (!recipient || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient)) {
            return textResult('🚫 A valid "recipient" email address is required to request send access. Requestable permissions: sending to a specific recipient, or read/read-write access to a specific spreadsheet.');
          }
          action = { action: 'send_whitelist', recipient };
        } else {
          if (!spreadsheetId) {
            return textResult('🚫 A "spreadsheetId" is required to request spreadsheet access. Requestable permissions: sending to a specific recipient, or read/read-write access to a specific spreadsheet.');
          }
          action = type === 'sheets_read'
            ? { action: 'sheets_expose', spreadsheetId }
            : { action: 'sheets_write', spreadsheetId };
        }

        const url = await mintApprovalUrl(DASHBOARD_URL, conn.user.id, conn.proxyKeyId, action);
        captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', { action: action.action, via: 'request_access' });
        return jsonResult({
          status: 'approval_required',
          summary: action.action === 'send_whitelist'
            ? `Requesting permission to send email to ${recipient}`
            : `Requesting ${type === 'sheets_read' ? 'read-only' : 'read & write'} access to spreadsheet ${spreadsheetId}`,
          approvalUrl: url,
          note: 'Nothing has been granted. Share the approval link with the user — it is single-use, expires in 15 minutes, and only they can approve it. Retry the original operation after they approve.',
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
            deletion: 'NEVER available through any tool',
          },
          rules: applicableRules.map(r => ({
            name: r.ruleName,
            type: r.actionType,
            pattern: r.regexPattern,
            email: r.targetEmail || 'all',
            scope: rulesWithAssignments.has(r.id) ? 'this-key' : 'global',
            // Sheets rules are per-file: without the spreadsheet id an
            // agent cannot locate the file it was granted access to.
            ...(r.service === 'sheets'
              ? { spreadsheetId: r.targetResourceId, resourceName: r.resourceName }
              : {}),
          })),
        });
      }
    );
  },
  {
    serverInfo: {
      name: 'fgac',
      version: '1.1.0',
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

const verifyMcpAuth = async (_req: Request, bearerToken?: string) => {
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
