/**
 * OAuth Callback — Spike v2
 *
 * Handles the OAuth callback for ANY client registered in spike-clients.json.
 * After exchanging the code for a token, it makes a test call to the MCP endpoint
 * to trigger connection creation, then redirects to the dashboard.
 *
 * TODO: Remove after spike is complete.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface ClientConfig {
  name: string;
  client_id: string;
  client_secret: string;
  verifier: string;
}

function loadClients(): Record<string, ClientConfig> {
  try {
    const filePath = path.join(process.cwd(), 'spike-clients.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Build a lookup by client_id
    const lookup: Record<string, ClientConfig> = {};
    for (const key of Object.keys(data)) {
      const client = data[key];
      lookup[client.client_id] = client;
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
      spike: 'oauth-callback-v2',
      status: 'error',
      error,
      error_description: req.nextUrl.searchParams.get('error_description'),
    }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({
      spike: 'oauth-callback-v2',
      status: 'waiting',
      message: 'No authorization code. Visit the authorization URL first.',
    });
  }

  // We need to figure out which client this callback is for.
  // Since we can't pass client_id in the state without breaking the flow,
  // we'll try each known client until one works.
  const clients = loadClients();

  let tokenData: Record<string, unknown> | null = null;
  let usedClient: ClientConfig | null = null;

  for (const clientConfig of Object.values(clients)) {
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
            client_id: clientConfig.client_id,
            client_secret: clientConfig.client_secret,
            code_verifier: clientConfig.verifier,
          }),
        }
      );

      const data = await tokenResponse.json();
      if (data.access_token) {
        tokenData = data;
        usedClient = clientConfig;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!tokenData || !usedClient) {
    return NextResponse.json({
      spike: 'oauth-callback-v2',
      status: 'token_exchange_failed',
      message: 'Could not exchange code with any known client.',
    }, { status: 400 });
  }

  // Decode JWT to see claims
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

  // Save token to disk for direct MCP testing via curl
  try {
    const tokenFile = `spike-token-${usedClient.name}.json`;
    fs.writeFileSync(
      path.join(process.cwd(), tokenFile),
      JSON.stringify({ access_token: accessToken, client_id: usedClient.client_id, name: usedClient.name })
    );
    console.log(`Token saved to ${tokenFile}`);
  } catch { /* ignore write errors */ }

  // Make a test call to the MCP endpoint to trigger connection creation
  let mcpResult: Record<string, unknown> | null = null;
  try {
    const mcpRes = await fetch('http://localhost:3000/api/spike/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'spike_whoami', arguments: {} },
        id: 1,
      }),
    });
    mcpResult = await mcpRes.json();
  } catch (e) {
    mcpResult = { error: String(e) };
  }

  console.log(`\n=== SPIKE: OAuth callback for ${usedClient.name} ===`);
  console.log(`Client ID: ${usedClient.client_id}`);
  console.log(`User (sub): ${decodedToken?.sub}`);
  console.log(`Token exchange: SUCCESS`);
  console.log(`MCP test result:`, JSON.stringify(mcpResult, null, 2));
  console.log(`================================================\n`);

  return NextResponse.json({
    spike: 'oauth-callback-v2',
    status: 'success',
    client: {
      name: usedClient.name,
      client_id: usedClient.client_id,
    },
    state,
    token: {
      has_access_token: true,
      has_refresh_token: !!tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    },
    decoded_claims: decodedToken,
    mcp_test: mcpResult,
    next_step: 'Visit /api/connections to see pending connections, then approve one.',
  });
}
