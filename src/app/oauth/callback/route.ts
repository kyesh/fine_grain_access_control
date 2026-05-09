/**
 * OAuth Callback Handler — Spike Only
 * 
 * Captures the authorization code from Clerk's OAuth redirect
 * and exchanges it for tokens. Displays the full token response
 * for spike inspection.
 * 
 * TODO: Remove after spike is complete.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.json({
      spike: 'oauth-callback',
      status: 'error',
      error,
      error_description: req.nextUrl.searchParams.get('error_description'),
    }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({
      spike: 'oauth-callback',
      status: 'waiting',
      message: 'No authorization code received. Visit the authorization URL first.',
    });
  }

  // Exchange the authorization code for tokens
  // The code_verifier must match what was used to generate the code_challenge
  const CODE_VERIFIER = req.nextUrl.searchParams.get('verifier') || 'DrTX8OXNnXMOwk7KqBbJPqM3LTydmGxFzcG3NZSEjYU';

  try {
    const tokenResponse = await fetch('https://pumped-quetzal-63.clerk.accounts.dev/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/oauth/callback',
        client_id: 'dGd3hVEbAbMZNBbK',
        client_secret: 'xVUG5Ep9Od84G5ECRKwtYeHoXzz551bZ',
        code_verifier: CODE_VERIFIER,
      }),
    });

    const tokenData = await tokenResponse.json();

    // If we got an access token, decode it to see the claims
    let decodedToken = null;
    if (tokenData.access_token) {
      try {
        const parts = tokenData.access_token.split('.');
        if (parts.length === 3) {
          decodedToken = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        }
      } catch {
        decodedToken = 'Could not decode (not a JWT)';
      }
    }

    console.log('\n=== SPIKE: OAuth Token Exchange ===');
    console.log('Token response status:', tokenResponse.status);
    console.log('Token data:', JSON.stringify(tokenData, null, 2));
    console.log('Decoded access_token claims:', JSON.stringify(decodedToken, null, 2));
    console.log('===================================\n');

    // Now test calling our MCP endpoint with this token
    let mcpTestResult = null;
    if (tokenData.access_token) {
      try {
        const mcpResponse = await fetch('http://localhost:3000/api/spike/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/list',
            id: 1,
          }),
        });
        mcpTestResult = {
          status: mcpResponse.status,
          body: await mcpResponse.json(),
        };
        console.log('\n=== SPIKE: MCP with OAuth token ===');
        console.log('MCP response:', JSON.stringify(mcpTestResult, null, 2));
        console.log('====================================\n');
      } catch (e) {
        mcpTestResult = { error: String(e) };
      }
    }

    return NextResponse.json({
      spike: 'oauth-callback',
      status: 'success',
      state,
      token_exchange: {
        http_status: tokenResponse.status,
        has_access_token: !!tokenData.access_token,
        has_refresh_token: !!tokenData.refresh_token,
        token_type: tokenData.token_type,
        expires_in: tokenData.expires_in,
        scope: tokenData.scope,
        error: tokenData.error,
        error_description: tokenData.error_description,
      },
      decoded_access_token_claims: decodedToken,
      mcp_test: mcpTestResult,
    });
  } catch (e) {
    return NextResponse.json({
      spike: 'oauth-callback',
      status: 'token_exchange_error',
      error: String(e),
    }, { status: 500 });
  }
}
