/**
 * FGAC.AI Auth Script — Clerk OAuth2 with DCR + PKCE
 *
 * Authenticates the agent with FGAC.AI:
 *   1. Discovers OAuth endpoints from the FGAC server
 *   2. Registers a Dynamic Client (DCR) — one-time per agent
 *   3. Opens browser for Clerk consent with PKCE
 *   4. Catches callback on localhost
 *   5. Exchanges code for tokens
 *   6. Calls /api/auth/cli-token to get connection status + proxy key
 *
 * Usage:
 *   node auth.js --action login           # Full OAuth flow
 *   node auth.js --action status          # Check connection status
 *   node auth.js --action refresh         # Refresh expired access token
 *
 * The proxy key is saved locally and used by gmail.js to route
 * requests through gmail.fgac.ai (mirrors the standard Gmail API).
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { parseArgs, loadFgacConfig, saveFgacConfig, FGAC_CONFIG_DIR } = require('./shared');
const fs = require('fs');
const path = require('path');

const args = parseArgs(process.argv);
const action = args.action || 'login';

// FGAC server URL
const FGAC_URL = process.env.FGAC_ROOT_URL || 'https://fgac.ai';
const CALLBACK_PORT = 8976;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const CLIENT_NAME = args['client-name'] || `fgac-cli-${require('os').hostname()}`;

// ─── HTTP Helpers (no external deps) ────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const postData = typeof body === 'string' ? body : JSON.stringify(body);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': headers['Content-Type'] || 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    };

    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ─── PKCE Helpers ───────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ─── Config Persistence ─────────────────────────────────────────────────────

const DCR_CONFIG_PATH = path.join(FGAC_CONFIG_DIR, 'dcr-client.json');

function loadDcrClient() {
  if (fs.existsSync(DCR_CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(DCR_CONFIG_PATH, 'utf8'));
  }
  return null;
}

function saveDcrClient(client) {
  fs.mkdirSync(path.dirname(DCR_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(DCR_CONFIG_PATH, JSON.stringify(client, null, 2));
}

// ─── OAuth Flow ─────────────────────────────────────────────────────────────

async function discoverEndpoints() {
  console.log(`\n🔍 Discovering OAuth endpoints from ${FGAC_URL}...`);
  const meta = await httpGet(`${FGAC_URL}/.well-known/oauth-authorization-server`);
  console.log('   ✓ Authorization server metadata found');
  return meta;
}

async function registerClient(meta) {
  // Check for existing DCR client
  let client = loadDcrClient();
  if (client && client.server === FGAC_URL) {
    console.log(`   ✓ Using existing DCR client: ${client.client_id}`);
    return client;
  }

  console.log(`\n📝 Registering new DCR client "${CLIENT_NAME}"...`);
  const result = await httpPost(meta.registration_endpoint, {
    client_name: CLIENT_NAME,
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // Public client (PKCE)
  });

  if (result.status >= 400) {
    throw new Error(`DCR registration failed: ${JSON.stringify(result.data)}`);
  }

  client = {
    server: FGAC_URL,
    client_id: result.data.client_id,
    client_name: CLIENT_NAME,
    registered_at: new Date().toISOString(),
  };
  saveDcrClient(client);
  console.log(`   ✓ Registered: ${client.client_id}`);
  return client;
}

async function doOAuthFlow(meta, client) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  // Build authorization URL
  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set('client_id', client.client_id);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'email profile offline_access');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  console.log(`\n🌐 Opening browser for authentication...`);
  console.log(`   If the browser doesn't open, visit this URL:\n`);
  console.log(`   ${authUrl.toString()}\n`);

  // Open browser
  const { exec } = require('child_process');
  const openCmd = process.platform === 'darwin' ? 'open' :
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${authUrl.toString()}"`);

  // Start local server to catch callback
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);

      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>❌ Authorization Failed</h1><p>You can close this window.</p>');
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>❌ State Mismatch</h1><p>Possible CSRF attack. Try again.</p>');
          server.close();
          reject(new Error('OAuth state mismatch'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>✅ Authenticated!</h1><p>You can close this window and return to the terminal.</p>');
        server.close();
        resolve({ code, codeVerifier, tokenEndpoint: meta.token_endpoint, clientId: client.client_id });
      }
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`   Waiting for OAuth callback on port ${CALLBACK_PORT}...`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timeout (5 minutes). Try again.'));
    }, 300000);
  });
}

async function exchangeToken({ code, codeVerifier, tokenEndpoint, clientId }) {
  console.log('\n🔑 Exchanging authorization code for tokens...');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: codeVerifier,
  }).toString();

  const result = await httpPost(tokenEndpoint, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (result.status >= 400) {
    throw new Error(`Token exchange failed: ${JSON.stringify(result.data)}`);
  }

  console.log('   ✓ Tokens received');
  return result.data;
}

async function getConnectionStatus(accessToken) {
  console.log('\n🔗 Checking agent connection status...');

  const result = await httpPost(`${FGAC_URL}/api/auth/cli-token`, {
    client_name: CLIENT_NAME,
  }, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  });

  return result.data;
}

async function refreshAccessToken(config) {
  const meta = await discoverEndpoints();

  console.log('\n🔄 Refreshing access token...');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refresh_token,
    client_id: config.client_id,
  }).toString();

  const result = await httpPost(meta.token_endpoint, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  if (result.status >= 400) {
    throw new Error(`Token refresh failed: ${JSON.stringify(result.data)}. Re-run: node auth.js --action login`);
  }

  console.log('   ✓ Access token refreshed');
  return result.data;
}

// ─── Main Actions ───────────────────────────────────────────────────────────

async function login() {
  const meta = await discoverEndpoints();
  const client = await registerClient(meta);
  const oauthResult = await doOAuthFlow(meta, client);
  const tokens = await exchangeToken(oauthResult);

  // Save tokens
  const config = {
    server: FGAC_URL,
    client_id: client.client_id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 86400) * 1000,
  };
  saveFgacConfig(config);

  // Check connection status
  const status = await getConnectionStatus(tokens.access_token);

  if (status.status === 'approved') {
    // Save proxy key for gmail.js to use
    const fullConfig = {
      ...config,
      proxy_key: status.proxy_key,
      key_label: status.key_label,
      emails: status.emails,
      proxy_endpoint: status.proxy_endpoint,
    };
    saveFgacConfig(fullConfig);

    console.log('\n✅ Authentication complete!');
    console.log(`   Proxy Key: ${status.key_label}`);
    console.log(`   Emails: ${status.emails.join(', ')}`);
    console.log('\n   You can now use: node gmail.js --action list');
  } else if (status.status === 'pending') {
    console.log('\n⏳ Connection is pending approval.');
    console.log(`   Ask the user to approve at: ${status.dashboard_url}`);
    console.log('\n   After approval, run: node auth.js --action status');
  } else if (status.status === 'blocked') {
    console.log('\n🚫 This connection has been blocked.');
  }
}

async function checkStatus() {
  const config = loadFgacConfig();
  if (!config || !config.access_token) {
    console.error('No FGAC credentials found. Run: node auth.js --action login');
    process.exit(1);
  }

  // Check if token needs refresh
  if (config.expires_at && Date.now() > config.expires_at) {
    const newTokens = await refreshAccessToken(config);
    config.access_token = newTokens.access_token;
    if (newTokens.refresh_token) config.refresh_token = newTokens.refresh_token;
    config.expires_at = Date.now() + (newTokens.expires_in || 86400) * 1000;
    saveFgacConfig(config);
  }

  const status = await getConnectionStatus(config.access_token);

  if (status.status === 'approved') {
    // Update saved config with proxy key
    config.proxy_key = status.proxy_key;
    config.key_label = status.key_label;
    config.emails = status.emails;
    config.proxy_endpoint = status.proxy_endpoint;
    saveFgacConfig(config);

    console.log('\n✅ Connection approved!');
    console.log(`   Proxy Key: ${status.key_label}`);
    console.log(`   Emails: ${status.emails.join(', ')}`);
    console.log('\n   You can now use: node gmail.js --action list');
  } else if (status.status === 'pending') {
    console.log('\n⏳ Still pending approval.');
    console.log(`   Dashboard: ${status.dashboard_url}`);
  } else if (status.status === 'blocked') {
    console.log('\n🚫 This connection has been blocked.');
  } else {
    console.log(`\n❓ Unexpected status: ${JSON.stringify(status)}`);
  }
}

async function refresh() {
  const config = loadFgacConfig();
  if (!config || !config.refresh_token) {
    console.error('No refresh token found. Run: node auth.js --action login');
    process.exit(1);
  }

  const newTokens = await refreshAccessToken(config);
  config.access_token = newTokens.access_token;
  if (newTokens.refresh_token) config.refresh_token = newTokens.refresh_token;
  config.expires_at = Date.now() + (newTokens.expires_in || 86400) * 1000;
  saveFgacConfig(config);

  console.log('✅ Access token refreshed successfully.');
}

// ─── Entry Point ────────────────────────────────────────────────────────────

async function main() {
  switch (action) {
    case 'login':
      await login();
      break;
    case 'status':
      await checkStatus();
      break;
    case 'refresh':
      await refresh();
      break;
    default:
      console.error(`Unknown action: ${action}`);
      console.error('Available: login, status, refresh');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n❌ Auth error: ${err.message}`);
  process.exit(1);
});
