/**
 * Shared utilities for gmail-fgac skill.
 *
 * Supports two auth modes:
 *   1. FGAC OAuth (recommended) — Clerk OAuth token → proxy key via /api/auth/cli-token
 *   2. Legacy Google BYOK — direct Google OAuth credentials (for backward compat)
 *
 * The FGAC config stores the proxy key obtained after OAuth approval.
 * gmail.js uses this to route all requests through gmail.fgac.ai.
 */

const fs = require('fs');
const path = require('path');

// ─── Directory Configuration ────────────────────────────────────────────────

const CONFIG_DIR = path.join(process.env.HOME || '~', '.openclaw', 'gmail-fgac');
const FGAC_CONFIG_DIR = CONFIG_DIR;
const FGAC_CONFIG_PATH = path.join(FGAC_CONFIG_DIR, 'fgac-credentials.json');
const TOKENS_DIR = path.join(CONFIG_DIR, 'tokens');

// Legacy paths (Google BYOK)
const CREDENTIALS_PATH = path.join(
  process.env.HOME || '~', '.openclaw', 'google-workspace-byok', 'credentials.json'
);

// ─── FGAC Config (New OAuth flow) ───────────────────────────────────────────

function loadFgacConfig() {
  if (!fs.existsSync(FGAC_CONFIG_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(FGAC_CONFIG_PATH, 'utf8'));
}

function saveFgacConfig(config) {
  fs.mkdirSync(FGAC_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(FGAC_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function hasFgacConfig() {
  return fs.existsSync(FGAC_CONFIG_PATH);
}

/**
 * Get the proxy key and endpoint from FGAC config.
 * Returns null if not configured or not approved.
 */
function getFgacProxyAuth() {
  const config = loadFgacConfig();
  if (!config || !config.proxy_key) return null;
  return {
    proxyKey: config.proxy_key,
    proxyEndpoint: config.proxy_endpoint || 'https://gmail.fgac.ai',
    keyLabel: config.key_label,
    emails: config.emails || [],
  };
}

// ─── Legacy Google Auth ─────────────────────────────────────────────────────

const SCOPES_READONLY = [
  'https://www.googleapis.com/auth/gmail.readonly',
];

const SCOPES_READWRITE = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
}

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `No credentials found at ${CREDENTIALS_PATH}\n` +
      `Run: node setup.js --credentials /path/to/credentials.json`
    );
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  // Google credentials JSON can have the client info under "installed" or "web"
  const creds = raw.installed || raw.web;
  if (!creds) {
    throw new Error('Invalid credentials.json — expected "installed" or "web" key');
  }
  return creds;
}

function tokenPath(accountLabel) {
  return path.join(TOKENS_DIR, `${accountLabel}.json`);
}

function loadToken(accountLabel) {
  const tp = tokenPath(accountLabel);
  if (!fs.existsSync(tp)) {
    throw new Error(
      `No token found for account "${accountLabel}"\n` +
      `Run: node auth.js --account ${accountLabel}`
    );
  }
  return JSON.parse(fs.readFileSync(tp, 'utf8'));
}

function saveToken(accountLabel, token) {
  ensureDirs();
  fs.writeFileSync(tokenPath(accountLabel), JSON.stringify(token, null, 2));
}

function listAccounts() {
  ensureDirs();
  if (!fs.existsSync(TOKENS_DIR)) return [];
  return fs.readdirSync(TOKENS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

/**
 * Get an authenticated client for the given account.
 *
 * For FGAC OAuth mode (no account label needed):
 *   Uses the proxy key from fgac-credentials.json
 *
 * For legacy Google BYOK mode:
 *   Supports both OAuth2 and Service Account tokens.
 */
function getAuthClient(accountLabel) {
  const token = loadToken(accountLabel);

  if (token.type === 'service_account') {
    const { google } = require('googleapis');
    return new google.auth.GoogleAuth({
      credentials: token,
      scopes: SCOPES_READWRITE,
    });
  }

  const creds = loadCredentials();
  const { google } = require('googleapis');

  const oauth2 = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    creds.redirect_uris ? creds.redirect_uris[0] : 'http://localhost'
  );

  oauth2.setCredentials(token);

  // Listen for token refresh events and persist
  oauth2.on('tokens', (newTokens) => {
    const updated = { ...token, ...newTokens };
    saveToken(accountLabel, updated);
  });

  return oauth2;
}

// ─── Arg Parser ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

module.exports = {
  CONFIG_DIR,
  FGAC_CONFIG_DIR,
  FGAC_CONFIG_PATH,
  CREDENTIALS_PATH,
  TOKENS_DIR,
  SCOPES_READONLY,
  SCOPES_READWRITE,
  ensureDirs,
  // FGAC OAuth
  loadFgacConfig,
  saveFgacConfig,
  hasFgacConfig,
  getFgacProxyAuth,
  // Legacy Google
  loadCredentials,
  tokenPath,
  loadToken,
  saveToken,
  listAccounts,
  getAuthClient,
  parseArgs,
};
