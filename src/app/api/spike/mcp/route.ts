/**
 * MCP Spike — Throwaway endpoint to validate Clerk + MCP integration
 *
 * This is Phase 0 of the skill distribution plan. It creates a minimal MCP
 * server with one tool (`spike_whoami`) that dumps the auth context, so we
 * can validate:
 *
 *   1. DCR works — MCP clients can register dynamically
 *   2. OAuth token issuance — Clerk issues tokens via Auth Code + PKCE
 *   3. Custom claims — We can see what fields are in authInfo.extra
 *   4. Token verification — verifyClerkToken works in our Next.js setup
 *
 * Test with:
 *   claude mcp add --transport http fgac-spike http://localhost:3000/api/spike/mcp
 *   Then ask Claude to call the spike_whoami tool.
 *
 * TODO: Remove this file after spike is complete.
 */
import { createMcpHandler, experimental_withMcpAuth } from 'mcp-handler';
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';

const handler = createMcpHandler(
  (server) => {
    // Tool 1: Dump auth context — the whole point of the spike
    server.tool(
      'spike_whoami',
      'Returns the full authentication context for this MCP session. ' +
        'Use this to understand what identity and claims Clerk provides.',
      {},
      async (_params, { authInfo }) => {
        const result = {
          spike_test: 'clerk-mcp-oauth',
          timestamp: new Date().toISOString(),
          auth_present: !!authInfo,
          auth_info: authInfo
            ? {
                token_present: !!authInfo.token,
                token_prefix: authInfo.token
                  ? authInfo.token.substring(0, 20) + '...'
                  : null,
                client_id: authInfo.clientId ?? null,
                scopes: authInfo.scopes ?? [],
                extra: authInfo.extra ?? {},
                // Specifically check for our target fields
                has_user_id: !!authInfo.extra?.userId,
                user_id: authInfo.extra?.userId ?? null,
                has_custom_claims: Object.keys(authInfo.extra ?? {}).length > 1,
                all_extra_keys: Object.keys(authInfo.extra ?? {}),
              }
            : null,
        };

        console.log(
          '\n=== SPIKE: spike_whoami called ===',
          '\nAuth Info:',
          JSON.stringify(result, null, 2),
          '\n=================================\n'
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    );

    // Tool 2: Simple echo — verifies basic MCP tool invocation works
    server.tool(
      'spike_echo',
      'Echoes back a message. Used to test basic MCP tool invocation without auth dependency.',
      { message: z.string().describe('Message to echo') },
      async ({ message }) => {
        return {
          content: [
            {
              type: 'text',
              text: `Echo: ${message}`,
            },
          ],
        };
      }
    );
  },
  {
    serverInfo: {
      name: 'fgac-spike',
      version: '0.0.1',
    },
  },
  {
    basePath: '/api/spike/mcp',
    verboseLogs: true,
  }
);

// Wrap with Clerk MCP auth verification
export const POST = experimental_withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    try {
      const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
      const authInfo = verifyClerkToken(clerkAuth, bearerToken);

      console.log(
        '\n=== SPIKE: Token verification ===',
        '\nClerk auth object type:', typeof clerkAuth,
        '\nClerk auth userId:', (clerkAuth as Record<string, unknown>)?.userId ?? 'none',
        '\nverifyClerkToken result:', authInfo ? 'SUCCESS' : 'FAILED (undefined)',
        '\nauthInfo.extra keys:', authInfo?.extra ? Object.keys(authInfo.extra) : 'none',
        '\n=================================\n'
      );

      return authInfo;
    } catch (error) {
      console.error(
        '\n=== SPIKE: Token verification ERROR ===',
        '\nError:', error,
        '\n=======================================\n'
      );
      return undefined;
    }
  },
  {
    required: true,
    resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
  }
);

// MCP also needs GET for SSE transport and DELETE for session cleanup
export const GET = handler;
export const DELETE = handler;
