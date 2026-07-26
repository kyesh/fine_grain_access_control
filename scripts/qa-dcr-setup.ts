/**
 * QA helper: register N distinct DCR clients against the local dev Clerk
 * instance, generate PKCE challenges + authorization URLs, and write
 * qa-test-agents.json so /oauth/callback can exchange codes automatically.
 *
 * Gitignored QA artifact — not app source. Usage: npx tsx scripts/qa-dcr-setup.ts
 */
import crypto from 'crypto';
import fs from 'fs';

const CLERK_ISSUER = 'https://pumped-quetzal-63.clerk.accounts.dev';
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';

const NAMES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['QA-Client-1'];

interface DCRResponse {
  client_id: string;
  client_secret: string;
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
  if (!res.ok) throw new Error(`DCR failed for ${name}: ${res.status} ${await res.text()}`);
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
  const out: Record<string, any> = {};
  for (const name of NAMES) {
    const client = await registerClient(name);
    const pkce = generatePKCE();
    const state = `${name}-state`;
    const url = buildAuthURL(client.client_id, pkce.challenge, state);
    out[name] = {
      client_id: client.client_id,
      client_secret: client.client_secret,
      pkce,
    };
    console.log(`--- ${name} ---`);
    console.log(`client_id: ${client.client_id}`);
    console.log(`auth_url: ${url}`);
    console.log();
  }
  fs.writeFileSync('qa-test-agents.json', JSON.stringify(out, null, 2));
  console.log('Saved qa-test-agents.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
