/**
 * Spike Test: Register two distinct DCR clients and run the pending approval flow.
 *
 * This script:
 * 1. Registers two OAuth clients via DCR with different names
 * 2. Generates authorization URLs for each
 * 3. Prints instructions for the browser-based test
 *
 * Usage: npx tsx scripts/spike-two-clients.ts
 */
import crypto from 'crypto';

const CLERK_ISSUER = 'https://pumped-quetzal-63.clerk.accounts.dev';
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';

interface DCRResponse {
  client_id: string;
  client_secret: string;
  client_name: string;
  scope: string;
}

async function registerClient(name: string): Promise<DCRResponse> {
  const res = await fetch(`${CLERK_ISSUER}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }),
  });

  if (!res.ok) {
    throw new Error(`DCR failed for ${name}: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildAuthURL(clientId: string, codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'email profile offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${CLERK_ISSUER}/oauth/authorize?${params.toString()}`;
}

async function main() {
  console.log('=== Registering two distinct DCR clients ===\n');

  // Client 1: Simulates "Claude Code Agent"
  const client1 = await registerClient('Claude-Code-Agent');
  const pkce1 = generatePKCE();
  console.log('Client 1: Claude-Code-Agent');
  console.log(`  client_id: ${client1.client_id}`);
  console.log(`  client_secret: ${client1.client_secret}`);
  console.log(`  PKCE verifier: ${pkce1.verifier}`);

  // Client 2: Simulates "Third-Party-Bot"
  const client2 = await registerClient('Third-Party-Bot');
  const pkce2 = generatePKCE();
  console.log('\nClient 2: Third-Party-Bot');
  console.log(`  client_id: ${client2.client_id}`);
  console.log(`  client_secret: ${client2.client_secret}`);
  console.log(`  PKCE verifier: ${pkce2.verifier}`);

  // Build auth URLs
  const url1 = buildAuthURL(client1.client_id, pkce1.challenge, 'client1-test');
  const url2 = buildAuthURL(client2.client_id, pkce2.challenge, 'client2-test');

  console.log('\n=== Authorization URLs ===\n');
  console.log('--- Client 1 (Claude-Code-Agent) ---');
  console.log(url1);
  console.log('\n--- Client 2 (Third-Party-Bot) ---');
  console.log(url2);

  // Write state file for the callback route to use
  const stateFile = {
    client1: {
      name: 'Claude-Code-Agent',
      client_id: client1.client_id,
      client_secret: client1.client_secret,
      verifier: pkce1.verifier,
    },
    client2: {
      name: 'Third-Party-Bot',
      client_id: client2.client_id,
      client_secret: client2.client_secret,
      verifier: pkce2.verifier,
    },
  };

  // Write to a file the callback can read
  const fs = await import('fs');
  fs.writeFileSync(
    'spike-clients.json',
    JSON.stringify(stateFile, null, 2)
  );
  console.log('\n✅ Client details saved to spike-clients.json');
  console.log('\nNext steps:');
  console.log('1. Start dev server: npm run dev');
  console.log('2. Open Client 1 URL in browser — complete OAuth');
  console.log('3. Open Client 2 URL in browser — complete OAuth');
  console.log('4. Check GET /api/connections — should show 2 pending connections');
  console.log('5. Approve one, verify it works while the other stays blocked');
}

main().catch(console.error);
