/**
 * MCP Spike — Pending Approval Flow
 *
 * This validates the user-controlled agent binding pattern:
 * 1. Agent connects via OAuth → gets userId + clientId
 * 2. MCP creates a "pending" connection record
 * 3. All tool calls return "pending_approval" with dashboard link
 * 4. User approves in dashboard, assigns a proxy key (agent profile)
 * 5. Subsequent calls work with that key's permissions
 *
 * TODO: Remove after spike is complete.
 */
import { createMcpHandler, experimental_withMcpAuth } from 'mcp-handler';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { db } from '@/db';
import { agentConnections, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * Check or create an agent connection record.
 * Returns the connection status and details.
 */
async function resolveConnection(userId: string, clientId: string | undefined) {
  if (!clientId) {
    return { authorized: false, reason: 'no_client_id' as const };
  }

  // Look up internal user by Clerk ID
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, userId),
  });

  if (!user) {
    return { authorized: false, reason: 'user_not_found' as const };
  }

  // Find existing connection
  let connection = await db.query.agentConnections.findFirst({
    where: and(
      eq(agentConnections.userId, user.id),
      eq(agentConnections.clientId, clientId),
    ),
  });

  // First time this client connected — create pending record
  if (!connection) {
    const [newConn] = await db.insert(agentConnections).values({
      userId: user.id,
      clientId,
      clientName: clientId, // Will be overridden if we have DCR metadata
      status: 'pending',
    }).returning();
    connection = newConn;

    console.log(`\n=== NEW AGENT CONNECTION ===`);
    console.log(`User: ${user.email} (${user.id})`);
    console.log(`Client ID: ${clientId}`);
    console.log(`Connection ID: ${connection.id}`);
    console.log(`Status: PENDING — user must approve in dashboard`);
    console.log(`===========================\n`);
  }

  // Update last_used_at
  await db.update(agentConnections)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentConnections.id, connection.id));

  if (connection.status === 'pending') {
    return {
      authorized: false,
      reason: 'pending_approval' as const,
      connectionId: connection.id,
      dashboardUrl: `${DASHBOARD_URL}/dashboard?tab=connections&highlight=${connection.id}`,
    };
  }

  if (connection.status === 'blocked') {
    return { authorized: false, reason: 'blocked' as const };
  }

  // Approved — return the bound proxy key ID
  return {
    authorized: true,
    reason: 'approved' as const,
    connectionId: connection.id,
    proxyKeyId: connection.proxyKeyId,
    nickname: connection.nickname,
  };
}

const handler = createMcpHandler(
  (server) => {
    // Tool: spike_whoami — shows auth context AND connection status
    server.tool(
      'spike_whoami',
      'Returns authentication context and connection approval status.',
      {},
      async (_params, { authInfo }) => {
        const userId = authInfo?.extra?.userId as string | undefined;
        const clientId = authInfo?.clientId;

        const connectionResult = userId
          ? await resolveConnection(userId, clientId)
          : { authorized: false, reason: 'no_auth' as const };

        if (!connectionResult.authorized) {
          let message = '';
          switch (connectionResult.reason) {
            case 'pending_approval':
              message = [
                '⚠️ This connection has not been approved yet.',
                '',
                'To activate this agent, ask the user to:',
                `1. Visit their FGAC dashboard: ${(connectionResult as { dashboardUrl: string }).dashboardUrl}`,
                '2. Find this connection under "Agent Connections"',
                '3. Assign it to an agent profile (proxy key) with the desired permissions',
                '',
                'Once approved, retry your request.',
              ].join('\n');
              break;
            case 'blocked':
              message = '🚫 This connection has been blocked by the user.';
              break;
            case 'no_client_id':
              message = '❌ No client_id found in auth token.';
              break;
            case 'user_not_found':
              message = '❌ User not found. Please sign up at the FGAC dashboard first.';
              break;
            default:
              message = '❌ Authentication failed.';
          }
          return { content: [{ type: 'text', text: message }] };
        }

        const approved = connectionResult as { connectionId: string; nickname: string | null; proxyKeyId: string | null };
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'approved',
              connection_id: approved.connectionId,
              nickname: approved.nickname,
              proxy_key_id: approved.proxyKeyId,
              user_id: userId,
              client_id: clientId,
            }, null, 2),
          }],
        };
      }
    );

    // Tool: spike_echo — works regardless of approval (for testing)
    server.tool(
      'spike_echo',
      'Echoes a message. Works even without approval — for basic connectivity testing.',
      { message: z.string().describe('Message to echo') },
      async ({ message }) => {
        return { content: [{ type: 'text', text: `Echo: ${message}` }] };
      }
    );
  },
  {
    serverInfo: {
      name: 'fgac-spike',
      version: '0.0.2',
    },
  },
  {
    basePath: '/api/spike',
    verboseLogs: true,
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
      console.error('Token verification error:', error);
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
