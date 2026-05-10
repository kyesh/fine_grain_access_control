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

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

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

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, userId),
  });

  if (!user) {
    return { authorized: false, reason: 'user_not_found' };
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
        '⚠️ This connection has not been approved yet.',
        '',
        'To activate this agent, ask the user to:',
        `1. Visit their FGAC dashboard: ${result.dashboardUrl}`,
        '2. Find this connection under "Agent Connections"',
        '3. Assign it to an agent profile (proxy key) with the desired permissions',
        '',
        'Once approved, retry your request.',
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

// ─── Require Approval Wrapper ───────────────────────────────────────────────

type AuthInfo = { extra?: { userId?: string }; clientId?: string };

async function requireApproval(authInfo: AuthInfo | undefined): Promise<ConnectionApproved | { content: Array<{ type: string; text: string }> }> {
  const userId = authInfo?.extra?.userId as string | undefined;
  const clientId = authInfo?.clientId;

  if (!userId) {
    return { content: [{ type: 'text', text: '❌ Authentication failed.' }] };
  }

  const result = await resolveConnection(userId, clientId);
  if (!result.authorized) {
    return { content: [{ type: 'text', text: pendingMessage(result) }] };
  }
  return result;
}

async function resolveAccountAndToken(
  conn: ConnectionApproved,
  account?: string,
) {
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
          return { content: [{ type: 'text', text: '❌ No proxy key assigned.' }] };
        }
        const emails = await getAccessibleEmails(conn.proxyKeyId);
        return {
          content: [{
            type: 'text',
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
        if ('error' in resolved) return { content: [{ type: 'text', text: resolved.error }] };

        const params = new URLSearchParams();
        if (query) params.set('q', query);
        params.set('maxResults', String(max || 10));

        const data = await gmailFetch(resolved.token, resolved.targetEmail, `messages?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
        if ('error' in resolved) return { content: [{ type: 'text', text: resolved.error }] };

        // Check read blacklist rules
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const data = await gmailFetch(resolved.token, resolved.targetEmail, `messages/${messageId}?format=${format || 'full'}`);

        // Apply read blacklist
        const readBlacklist = rules.filter(r => r.service === 'gmail' && r.actionType === 'read_blacklist');
        const bodyStr = JSON.stringify(data);
        for (const rule of readBlacklist) {
          const regexStr = rule.regexPattern.replace(/\*/g, '.*');
          if (!safeRegex(regexStr)) continue;
          if (new RegExp(regexStr, 'i').test(bodyStr)) {
            return { content: [{ type: 'text', text: `🚫 Access restricted: Content blocked by rule '${rule.ruleName}'.` }] };
          }
        }

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
        if ('error' in resolved) return { content: [{ type: 'text', text: resolved.error }] };

        // Enforce send whitelist
        const rules = await loadApplicableRules(conn.user.id, resolved.proxyKeyId, resolved.targetEmail);
        const sendRules = rules.filter(r => r.service === 'gmail' && r.actionType === 'send_whitelist');

        if (sendRules.length === 0) {
          return { content: [{ type: 'text', text: `🚫 No send whitelist rules configured. Ask the user to add '${to}' to the sending whitelist.` }] };
        }

        let isWhitelisted = false;
        for (const rule of sendRules) {
          const regexStr = rule.regexPattern.replace(/\*/g, '.*');
          if (!safeRegex(regexStr)) continue;
          if (new RegExp(regexStr, 'i').test(to)) { isWhitelisted = true; break; }
        }

        if (!isWhitelisted) {
          return { content: [{ type: 'text', text: `🚫 Unauthorized recipient. '${to}' is not in the send whitelist. Ask the user to add it.` }] };
        }

        // Build RFC 2822 message
        const raw = Buffer.from(
          `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
        ).toString('base64url');

        const data = await gmailFetch(resolved.token, resolved.targetEmail, 'messages/send', 'POST', JSON.stringify({ raw }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
        if ('error' in resolved) return { content: [{ type: 'text', text: resolved.error }] };

        const data = await gmailFetch(resolved.token, resolved.targetEmail, 'labels');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
          return { content: [{ type: 'text', text: '❌ No proxy key assigned.' }] };
        }

        const emails = await getAccessibleEmails(conn.proxyKeyId);
        const key = await db.select().from(proxyKeys)
          .where(eq(proxyKeys.id, conn.proxyKeyId)).then(r => r[0]);

        // Load rules for the key owner
        const allRules = await db.select().from(accessRules)
          .where(eq(accessRules.userId, conn.user.id));

        return {
          content: [{
            type: 'text',
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
      name: 'fgac-gmail',
      version: '1.0.0',
    },
  },
  {
    basePath: '/api',
    verboseLogs: false,
  }
);

export const POST = experimental_withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    try {
      const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
      const authInfo = verifyClerkToken(clerkAuth, bearerToken);
      return authInfo;
    } catch (error) {
      console.error('[MCP] Token verification error:', error);
      return undefined;
    }
  },
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  }
);

export const GET = handler;
export const DELETE = handler;
