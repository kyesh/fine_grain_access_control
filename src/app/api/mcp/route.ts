/**
 * Production MCP Server — FGAC.ai Gmail Access Control
 *
 * Promoted from /api/spike/mcp with full Gmail tool support.
 * Uses the Pending Approval pattern validated in spikes #1 and #2.
 *
 * Auth chain: OAuth token → userId + clientId → agent_connections →
 *   proxy_key → key_email_access → Clerk Google token → Gmail API
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
import { clerkClient } from '@clerk/nextjs/server';
import safeRegex from 'safe-regex';
import { resolveDbUser } from '@/db/userHelpers';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
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
    const [newConn] = await db.insert(agentConnections).values({
      userId: user.id,
      clientId,
      clientName: clientId,
      status: 'pending',
    }).returning();
    connection = newConn;

    console.log(`[MCP] New connection: user=${user.email} client=${clientId} conn=${connection.id} status=PENDING`);
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

  return {
    authorized: true,
    reason: 'approved',
    connectionId: connection.id,
    proxyKeyId: connection.proxyKeyId,
    nickname: connection.nickname,
    user: { id: user.id, email: user.email, clerkUserId: user.clerkUserId },
  };
}

// ─── Pending Approval Message ───────────────────────────────────────────────

function pendingMessage(result: ConnectionDenied) {
  switch (result.reason) {
    case 'pending_approval':
      return [
        'Please share this exact error message with the user:',
        `You have not assigned this client ${result.connectionId} to a permission profile please assign a profile by visiting:`,
        `${result.dashboardUrl}`,
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
  return db.select().from(keyEmailAccess)
    .where(eq(keyEmailAccess.proxyKeyId, proxyKeyId));
}

async function checkEmailAccess(proxyKeyId: string, targetEmail: string) {
  const rows = await db.select().from(keyEmailAccess)
    .where(eq(keyEmailAccess.proxyKeyId, proxyKeyId));
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

async function loadApplicableRules(userId: string, proxyKeyId: string, targetEmail: string) {
  const allUserRules = await db.select().from(accessRules)
    .where(eq(accessRules.userId, userId));

  const keyAssignments = await db.select().from(keyRuleAssignments)
    .where(eq(keyRuleAssignments.proxyKeyId, proxyKeyId));

  const assignedRuleIds = new Set(keyAssignments.map(a => a.accessRuleId));
  const allAssignments = await db.select().from(keyRuleAssignments);
  const rulesWithAssignments = new Set(allAssignments.map(a => a.accessRuleId));

  return allUserRules.filter(rule => {
    const isGlobal = !rulesWithAssignments.has(rule.id);
    const isAssignedToThisKey = assignedRuleIds.has(rule.id);
    const emailMatches = !rule.targetEmail ||
      rule.targetEmail.toLowerCase() === targetEmail.toLowerCase();
    return (isGlobal || isAssignedToThisKey) && emailMatches;
  });
}

// ─── Gmail API Helpers ──────────────────────────────────────────────────────

async function gmailFetch(token: string, email: string, path: string, method = 'GET', body?: string) {
  const userId = email === 'me' ? 'me' : encodeURIComponent(email);
  const url = `https://www.googleapis.com/gmail/v1/users/${userId}/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  return res.json();
}

function extractSheetsSpreadsheetId(path: string): string | null {
  const match = path.match(/(?:v4\/spreadsheets|sheets\/v4\/spreadsheets|spreadsheets)\/([^/?:#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function sheetsFetch(token: string, path: string, method = 'GET', body?: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  return res.json();
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
    return { allowed: false, reason: `🚫 Access Denied: Spreadsheet '${spreadsheetId}' is not exposed in your FGAC rules.` };
  }

  if (sheetsRules.some(r => r.actionType === 'sheet_block')) {
    return { allowed: false, reason: `🚫 Access Denied: Access to spreadsheet '${spreadsheetId}' is explicitly blocked.` };
  }

  if (isMutating) {
    const hasReadWrite = sheetsRules.some(r => r.actionType === 'sheet_read_write');
    if (!hasReadWrite) {
      return { allowed: false, reason: `🚫 Access Denied: Write access to spreadsheet '${spreadsheetId}' is restricted (Read Only).` };
    }
  }

  return { allowed: true };
}

// ─── Require Approval Wrapper ───────────────────────────────────────────────

type AuthInfo = { extra?: { userId?: string }; clientId?: string };

async function requireApproval(authInfo: AuthInfo | undefined): Promise<ConnectionApproved | { content: Array<{ type: 'text'; text: string }> }> {
  const userId = authInfo?.extra?.userId as string | undefined;
  const clientId = authInfo?.clientId;

  if (!userId) {
    return { content: [{ type: 'text' as const, text: '❌ Authentication failed.' }] };
  }

  const result = await resolveConnection(userId, clientId);
  if (!result.authorized) {
    return { content: [{ type: 'text' as const, text: pendingMessage(result) }] };
  }
  return result;
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

  const token = await getGoogleToken(targetEmail, conn.user);
  if (!token) {
    return { error: `❌ Could not fetch Google token for '${targetEmail}'. The account owner may need to reconnect Google.` };
  }

  return { targetEmail, token, proxyKeyId: conn.proxyKeyId };
}

// ─── MCP Handler ────────────────────────────────────────────────────────────

const handler = createMcpHandler(
  (server) => {

    // ── list_accounts ─────────────────────────────────────────────────
    server.tool(
      'list_accounts',
      'Lists all email accounts this agent can access.',
      {},
      async (_params, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;
        if (!conn.proxyKeyId) {
          return { content: [{ type: 'text' as const, text: '❌ No proxy key assigned.' }] };
        }
        const emails = await getAccessibleEmails(conn.proxyKeyId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              accounts: emails.map(e => e.targetEmail),
              default: conn.user.email,
              nickname: conn.nickname,
            }, null, 2),
          }],
        };
      }
    );

    // ── gmail_list ────────────────────────────────────────────────────
    server.tool(
      'gmail_list',
      'List recent emails. Optionally filter by query.',
      {
        account: z.string().optional().describe('Email account to use. Defaults to primary.'),
        query: z.string().optional().describe('Gmail search query (e.g., "is:unread")'),
        max: z.number().optional().describe('Max results (default: 10)'),
      },
      async ({ account, query, max }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('maxResults', String(max || 10));

        const data = await gmailFetch(resolved.token, resolved.targetEmail, `messages?${params}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── gmail_read ────────────────────────────────────────────────────
    server.tool(
      'gmail_read',
      'Read a specific email by message ID.',
      {
        account: z.string().optional().describe('Email account to use.'),
        messageId: z.string().describe('Gmail message ID'),
        format: z.enum(['full', 'metadata', 'minimal']).optional().describe('Response format'),
      },
      async ({ account, messageId, format }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        // Check read blacklist rules
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const data = await gmailFetch(resolved.token, resolved.targetEmail, `messages/${messageId}?format=${format || 'full'}`);

        // Apply read blacklist
        const readBlacklist = rules.filter(r => r.service === 'gmail' && r.actionType === 'read_blacklist');
        const bodyStr = JSON.stringify(data);
        for (const rule of readBlacklist) {
          if (!rule.regexPattern) continue;
          const regexStr = rule.regexPattern.replace(/\*/g, '.*');
          if (!safeRegex(regexStr)) continue;
          if (new RegExp(regexStr, 'i').test(bodyStr)) {
            return { content: [{ type: 'text' as const, text: `🚫 Access restricted: Content blocked by rule '${rule.ruleName}'.` }] };
          }
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── gmail_get_attachment ──────────────────────────────────────────
    server.tool(
      'gmail_get_attachment',
      'Download and retrieve an email attachment by message ID and attachment ID.',
      {
        messageId: z.string().describe('Gmail message ID containing the attachment'),
        attachmentId: z.string().describe('Attachment ID (found in message details payload.parts)'),
        account: z.string().optional().describe('Email account to use.'),
      },
      async ({ messageId, attachmentId, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        // Check read blacklist rules on parent message
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const parentMsg = await gmailFetch(resolved.token, resolved.targetEmail, `messages/${messageId}?format=full`);

        const readBlacklist = rules.filter(r => r.service === 'gmail' && r.actionType === 'read_blacklist');
        const parentBodyStr = JSON.stringify(parentMsg);
        for (const rule of readBlacklist) {
          if (!rule.regexPattern) continue;
          const regexStr = rule.regexPattern.replace(/\*/g, '.*');
          if (!safeRegex(regexStr)) continue;
          if (new RegExp(regexStr, 'i').test(parentBodyStr)) {
            return { content: [{ type: 'text' as const, text: `🚫 Access restricted: Parent email content blocked by rule '${rule.ruleName}'.` }] };
          }
        }

        // Fetch attachment body from Gmail API
        const attachmentData = await gmailFetch(
          resolved.token,
          resolved.targetEmail,
          `messages/${messageId}/attachments/${attachmentId}`
        );

        return { content: [{ type: 'text' as const, text: JSON.stringify(attachmentData, null, 2) }] };
      }
    );

    // ── gmail_send ────────────────────────────────────────────────────
    server.tool(
      'gmail_send',
      'Send an email. Subject to send whitelist rules.',
      {
        account: z.string().optional().describe('Email account to send from.'),
        to: z.string().describe('Recipient email address'),
        subject: z.string().describe('Email subject line'),
        body: z.string().describe('Email body (plain text)'),
      },
      async ({ account, to, subject, body }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        // Enforce send whitelist
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const sendRules = rules.filter(r => r.service === 'gmail' && r.actionType === 'send_whitelist');

        if (sendRules.length === 0) {
          return { content: [{ type: 'text' as const, text: `🚫 No send whitelist rules configured. Ask the user to add '${to}' to the sending whitelist.` }] };
        }

        let isWhitelisted = false;
        for (const rule of sendRules) {
          if (!rule.regexPattern) continue;
          const regexStr = rule.regexPattern.replace(/\*/g, '.*');
          if (!safeRegex(regexStr)) continue;
          if (new RegExp(regexStr, 'i').test(to)) { isWhitelisted = true; break; }
        }

        if (!isWhitelisted) {
          return { content: [{ type: 'text' as const, text: `🚫 Unauthorized recipient. '${to}' is not in the send whitelist. Ask the user to add it.` }] };
        }

        // Build RFC 2822 message
        const raw = Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url');

        const data = await gmailFetch(resolved.token, resolved.targetEmail, 'messages/send', 'POST', JSON.stringify({ raw }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── gmail_labels ──────────────────────────────────────────────────
    server.tool(
      'gmail_labels',
      'List all Gmail labels for an account.',
      { account: z.string().optional().describe('Email account to use.') },
      async ({ account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        const data = await gmailFetch(resolved.token, resolved.targetEmail, 'labels');
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── sheets_get_spreadsheet ────────────────────────────────────────
    server.tool(
      'sheets_get_spreadsheet',
      'Get metadata and sheet tabs for an exposed Google Spreadsheet.',
      {
        spreadsheetId: z.string().describe('Google Spreadsheet ID (e.g. 1BxiMVs0...)'),
        account: z.string().optional().describe('Email account to use.'),
      },
      async ({ spreadsheetId, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, false);
        if (!perm.allowed) return { content: [{ type: 'text' as const, text: perm.reason! }] };

        const data = await sheetsFetch(resolved.token, `${spreadsheetId}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── sheets_read_range ─────────────────────────────────────────────
    server.tool(
      'sheets_read_range',
      'Read cell values from a specific sheet tab and range in a Google Spreadsheet.',
      {
        spreadsheetId: z.string().describe('Google Spreadsheet ID'),
        range: z.string().describe("Cell range (e.g. 'Sheet1'!A1:D20 or 'Sheet1')"),
        account: z.string().optional().describe('Email account to use.'),
      },
      async ({ spreadsheetId, range, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, false);
        if (!perm.allowed) return { content: [{ type: 'text' as const, text: perm.reason! }] };

        const encodedRange = encodeURIComponent(range);
        const data = await sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── sheets_update_range ───────────────────────────────────────────
    server.tool(
      'sheets_update_range',
      'Update cell values in a range within a Google Spreadsheet (requires Read & Write permission).',
      {
        spreadsheetId: z.string().describe('Google Spreadsheet ID'),
        range: z.string().describe("Cell range (e.g. 'Sheet1'!A1:B2)"),
        values: z.array(z.array(z.any())).describe('2D array of cell values'),
        account: z.string().optional().describe('Email account to use.'),
      },
      async ({ spreadsheetId, range, values, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, true);
        if (!perm.allowed) return { content: [{ type: 'text' as const, text: perm.reason! }] };

        const encodedRange = encodeURIComponent(range);
        const body = JSON.stringify({ values, range });
        const data = await sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}?valueInputOption=USER_ENTERED`, 'PUT', body);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── sheets_append_rows ────────────────────────────────────────────
    server.tool(
      'sheets_append_rows',
      'Append data rows to a sheet in a Google Spreadsheet (requires Read & Write permission).',
      {
        spreadsheetId: z.string().describe('Google Spreadsheet ID'),
        range: z.string().describe("Sheet tab or range to append to (e.g. 'Sheet1')"),
        values: z.array(z.array(z.any())).describe('2D array of rows to append'),
        account: z.string().optional().describe('Email account to use.'),
      },
      async ({ spreadsheetId, range, values, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, true);
        if (!perm.allowed) return { content: [{ type: 'text' as const, text: perm.reason! }] };

        const encodedRange = encodeURIComponent(range);
        const body = JSON.stringify({ values });
        const data = await sheetsFetch(resolved.token, `${spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED`, 'POST', body);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      }
    );

    // ── raw_google_api_call ───────────────────────────────────────────
    server.tool(
      'raw_google_api_call',
      'Execute any raw Google API request (Gmail or Google Sheets) through FGAC access control rules. Guarantees access to any API endpoint even if no dedicated tool exists.',
      {
        path: z.string().describe('API path (e.g. "v4/spreadsheets/1BxiM.../values/Sheet1" or "gmail/v1/users/me/messages")'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('HTTP method (default: GET)'),
        body: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('Request body (JSON object or string)'),
        account: z.string().optional().describe('Email account to use.'),
      },
      async ({ path, method = 'GET', body, account }, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;

        const resolved = await resolveAccountAndToken(conn, account);
        if ('error' in resolved) return { content: [{ type: 'text' as const, text: resolved.error }] };

        const isMutating = method !== 'GET';
        let googleUrl = '';

        // Evaluate FGAC rules based on path
        if (path.includes('spreadsheets')) {
          const spreadsheetId = extractSheetsSpreadsheetId(path);
          if (spreadsheetId) {
            const perm = await checkSheetsPermission(conn.user.id, resolved.proxyKeyId, spreadsheetId, isMutating);
            if (!perm.allowed) {
              return { content: [{ type: 'text' as const, text: perm.reason! }] };
            }
          }
          const cleanPath = path.replace(/^sheets\//, '');
          googleUrl = `https://sheets.googleapis.com/${cleanPath}`;
        } else {
          // Gmail / general Google API
          const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);

          if (isMutating && path.includes('messages/send')) {
            const sendRules = rules.filter(r => r.service === 'gmail' && r.actionType === 'send_whitelist');
            if (sendRules.length === 0) {
              return { content: [{ type: 'text' as const, text: '🚫 Access Denied: No send whitelist rules configured.' }] };
            }
          }

          if (method === 'DELETE' && (path.includes('messages/trash') || path.includes('emptyTrash'))) {
            return { content: [{ type: 'text' as const, text: '🚫 Access Denied: Safeguard prevents deletion of emails.' }] };
          }

          googleUrl = `https://www.googleapis.com/${path}`;
        }

        const bodyString = typeof body === 'object' ? JSON.stringify(body) : body;
        const res = await fetch(googleUrl, {
          method,
          headers: {
            'Authorization': `Bearer ${resolved.token}`,
            'Content-Type': 'application/json',
          },
          body: isMutating ? bodyString : undefined,
        });

        const resText = await res.text();
        let parsedData: any = resText;
        try { parsedData = JSON.parse(resText); } catch {}

        return { content: [{ type: 'text' as const, text: typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData, null, 2) }] };
      }
    );

    // ── get_my_permissions ────────────────────────────────────────────
    server.tool(
      'get_my_permissions',
      'Shows the current access rules and permissions for this agent.',
      {},
      async (_params, { authInfo }) => {
        const conn = await requireApproval(authInfo);
        if ('content' in conn) return conn;
        if (!conn.proxyKeyId) {
          return { content: [{ type: 'text' as const, text: '❌ No proxy key assigned.' }] };
        }

        const emails = await getAccessibleEmails(conn.proxyKeyId);
        const key = await db.select().from(proxyKeys)
          .where(eq(proxyKeys.id, conn.proxyKeyId)).then(r => r[0]);

        // Load rules for the key owner
        const allRules = await db.select().from(accessRules)
          .where(eq(accessRules.userId, conn.user.id));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              connection: { id: conn.connectionId, nickname: conn.nickname },
              proxyKey: { id: key?.id, label: key?.label },
              accessibleEmails: emails.map(e => e.targetEmail),
              rules: allRules.map(r => ({
                name: r.ruleName,
                type: r.actionType,
                pattern: r.regexPattern,
                email: r.targetEmail || 'all',
              })),
            }, null, 2),
          }],
        };
      }
    );
  },
  {
    serverInfo: {
      name: 'fgac',
      version: '1.0.0',
    },
  },
  {
    basePath: '/api',
    verboseLogs: false,
  }
);

/**
 * Direct JWT verification fallback for CLI/non-browser OAuth tokens.
 * Used when Clerk's auth()+verifyClerkToken fails to extract userId/clientId.
 */
async function verifyClerkJwtDirect(token: string) {
  try {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return undefined;
    const rawPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const issuer = rawPayload.iss;
    if (!issuer) return undefined;

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

export const POST = experimental_withMcpAuth(
  handler,
  async (_req, bearerToken) => {
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
    if (authInfo) {
      const userId = authInfo.extra?.userId as string | undefined;
      const clientId = (authInfo as Record<string, unknown>).clientId as string | undefined;
      if (userId && clientId) {
        resolveConnection(userId, clientId).catch((err) =>
          console.error('[MCP] Eager connection creation failed:', err)
        );
      }
    }

    return authInfo;
  },
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  }
);

export const GET = handler;
export const DELETE = handler;
