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
 * Directory requirements. Raw Google API calls are classified (allow-by-default,
 * with sends whitelisted and scopes as the backstop) in ./googleApiPolicy.ts.
 */
import { createMcpHandler, experimental_withMcpAuth } from 'mcp-handler';
import type { JWTVerifyGetKey } from 'jose';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { db } from '@/db';
import {
  agentConnections, users, proxyKeys, keyEmailAccess,
  accessRules, keyRuleAssignments, emailDelegations,
} from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { filterLiveDelegatedAccess } from '@/db/delegationQueries';
import { clerkClient } from '@clerk/nextjs/server';
import { resolveDbUser } from '@/db/userHelpers';
import { loadApplicableRules, checkReadRestrictions, type ApplicableRules } from '@/lib/gmailRules';
import { extractAttachmentText } from '@/lib/attachmentText';
import { compileRulePattern } from '@/lib/rulePatterns';
import { captureServerEvent } from '@/lib/posthogServer';
import { runWithToolCallProps, addToolCallProps, getToolCallProps } from '@/lib/toolCallContext';
import { GOOGLE_FETCH_TIMEOUT_MS, CLERK_TOKEN_TIMEOUT_MS, withTimeout, isUpstreamTimeout } from '@/lib/upstreamTimeouts';
import { installFingerprint, parseInitializeClientInfo, type McpClientInfo } from '@/lib/mcpClientSignals';
import { inSuccessSample, AUTH_SUCCESS_SAMPLE } from '@/lib/authSampling';
import { ensureDefaultProfile } from '@/db/defaultProfile';
import { mintApprovalLink, type ApprovalAction } from '@/lib/approvalLinks';
import { connectionsDeepLink } from '@/lib/dashboardAgentLinks';
import { recordApprovalMint } from '@/lib/approvalRequests';
import { TOOL_DEFS, toolAnnotations, type FgacToolDef } from './toolDefs';
import {
  classifyGoogleApiCall, extractSendRecipients, extractDraftSendInfo, sheetsApprovalAction, docsApprovalAction,
  templateGoogleApiPath, rawApiFamily, extractGoogleErrorReason,
  type RawCallClass, type GoogleErrorReason,
} from './googleApiPolicy';
import { DRIVE_FILE_KINDS, ACTIVE_DRIVE_FILE_KINDS, type DriveFileKind } from '@/lib/driveFileKinds';
import { clerkPrimaryEmail } from '@/lib/clerkPrimaryEmail';
import { slugifyProfileLabel } from '@/lib/profileSlugs';
import { logAndSanitize, describeErrorForLog, toolErrorResult } from '@/lib/serverErrors';

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

/**
 * One-click reconnect link, bound to the account it is meant to repair. The
 * `for=` param lets the Accounts page refuse to auto-fire reconnect when the
 * browser that opens the link is signed in to a DIFFERENT FGAC user — without
 * it, the wrong user's grant gets "repaired" and reported as success while
 * the affected account stays broken (2026-08-30 incident). `targetEmail` is
 * the mailbox owner: for delegated mailboxes that owner — not the key owner —
 * is the one who must run the reconnect.
 */
function reconnectLink(targetEmail: string): string {
  return `${DASHBOARD_URL}/dashboard/accounts?reconnect=1&for=${encodeURIComponent(targetEmail)}`;
}

/** Per-account bound on the list_accounts scope probes — deliberately far
 * below CLERK_TOKEN_TIMEOUT_MS (15 s): list_accounts is the first tool most
 * agents call, and the probes run one per accessible account. A probe that
 * misses the bound reports scope state 'unknown', never an error. */
const LIST_ACCOUNTS_SCOPE_PROBE_TIMEOUT_MS = 4_000;

// ─── Connection Resolution ──────────────────────────────────────────────────

interface ConnectionApproved {
  authorized: true;
  reason: 'approved';
  connectionId: string;
  proxyKeyId: string | null;
  nickname: string | null;
  clientName: string | null;
  user: { id: string; email: string; clerkUserId: string };
}

interface ConnectionDenied {
  authorized: false;
  reason: 'pending_approval' | 'blocked' | 'no_client_id' | 'user_not_found' | 'no_auth';
  dashboardUrl?: string;
  connectionId?: string;
}

type ConnectionResult = ConnectionApproved | ConnectionDenied;

/** Resolve a profile-addressed MCP URL's slug (set by middleware from
 * /api/mcp/<slug>) to one of THIS user's live profiles. The slug is
 * addressing, not authorization: an unknown slug falls back to the default
 * profile rather than failing, so a renamed profile degrades gracefully. */
async function findProfileBySlug(userId: string, slug: string) {
  const keys = await db.query.proxyKeys.findMany({
    where: and(eq(proxyKeys.userId, userId), isNull(proxyKeys.revokedAt)),
  });
  return keys.find((k) => slugifyProfileLabel(k.label) === slug);
}

async function resolveConnection(
  userId: string,
  clientId: string | undefined,
  // Self-reported name/version from an MCP `initialize` request — only the
  // auth layer's eager resolve ever has it (tool handlers see later POSTs,
  // which carry no clientInfo in stateless mode).
  clientHint?: McpClientInfo,
  // Profile slug from a profile-addressed URL (/api/mcp/<slug>). Applies only
  // when the connection is FIRST created; an existing connection keeps its
  // dashboard-managed binding regardless of which URL requests arrive on.
  profileSlug?: string,
): Promise<ConnectionResult> {
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
      const email = clerkPrimaryEmail(clerkUser);

      if (!email) {
        return { authorized: false, reason: 'user_not_found' };
      }

      user = await resolveDbUser(userId, email);
      console.log(`[MCP] Auto-created DB user for ${email}`);
    } catch (err) {
      console.error('[MCP] Failed to auto-create user:', describeErrorForLog(err));
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
    // A profile-addressed URL (/api/mcp/<slug>) overrides the default with
    // the caller's own matching profile.
    const slugKey = profileSlug ? await findProfileBySlug(user.id, profileSlug) : undefined;
    const defaultKey = slugKey ?? await ensureDefaultProfile(user.id, user.email);
    if (profileSlug) {
      console.log(`[MCP] Profile slug '${profileSlug}' ${slugKey ? `matched profile '${slugKey.label}' (${slugKey.id})` : 'matched no live profile — falling back to default'} for user=${user.email}`);
    }
    try {
      const [newConn] = await db.insert(agentConnections).values({
        userId: user.id,
        clientId,
        // Real product name when the creating request was `initialize`;
        // the opaque client_id otherwise (later initializes backfill it).
        clientName: clientHint?.name ?? clientId,
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
        client_name: clientHint?.name,
        client_version: clientHint?.version,
        auto_attached: true,
        profile_slug: profileSlug,
        profile_slug_matched: profileSlug ? !!slugKey : undefined,
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

  // Backfill-on-touch: rows created before initialize-time capture (or by a
  // tool-handler resolve losing the race) hold the opaque client_id as their
  // name; the next initialize replaces it. Never overwrites a real name.
  const backfillName =
    clientHint?.name && connection.clientName === connection.clientId
      ? { clientName: clientHint.name }
      : {};
  await db.update(agentConnections)
    .set({ lastUsedAt: new Date(), ...backfillName })
    .where(eq(agentConnections.id, connection.id));
  if (backfillName.clientName) {
    connection.clientName = backfillName.clientName;
    // The row is almost never created by the initialize POST itself — the
    // client's concurrent SSE GET (no body, no clientInfo) usually wins the
    // insert race — so mcp_connection_created fires nameless (measured
    // 2026-08-29: 0 of 10 events since 08-27 carried client_name). This
    // one-time event, on the opaque-id → product-name transition, is the
    // reliable connection→client mapping; join on connection_id.
    captureServerEvent(user.clerkUserId, 'mcp_connection_client_identified', {
      connection_id: connection.id,
      client_id: clientId,
      client_name: clientHint?.name,
      client_version: clientHint?.version,
    });
  }

  if (connection.status === 'pending') {
    return {
      authorized: false,
      reason: 'pending_approval',
      connectionId: connection.id,
      dashboardUrl: await connectionsDeepLink(DASHBOARD_URL, user.id),
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
    clientName: connection.clientName,
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

/**
 * Whether `email` belongs to the key owner's own Clerk account — a verified
 * email address or the connected Google external account. Guards against
 * identity drift: `users.email` once tracked `emailAddresses[0]`, whose order
 * changes when a second address is added, so a key's own-mailbox access row
 * can legitimately name an address that no longer equals `users.email`
 * (support case 2026-08-24). Only consulted after the delegation lookup
 * fails, so it costs nothing on the happy paths.
 */
async function isOwnClerkEmail(clerkUserId: string, email: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(clerkUserId);
    const target = email.toLowerCase();
    const ownVerified = clerkUser.emailAddresses.some(
      e => e.emailAddress.toLowerCase() === target && e.verification?.status === 'verified',
    );
    const ownGoogle = clerkUser.externalAccounts.some(
      e => (e.provider === 'oauth_google' || (e.provider as string) === 'google') &&
        e.emailAddress?.toLowerCase() === target,
    );
    return ownVerified || ownGoogle;
  } catch (err) {
    console.error('[MCP] Clerk lookup failed while checking own-email fallback:', err);
    return false;
  }
}

/**
 * The one Gmail scope FGAC requests at sign-in (src/app/layout.tsx), plus the
 * broader legacy grant that also covers every Gmail call. Google's granular
 * consent screen lets a user finish sign-in with the Gmail checkbox unchecked —
 * Clerk then holds a verified account whose token Google 403s on every Gmail
 * call, forever. The dashboard detects that state (googleAccess.ts); the MCP
 * path must too, or the user is silently locked out of Gmail tools while
 * everything else half-works.
 */
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'];
// Every non-Gmail surface (Sheets, Docs, Slides, Drive) rides drive.file;
// the full drive scope would also satisfy it if a grant ever carried one.
const DRIVE_FILE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'];

type GoogleTokenResult = {
  token: string;
  /** undefined = Clerk did not report scopes; never enforce on missing metadata. */
  hasGmailScope?: boolean;
  /** undefined = Clerk did not report scopes; never enforce on missing metadata. */
  hasDriveFileScope?: boolean;
};

/**
 * `quiet` suppresses the PostHog captures and tool-call props this function
 * stamps (google_token_identity_fallback / google_token_fetch_failed /
 * google_token_error / token_ms). The list_accounts scope probe runs this
 * once per accessible account on the first tool most agents call — letting
 * those probes fire the events would corrupt the monitoring counts in
 * docs/monitoring.md §7.4/§7.6, whose queries count the events unfiltered.
 */
async function getGoogleToken(
  targetEmail: string, keyOwner: { id: string; email: string; clerkUserId: string },
  { quiet = false }: { quiet?: boolean } = {},
): Promise<GoogleTokenResult | null> {
  let tokenOwnerClerkId: string;

  if (targetEmail.toLowerCase() === keyOwner.email.toLowerCase()) {
    tokenOwnerClerkId = keyOwner.clerkUserId;
  } else {
    // Delegated email — find the email owner
    const emailOwner = await db.select().from(users)
      .where(eq(users.email, targetEmail))
      .limit(1).then(r => r[0]);

    // Verify active delegation
    const delegation = emailOwner
      ? await db.select().from(emailDelegations)
          .where(and(
            eq(emailDelegations.ownerUserId, emailOwner.id),
            eq(emailDelegations.delegateUserId, keyOwner.id),
            eq(emailDelegations.status, 'active'),
          )).limit(1).then(r => r[0])
      : undefined;

    if (emailOwner && delegation) {
      tokenOwnerClerkId = emailOwner.clerkUserId;
    } else if (await isOwnClerkEmail(keyOwner.clerkUserId, targetEmail)) {
      // Not a delegation — the address is the key owner's own mailbox under a
      // drifted `users.email`. Use their token and record that the fallback
      // fired so analytics can watch the drift population shrink.
      //
      // Two signals, deliberately: the tool-call property attributes the
      // fallback to the individual call, while the standalone event is the
      // countable one — it is unsampled and does not depend on the enclosing
      // $mcp_tool_call, so `uniq(person)` over it is the size of the drifted
      // population still being rescued. The monitoring runbook watches this
      // count fall to zero as the population self-heals (docs/monitoring.md).
      if (!quiet) {
        addToolCallProps({ google_token_identity_fallback: true });
        captureServerEvent(keyOwner.clerkUserId, 'google_token_identity_fallback', {
          via: 'mcp',
        });
      }
      tokenOwnerClerkId = keyOwner.clerkUserId;
    } else {
      return null;
    }
  }

  const client = await clerkClient();
  const tokenStarted = Date.now();
  try {
    const tokenResponse = await withTimeout(
      client.users.getUserOauthAccessToken(tokenOwnerClerkId, 'oauth_google'),
      CLERK_TOKEN_TIMEOUT_MS,
    );
    if (!quiet) addToolCallProps({ token_ms: Date.now() - tokenStarted });
    const grant = tokenResponse.data?.[0];
    if (!grant?.token) {
      if (!quiet) addToolCallProps({ google_token_error: 'no_token' });
      return null;
    }
    // Clerk reports the scopes Google actually granted (the dashboard's
    // checkGoogleAccess already treats a missing scope here as "not
    // connected"). Only computed here — gmailScopeDenial does the enforcement
    // and the analytics, so a sheets-only call by a Gmail-scope-less user
    // records nothing.
    const scopes = Array.isArray(grant.scopes) ? grant.scopes : undefined;
    const hasGmailScope = scopes ? scopes.some(s => GMAIL_SCOPES.includes(s)) : undefined;
    const hasDriveFileScope = scopes ? scopes.some(s => DRIVE_FILE_SCOPES.includes(s)) : undefined;
    return { token: grant.token, hasGmailScope, hasDriveFileScope };
  } catch (err) {
    // Observability for the "Clerk cannot refresh the Google token" failure
    // mode (Clerk 422: grant stored without a refresh token — seen on the
    // dev instance 2026-08-20, cause unconfirmed in prod). Without this,
    // these failures are indistinguishable from generic errors in analytics.
    const message = err instanceof Error ? err.message : String(err);
    const reason = err instanceof Error && err.name === 'TimeoutError'
      ? 'timeout'
      : /refresh/i.test(message) ? 'refresh_failed' : 'clerk_error';
    if (!quiet) {
      addToolCallProps({ token_ms: Date.now() - tokenStarted });
      addToolCallProps({ google_token_error: reason });
      captureServerEvent(keyOwner.clerkUserId, 'google_token_fetch_failed', {
        reason,
        via: 'mcp',
        account_delegated: targetEmail.toLowerCase() !== keyOwner.email.toLowerCase(),
      });
    }
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
      const regex = compileRulePattern(rule.regexPattern);
      if (!regex) continue;
      if (regex.test(recipient)) { isWhitelisted = true; break; }
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
 * would plausibly want to approve carry a signed link that pre-fills exactly
 * that grant. The link is DETERMINISTIC — denying the same operation again
 * re-emits the same URL rather than minting a new one — and does not expire.
 * Every attempt is still recorded, so demand (rows in approval_requests) stays
 * separable from retry pressure (mintCount). Explicit blocks and read
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
    const { url, requestId, targetHash } = await mintApprovalLink(DASHBOARD_URL, conn.user.id, proxyKeyId, action);
    const mintCount = await recordApprovalMint({
      requestId, userId: conn.user.id, proxyKeyId, action: action.action, targetHash,
    });
    captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', {
      action: action.action, request_id: requestId, target_hash: targetHash, mint_count: mintCount,
    });
    addToolCallProps({ approval_request_id: requestId });
    // The user-facing sentence exists because the denial text above is
    // FGAC-jargon the agent tends to paraphrase AT the user ("not exposed in
    // your FGAC rules") — and measured 2026-08-25→29, 62% of file-approval
    // links were never opened while every opened+approved link now verifies
    // clean, so the remaining funnel loss is entirely in getting the click.
    // A quotable, jargon-free line doubles the URL's survival odds in
    // paraphrase and tells the user why clicking is safe.
    return textResult(
      `${message}\n👉 Share this link with the user to approve it in one click: ${url}\n` +
      `Suggested wording to relay: "FGAC is blocking this until you approve it here: ${url} — one click, and you can revoke it any time from your dashboard."\n` +
      AGENT_APPROVAL_PROTOCOL,
    );
  } catch (err) {
    console.error('[MCP] Failed to mint approval link:', err);
    return textResult(message);
  }
}

/**
 * Appended to every denial that carries an approval link.
 *
 * Originally added 2026-08-19 on the theory that agents were dropping the URL
 * when paraphrasing. Measured afterwards, that theory did not hold: most users
 * DO open their links, and the apparent shortfall was retry-inflated counting
 * (see approvalLinks.ts). What the data does show is that retrying is pure
 * waste — the same request re-emits the same URL — so the protocol now says
 * to stop and ask the user rather than to expect a fresh link.
 */
const AGENT_APPROVAL_PROTOCOL =
  'IMPORTANT — how to handle this: (1) Show the link above to the user VERBATIM as a clickable URL; only they can open it, and it is the only way to get access. ' +
  '(2) Do NOT retry the denied call until the user says they approved — retrying just fails again, and re-requesting returns the SAME link. ' +
  '(3) The link does not expire — if the user has not opened it yet, ask them directly rather than retrying.';

/**
 * Send denials offer BOTH one-click options: approve just this recipient, or
 * flip the profile to "Send to Anyone" — the escape hatch for users who find
 * per-recipient whitelisting confusing. Each is its own signed deterministic
 * link; only the human choosing one applies anything. Note this mints TWO
 * requests per denial, so send actions carry roughly double the request count
 * of a single-option denial — a known accounting quirk, not duplicate demand.
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
      lines.push(`👉 Allow sending to '${denial.deniedRecipient}' only — share this one-click link with the user: ${one.url}`);
      await recordApprovalMint({
        requestId: one.requestId, userId: conn.user.id, proxyKeyId,
        action: 'send_whitelist', targetHash: one.targetHash,
      });
      captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', {
        action: 'send_whitelist', request_id: one.requestId, target_hash: one.targetHash, via: 'send_denial',
      });
    }
    const all = await mintApprovalLink(DASHBOARD_URL, conn.user.id, proxyKeyId, { action: 'send_all' });
    lines.push(`👉 Or allow sending to ANY recipient from this profile — share this one-click link with the user instead: ${all.url}`);
    await recordApprovalMint({
      requestId: all.requestId, userId: conn.user.id, proxyKeyId, action: 'send_all',
    });
    captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', {
      action: 'send_all', request_id: all.requestId, via: 'send_denial',
    });
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

// GoogleErrorReason / extractGoogleErrorReason moved to googleApiPolicy.ts
// (pure parsing, now unit-tested — it also reads the gRPC-style
// error.details[] ErrorInfo shape that Sheets/Docs/Slides/People return).

/** 403s Google raises for throttling rather than for a missing/revoked grant. */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded',
  'quotaExceeded', 'sharingRateLimitExceeded',
]);

/**
 * 403s that genuinely mean the grant is wrong. Deliberately NOT including
 * Google's generic `forbidden`: it appears for several unrelated conditions,
 * so claiming "retrying will NOT fix it" for it would repeat the
 * over-confident assertion this branching exists to remove. It falls through
 * to the hedged default instead.
 */
const SCOPE_REASONS = new Set([
  'insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  'insufficientFilePermissions',
]);

function describe403(detail: string, targetEmail: string, r: GoogleErrorReason): string {
  const reconnect = `Ask the user to reconnect the account with this one-click link (it opens Google's consent screen directly): ` +
    `${reconnectLink(targetEmail)} — then retry once after they confirm.`;

  // Throttling. Reconnecting the account does nothing here, and the retry the
  // old text suppressed is exactly the right move.
  if ((r.reason && RATE_LIMIT_REASONS.has(r.reason)) || r.domain === 'usageLimits' || r.status === 'RESOURCE_EXHAUSTED') {
    return `❌ Google is rate limiting this account (403 ${r.reason || 'usageLimits'})${detail ? `: ${detail}` : ''}. ` +
      `This is temporary and NOT a permissions problem — do not ask the user to reconnect. ` +
      `Wait a few seconds and retry; if several retries fail, slow down the rate of calls and tell the user Google is throttling.`;
  }

  // Workspace admin policy. A reconnect re-grants the same scopes and fails
  // identically — only an admin can change this.
  if (r.reason === 'domainPolicy') {
    return `❌ A Google Workspace admin policy blocks this operation for '${targetEmail}' (403 domainPolicy)${detail ? `: ${detail}` : ''}. ` +
      `STOP — do not retry and do not ask the user to reconnect; reconnecting grants the same scopes and will fail the same way. ` +
      `Only a Workspace administrator can allow this.`;
  }

  // Genuinely a missing/revoked scope — the original text, now only on the
  // branch where it is actually true.
  if (r.reason && SCOPE_REASONS.has(r.reason)) {
    return `❌ Google denied the request (403 ${r.reason})${detail ? `: ${detail}` : ''}. ` +
      `Google's grant for '${targetEmail}' is missing a scope or was revoked — retrying will NOT fix it. ${reconnect}`;
  }

  // Reason absent or unrecognised: state both plausible causes and allow one
  // retry, rather than asserting the scope cause the way the old text did.
  return `❌ Google denied the request (403${r.reason ? ` ${r.reason}` : ''})${detail ? `: ${detail}` : ''}. ` +
    `This is usually either temporary throttling or a missing/revoked OAuth scope for '${targetEmail}'. ` +
    `Retry ONCE after a short pause — if it fails again it is the grant, not throttling, and reconnecting is the fix: ${reconnectLink(targetEmail)}`;
}

function describeGoogleError(status: number, data: unknown, targetEmail: string): string {
  // Google's `message` usually ends in a period and every call site appends
  // its own, producing "…scopes.." in agent-facing text.
  const detail = ((data as { error?: { message?: string } })?.error?.message
    || (typeof data === 'string' ? data.slice(0, 300) : '')).replace(/\s*\.\s*$/, '');
  const r = extractGoogleErrorReason(data);
  switch (status) {
    case 401:
      return `❌ Google authorization expired for '${targetEmail}'. STOP — do not retry; it will keep failing. ` +
        `Ask the user to reconnect this Google account with this one-click link (it opens Google's consent screen directly): ` +
        `${reconnectLink(targetEmail)} — then retry once after they confirm.`;
    case 403:
      return describe403(detail, targetEmail, r);
    case 404:
      return `❌ Google resource not found (404)${detail ? `: ${detail}` : ''}. Check the ID and try again.`;
    case 429:
      return '❌ Google API rate limit exceeded (429). Wait a moment and retry.';
    default:
      return `❌ Google API error (${status})${detail ? `: ${detail}` : ''}.`;
  }
}

/**
 * Accumulate wall-clock spent talking to Google onto the tool-call event
 * (grace retries make multiple googleFetch calls per tool call), so slow
 * calls are attributable: google_ms ≈ $mcp_duration_ms means Google was
 * slow; a wide gap means the time went to FGAC (token fetch, rules, DB).
 */
function recordGoogleMs(started: number): void {
  const prev = getToolCallProps().google_ms;
  addToolCallProps({ google_ms: (typeof prev === 'number' ? prev : 0) + (Date.now() - started) });
}

async function googleFetch(
  url: string, token: string, method = 'GET', body?: string, targetEmail = '',
): Promise<GoogleFetchResult> {
  const started = Date.now();
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
    });
    // The signal also covers body streaming, so a response that stalls after
    // headers aborts into the same classified branch below.
    text = await res.text();
  } catch (err) {
    recordGoogleMs(started);
    if (isUpstreamTimeout(err)) {
      addToolCallProps({ error_status: 'timeout' });
      const retryAdvice = method === 'GET'
        ? 'Wait a moment and retry ONCE; if it times out again, Google is degraded — tell the user and try later.'
        : 'The request MAY have been applied despite the timeout. Do NOT blindly retry a write — read the data back first, and only retry if the change is missing.';
      return {
        ok: false,
        error: `❌ Google did not answer within ${GOOGLE_FETCH_TIMEOUT_MS / 1000}s. This is Google-side slowness, not a permissions problem. ${retryAdvice}`,
      };
    }
    addToolCallProps({ error_status: 'network' });
    return { ok: false, error: `❌ Could not reach the Google API: ${err instanceof Error ? err.message : 'network error'}.` };
  }
  recordGoogleMs(started);

  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body: keep text */ }

  if (!res.ok) {
    // reason/domain are what make the 403 branching (and any later analysis of
    // the 403 mix) possible at all; status alone cannot separate throttling
    // from a revoked grant. See extractGoogleErrorReason for why these are
    // safe to put on an event.
    const r = extractGoogleErrorReason(data);
    addToolCallProps({
      error_status: res.status,
      // Fall back to Google's canonical status string (PERMISSION_DENIED,
      // NOT_FOUND) when the body carries no reason enum — before this, most
      // raw-API errors landed with a null error_reason and could not be
      // triaged by cause at all.
      ...(r.reason || r.status ? { error_reason: r.reason ?? r.status } : {}),
      ...(r.domain ? { error_domain: r.domain } : {}),
    });
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

/**
 * Post-policy Gmail 404. There is no drive.file grant to fix here — a 404
 * means one of the two ids is stale, and WHICH one is knowable from the call
 * site, because gmail_get_attachment issues two separate requests:
 * the parent message read, then the attachment read. The generic
 * "check the ID and try again" text could not say which id to check, so
 * agents retried the same (messageId, attachmentId) pair unchanged — one
 * production user did so 9 times in a single day.
 *
 * When the parent read SUCCEEDED and the attachment read 404s, the messageId
 * is provably valid and the attachmentId is the bad one. Attachment ids are
 * message-scoped (they are a path segment under the message) and Gmail
 * re-issues them when a message is re-indexed, so an id cached from an
 * earlier gmail_read can go stale while the message stays valid. That is
 * recoverable — but only by re-reading the message, never by retrying the
 * same pair. The reverse advice would be wrong for a bad messageId, which is
 * why the two sites must not share one string.
 *
 * Each branch states a stop condition. The repeat-count signature says the
 * missing piece was the stop, not the explanation.
 */
function gmailNotFoundResult(
  site: 'message' | 'attachment',
  result: { error: string; status?: number },
  messageId: string,
) {
  if (result.status !== 404) return errorResult(result.error);
  addToolCallProps({ gmail_404_site: site });

  if (site === 'message') {
    return errorResult(
      `❌ Gmail has no message with id '${messageId}' for this account (404). ` +
      `The id is wrong, belongs to a different account, or the message was deleted. ` +
      `STOP — do not retry this id; it will keep failing. ` +
      `Re-run gmail_list to get current message ids, or confirm with the user which account the message is in.`,
    );
  }

  return errorResult(
    `❌ The message exists, but Gmail has no attachment with that attachmentId on it (404). ` +
    `Attachment ids belong to one specific message and Gmail re-issues them when the message is re-indexed, ` +
    `so an id from an earlier gmail_read (or from a different message) goes stale even though the message is still fine. ` +
    `Do NOT retry the same messageId + attachmentId pair — that is guaranteed to fail again. ` +
    `Fix: re-run gmail_read with messageId '${messageId}', take the attachmentId from the \`attachments\` array in that fresh response, and retry ONCE with it. ` +
    `If that also 404s, stop and tell the user the attachment is no longer retrievable.`,
  );
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
      addToolCallProps({ error_status: undefined, error_reason: undefined, error_domain: undefined });
      console.log(`[MCP] ${service} grace retry recovered after ${retries} attempt(s) (rule age ${grantAgeSeconds()}s)`);
    }
  }
  return result;
}

const withSheetsGrace = (perm: FilePermission, doFetch: () => Promise<GoogleFetchResult>) =>
  withGrantGrace('sheet', perm, doFetch);
const withDocsGrace = (perm: FilePermission, doFetch: () => Promise<GoogleFetchResult>) =>
  withGrantGrace('doc', perm, doFetch);

// ─── docs_edit delete verification ──────────────────────────────────────────
//
// Google can apply a deleteContentRange only partially and still return 200
// (observed 2026-08-30 when a range crossed a table boundary: ~190 chars of a
// body-wide delete survived, response indicated success). The write stays a
// byte-faithful passthrough; when a request array contains a delete we read
// the body end index back and report facts — never our interpretation of the
// content. Verification is best-effort: it can degrade to "unavailable" but
// never turns a successful write into an error.

/** Requests that never move body indices. */
const DOCS_ZERO_DELTA_OPS = new Set([
  'updateParagraphStyle', 'updateTextStyle', 'updateDocumentStyle',
  'updateTableCellStyle', 'updateTableRowStyle', 'updateTableColumnProperties',
  'updateSectionStyle',
]);

type DocsDeleteVerifyPlan =
  | { hasDelete: false }
  | { hasDelete: true; deterministic: boolean; expectedDelta: number };

/**
 * Decide whether a batchUpdate needs read-back verification and whether the
 * net body-length change is exactly computable from the requests alone.
 * Deterministic ops: deleteContentRange removes (endIndex - startIndex)
 * indices, insertText adds the UTF-16 length of its text (JS string .length),
 * style updates move nothing. Anything else — or any op targeting a non-body
 * segment (segmentId) — makes the outcome non-deterministic; we then report
 * before/after indices without an expectation.
 */
function planDocsDeleteVerification(requests: Record<string, unknown>[]): DocsDeleteVerifyPlan {
  let hasDelete = false;
  let deterministic = true;
  let expectedDelta = 0;
  for (const request of requests) {
    for (const [op, rawArgs] of Object.entries(request)) {
      const args = (rawArgs ?? {}) as Record<string, any>;
      if (op === 'deleteContentRange') {
        hasDelete = true;
        const range = args.range as Record<string, any> | undefined;
        if (range && typeof range.startIndex === 'number' && typeof range.endIndex === 'number' && !range.segmentId) {
          expectedDelta -= range.endIndex - range.startIndex;
        } else {
          deterministic = false;
        }
      } else if (op === 'insertText') {
        const targetsBody = !args.location?.segmentId && !args.endOfSegmentLocation?.segmentId;
        if (typeof args.text === 'string' && targetsBody) {
          expectedDelta += args.text.length;
        } else {
          deterministic = false;
        }
      } else if (!DOCS_ZERO_DELTA_OPS.has(op)) {
        deterministic = false;
      }
    }
  }
  return hasDelete ? { hasDelete, deterministic, expectedDelta } : { hasDelete: false };
}

/** End index of the document body's last structural element, or null when the
 * read fails — callers treat null as "verification unavailable". */
async function fetchDocsBodyEndIndex(token: string, documentId: string, targetEmail: string): Promise<number | null> {
  const result = await docsFetch(token, `${encodeURIComponent(documentId)}?fields=body(content(endIndex))`, 'GET', undefined, targetEmail);
  if (!result.ok) return null;
  const content = (result.data as { body?: { content?: Array<{ endIndex?: number }> } })?.body?.content;
  const last = Array.isArray(content) && content.length > 0 ? content[content.length - 1] : null;
  return typeof last?.endIndex === 'number' ? last.endIndex : null;
}

/** Verification line appended to the docs_edit result, or null for tier 0. */
function docsDeleteVerifyNote(plan: DocsDeleteVerifyPlan, before: number | null, after: number | null): string | null {
  if (!plan.hasDelete) return null;
  if (before === null || after === null) {
    addToolCallProps({ docs_verify_outcome: 'unavailable' });
    return 'verification unavailable';
  }
  if (!plan.deterministic) {
    addToolCallProps({ docs_verify_outcome: 'reported' });
    return `body end ${after} (was ${before})`;
  }
  const expected = before + plan.expectedDelta;
  if (after === expected) {
    addToolCallProps({ docs_verify_outcome: 'verified' });
    return 'verified';
  }
  addToolCallProps({ docs_verify_outcome: 'mismatch', docs_verify_expected: expected, docs_verify_actual: after });
  console.warn(`[MCP] docs_edit delete verification mismatch: body end ${after}, expected ${expected}`);
  return `body end ${after}, expected ${expected} — delete may have partially applied; read the document back.`;
}

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

/**
 * Comments address files by bare Drive file id, which doesn't say whether the
 * file is a doc or a sheet — resolve the kind from whichever service's rules
 * mention the id, then run the standard per-file check for that kind. A file
 * no rule mentions denies as not-exposed WITHOUT an approval action: the
 * service is unknown, so no expose action could be minted for it.
 */
async function checkCommentsPermission(
  conn: ConnectionApproved,
  proxyKeyId: string,
  fileId: string,
  isMutating: boolean,
): Promise<{ denial: Awaited<ReturnType<typeof policyDenialWithLink>> } | { kind: DriveFileKind; perm: FilePermission }> {
  const rules = await db.select().from(accessRules).where(eq(accessRules.userId, conn.user.id));
  const kind = ACTIVE_DRIVE_FILE_KINDS.find(k =>
    rules.some(r => r.service === DRIVE_FILE_KINDS[k].service && (r.targetResourceId === fileId || r.regexPattern === fileId)),
  );
  if (!kind) {
    addToolCallProps({ denial_code: 'file_not_exposed' });
    return { denial: textResult(`🚫 Access Denied: File '${fileId}' is not exposed in your FGAC rules. Ask the user to expose the document or spreadsheet via the dashboard picker, or call request_access with the file id.`) };
  }
  const perm = await checkFilePermission(kind, conn.user.id, proxyKeyId, fileId, isMutating);
  if (!perm.allowed) {
    const action = kind === 'doc'
      ? docsApprovalAction(perm.denial, fileId, isMutating)
      : sheetsApprovalAction(perm.denial, fileId, isMutating);
    return { denial: await policyDenialWithLink(conn, proxyKeyId, perm.reason, action) };
  }
  return { kind, perm };
}

const COMMENT_LIST_FIELDS = 'nextPageToken,comments(id,content,resolved,createdTime,modifiedTime,author(displayName),quotedFileContent(value),replies(id,content,action,createdTime,author(displayName)))';

// ─── Gmail Message Parsing (token-frugal responses) ─────────────────────────

const MAX_BODY_CHARS = 20_000;
const MAX_ATTACHMENT_CHARS = 200_000; // base64url chars ≈ 150 KB decoded
// Large-attachment windows (plan gmail-attachment-pagination_v1). Sized so one
// window stays under MCP clients' own tool-result caps (Claude Code rejects
// ~25k tokens): 50k chars of prose ≈ 12k tokens; 75 KB of bytes re-encodes to
// 100k base64url chars ≈ 25k tokens — deliberately the byte path is the
// fallback, extracted text the primary (base64 is ~30× worse per useful byte).
const ATTACHMENT_TEXT_WINDOW_CHARS = 50_000;
const ATTACHMENT_BYTES_WINDOW = 75_000;

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

type AuthInfo = { extra?: { userId?: string; userAgent?: string; profileSlug?: string }; clientId?: string };

type ApprovalDenied = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

async function requireApproval(authInfo: AuthInfo | undefined): Promise<ConnectionApproved | ApprovalDenied> {
  const userId = authInfo?.extra?.userId as string | undefined;
  const clientId = authInfo?.clientId;

  if (!userId) {
    return textResult('❌ Authentication failed.');
  }

  // resolveConnection is the first thing every tool does and it is entirely
  // database work — the users lookup, the agent_connections read, the bound
  // proxy-key check. A database failure here used to escape unwrapped, and
  // the MCP SDK printed Drizzle's message (the full SQL plus the caller's
  // Clerk user id) straight into the tool result. Keep the detail in the log.
  let result: ConnectionResult;
  try {
    result = await resolveConnection(userId, clientId, undefined, authInfo?.extra?.profileSlug);
  } catch (err) {
    return errorResult(logAndSanitize('Connection resolution failed', err));
  }

  if (!result.authorized) {
    return textResult(pendingMessage(result));
  }
  // Client-product attribution: today clientName is usually the opaque DCR
  // client_id (only cli-token registrations send a real name), but stamping
  // it means events light up as soon as DCR name capture improves.
  if (result.clientName) addToolCallProps({ client_name: result.clientName });
  return result;
}

// ─── Analytics Instrumentation ──────────────────────────────────────────────

type ToolAnalyticsResult = { isError?: boolean; content?: Array<{ type?: string; text?: string }> };

/**
 * Tool responses follow a strict convention (textResult/errorResult above):
 * isError marks upstream/auth failures, and policy outcomes carry a leading
 * ⏳ (pending approval), 🚫 (denied by FGAC policy), ❌ (failed), or
 * ⚠️ (size-capped: a deliberate refusal to return an oversized payload —
 * the tool worked, so it must not count as a tool error in any error-rate
 * metric; before 2026-08-24 it classified as `failed` and inflated the
 * gmail_get_attachment error rate).
 */
function classifyToolOutcome(result: ToolAnalyticsResult): string {
  if (result.isError) return 'error';
  const text = result.content?.[0]?.text ?? '';
  if (text.startsWith('⏳')) return 'pending_approval';
  if (text.startsWith('🚫')) return 'denied_by_policy';
  if (text.startsWith('⚠️')) return 'size_capped';
  if (text.startsWith('❌')) return 'failed';
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
        user_agent: extra?.authInfo?.extra?.userAgent,
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
      // Catch-all so no unhandled throw from any tool reaches the MCP SDK,
      // which turns `error.message` into the tool result verbatim. Every
      // library in this path — Drizzle, Clerk, jose, fetch — writes messages
      // for developers reading logs, not for an agent's transcript.
      return toolErrorResult(`Unhandled exception in ${tool}`, err) as unknown as R;
    }
  });
}

type ResolvedAccount = { targetEmail: string; token: string; proxyKeyId: string; hasGmailScope?: boolean; hasDriveFileScope?: boolean };
type ResolvedError = { error: string };

/**
 * Account/token resolution failures are the `outcome='failed'` class: they
 * return ❌ text via textResult, so they never reached Google and carry no
 * error_status. Which of the four branches fired was unrecoverable from
 * analytics.
 *
 * `failure_reason` is deliberately a SEPARATE property from `error_status`
 * (which means "Google returned this HTTP status" — these calls never got
 * that far), and these stay `textResult`, NOT `errorResult`: classifyToolOutcome
 * maps them to `failed`, and `$mcp_is_error` is true only for `error`/
 * `exception`. Promoting them would move them into the error field that
 * Anthropic's Connector Directory reads — worsening our published error rate
 * purely to gain internal visibility we can get for free here.
 */
type ResolveFailureReason =
  | 'no_proxy_key'
  | 'no_accessible_accounts'
  | 'account_not_permitted'
  | 'google_token_unavailable'
  | 'gmail_scope_missing';

function resolveFailure(reason: ResolveFailureReason, error: string): ResolvedError {
  addToolCallProps({ failure_reason: reason });
  return { error };
}

async function resolveAccountAndToken(
  conn: ConnectionApproved,
  account?: string,
): Promise<ResolvedAccount | ResolvedError> {
  if (!conn.proxyKeyId) {
    return resolveFailure('no_proxy_key', '❌ No proxy key assigned to this connection. Ask the user to update it in the dashboard.');
  }

  const emails = await getAccessibleEmails(conn.proxyKeyId);
  if (emails.length === 0) {
    return resolveFailure('no_accessible_accounts', '❌ No email accounts are accessible with this proxy key.');
  }

  const targetEmail = account || conn.user.email;
  const access = await checkEmailAccess(conn.proxyKeyId, targetEmail);
  if (!access) {
    return resolveFailure('account_not_permitted', `❌ This proxy key does not have access to '${targetEmail}'. Accessible: ${emails.map(e => e.targetEmail).join(', ')}`);
  }

  // Delegation observability: record which account this call resolved to, so
  // the mcp_tool_call event can attribute usage across own vs delegated
  // mailboxes (one user may access several Gmail accounts).
  addToolCallProps({
    account_email: access.targetEmail,
    account_delegated: !!access.delegationId,
  });

  const googleToken = await getGoogleToken(targetEmail, conn.user);
  if (!googleToken) {
    return resolveFailure('google_token_unavailable', `❌ Could not fetch Google token for '${targetEmail}'. The account owner may need to reconnect Google — one-click link: ${reconnectLink(targetEmail)}`);
  }

  return {
    targetEmail,
    token: googleToken.token,
    proxyKeyId: conn.proxyKeyId,
    hasGmailScope: googleToken.hasGmailScope,
    hasDriveFileScope: googleToken.hasDriveFileScope,
  };
}

/**
 * Pre-flight for Gmail surfaces only (sheets/docs/drive don't need the Gmail
 * scope): a token whose grant lacks the Gmail scope 403s on every Gmail call
 * until the account is reconnected, so calling Google is pointless and the
 * generic 403 text used to send agents into retry loops. Deterministic and
 * never-reached-Google, so it is the `failed` class (textResult), not an
 * upstream `error` — see the ResolveFailureReason comment above.
 *
 * Two signals, same pattern as google_token_identity_fallback: the tool-call
 * properties attribute the denial to the call; the standalone event is
 * unsampled and independent of $mcp_tool_call, so `uniq(person)` over it is
 * exactly the locked-out population (docs/monitoring.md 7.6).
 */
function gmailScopeDenial(conn: ConnectionApproved, resolved: ResolvedAccount) {
  if (resolved.hasGmailScope !== false) return null;
  addToolCallProps({ failure_reason: 'gmail_scope_missing', google_scope_missing: true });
  captureServerEvent(conn.user.clerkUserId, 'google_scope_missing', {
    via: 'mcp',
    scope: 'gmail',
    account_delegated: resolved.targetEmail.toLowerCase() !== conn.user.email.toLowerCase(),
  });
  return textResult(
    `❌ The Google account '${resolved.targetEmail}' is connected WITHOUT Gmail permission — ` +
    `most likely the Gmail checkbox was left unchecked on Google's consent screen when connecting. ` +
    `STOP — every Gmail call on this account will fail until it is reconnected; retrying will NOT help. ` +
    `👉 Send the account owner this one-click link — it opens Google's consent screen directly; they must approve Gmail access there: ` +
    `${reconnectLink(resolved.targetEmail)} — then retry once after they confirm. ` +
    `Non-Gmail tools (sheets, docs) are unaffected.`,
  );
}

/**
 * Mirror of gmailScopeDenial for the drive.file scope, which every non-Gmail
 * surface (Sheets, Docs, Slides, Drive) rides. Accounts connected before
 * drive.file joined the grant — or with the Drive checkbox left unchecked on
 * Google's consent screen — 403 on every one of these calls (observed as the
 * 403s on POST v4/spreadsheets, 2026-08 production), and the upstream 403
 * body often carries no reason the agent can act on. Deterministic and
 * never-reached-Google, so it is the `failed` class (textResult), not an
 * upstream `error`. Applied by every typed per-file tool (sheets_*, docs_*,
 * comments_*) and by non-Gmail raw google_api_get/modify calls.
 */
function driveFileScopeDenial(conn: ConnectionApproved, resolved: ResolvedAccount) {
  if (resolved.hasDriveFileScope !== false) return null;
  addToolCallProps({ failure_reason: 'drive_file_scope_missing', google_scope_missing: true });
  captureServerEvent(conn.user.clerkUserId, 'google_scope_missing', {
    via: 'mcp',
    scope: 'drive_file',
    account_delegated: resolved.targetEmail.toLowerCase() !== conn.user.email.toLowerCase(),
  });
  return textResult(
    `❌ The Google account '${resolved.targetEmail}' is connected WITHOUT the Google Drive file permission (drive.file) — ` +
    `most likely the account was connected before FGAC requested it, or the Drive checkbox was left unchecked on Google's consent screen. ` +
    `Every Sheets, Docs, Slides, and Drive call on this account will fail until it is reconnected; retrying will NOT help. ` +
    `👉 Send the account owner this one-click link — it opens Google's consent screen directly; they must approve Drive file access there: ` +
    `${reconnectLink(resolved.targetEmail)} — then retry once after they confirm. ` +
    `Gmail tools are unaffected.`,
  );
}

// ─── Raw Google API Execution ───────────────────────────────────────────────

function serializeBody(body?: string | Record<string, unknown>): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/**
 * Classify a raw call and stamp its observability props. Called from the tool
 * handlers BEFORE account resolution, so resolution failures (and
 * unsupported-family denials, which need no account at all) still carry
 * raw_api_endpoint/raw_api_family — until 2026-08 those events landed with
 * null endpoint/family and were unattributable. Raw calls are the
 * highest-volume tool surface, and the classifier already knows the product —
 * stamp it on every call (denials included) so analytics can break raw usage
 * down by Google product and id-stripped endpoint, not just "google_api_get".
 */
function classifyAndStampRawCall(path: string, method: string): RawCallClass {
  const cls = classifyGoogleApiCall(path, method);
  const family = rawApiFamily(cls);
  addToolCallProps({
    raw_api_kind: cls.kind,
    raw_api_endpoint: `${method} ${templateGoogleApiPath(path)}`,
    raw_api_mutating: method !== 'GET',
    ...(family ? { raw_api_family: family } : {}),
  });
  if (cls.kind === 'denied') addToolCallProps({ denial_code: cls.code });
  return cls;
}

/**
 * Passthrough failures ride Google's own enforcement, and under drive.file a
 * 404 is ambiguous in a way agents cannot know: files the user never exposed
 * to FGAC (and this agent didn't create) are simply invisible and 404
 * identically to a wrong id. The bare "check the ID" framing sent agents into
 * retry loops on ids that were never going to appear (observed on
 * drive/v3/files/{id}/permissions and PATCH drive/v3/files/{id}, 2026-08
 * production); say what the 404 can and cannot prove, and where the fix is.
 */
function passthroughErrorResult(result: { error: string; status?: number }) {
  if (result.status !== 404) return errorResult(result.error);
  return errorResult(
    `${result.error} ` +
    `NOTE: FGAC's Google grant is per-file (drive.file) — files the user never exposed to FGAC and this agent did not create are INVISIBLE to this token, ` +
    `and Google reports them with this exact 404 even though they exist. A wrong id looks identical, so do NOT retry the same id. ` +
    `If this id is a Google Sheet or Doc, call request_access with the spreadsheetId/documentId to send the user a one-click approval link; ` +
    `for other Drive files, ask the user to expose the file via the FGAC dashboard, or create the file through FGAC so it is granted automatically.`,
  );
}

/**
 * Shared executor for google_api_get / google_api_modify. `cls` comes from
 * classifyAndStampRawCall in the tool handler; classification is
 * allow-by-default (see googleApiPolicy.ts — sends ride the recipient
 * whitelist, Google's OAuth scopes backstop the rest) and every enforced
 * family maps onto the same FGAC enforcement the dedicated tools use.
 */
async function executeRawGoogleCall(
  conn: ConnectionApproved,
  resolved: ResolvedAccount,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  cls: RawCallClass,
  body?: string | Record<string, unknown>,
) {
  const family = rawApiFamily(cls);
  if (cls.kind === 'denied') {
    // Handlers short-circuit denials before account resolution; kept here so
    // the executor stays total over RawCallClass.
    return textResult(cls.reason);
  }

  // Scope pre-flight, mirroring the dedicated tools: gmail/* needs the Gmail
  // scope; every other family rides drive.file. A token that provably lacks
  // the scope fails deterministically at Google, so calling it is pointless —
  // and its 403 body often gives the agent nothing to act on.
  if (family === 'gmail') {
    const scopeDenial = gmailScopeDenial(conn, resolved);
    if (scopeDenial) return scopeDenial;
  } else {
    const scopeDenial = driveFileScopeDenial(conn, resolved);
    if (scopeDenial) return scopeDenial;
  }

  const cleanPath = path.replace(/^\/+/, '');
  // Route a raw path to the host that owns its API family. Sheets, Docs,
  // Slides, and Forms live on their own subdomains (www.googleapis.com does
  // NOT serve the latter two — routing them there returned bare 404s that
  // read as missing resources); everything else rides www.googleapis.com.
  const rawUrl = (p: string) =>
    p.includes('spreadsheets') ? `https://sheets.googleapis.com/${p.replace(/^sheets\//, '')}`
    : p.includes('documents') ? `https://docs.googleapis.com/${p.replace(/^docs\//, '')}`
    : p.includes('presentations') ? `https://slides.googleapis.com/${p.replace(/^slides\//, '')}`
    : /(^|\/)forms(\/|$)/.test(p) ? `https://forms.googleapis.com/${p.replace(/^forms\//, '')}`
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

  if (cls.kind === 'file_comments') {
    // Comments are content on the file: they inherit the file's per-file
    // rule (comment writes need Read & Write) instead of scope-only
    // passthrough. Same enforcement as the comments_read / comments_add
    // typed tools.
    const check = await checkCommentsPermission(conn, resolved.proxyKeyId, cls.fileId, cls.isMutating);
    if ('denial' in check) return check.denial;
    const result = await withGrantGrace(check.kind, check.perm, () => googleFetch(rawUrl(cleanPath), resolved.token, method, serializeBody(body), resolved.targetEmail));
    if (!result.ok) return errorResult(result.error);
    return jsonResult(result.data);
  }

  if (cls.kind === 'passthrough') {
    // Classify-don't-block: unknown Google API families are forwarded with
    // the account's token (Google's scopes are the enforcement backstop) and
    // flagged so demand is visible in analytics before we build rules for it
    // (family/kind/endpoint were already stamped at classification above).
    addToolCallProps({ raw_api_passthrough: true });
    const result = await googleFetch(rawUrl(cleanPath), resolved.token, method, serializeBody(body), resolved.targetEmail);
    if (!result.ok) return passthroughErrorResult(result);
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

  if (cls.kind === 'gmail_draft_send') {
    // drafts/send delivers mail, so it rides the same recipient whitelist as
    // messages/send — but the recipients live in the STORED draft, not the
    // request body. Resolve them server-side: fetch the draft (format=raw)
    // and parse To/Cc/Bcc out of it, unioned with any inline message.raw the
    // body carries (drafts.send can update the draft while sending). Every
    // address from either source must be whitelisted; anything unresolvable
    // denies — never forward blind.
    // Resolution failures deny WITHOUT approval links: the fix is the draft
    // or its id, not a whitelist grant — a "send to anyone" link here would
    // point the user at the wrong remedy. Whitelist violations below still
    // mint links via sendDenialWithLinks.
    const draftDenial = (detail: string) => {
      addToolCallProps({ denial_code: 'recipients_undetermined' });
      return textResult(`🚫 ${detail} Nothing was sent — drafts/send is denied whenever the draft's recipients cannot be determined and verified against the send whitelist.`);
    };
    const { draftId, bodyRecipients } = extractDraftSendInfo(body);
    if (!draftId) {
      return draftDenial('Could not determine which draft to send. Provide the draft id in the body: {"id": "<draftId>"}.');
    }
    // Query-stripped: the caller's path may carry ?alt=json etc., which would
    // otherwise leave `/send` in place and fetch the wrong URL.
    const draftPath = cleanPath.split(/[?#]/)[0].replace(/\/send$/i, `/${encodeURIComponent(draftId)}`) + '?format=raw';
    const draftResult = await googleFetch(`https://www.googleapis.com/${draftPath}`, resolved.token, 'GET', undefined, resolved.targetEmail);
    if (!draftResult.ok) {
      // A bogus id surfaced Google's bare 404 here before (QA finding,
      // 2026-08-30), which read as "the send endpoint 404ed" — say what was
      // actually being fetched and that the send was refused.
      return draftDenial(`The draft could not be fetched to verify its recipients (${draftResult.error}). Confirm the draft id via google_api_get gmail/v1/users/me/drafts and retry.`);
    }
    const draftRaw = (draftResult.data as { message?: { raw?: unknown } })?.message?.raw;
    const draftRecipients = typeof draftRaw === 'string' ? extractSendRecipients({ raw: draftRaw }) : null;
    const recipients = [...new Set([...(draftRecipients ?? []), ...(bodyRecipients ?? [])])];
    if (recipients.length === 0) {
      return draftDenial('The draft has no parseable To/Cc/Bcc recipients. Update the draft with standard recipient headers, then retry drafts/send.');
    }
    const denial = checkSendWhitelist(rules, recipients);
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

        // Per-account Google scope state, so the agent can see a
        // missing-scope account BEFORE its first failing call. Three-state:
        // Clerk not reporting scope metadata is 'unknown', never coerced to
        // missing (same convention the scope denials enforce). Probes are
        // quiet (no PostHog captures — see getGoogleToken) and individually
        // time-bounded: this is the first tool most agents call, and N
        // accounts riding the full 15 s Clerk timeout each is unacceptable.
        const scopeState = (has: boolean | undefined) =>
          has === undefined ? 'unknown' : has ? 'granted' : 'missing';
        const probes = await Promise.allSettled(
          emails.map(e => withTimeout(
            getGoogleToken(e.targetEmail, conn.user, { quiet: true }),
            LIST_ACCOUNTS_SCOPE_PROBE_TIMEOUT_MS,
          )),
        );
        const accountDetails = emails.map((e, i) => {
          const probe = probes[i];
          const token = probe.status === 'fulfilled' ? probe.value : null;
          const gmail = token ? scopeState(token.hasGmailScope) : 'unknown';
          const driveFile = token ? scopeState(token.hasDriveFileScope) : 'unknown';
          // A definitive miss — or a definitive token failure — gets the
          // bound reconnect link; a timed-out probe stays link-free (nothing
          // is known to be wrong).
          const tokenUnavailable = probe.status === 'fulfilled' && token === null;
          const needsReconnect = tokenUnavailable || gmail === 'missing' || driveFile === 'missing';
          return {
            email: e.targetEmail,
            delegated: !!e.delegationId,
            gmail,
            drive_file: driveFile,
            ...(needsReconnect ? { reconnect_url: reconnectLink(e.targetEmail) } : {}),
          };
        });
        const driveMissing = accountDetails.find(d => d.drive_file === 'missing');

        // Onboarding nudge: list_accounts is most new users' first (and for
        // many, only) call — 2026-08 launch analytics showed a large cohort
        // stopping right here. Tell the agent what a useful next step is and
        // how more mailboxes get added, so the dead end becomes a path.
        return jsonResult({
          accounts: emails.map(e => e.targetEmail),
          account_details: accountDetails,
          default: conn.user.email,
          nickname: conn.nickname,
          next_steps: {
            gmail: "Read a mailbox with gmail_list (pass account: '<address>' to target a specific one; defaults to the primary). Reads work out of the box.",
            sheets: driveMissing
              ? `'${driveMissing.email}' is connected WITHOUT the drive.file scope — every Sheets call on it will fail until the account owner reconnects: ${driveMissing.reconnect_url}`
              : 'Spreadsheet access is granted per sheet: call sheets_get_spreadsheet with a spreadsheetId, or request_access — a denial returns a one-click approval link for the user.',
            docs: driveMissing
              ? `'${driveMissing.email}' is connected WITHOUT the drive.file scope — every Docs call on it will fail until the account owner reconnects: ${driveMissing.reconnect_url}`
              : 'Google Docs access is granted per document: call docs_read_document with a documentId, or request_access — a denial returns a one-click approval link for the user.',
            sending: 'Email sending is off by default; the first gmail_send returns a one-click approval link the user can use to whitelist the recipient.',
            raw_api: "Anything the typed tools can't express — Gmail mailbox writes (labels, drafts, archive/mark-read, trash) and threads, Drive listing and export, creating new docs, sheets, or slides — is reachable via google_api_get / google_api_modify under the same rules (see their descriptions). The Google grant covers ONLY Gmail plus per-file Drive access (Sheets/Docs/Slides/Drive files the user picked or this agent created); People/Contacts, Calendar, Tasks, and other Google APIs are not available and calls to them are refused.",
          },
          add_more_accounts: {
            // Every extra mailbox — the user's own second account included —
            // arrives via delegation from its own FGAC signup. There is no
            // in-dashboard "link a second Google account" flow; describing
            // one here sent users hunting for it (support case 2026-08-24).
            own_account: `To add another Gmail account the user owns: sign in to ${DASHBOARD_URL} AS that account (e.g. in another browser profile), then on its Accounts page use "Delegations You've Granted" to delegate that mailbox to this user's email. It then appears here automatically. Walkthrough: ${DASHBOARD_URL}/use-cases/multiple-gmail-accounts`,
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
        const scopeDenial = gmailScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

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
        const scopeDenial = gmailScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        // Read-time enforcement: label blacklist/whitelist + content blacklist
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const result = await gmailFetch(resolved.token, resolved.targetEmail, `messages/${messageId}?format=${format || 'full'}`);
        if (!result.ok) return gmailNotFoundResult('message', result, messageId);

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
        attachmentId: z.string().optional().describe('Attachment ID, taken from the `attachments` array of a gmail_read on THIS messageId. Ids are message-scoped and are re-issued when the message is re-indexed; a stale id is healed automatically when the message has exactly one attachment. Prefer `filename` when you know it — filenames never go stale.'),
        filename: z.string().optional().describe('Attachment filename as shown in gmail_read `attachments` (case-insensitive), as an alternative to attachmentId. If several attachments share the name, the error lists them so you can pick one by attachmentId.'),
        account: z.string().optional().describe('Email account to use.'),
        mode: z.enum(['auto', 'text', 'base64']).optional().describe("auto (default): full base64url when the file fits ~150 KB, extracted text for larger extractable files. 'text': return the attachment's extracted text (PDF, .docx, text-family types) — the cheap way to READ an attachment of any size. 'base64': raw bytes, windowed when large."),
        offset: z.number().int().min(0).optional().describe('Continuation offset from a previous partial response — chars into the extracted text, or decoded bytes for base64 windows. Start at 0; each partial response states the next offset.'),
      }),
      async ({ messageId, attachmentId, filename, account, mode, offset }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        if (!attachmentId && !filename) {
          return errorResult('❌ Provide either attachmentId or filename to identify the attachment.');
        }

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);
        const scopeDenial = gmailScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        // Read-time enforcement on the parent message (labels + content rules):
        // an attachment is only as readable as the email that carries it
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const parentResult = await gmailFetch(resolved.token, resolved.targetEmail, `messages/${messageId}?format=full`);
        if (!parentResult.ok) return gmailNotFoundResult('message', parentResult, messageId);

        const restriction = checkReadRestrictions(rules, parentResult.data);
        if (restriction) {
          captureServerEvent(conn.user.clerkUserId, 'read_restriction_enforced', { via: 'gmail_get_attachment', restriction });
          return textResult(restriction);
        }

        // The parent read above is FRESH, so its attachment ids are the ones
        // Gmail currently honours — the list both selector paths resolve
        // against, and the authority the 404 self-heal below retries from.
        // (Attachment ids are ephemeral: Gmail re-issues them on re-index,
        // which is why an id cached from an earlier gmail_read can 404 while
        // the message stays valid — the dominant failure of this tool per the
        // 2026-08 directory metrics.)
        const freshAttachments = parseGmailMessage(parentResult.data as Record<string, unknown>).attachments;
        const listFresh = () => freshAttachments
          .map(a => `- '${a.filename}' (${a.mimeType || 'unknown type'}, ~${Math.round((a.sizeBytes || 0) / 1024)} KB, attachmentId: ${a.attachmentId})`)
          .join('\n');

        let targetId: string;
        if (attachmentId) {
          addToolCallProps({ attachment_selector: 'id' });
          targetId = attachmentId;
        } else {
          addToolCallProps({ attachment_selector: 'filename' });
          const wanted = (filename as string).toLowerCase();
          const matches = freshAttachments.filter(a => a.filename.toLowerCase() === wanted);
          if (matches.length === 0) {
            return errorResult(freshAttachments.length === 0
              ? `❌ Message '${messageId}' has no attachments.`
              : `❌ No attachment named '${filename}' on message '${messageId}'. It currently has:\n${listFresh()}\nRetry ONCE with one of these filenames or attachmentIds; if none is the one you need, it is not on this message.`);
          }
          if (matches.length > 1) {
            return errorResult(
              `❌ ${matches.length} attachments on message '${messageId}' are named '${filename}':\n${listFresh()}\n` +
              `Retry ONCE with the attachmentId of the one you need.`);
          }
          targetId = matches[0].attachmentId;
        }

        // Declared size from the parent's MIME metadata, stamped BEFORE the
        // attachment fetch: if that fetch fails, the event still says how big
        // the attachment was, so error rows are attributable to size vs
        // genuine upstream failure. (attachment_kb below is the measured
        // truth when the fetch succeeds and overwrites nothing — different
        // property name on purpose.)
        const declaredSize = (function findDeclared(part?: { body?: { attachmentId?: string; size?: number }; parts?: unknown[] }): number | undefined {
          if (!part) return undefined;
          if (part.body?.attachmentId === targetId) return part.body.size;
          for (const child of (part.parts as typeof part[] | undefined) ?? []) {
            const found = findDeclared(child);
            if (found !== undefined) return found;
          }
          return undefined;
        })((parentResult.data as { payload?: { body?: { attachmentId?: string; size?: number }; parts?: unknown[] } }).payload);
        if (declaredSize !== undefined) {
          addToolCallProps({ attachment_declared_kb: Math.round(declaredSize / 1024) });
        }

        let attachmentResult = await gmailFetch(
          resolved.token,
          resolved.targetEmail,
          `messages/${messageId}/attachments/${targetId}`
        );
        // Reaching here means the parent read succeeded, so a failure now is
        // provably the attachmentId, not the messageId. Google's split
        // (measured 2026-08-28 against production): a well-formed token it has
        // invalidated (message re-indexed) → 404; a malformed/truncated token
        // → 400 "Invalid attachment token". Both mean "this id will never
        // work, the message is fine", and the recovery is identical — so when
        // the caller supplied the id themselves, heal it server-side instead
        // of erroring: the fresh parent already says which ids are current.
        if (!attachmentResult.ok && (attachmentResult.status === 404 || attachmentResult.status === 400) && attachmentId) {
          const suppliedIdIsCurrent = freshAttachments.some(a => a.attachmentId === attachmentId);
          if (freshAttachments.length === 0) {
            addToolCallProps({ attachment_selfheal: 'no_attachments' });
            return errorResult(
              `❌ Message '${messageId}' has no attachments (${attachmentResult.status}). The attachmentId may belong to a different message — ` +
              `STOP retrying this pair and re-check which message carries the attachment via gmail_read.`);
          }
          if (!suppliedIdIsCurrent && freshAttachments.length === 1) {
            const retry = await gmailFetch(
              resolved.token,
              resolved.targetEmail,
              `messages/${messageId}/attachments/${freshAttachments[0].attachmentId}`
            );
            if (retry.ok) {
              // Transparent recovery: the caller's id was stale, the message
              // has exactly one attachment, so the fresh id is unambiguously
              // the one they meant. Counts as a success, not an error — so
              // the failed first attempt's status/reason must not ride on
              // the success event (same rule as the sheets grace retry).
              addToolCallProps({
                attachment_selfheal: 'recovered',
                error_status: undefined, error_reason: undefined, error_domain: undefined,
              });
              attachmentResult = retry;
              targetId = freshAttachments[0].attachmentId; // so filename/mime metadata below resolves
            } else {
              addToolCallProps({ attachment_selfheal: 'retry_failed' });
            }
          } else if (!suppliedIdIsCurrent) {
            addToolCallProps({ attachment_selfheal: 'ambiguous' });
            return errorResult(
              `❌ Gmail rejected that attachmentId (${attachmentResult.status}) — it is stale or invalid; Gmail re-issues ids when a message is re-indexed. Message '${messageId}' currently has:\n${listFresh()}\n` +
              `Retry ONCE with the matching attachmentId above (or call again with the filename parameter instead). ` +
              `Do NOT retry the old id — it is guaranteed to fail again.`);
          }
          // suppliedIdIsCurrent but Google still 404s: not a staleness case —
          // fall through to the generic per-site text.
        }
        if (!attachmentResult.ok) return gmailNotFoundResult('attachment', attachmentResult, messageId);

        const attachment = attachmentResult.data as { size?: number; data?: string };
        // Size on EVERY outcome (port of 5aa23bd): the generic response_chars
        // only sees the short ⚠️ message on over-cap failures, so the true
        // attachment size must be stamped before the cap check or analytics
        // can't tell a 200 KB refusal from a 2 MB one.
        const attachmentChars = attachment.data?.length ?? 0;
        const approxKb = Math.round((attachmentChars * 3) / 4 / 1024);
        addToolCallProps({ attachment_chars: attachmentChars, attachment_kb: approxKb });

        // Large-attachment reading (plan gmail-attachment-pagination_v1):
        // measured demand is bimodal — most capped files are 200–350 KB
        // documents, a tail is 13–18 MB — and the intent is almost always
        // "read it", so extracted text is the primary path and stateless
        // decoded-byte windows the fallback. Gmail's attachments.get has no
        // partial fetch, so every windowed call re-downloads the full body
        // server-side; fine at observed volume.
        const readMode = mode ?? 'auto';
        const windowOffset = offset ?? 0;
        if (readMode !== 'auto' || windowOffset > 0) {
          addToolCallProps({ attachment_mode: readMode, attachment_offset: windowOffset });
        }

        // Legacy path, byte-for-byte: whole body fits and no windowing asked.
        if (readMode !== 'text' && windowOffset === 0 && attachmentChars <= MAX_ATTACHMENT_CHARS) {
          return jsonResult(attachment);
        }

        // Gmail re-issues attachment ids on every parent read, so a
        // caller-supplied id routinely matches NOTHING in the fresh list even
        // though the fetch it fed succeeded — fall back to the only
        // attachment, or to the caller's filename, before giving up on
        // metadata (verified against a live mailbox 2026-08-31: without this,
        // id-selected text extraction saw 'unknown type' every time).
        const attMeta = freshAttachments.find(a => a.attachmentId === targetId)
          ?? (freshAttachments.length === 1 ? freshAttachments[0] : undefined)
          ?? (filename ? freshAttachments.find(a => a.filename.toLowerCase() === (filename as string).toLowerCase()) : undefined);
        const attName = attMeta?.filename || filename || 'attachment';
        const attMime = attMeta?.mimeType || '';
        const bytes = Buffer.from(attachment.data ?? '', 'base64url');

        const byteWindow = () => {
          if (windowOffset >= bytes.length) {
            return textResult(
              `❌ offset ${windowOffset} is at or beyond the end of '${attName}' (${bytes.length} bytes total). ` +
              `Do not retry this offset — the previous window was the final one, or restart from offset 0.`);
          }
          const slice = bytes.subarray(windowOffset, windowOffset + ATTACHMENT_BYTES_WINDOW);
          const nextOffset = windowOffset + slice.length < bytes.length ? windowOffset + slice.length : null;
          addToolCallProps({ attachment_window: 'bytes' });
          return jsonResult({
            filename: attName,
            mimeType: attMime || undefined,
            encoding: 'base64url',
            total_bytes: bytes.length,
            offset: windowOffset,
            bytes_returned: slice.length,
            next_offset: nextOffset,
            note: nextOffset === null
              ? 'Final window. Decode each window with a base64url decoder and concatenate the DECODED bytes in offset order.'
              : `Partial content — call again with offset: ${nextOffset} for the next window, then concatenate the DECODED bytes in offset order.`,
            data: slice.toString('base64url'),
          });
        };

        if (readMode === 'base64') return byteWindow();

        // mode 'text', or 'auto' past the legacy path: extraction first.
        let extracted: Awaited<ReturnType<typeof extractAttachmentText>> = null;
        let extractFailed = false;
        try {
          extracted = await extractAttachmentText(bytes, attMime, attName);
        } catch (err) {
          extractFailed = true;
          addToolCallProps({ attachment_extract_error: 'failed' });
          console.error('[MCP] attachment text extraction failed:', err instanceof Error ? err.message : err);
        }
        let extractEmpty = false;
        if (extracted && extracted.text.trim().length === 0) {
          // A text layer that extracts to nothing (scanned-image PDF) reads as
          // unsupported, not as a successful empty window.
          extracted = null;
          extractEmpty = true;
          addToolCallProps({ attachment_extract_error: 'empty' });
        }

        if (extracted) {
          addToolCallProps({
            attachment_window: 'text',
            attachment_text_kind: extracted.kind,
            attachment_text_chars: extracted.text.length,
          });
          if (windowOffset >= extracted.text.length) {
            return textResult(
              `❌ offset ${windowOffset} is at or beyond the end of the extracted text (${extracted.text.length} chars total). ` +
              `Do not retry this offset — the previous window was the final one, or restart from offset 0.`);
          }
          const win = extracted.text.slice(windowOffset, windowOffset + ATTACHMENT_TEXT_WINDOW_CHARS);
          const end = windowOffset + win.length;
          const more = end < extracted.text.length;
          return textResult(
            `📎 ${attName} (${attMime || 'unknown type'}, ~${approxKb} KB) — extracted ${extracted.kind} text, chars ${windowOffset}–${end} of ${extracted.text.length}.` +
            (more ? ` More remains: call again with offset: ${end}.` : ' End of text.') +
            ` For the raw bytes instead, use mode: 'base64'.` +
            `\n---\n${win}`);
        }

        if (!extractFailed && !extractEmpty) {
          addToolCallProps({ attachment_extract_error: 'unsupported' });
        }

        if (readMode === 'text') {
          return textResult(
            `❌ No text could be extracted from '${attName}' (${attMime || 'unknown type'}) — text mode covers PDFs and .docx with a text layer plus text-family types` +
            `${extractFailed ? ', and this file defeated its extractor (corrupt or password-protected?)' : ' (a scanned/image-only PDF has no text layer)'}. ` +
            `Use mode: 'base64' to page through the raw bytes (~${ATTACHMENT_BYTES_WINDOW / 1000} KB per call), or ask the user to open it in Gmail.`);
        }

        // mode 'auto', nothing extractable.
        if (windowOffset > 0) return byteWindow();
        return textResult(
          `⚠️ Attachment is ~${approxKb} KB, which exceeds the ~150 KB limit for MCP responses, and no text could be extracted from it (${attMime || 'unknown type'}). ` +
          `Retrieve the raw bytes in windows with mode: 'base64', offset: 0 (~${ATTACHMENT_BYTES_WINDOW / 1000} KB per call; each response states the next offset), ` +
          `or ask the user to retrieve it directly from Gmail.`);
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
        const scopeDenial = gmailScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

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
        const scopeDenial = gmailScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

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
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

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
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

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
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, spreadsheetId, true));

        const encodedRange = encodeURIComponent(range);
        const body = JSON.stringify({ values, range });
        const result = await withSheetsGrace(perm, () => sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`, 'PUT', body, resolved.targetEmail));
        if (!result.ok) return sheetsErrorResult(result, spreadsheetId);
        return jsonResult({
          ...(result.data as Record<string, unknown>),
          fgac_hint: 'Values written. Formatting, charts, and structural changes: sheets_edit (same rule authorizes both).',
        });
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
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, spreadsheetId, true));

        const encodedRange = encodeURIComponent(range);
        const body = JSON.stringify({ values });
        const result = await withSheetsGrace(perm, () => sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`, 'POST', body, resolved.targetEmail));
        if (!result.ok) return sheetsErrorResult(result, spreadsheetId);
        return jsonResult({
          ...(result.data as Record<string, unknown>),
          fgac_hint: 'Rows appended as values. Formatting or structural changes: sheets_edit (same rule authorizes both).',
        });
      }
    );

    // ── sheets_edit ───────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.sheets_edit.name,
      toolConfig(TOOL_DEFS.sheets_edit, {
        spreadsheetId: z.string().describe('Google Spreadsheet ID'),
        requests: z.array(z.record(z.string(), z.any())).min(1).describe('Sheets API batchUpdate request objects, applied in order (e.g. repeatCell, addSheet, updateSheetProperties, addChart, mergeCells, setDataValidation)'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ spreadsheetId, requests, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, sheetsDenialAction(perm, spreadsheetId, true));

        const body = JSON.stringify({ requests });
        const result = await withSheetsGrace(perm, () => sheetsFetch(resolved.token, `${spreadsheetId}:batchUpdate`, 'POST', body, resolved.targetEmail));
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
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        const perm = await checkDocsPermission(conn.user.id, resolved.proxyKeyId, documentId, false);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, docsDenialAction(perm, documentId, false));

        const query = fields ? `?fields=${encodeURIComponent(fields)}` : '';
        const result = await withDocsGrace(perm, () => docsFetch(resolved.token, `${encodeURIComponent(documentId)}${query}`, 'GET', undefined, resolved.targetEmail));
        if (!result.ok) return docsErrorResult(result, documentId);
        return jsonResult(result.data);
      }
    );

    // ── docs_edit ─────────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.docs_edit.name,
      toolConfig(TOOL_DEFS.docs_edit, {
        documentId: z.string().describe('Google Docs document ID'),
        requests: z.array(z.record(z.string(), z.any())).min(1).describe('Docs API batchUpdate request objects, applied in order (e.g. insertText, insertTable, updateTextStyle, updateParagraphStyle, replaceAllText, insertInlineImage)'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ documentId, requests, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        const perm = await checkDocsPermission(conn.user.id, resolved.proxyKeyId, documentId, true);
        if (!perm.allowed) return policyDenialWithLink(conn, resolved.proxyKeyId, perm.reason, docsDenialAction(perm, documentId, true));

        const body = JSON.stringify({ requests });
        const verifyPlan = planDocsDeleteVerification(requests);
        const endBefore = verifyPlan.hasDelete
          ? await fetchDocsBodyEndIndex(resolved.token, documentId, resolved.targetEmail)
          : null;
        const result = await withDocsGrace(perm, () => docsFetch(resolved.token, `${encodeURIComponent(documentId)}:batchUpdate`, 'POST', body, resolved.targetEmail));
        if (!result.ok) return docsErrorResult(result, documentId);
        if (!verifyPlan.hasDelete) return jsonResult(result.data);

        const endAfter = await fetchDocsBodyEndIndex(resolved.token, documentId, resolved.targetEmail);
        const note = docsDeleteVerifyNote(verifyPlan, endBefore, endAfter);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(result.data, null, 2) },
            ...(note ? [{ type: 'text' as const, text: note }] : []),
          ],
        };
      }
    );

    // ── comments_read ─────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.comments_read.name,
      toolConfig(TOOL_DEFS.comments_read, {
        fileId: z.string().describe('Google Docs document ID or Google Sheets spreadsheet ID'),
        pageToken: z.string().optional().describe('nextPageToken from a previous page of results'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ fileId, pageToken, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        const check = await checkCommentsPermission(conn, resolved.proxyKeyId, fileId, false);
        if ('denial' in check) return check.denial;

        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/comments?fields=${encodeURIComponent(COMMENT_LIST_FIELDS)}&pageSize=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const result = await withGrantGrace(check.kind, check.perm, () => googleFetch(url, resolved.token, 'GET', undefined, resolved.targetEmail));
        if (!result.ok) return errorResult(result.error);
        return jsonResult(result.data);
      }
    );

    // ── comments_add ──────────────────────────────────────────────────
    server.registerTool(
      TOOL_DEFS.comments_add.name,
      toolConfig(TOOL_DEFS.comments_add, {
        fileId: z.string().describe('Google Docs document ID or Google Sheets spreadsheet ID'),
        content: z.string().describe('Comment or reply text'),
        commentId: z.string().optional().describe('Existing comment ID to reply to (from comments_read). Omit to create a new file-level comment.'),
        resolve: z.boolean().optional().describe('With commentId: also mark the comment resolved (Drive reply action "resolve")'),
        account: z.string().optional().describe('Email account to use.'),
      }),
      async ({ fileId, content, commentId, resolve, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;
        if (resolve && !commentId) {
          return textResult('❌ resolve requires commentId — resolving happens via a reply to an existing comment.');
        }

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);
        const scopeDenial = driveFileScopeDenial(conn, resolved);
        if (scopeDenial) return scopeDenial;

        const check = await checkCommentsPermission(conn, resolved.proxyKeyId, fileId, true);
        if ('denial' in check) return check.denial;

        const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
        const url = commentId
          ? `${base}/comments/${encodeURIComponent(commentId)}/replies?fields=${encodeURIComponent('id,content,action,createdTime')}`
          : `${base}/comments?fields=${encodeURIComponent('id,content,createdTime')}`;
        const payload = JSON.stringify(commentId && resolve ? { content, action: 'resolve' } : { content });
        const result = await withGrantGrace(check.kind, check.perm, () => googleFetch(url, resolved.token, 'POST', payload, resolved.targetEmail));
        if (!result.ok) return errorResult(result.error);
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

        // Classify before resolving the account: resolution failures keep
        // their raw_api_* props, and denials that need no account (batch,
        // unsupported families) answer without a token fetch.
        const cls = classifyAndStampRawCall(path, 'GET');
        if (cls.kind === 'denied') return textResult(cls.reason);

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        return executeRawGoogleCall(conn, resolved, path, 'GET', cls);
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

        // Classify before resolving the account — see google_api_get.
        const cls = classifyAndStampRawCall(path, method);
        if (cls.kind === 'denied') return textResult(cls.reason);

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return textResult(resolved.error);

        return executeRawGoogleCall(conn, resolved, path, method, cls, body);
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

        const { url, requestId, targetHash } = await mintApprovalLink(DASHBOARD_URL, conn.user.id, conn.proxyKeyId, action);
        await recordApprovalMint({
          requestId, userId: conn.user.id, proxyKeyId: conn.proxyKeyId, action: action.action, targetHash,
        });
        captureServerEvent(conn.user.clerkUserId, 'approval_link_minted', {
          action: action.action, via: 'request_access', request_id: requestId, target_hash: targetHash,
        });
        addToolCallProps({ approval_request_id: requestId });
        return jsonResult({
          status: 'approval_required',
          summary: action.action === 'send_whitelist'
            ? `Requesting permission to send email to ${recipient}`
            : action.action.startsWith('docs')
              ? `Requesting ${type === 'docs_read' ? 'read-only' : 'read & write'} access to document ${documentId}`
              : `Requesting ${type === 'sheets_read' ? 'read-only' : 'read & write'} access to spreadsheet ${spreadsheetId}`,
          approvalUrl: url,
          note: 'Nothing has been granted. Show the approval link to the user VERBATIM as a clickable URL — only they can approve it. The link does not expire and stays valid, so re-requesting produces the same URL rather than a new one. Do not retry the original operation until they confirm.',
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
            gmailSend: 'DENIED unless a send_whitelist rule matches the recipient (applies to messages/send AND drafts/send — draft recipients are resolved server-side)',
            gmailWrite: 'ALLOWED by default via google_api_modify: labels, drafts, messages modify/trash/untrash/batchModify, insert/import — everything the gmail.modify grant covers except sending (whitelisted above), settings writes (Google scopes FGAC does not hold), and permanent deletion (below)',
            sheets: 'DENIED unless a per-spreadsheet rule below exposes the sheet',
            docs: 'DENIED unless a per-document rule below exposes the document',
            deletion: 'NEVER available through any tool',
            rawApi: 'google_api_get / google_api_modify expose the Google API surface the grant covers under these same rules; Drive and Slides calls are forwarded subject to the per-file drive.file scope the user granted; POST v4/spreadsheets and POST v1/documents create new files auto-granted to this key; APIs outside the grant (People/Contacts, Calendar, Tasks, …) are refused with a clear denial',
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
    // Surfaced in the `initialize` result and loaded into the client's context
    // before any tool is called. Agents read tool catalogs as paths (task →
    // first plausible tool → stop), so the shortcut/full-surface relationship
    // must be stated up front, not only inside individual descriptions.
    //
    // The first two sentences are the whole onboarding surface for most
    // connectors: 2026-08-29 analysis of the silent-connector cohort showed
    // every measurable zero-call user DOES complete the initialize handshake
    // (Claude.ai web 8:1 over Claude Code, most across many sessions), so
    // this string reaches their context repeatedly while list_accounts's
    // next_steps block never does — a user whose agent calls nothing never
    // sees a tool result. Two failure modes it must counter: the agent
    // claiming it cannot access the user's mail despite the connector, and
    // a just-connected user never being shown what a first use looks like.
    instructions:
      "These tools give live access to the Gmail, Google Docs, and Google Sheets accounts the user has already connected — mailbox reads work immediately, with no further setup. " +
      "When the user mentions their email, documents, or spreadsheets, reach for these tools instead of saying you cannot access their data. " +
      "If this connector has not been used yet, call list_accounts first: it returns the reachable mailboxes plus next-step guidance, and makes an easy first demonstration to offer (e.g. summarizing recent unread mail). " +
      'FGAC proxies Google Workspace behind per-user access rules enforced upstream at the proxy — every tool passes through the same enforcement. ' +
      'The typed tools are shortcuts for common operations: docs_edit and sheets_edit accept native Google batchUpdate requests (tables, text styles, ' +
      'cell formatting, charts, sheet tabs), comments_read and comments_add cover Drive-API comments on docs and sheets, and the values/gmail tools ' +
      'handle the simple cases. The full Google API surface is available through google_api_get (reads) and google_api_modify (writes) — Gmail threads, ' +
      'drafts, labels, and mailbox organization (archive, mark read, trash), Drive file listing and export, creating new documents or spreadsheets. Fall back to them instead of treating an operation as ' +
      'unsupported. A denied call is not a dead end: it returns a one-click approval link — show it to the user and retry after they approve.',
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
 * Kill switch for the auth optimizations below (JWKS singleton + strategy
 * memo). Set MCP_AUTH_OPTIMIZATIONS=disabled to restore the legacy behavior
 * (fresh JWKS per call, fixed clerk→direct try-order) without a code revert.
 */
const authOptimizationsEnabled = () => process.env.MCP_AUTH_OPTIMIZATIONS !== 'disabled';

/**
 * Optimization A: one remote JWKS per function instance instead of per
 * request. jose caches fetched keys inside this object — it refetches
 * immediately when it sees an unknown `kid` (rate-limited by
 * cooldownDuration) and expires known keys after cacheMaxAge, so a retired
 * signing key is trusted for at most 5 minutes. These are public keys; the
 * security control is the pinned-issuer check in the caller, which is
 * unchanged.
 */
let jwksSingleton: { issuer: string; jwks: JWTVerifyGetKey } | null = null;

async function getClerkJwks(issuer: string): Promise<JWTVerifyGetKey> {
  const { createRemoteJWKSet } = await import('jose');
  const url = new URL(`${issuer}/.well-known/jwks.json`);
  if (!authOptimizationsEnabled()) return createRemoteJWKSet(url);
  if (!jwksSingleton || jwksSingleton.issuer !== issuer) {
    jwksSingleton = {
      issuer,
      jwks: createRemoteJWKSet(url, { cooldownDuration: 30_000, cacheMaxAge: 300_000 }),
    };
  }
  return jwksSingleton.jwks;
}

/**
 * Optimization B: remember which verification strategy last worked for each
 * OAuth client so established CLI clients skip the doomed Clerk auth()
 * attempt. Routing hint ONLY — both strategies remain fail-closed and the
 * other one still runs when the preferred one fails, so a wrong (or
 * attacker-planted) memo entry can never grant access, only reorder two
 * verifiers. Bounded LRU so bogus client_ids can't grow it without limit.
 */
const STRATEGY_MEMO_MAX = 500;
const strategyMemo = new Map<string, 'clerk' | 'direct'>();

function strategyMemoGet(clientId: string): 'clerk' | 'direct' | undefined {
  const v = strategyMemo.get(clientId);
  if (v !== undefined) {
    strategyMemo.delete(clientId);
    strategyMemo.set(clientId, v);
  }
  return v;
}

function strategyMemoSet(clientId: string, strategy: 'clerk' | 'direct'): void {
  if (strategyMemo.has(clientId)) {
    strategyMemo.delete(clientId);
  } else if (strategyMemo.size >= STRATEGY_MEMO_MAX) {
    const oldest = strategyMemo.keys().next().value;
    if (oldest !== undefined) strategyMemo.delete(oldest);
  }
  strategyMemo.set(clientId, strategy);
}

/**
 * client_id from the UNVERIFIED token payload — used only to look up the
 * strategy memo and label auth metrics, never to authorize.
 *
 * Both claims are caller-controlled on a failed auth (anyone can mint an
 * unsigned JWT with any header/payload), and both now travel into analytics on
 * `mcp_auth_attempt`. Truncate them: a real Clerk client_id/kid is well under
 * this, while an unbounded value would let an unauthenticated caller inflate
 * every event it triggers — and would grow strategy-memo keys without limit
 * even though the memo caps entry *count*.
 */
const MAX_CLAIM_LEN = 128;

function unverifiedTokenClaims(token?: string): { clientId?: string; kid?: string } {
  if (!token) return {};
  const claim = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_CLAIM_LEN) : undefined;
  try {
    const [headerB64, payloadB64] = token.split('.');
    if (!payloadB64) return {};
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    return { clientId: claim(payload.client_id), kid: claim(header.kid) };
  } catch {
    return {};
  }
}

/**
 * Direct JWT verification fallback for CLI/non-browser OAuth tokens.
 * Used when Clerk's auth()+verifyClerkToken fails to extract userId/clientId.
 * Fails closed unless the token's issuer is exactly our Clerk instance.
 */
async function verifyClerkJwtDirect(token: string) {
  try {
    const { jwtVerify } = await import('jose');
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return undefined;
    const rawPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const issuer = rawPayload.iss;

    const expected = expectedClerkIssuer();
    if (!expected || issuer !== expected) {
      console.error(`[MCP] Rejecting token from unexpected issuer '${issuer}' (expected '${expected ?? 'unavailable'}')`);
      return undefined;
    }

    const JWKS = await getClerkJwks(issuer);
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

// Success events are sampled 1-in-20 PER REQUEST; failures always capture.
// Lives in src/lib/authSampling.ts — read its header before touching the gate:
// two prior versions keyed the draw off the token itself, which is not a
// sample of requests and made `ok` counts unusable for volume estimation.

const verifyMcpAuth = async (req: Request, bearerToken?: string) => {
  let authInfo: ReturnType<typeof verifyClerkToken> | Awaited<ReturnType<typeof verifyClerkJwtDirect>> | undefined;
  let strategyUsed: 'clerk' | 'direct' | 'none' = 'none';
  let clerkErrorClass: string | undefined;

  const { clientId: clientIdHint, kid } = unverifiedTokenClaims(bearerToken);
  const memoStrategy =
    authOptimizationsEnabled() && clientIdHint ? strategyMemoGet(clientIdHint) : undefined;

  // Strategy 1: Clerk's built-in auth() + verifyClerkToken
  const tryClerk = async () => {
    try {
      const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
      const result = verifyClerkToken(clerkAuth, bearerToken);
      if (result?.extra?.userId) {
        authInfo = result;
        strategyUsed = 'clerk';
      }
    } catch (error) {
      clerkErrorClass = error instanceof Error ? error.name : 'unknown';
      console.warn('[MCP] Clerk auth() failed:', error);
    }
  };

  // Strategy 2: Direct JWT verification (fallback for CLI/non-browser contexts)
  const tryDirect = async () => {
    if (!bearerToken) return;
    const result = await verifyClerkJwtDirect(bearerToken);
    if (result) {
      authInfo = result;
      strategyUsed = 'direct';
    }
  };

  // Optimization B: try the strategy that last worked for this client first;
  // the other still runs on a miss, so try-order never changes the outcome.
  if (memoStrategy === 'direct') {
    await tryDirect();
    if (!authInfo) await tryClerk();
  } else {
    await tryClerk();
    if (!authInfo) {
      if (!memoStrategy) console.log('[MCP] Falling back to direct JWT verification');
      await tryDirect();
    }
  }

  if (authInfo && clientIdHint && strategyUsed !== 'none' && authOptimizationsEnabled()) {
    strategyMemoSet(clientIdHint, strategyUsed);
  }

  // Client self-identification: in stateless streamable HTTP every POST gets
  // a fresh McpServer, so the `initialize` request is the ONLY place the
  // client's name/version exist server-side — and this auth wrapper is the
  // only code that still holds the raw Request. Parsed from a clone;
  // undefined for every other request.
  const clientInfo = await parseInitializeClientInfo(req);
  const userAgent = req.headers.get('user-agent') ?? undefined;
  // Set by middleware when the client connected via /api/mcp/<slug>.
  const profileSlug = req.headers.get('x-fgac-profile-slug') ?? undefined;

  // Auth-health instrumentation: every failure, sampled successes. This is
  // the alerting substrate for the JWKS/strategy optimizations — an auth
  // regression shows up here (and as vanishing $mcp_tool_call volume) long
  // before anyone reads function logs.
  const outcome = authInfo ? 'ok' : bearerToken ? 'invalid_token' : 'no_token';
  if (outcome !== 'ok' || inSuccessSample()) {
    captureServerEvent(
      (authInfo?.extra?.userId as string | undefined) ?? 'anonymous-mcp',
      'mcp_auth_attempt',
      {
        outcome,
        client_id: (authInfo as { clientId?: string } | undefined)?.clientId ?? clientIdHint,
        strategy_used: strategyUsed,
        memo_hit: memoStrategy !== undefined,
        optimizations_enabled: authOptimizationsEnabled(),
        success_sample_rate: AUTH_SUCCESS_SAMPLE,
        error_class: clerkErrorClass,
        kid: outcome === 'invalid_token' ? kid : undefined,
        method: req.method,
      },
    );
  }

  // Install-funnel measurement (pre-Clerk visibility): an unauthenticated MCP
  // request is the first FGAC-owned touchpoint when a client adds the
  // connector — the 401 issued below is what sends it into OAuth discovery.
  // Anonymous by design (distinct_id is already excluded from user metrics);
  // this is a rate metric, not an identity metric. reason='no_token' on POST
  // approximates fresh install attempts; 'invalid_token' is mostly token
  // expiry/refresh noise from established clients.
  // `install_fingerprint` (salted hash of ip+ua) is the uniqueness key:
  // distinct_id stays 'anonymous-mcp' so person-space is untouched, and
  // uniq(properties.install_fingerprint) becomes the real installer count —
  // raw daily totals are 401/retry volume (exactly the mcp_auth_attempt
  // failure counts above), not people. An unauthenticated `initialize`
  // additionally self-reports the client product.
  if (!authInfo) {
    captureServerEvent('anonymous-mcp', 'connector_install_started', {
      touchpoint: 'mcp_401',
      reason: bearerToken ? 'invalid_token' : 'no_token',
      method: req.method,
      user_agent: userAgent,
      install_fingerprint: installFingerprint(req),
      client_name: clientInfo?.name,
      client_version: clientInfo?.version,
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
    // withToolAnalytics sees only authInfo, never the Request — ride the
    // user-agent along so $mcp_tool_call can be split by client product.
    (authInfo as { extra?: Record<string, unknown> }).extra = { ...authInfo.extra, userAgent, profileSlug };
    // Once-per-MCP-session product attribution (the initialize handshake).
    if (clientInfo && userId) {
      captureServerEvent(userId, 'mcp_client_initialize', {
        client_name: clientInfo.name,
        client_version: clientInfo.version,
        client_id: clientId,
        user_agent: userAgent,
      });
    }
    if (userId && clientId) {
      try {
        await resolveConnection(userId, clientId, clientInfo, profileSlug);
      } catch (err) {
        console.error('[MCP] Eager connection creation failed:', describeErrorForLog(err));
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

// experimental_withMcpAuth takes resourceMetadataPath as a module-level
// constant, but profile-addressed URLs (/api/mcp/<slug>, rewritten by
// middleware with the slug in a header) need their 401s to point at the
// per-slug metadata document — the MCP spec requires the advertised
// `resource` to match the URL the client connected to exactly. Patch the
// pointer on the way out.
const withProfileResourceMetadata =
  (h: (req: Request) => Promise<Response>) =>
  async (req: Request): Promise<Response> => {
    const slug = req.headers.get('x-fgac-profile-slug');
    // The middleware rewrite routes /api/mcp/<slug> to this file, but the
    // handler still sees the ORIGINAL external URL in req.url — and
    // mcp-handler 404s on anything that isn't exactly '/api/mcp'. Normalize
    // before handing over; the slug survives in the header.
    if (slug) {
      const url = new URL(req.url);
      if (url.pathname !== '/api/mcp') {
        url.pathname = '/api/mcp';
        req = new Request(url, req);
      }
    }
    const res = await h(req);
    if (!slug || res.status !== 401) return res;
    const www = res.headers.get('WWW-Authenticate');
    if (!www || !www.includes('resource_metadata=')) return res;
    const headers = new Headers(res.headers);
    headers.set(
      'WWW-Authenticate',
      www.replace(
        /resource_metadata="([^"]+?)\/?"/,
        (_m, base) => `resource_metadata="${base}/${slug}"`,
      ),
    );
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };

const profileAwareHandler = withProfileResourceMetadata(authedHandler);

export const POST = profileAwareHandler;
export const GET = profileAwareHandler;
export const DELETE = profileAwareHandler;

// Headroom for the sheets grant-propagation grace retries (≤ ~7 s added on
// top of normal Google latency) — never let them race the function timeout.
// googleFetch aborts each Google exchange at GOOGLE_FETCH_TIMEOUT_MS (50 s),
// so a hung upstream call is classified and captured before this kill fires.
export const maxDuration = 60;
