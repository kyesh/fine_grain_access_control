#!/usr/bin/env node
/**
 * qa-claude-code-mcp.js — Automated QA for Claude Code ↔ FGAC MCP integration
 *
 * Uses tmux to spawn Claude Code interactively, keeping the OAuth callback
 * listener alive for the full auth round-trip. Playwright handles auto-consent.
 *
 * Strategy:
 *   1. Start Claude Code in a tmux session
 *   2. Send /mcp → select server → Authenticate
 *   3. Auto-consent via playwright (click Allow)
 *   4. Approve connection in dashboard via playwright
 *   5. Send tool call prompts and validate output
 *
 * Usage:
 *   node test/testclaw/qa-claude-code-mcp.js [--timeout 600] [--auto-consent]
 *
 * Prerequisites:
 *   - tmux installed
 *   - Claude Code installed (`claude` in PATH)
 *   - Dev server running on localhost:3000
 *   - Playwright browser session available (-s=antigravity_ui)
 *
 * Flags:
 *   --timeout N       Max seconds to wait for OAuth consent (default: 600 = 10 min)
 *   --auto-consent    Auto-complete consent via playwright CLI
 *   --skip-auth       Skip auth, assume already authenticated (test tools only)
 *   --cleanup         Kill tmux session on exit (default: leave running)
 */

const { execSync, spawnSync } = require('child_process');
const { writeFileSync, existsSync, mkdirSync } = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  return args[idx + 1] || def;
};

const TIMEOUT_SEC = parseInt(getFlag('timeout', '600'), 10);
const AUTO_CONSENT = args.includes('--auto-consent');
const SKIP_AUTH = args.includes('--skip-auth');
const CLEANUP = args.includes('--cleanup');
const RESULTS_DIR = path.join(__dirname, 'results');
const TMUX_SESSION = 'fgac-claude-qa';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', NC = '\x1b[0m';
let results = [];

function log(msg) { console.log(`${CYAN}[qa]${NC} ${msg}`); }
function pass(test) { results.push({ test, pass: true }); console.log(`${GREEN}✅ PASS${NC}: ${test}`); }
function fail(test, detail) { results.push({ test, pass: false, detail }); console.log(`${RED}❌ FAIL${NC}: ${test} — ${detail}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tmuxSend(text) {
  execSync(`tmux send-keys -t ${TMUX_SESSION} ${JSON.stringify(text)} Enter`, { stdio: 'pipe' });
}

function tmuxCapture(scrollback = 50) {
  try {
    return execSync(`tmux capture-pane -t ${TMUX_SESSION} -p -S -${scrollback}`, {
      stdio: 'pipe', timeout: 5000,
    }).toString();
  } catch { return ''; }
}

function tmuxClearAndSend(text) {
  execSync(`tmux send-keys -t ${TMUX_SESSION} C-u`, { stdio: 'pipe' });
  execSync(`tmux send-keys -t ${TMUX_SESSION} ${JSON.stringify(text)} Enter`, { stdio: 'pipe' });
}

function playwright(action, ...args) {
  try {
    return execSync(
      `npx @playwright/cli -s=antigravity_ui ${action} ${args.map(a => JSON.stringify(a)).join(' ')}`,
      { cwd: process.cwd(), timeout: 30000, stdio: 'pipe' }
    ).toString();
  } catch (e) { return e.stdout?.toString() || e.message; }
}

/**
 * Wait for a pattern to appear in the tmux pane output.
 * Returns the matching capture, or null on timeout.
 */
async function waitForPattern(pattern, timeoutSec, pollMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutSec * 1000) {
    const output = tmuxCapture(100);
    if (pattern instanceof RegExp ? pattern.test(output) : output.includes(pattern)) {
      return output;
    }
    await sleep(pollMs);
  }
  return null;
}

// ─── Phase 1: Start Claude Code in tmux ─────────────────────────────────────

async function startClaudeCode() {
  log('Phase 1: Starting Claude Code in tmux session...');

  // Kill existing session
  try { execSync(`tmux kill-session -t ${TMUX_SESSION} 2>/dev/null`, { stdio: 'pipe' }); } catch {}

  // Create new tmux session with Claude Code
  execSync(
    `tmux new-session -d -s ${TMUX_SESSION} -x 200 -y 50 "claude --dangerously-skip-permissions"`,
    { cwd: process.cwd(), stdio: 'pipe' }
  );

  // Wait for Claude to start
  const ready = await waitForPattern('❯', 30);
  if (!ready) {
    fail('Claude Code startup', 'Could not detect prompt within 30s');
    return false;
  }

  pass('Claude Code started in tmux');
  return true;
}

// ─── Phase 2: MCP Authentication ────────────────────────────────────────────

async function authenticateMCP() {
  log('Phase 2: MCP OAuth Authentication');

  // Send /mcp command
  tmuxSend('/mcp');
  await sleep(3000);

  // Check for MCP menu
  let output = tmuxCapture();
  if (!output.includes('fgac-gmail')) {
    fail('MCP server list', 'fgac-gmail not found in /mcp menu');
    return false;
  }
  pass('fgac-gmail found in /mcp menu');

  // Select fgac-gmail (should be first/highlighted) and press Enter
  tmuxSend('');  // Enter to select
  await sleep(3000);

  output = tmuxCapture();
  if (output.includes('Authenticate')) {
    // Select "Authenticate" option
    tmuxSend('');  // Enter on Authenticate
    await sleep(5000);
  }

  // Wait for auth URL to appear
  log(`Waiting up to ${TIMEOUT_SEC}s for auth URL...`);
  const authOutput = await waitForPattern('clerk.accounts.dev', 30);

  if (!authOutput) {
    fail('Auth URL generation', 'No auth URL appeared');
    return false;
  }

  // Extract auth URL
  const urlMatch = authOutput.match(/(https:\/\/[^\s]+clerk\.accounts\.dev[^\s]+)/);
  if (!urlMatch) {
    fail('Auth URL extraction', 'Could not parse URL from output');
    return false;
  }

  const authUrl = urlMatch[1];
  pass('Auth URL generated');

  console.log(`\n${YELLOW}══════════════════════════════════════════════════════════${NC}`);
  console.log(`${YELLOW}  OAuth consent URL ready${NC}`);
  console.log(`${CYAN}  ${authUrl.substring(0, 100)}...${NC}`);
  console.log(`${YELLOW}  Waiting up to ${TIMEOUT_SEC}s for consent completion...${NC}`);
  console.log(`${YELLOW}══════════════════════════════════════════════════════════${NC}\n`);

  // Auto-consent
  if (AUTO_CONSENT) {
    await autoConsent(authUrl);
  }

  // Wait for auth success
  log('Waiting for authentication to complete...');
  const authSuccess = await waitForPattern('Authentication successful', TIMEOUT_SEC);

  if (authSuccess) {
    pass('MCP OAuth completed — Authentication successful');
    // Press Esc to exit /mcp menu
    execSync(`tmux send-keys -t ${TMUX_SESSION} Escape`, { stdio: 'pipe' });
    await sleep(2000);
    return true;
  } else {
    fail('MCP OAuth completion', `Timed out after ${TIMEOUT_SEC}s`);
    execSync(`tmux send-keys -t ${TMUX_SESSION} Escape`, { stdio: 'pipe' });
    await sleep(1000);
    return false;
  }
}

// ─── Phase 3: Dashboard Approval ────────────────────────────────────────────

async function approveDashboard() {
  log('Phase 3: Dashboard connection approval');

  // Navigate to dashboard connections
  const navResult = playwright('goto', 'http://localhost:3000/dashboard?tab=connections');
  await sleep(3000);

  // Check for pending approvals
  const snapshot = playwright('snapshot');

  if (snapshot.includes('Pending Approval')) {
    // Find and click Approve
    const approveMatch = snapshot.match(/button "✓ Approve" \[ref=(e\d+)\]/);
    if (approveMatch) {
      playwright('click', approveMatch[1]);
      await sleep(2000);
      pass('Dashboard connection approved');
      return true;
    }
  }

  if (snapshot.includes('Approved')) {
    log('Connection already approved');
    return true;
  }

  fail('Dashboard approval', 'Could not find pending connection');
  return false;
}

// ─── Phase 4: Tool Verification ─────────────────────────────────────────────

async function verifyTools() {
  log('Phase 4: Tool verification via tmux');

  // Test 1: list_accounts
  tmuxClearAndSend('Call list_accounts from fgac-gmail MCP server and show the raw result');
  await sleep(15000);

  let output = tmuxCapture(100);

  if (output.includes('spike-test@example.com') || output.includes('Default account')) {
    pass('list_accounts returns account data');
  } else if (output.includes("isn't approved") || output.includes('pending')) {
    fail('list_accounts', 'Connection not approved yet');
    return;
  } else if (output.includes("doesn't have access")) {
    pass('list_accounts callable (no email access configured — expected for auto-created key)');
  } else {
    // Wait more and retry
    await sleep(15000);
    output = tmuxCapture(100);
    if (output.includes('spike-test') || output.includes('account')) {
      pass('list_accounts returns data');
    } else {
      fail('list_accounts', `Unexpected output (last 200 chars): ${output.slice(-200)}`);
    }
  }

  // Test 2: get_my_permissions
  tmuxClearAndSend('Call get_my_permissions from fgac-gmail MCP server');
  await sleep(15000);
  output = tmuxCapture(100);

  if (output.includes('proxy') || output.includes('permission') || output.includes('connection')) {
    pass('get_my_permissions callable');
  } else {
    fail('get_my_permissions', `Unexpected: ${output.slice(-200)}`);
  }

  // Test 3: gmail_list (expected to fail with no email access)
  tmuxClearAndSend('Call gmail_list from fgac-gmail MCP server');
  await sleep(15000);
  output = tmuxCapture(100);

  if (output.includes('messages') || output.includes('subject') || output.includes('snippet')) {
    pass('gmail_list returns email data');
  } else if (output.includes("doesn't have access") || output.includes('blocked') || output.includes('no email')) {
    pass('gmail_list correctly enforces email scope (no access configured)');
  } else {
    fail('gmail_list', `Unexpected: ${output.slice(-200)}`);
  }
}

// ─── Auto-consent ────────────────────────────────────────────────────────────

async function autoConsent(authUrl) {
  log('🤖 Auto-consent via playwright...');

  try {
    playwright('goto', authUrl);
    await sleep(5000);

    const snapshot = playwright('snapshot');
    const allowMatch = snapshot.match(/button "Allow" \[ref=(e\d+)\]/);

    if (allowMatch) {
      playwright('click', allowMatch[1]);
      log('🤖 Allow button clicked!');
      pass('Auto-consent completed');
    } else {
      log('⚠️ Allow button not found — manual consent may be needed');
    }
  } catch (err) {
    log(`⚠️ Auto-consent failed: ${err.message?.substring(0, 200)}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${CYAN}║  FGAC.ai — Claude Code MCP QA via tmux                       ║${NC}`);
  console.log(`${CYAN}║  tmux + playwright for full interactive OAuth flow            ║${NC}`);
  console.log(`${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}\n`);

  // Verify prerequisites
  try { execSync('which tmux', { stdio: 'pipe' }); } catch {
    console.error(`${RED}Error: tmux is required but not installed${NC}`);
    process.exit(1);
  }

  try { execSync('which claude', { stdio: 'pipe' }); } catch {
    console.error(`${RED}Error: claude is required but not installed${NC}`);
    process.exit(1);
  }

  // Phase 1: Start Claude Code
  if (!await startClaudeCode()) {
    process.exit(1);
  }

  // Phase 2: Auth (or skip)
  if (!SKIP_AUTH) {
    const authOk = await authenticateMCP();
    if (authOk) {
      // Phase 3: Dashboard approval
      await approveDashboard();
    }
  } else {
    log('Skipping auth (--skip-auth)');
  }

  // Phase 4: Tool verification
  await verifyTools();

  // Cleanup
  if (CLEANUP) {
    log('Cleaning up tmux session...');
    try {
      execSync(`tmux send-keys -t ${TMUX_SESSION} "/exit" Enter`, { stdio: 'pipe' });
      await sleep(3000);
      execSync(`tmux kill-session -t ${TMUX_SESSION}`, { stdio: 'pipe' });
    } catch {}
  } else {
    log(`tmux session "${TMUX_SESSION}" left running. Attach with: tmux attach -t ${TMUX_SESSION}`);
  }

  // ─── Summary ───────────────────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  Claude Code MCP QA: ${GREEN}${passed} passed${NC}, ${RED}${failed} failed${NC} / ${results.length} total`);
  console.log(`${'═'.repeat(55)}\n`);

  // Save results
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    path.join(RESULTS_DIR, 'claude-code-mcp.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      results,
      config: { timeout: TIMEOUT_SEC, autoConsent: AUTO_CONSENT, skipAuth: SKIP_AUTH },
    }, null, 2)
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal: ${err.message}${NC}`);
  process.exit(1);
});
