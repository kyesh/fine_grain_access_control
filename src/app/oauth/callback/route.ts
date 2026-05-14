/**
 * OAuth Callback — Handles OAuth authorization code exchange.
 *
 * Reads client configuration from qa-test-agents.json (for QA testing).
 * After exchanging the code for a token, saves the token and triggers
 * an MCP call to create the agent connection.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface AgentConfig {
  client_id: string;
  client_secret: string;
  pkce: { verifier: string; challenge: string };
}

function loadAgents(): Record<string, AgentConfig> {
  try {
    const filePath = path.join(process.cwd(), 'qa-test-agents.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const lookup: Record<string, AgentConfig> = {};
    for (const key of Object.keys(data)) {
      const agent = data[key];
      if (agent.client_id) {
        lookup[agent.client_id] = agent;
      }
    }
    return lookup;
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.json({
      status: 'error',
      error,
      error_description: req.nextUrl.searchParams.get('error_description'),
    }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({
      status: 'waiting',
      message: 'No authorization code. Visit the authorization URL first.',
    });
  }

  const agents = loadAgents();

  let tokenData: Record<string, unknown> | null = null;
  let usedClientId: string | null = null;

  // Try each known agent until one works
  for (const [clientId, agent] of Object.entries(agents)) {
    try {
      const tokenResponse = await fetch(
        'https://pumped-quetzal-63.clerk.accounts.dev/oauth/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: 'http://localhost:3000/oauth/callback',
            client_id: clientId,
            client_secret: agent.client_secret,
            code_verifier: agent.pkce.verifier,
          }),
        }
      );

      const data = await tokenResponse.json();
      if (data.access_token) {
        tokenData = data;
        usedClientId = clientId;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!tokenData || !usedClientId) {
    return NextResponse.json({
      status: 'token_exchange_failed',
      message: 'Could not exchange code with any known agent.',
    }, { status: 400 });
  }

  // Decode JWT
  let decodedToken: Record<string, unknown> | null = null;
  const accessToken = tokenData.access_token as string;
  try {
    const parts = accessToken.split('.');
    if (parts.length === 3) {
      decodedToken = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    }
  } catch {
    decodedToken = null;
  }

  // Save token for curl-based MCP testing
  try {
    const tokenFile = `qa-token-${usedClientId}.json`;
    fs.writeFileSync(
      path.join(process.cwd(), tokenFile),
      JSON.stringify({
        access_token: accessToken,
        refresh_token: tokenData.refresh_token,
        client_id: usedClientId,
        state,
      })
    );
    console.log(`[QA] Token saved to ${tokenFile}`);
  } catch { /* ignore */ }

  console.log(`[QA] OAuth callback: client=${usedClientId} state=${state} sub=${decodedToken?.sub}`);

  return NextResponse.json({
    status: 'success',
    client_id: usedClientId,
    state,
    token: {
      has_access_token: true,
      has_refresh_token: !!tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    },
    decoded_claims: decodedToken,
    next_step: 'Token saved. Use it to call /api/mcp — the connection will be created automatically.',
  });
}
