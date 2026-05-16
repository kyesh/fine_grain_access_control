#!/usr/bin/env node
/**
 * qa-claude-code-mcp.js — Automated QA for Claude Code ↔ FGAC MCP integration
 *
 * Strategy:
 *   Phase 1 — Auth: Use `claude -p` with stream-json output to get the auth URL,
 *             then keep polling with `--resume` to detect when auth completes.
 *   Phase 2 — Tool Test: Use `claude -p --resume` to call actual FGAC tools.
 *
 * Usage:
 *   node test/testclaw/qa-claude-code-mcp.js [--timeout 600] [--auto-consent]
 *
 * Flags:
 *   --timeout N       Max seconds to wait for OAuth consent (default: 600 = 10 min)
 *   --auto-consent    Auto-complete consent via playwright CLI (requires session)
 *   --skip-auth       Skip auth, assume already authenticated (test tools only)
 */

const { spawn, execSync } = require('child_process');
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
const RESULTS_DIR = path.join(__dirname, 'results');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', NC = '\x1b[0m';
let results = [];

function log(msg) { console.log(`${CYAN}[qa]${NC} ${msg}`); }
function pass(test) { results.push({ test, pass: true }); console.log(`${GREEN}✅ PASS${NC}: ${test}`); }
function fail(test, detail) { results.push({ test, pass: false, detail }); console.log(`${RED}❌ FAIL${NC}: ${test} — ${detail}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Run `claude -p` and return { result, sessionId, raw }.
 * Clean, reliable — no PTY needed.
 */
function claudeP(prompt, opts = {}) {
  const {
    allowedTools = [],
    maxTurns = 3,
    resumeSession = null,
    timeoutMs = 60000,
  } = opts;

  return new Promise((resolve) => {
    const cliArgs = ['-p', prompt, '--output-format', 'json', '--max-turns', String(maxTurns)];

    if (allowedTools.length > 0) {
      cliArgs.push('--allowedTools', allowedTools.join(','));
    }
    if (resumeSession) {
      cliArgs.push('--resume', resumeSession);
    }

    const child = spawn('claude', cliArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ result: 'TIMEOUT', sessionId: null, raw: stdout, stderr });
    }, timeoutMs);

    child.on('close', () => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(stdout);
        resolve({
          result: data.result || '',
          sessionId: data.session_id || null,
          raw: stdout,
          stderr,
          isError: data.is_error || false,
        });
      } catch {
        resolve({ result: stdout, sessionId: null, raw: stdout, stderr });
      }
    });
  });
}

// ─── Phase 1: MCP OAuth Authentication ──────────────────────────────────────

async function authenticateMCP() {
  log(`Phase 1: MCP OAuth Authentication (timeout: ${TIMEOUT_SEC}s)`);

  // Step 1: Trigger the auth flow
  log('Step 1: Triggering mcp__fgac-gmail__authenticate...');
  const authResponse = await claudeP(
    'Call the mcp__fgac-gmail__authenticate tool to start OAuth. Return ONLY the authorization URL on a single line, nothing else.',
    {
      allowedTools: ['mcp__fgac-gmail__authenticate'],
      maxTurns: 3,
      timeoutMs: 30000,
    }
  );

  const sessionId = authResponse.sessionId;
  log(`Session: ${sessionId || 'none'}`);

  // Extract auth URL
  const urlMatch = authResponse.result.match(/(https:\/\/[^\s)>\]]+authorize[^\s)>\]]+)/);
  if (!urlMatch) {
    fail('MCP auth initiation', `No auth URL found in response: ${authResponse.result.substring(0, 200)}`);
    return null;
  }

  const authUrl = urlMatch[1];
  pass('MCP auth URL generated');

  console.log(`\n${YELLOW}══════════════════════════════════════════════════════════${NC}`);
  console.log(`${YELLOW}  Complete OAuth consent in your browser:${NC}`);
  console.log(`${CYAN}  ${authUrl.substring(0, 120)}...${NC}`);
  console.log(`${YELLOW}  Waiting up to ${TIMEOUT_SEC}s for consent completion...${NC}`);
  console.log(`${YELLOW}══════════════════════════════════════════════════════════${NC}\n`);

  // Step 2: Auto-consent if enabled
  if (AUTO_CONSENT) {
    await autoConsent(authUrl);
  }

  // Step 3: Poll for auth completion
  log('Step 3: Polling for auth completion...');
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  while (Date.now() - startTime < TIMEOUT_SEC * 1000) {
    await sleep(pollInterval);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log(`  Polling... (${elapsed}s / ${TIMEOUT_SEC}s)`);

    // Check if tools are now available (auth completed)
    const checkResponse = await claudeP(
      'List all available tools from the fgac-gmail MCP server. Just list the tool names.',
      {
        allowedTools: ['mcp__fgac-gmail__list_accounts', 'mcp__fgac-gmail__get_my_permissions'],
        maxTurns: 2,
        timeoutMs: 20000,
      }
    );

    const check = checkResponse.result.toLowerCase();

    // If we see real tool names (not just authenticate), auth succeeded
    if (check.includes('list_accounts') || check.includes('gmail_list') || check.includes('get_my_permissions')) {
      if (!check.includes('not available') && !check.includes('not currently')) {
        pass('MCP OAuth completed — tools are accessible');
        return checkResponse.sessionId;
      }
    }
  }

  fail('MCP OAuth completion', `Timed out after ${TIMEOUT_SEC}s — consent not completed`);
  return null;
}

// ─── Phase 2: Tool Verification ──────────────────────────────────────────────

async function verifyTools() {
  log('Phase 2: Headless tool verification via claude -p');

  // Test 1: list_accounts
  const t1 = await claudeP(
    'Call the mcp__fgac-gmail__list_accounts tool. Return the raw JSON result only.',
    { allowedTools: ['mcp__fgac-gmail__list_accounts'], maxTurns: 5, timeoutMs: 45000 }
  );

  if (t1.result.toLowerCase().includes('not available') || t1.result.toLowerCase().includes('authenticate')) {
    fail('list_accounts', 'MCP server not authenticated — run without --skip-auth first');
    return;
  } else if (t1.result.includes('default') || t1.result.includes('account') || t1.result.includes('email')) {
    pass('list_accounts returns data');
  } else {
    // Could be a model interpretation — check if it ran the tool at all
    fail('list_accounts', `Unexpected result: ${t1.result.substring(0, 300)}`);
  }

  // Test 2: get_my_permissions
  const t2 = await claudeP(
    'Call the mcp__fgac-gmail__get_my_permissions tool. Return the raw JSON result only.',
    { allowedTools: ['mcp__fgac-gmail__get_my_permissions'], maxTurns: 5, timeoutMs: 45000 }
  );

  if (t2.result.includes('connection') || t2.result.includes('proxy') || t2.result.includes('permission')) {
    pass('get_my_permissions returns data');
  } else if (t2.result.toLowerCase().includes('not available')) {
    fail('get_my_permissions', 'Tool not available (auth may have expired)');
  } else {
    fail('get_my_permissions', `Unexpected: ${t2.result.substring(0, 300)}`);
  }

  // Test 3: gmail_list
  const t3 = await claudeP(
    'Call the mcp__fgac-gmail__gmail_list tool with no arguments. Return the raw JSON result only.',
    { allowedTools: ['mcp__fgac-gmail__gmail_list'], maxTurns: 5, timeoutMs: 45000 }
  );

  if (t3.result.includes('messages') || t3.result.includes('snippet') || t3.result.includes('subject')) {
    pass('gmail_list returns email data');
  } else if (t3.result.includes('No email') || t3.result.includes('empty')) {
    pass('gmail_list callable (empty result)');
  } else if (t3.result.toLowerCase().includes('not available')) {
    fail('gmail_list', 'Tool not available');
  } else {
    fail('gmail_list', `Unexpected: ${t3.result.substring(0, 300)}`);
  }
}

// ─── Auto-consent via Playwright ─────────────────────────────────────────────

async function autoConsent(authUrl) {
  log('🤖 Auto-consent: navigating to auth URL via playwright...');

  try {
    // Navigate to auth URL
    execSync(
      `npx @playwright/cli -s=antigravity_ui goto "${authUrl}"`,
      { cwd: process.cwd(), timeout: 20000, stdio: 'pipe' }
    );

    // Wait for consent page to load
    await sleep(4000);

    // Take a snapshot to find the Allow button
    const snapshot = execSync(
      'npx @playwright/cli -s=antigravity_ui snapshot',
      { cwd: process.cwd(), timeout: 10000, stdio: 'pipe' }
    ).toString();

    // Find the Allow button ref
    const allowMatch = snapshot.match(/button "Allow" \[ref=(e\d+)\]/);
    if (allowMatch) {
      log(`🤖 Found Allow button (${allowMatch[1]}), clicking...`);
      execSync(
        `npx @playwright/cli -s=antigravity_ui click ${allowMatch[1]}`,
        { cwd: process.cwd(), timeout: 10000, stdio: 'pipe' }
      );
      log('🤖 Auto-consent: Allow clicked!');
      pass('Auto-consent completed');
    } else {
      log('⚠️ Allow button not found — may need manual consent');
      log(`Snapshot excerpt: ${snapshot.substring(0, 500)}`);
    }
  } catch (err) {
    log(`⚠️ Auto-consent failed: ${err.message?.substring(0, 200)}`);
    log('Please complete consent manually in your browser.');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${CYAN}║  FGAC.ai — Claude Code MCP Integration QA                    ║${NC}`);
  console.log(`${CYAN}║  Strategy: claude -p with --resume for session chaining       ║${NC}`);
  console.log(`${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}\n`);

  if (!SKIP_AUTH) {
    await authenticateMCP();
  } else {
    log('Skipping auth (--skip-auth)');
  }

  await verifyTools();

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
    JSON.stringify({ timestamp: new Date().toISOString(), results, config: { timeout: TIMEOUT_SEC, autoConsent: AUTO_CONSENT, skipAuth: SKIP_AUTH } }, null, 2)
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal: ${err.message}${NC}`);
  process.exit(1);
});
