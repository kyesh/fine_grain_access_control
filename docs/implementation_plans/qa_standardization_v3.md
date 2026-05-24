# QA Framework Restructure & Secrets Automation (v2)

Redesign the QA acceptance test suite into a layered architecture: **Setup → Capabilities → Agent Environments → Production**, with 1Password CLI for secret management and agent-driven workflow skills for test execution.

---

## Resolved Questions

| Question | Decision |
|----------|----------|
| 1Password vault name | `FGAC` |
| Separate dev/prod vaults | No, single vault |
| `op` CLI | Not installed yet — plan includes install step |
| Test emails | `USER_A@example.com` (USER_A) + `USER_B@example.com` (USER_B) — currently not used in actual tests, will fix |
| DCR agents | Fresh-generated each run — no 1Password storage |
| Production write tests | Allowed — test email accounts are dedicated for this |
| Test runner | **Agent-driven workflow skills**, not npm scripts |
| BASE_URL strategy | See dedicated section below |

---

## BASE_URL Strategy

> [!IMPORTANT]
> Packaged skills (SKILL.md, `.claude.json`) always point to **production** (`https://gmail.fgac.ai`, `https://fgac.ai/api/mcp`). These are the URLs end-users see.

| Context | BASE_URL | When Used |
|---------|----------|-----------|
| **Dev testing** (Layers 1-3) | `http://localhost:3000` | Agent runs `/qa-setup`, `/qa-capabilities`, `/qa-claude-code` |
| **PR preview** (Layer 3-4) | Vercel preview URL | Agent runs `/deploy-pr-preview` → `/qa-production` |
| **Production** (Layer 4) | `https://fgac.ai` | Agent runs `/qa-production` against live deployment |
| **Packaged skills** (always) | `https://gmail.fgac.ai` | What end-users install — never changes |

**For dev testing**, the agent overrides with `FGAC_ROOT_URL=http://localhost:3000`. For production tests, no override needed — skills use their default production URLs.

**For MCP testing**, `.claude.json` has `http://localhost:3000/api/mcp` for dev. Production testing uses Claude Code pointed at `https://fgac.ai/api/mcp`.

---

## Proposed Changes

### 1. Secret Management (1Password CLI)

---

#### [NEW] Install `op` CLI

The 1Password desktop app is installed at `/opt/1Password/` but the CLI tool isn't on the PATH. First step in `/qa-setup` workflow:

```bash
# Install 1Password CLI (Linux amd64)
curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
  sudo gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/amd64 stable main" | \
  sudo tee /etc/apt/sources.list.d/1password.list
sudo apt update && sudo apt install -y 1password-cli
```

#### [NEW] 1Password Vault: `FGAC`

Items to create in the vault:

| Item Name | Fields | Purpose |
|-----------|--------|---------|
| `test-emails` | `user-a`: USER_A@example.com, `user-b`: USER_B@example.com | QA test email accounts |
| `proxy-key` | `credential`: sk_proxy_... | Default QA proxy key for OpenClaw testing |
| `clerk-test-password` | `password`: (if needed for non-SSO sign-in) | Clerk auth for browser agent |

#### [NEW] `scripts/qa-secrets.sh`

Pulls credentials from 1Password vault into gitignored local files:

```bash
#!/bin/bash
set -euo pipefail
echo "📦 Pulling QA secrets from 1Password vault 'FGAC'..."

# Test email accounts
op inject -i .qa_test_emails.json.template -o .qa_test_emails.json
echo "✅ .qa_test_emails.json"

# OpenClaw proxy key
PROXY_KEY=$(op read "op://FGAC/proxy-key/credential")
mkdir -p ~/.openclaw/gmail-fgac/tokens
cat > ~/.openclaw/gmail-fgac/tokens/qa-test.json <<EOF
{
  "proxyKey": "$PROXY_KEY",
  "proxyEndpoint": "https://gmail.fgac.ai"
}
EOF
echo "✅ ~/.openclaw/gmail-fgac/tokens/qa-test.json"
echo "🎉 All QA secrets populated."
```

#### [NEW] `.qa_test_emails.json.template`

Committed template with `op://` secret references:

```json
{
  "USER_A_EMAIL": "op://FGAC/test-emails/user-a",
  "USER_B_EMAIL": "op://FGAC/test-emails/user-b"
}
```

#### [MODIFY] [.gitignore](file:///home/kyesh/GitRepos/fine_grain_access_control/.gitignore)

Add `.qa_test_emails.json.template` as tracked (it's safe — only contains `op://` references).

---

### 2. QA Directory Restructure

---

```
docs/QA_Acceptance_Test/
├── README.md                              # [NEW] Index, dependency graph, how to run
├── setup/                                 # Layer 1: User Setup via Browser Agent
│   ├── 01_signup_and_credential.md        # [MOVE] Sign up, create key, link email
│   ├── 02_multi_account_linking.md        # [EXTRACT from 03] Link USER_B, create multi-email keys
│   └── 03_rules_configuration.md          # [EXTRACT from 02,03] Send whitelist + read blacklist + deletion rules
├── capabilities/                          # Layer 2: Feature Tests (environment-agnostic)
│   ├── 01_send_whitelist.md               # [EXTRACT from 02 §1] Whitelisted/blocked send
│   ├── 02_read_blacklist.md               # [EXTRACT from 02 §2-3] Content-based read blocking
│   ├── 03_multi_email_scoping.md          # [EXTRACT from 03 §3-6] Key-to-email isolation
│   ├── 04_delegation.md                   # [MOVE from 04]
│   ├── 05_label_access.md                 # [MOVE from 05]
│   ├── 06_connection_lifecycle.md         # [MERGE 11+11a+11b] Pending→approve→block→unblock
│   └── 07_key_lifecycle.md                # [EXTRACT from 03 §7-8] Revoke + roll
├── environments/                          # Layer 3: Agent Runtime Runbooks
│   ├── 01_hosted_mcp.md                   # [MERGE 11a + 12§1] HTTP curl-level MCP testing
│   ├── 02_claude_code_mcp.md              # [NEW] tmux + playwright interactive flow
│   ├── 03_claude_code_cli.md              # [MOVE from 12§3] Script-based CLI testing
│   └── 04_openclaw_skill.md               # [MERGE 10 + 12§4] Skill install + script testing
├── production/                            # Layer 4: Live Deployment Validation
│   ├── 01_smoke_test.md                   # [NEW] Discovery, auth, basic tool call
│   └── 02_cross_distribution.md           # [NEW] Each env against prod URLs
└── archive/                               # Retired one-time-fix tests
    ├── 07_waitlist_and_signup_flow.md      # Waitlist removed
    ├── 08_missing_google_scopes.md        # One-time fix
    ├── 08_strict_light_mode.md            # Cosmetic
    ├── 09_universe_domain_rollback.md     # One-time fix
    └── 06_google_verification_compliance.md # CASA-specific
```

#### Key design principle: separation of concerns

- **`setup/`** — Agent uses `/browser-agent` to sign in, create keys, configure rules. Run once per QA cycle.
- **`capabilities/`** — Describe **what** to verify (e.g., "send to blocked address returns 403"). These are environment-agnostic — same assertion, different execution method.
- **`environments/`** — Describe **how** to execute capability tests in each agent runtime. Each environment doc references the capability tests it validates.
- **`production/`** — Same as environments but against live URLs. Uses real test email accounts.

#### Capabilities + Environments cross-reference

Each **capability test** has an "Execution Matrix" table:

```markdown
## Execution Matrix

| Capability | Hosted MCP | Claude Code MCP | CLI Scripts | OpenClaw |
|-----------|------------|-----------------|-------------|----------|
| Send whitelist enforced | ✅ curl | ✅ tmux prompt | ✅ gmail.js | ✅ gmail.js |
| Read blacklist enforced | ✅ curl | ✅ tmux prompt | ✅ gmail.js | ✅ gmail.js |
| Multi-email scoping     | ✅ curl | ✅ tmux prompt | ✅ gmail.js | ✅ gmail.js |
```

Each **environment doc** links back to which capabilities it covers and provides the exact commands/interactions.

---

### 3. Agent-Driven Workflow Skills

---

> [!IMPORTANT]
> These workflows are **not npm scripts** — they are step-by-step instructions for the coding agent (me) to execute using browser tools, tmux, and terminal commands. The agent reads the workflow, executes each step, and validates results.

#### [NEW] `.agent/workflows/qa-setup.md` — `/qa-setup`

**Purpose**: Bootstrap the QA environment from scratch.

```markdown
## Steps
1. Verify 1Password CLI: `which op || echo "Install with: sudo apt install 1password-cli"`
2. Pull secrets: `bash scripts/qa-secrets.sh`
3. Read .qa_test_emails.json to get USER_A_EMAIL and USER_B_EMAIL
4. Start dev server: `npm run dev`
5. Attach browser: `/browser-agent http://localhost:3000`
6. Sign in as USER_A (Google SSO — browser already has session)
7. Navigate to dashboard
8. Create proxy key "QA-Agent-A" mapped to USER_A_EMAIL
9. Create proxy key "QA-Agent-B" mapped to USER_B_EMAIL  
10. Create proxy key "QA-Power-Agent" mapped to BOTH emails
11. Configure rules:
    - Send whitelist: USER_B_EMAIL (so USER_A can send to USER_B)
    - Read blacklist: regex "2FA Code|Password Reset"
12. Link USER_B email via Clerk Connected Accounts
13. Screenshot dashboard state: `qa_proof_setup.png`
14. Save proxy key values to .qa_test_emails.json (extended format)
```

#### [NEW] `.agent/workflows/qa-capabilities.md` — `/qa-capabilities`

**Purpose**: Run the environment-agnostic capability tests.

```markdown
## Prerequisites
- /qa-setup completed
- Dev server running

## Steps
1. Read proxy keys from .qa_test_emails.json
2. Run TestClaw automated suite: `bash test/testclaw/run-qa.sh`
   - Validates: discovery, 401, pending, approved, permissions
3. Test send whitelist:
   - curl to /api/mcp with gmail_send to USER_B_EMAIL → expect success
   - curl with gmail_send to blocked@evil.com → expect 403
4. Test read blacklist:
   - curl with gmail_read for "2FA Code" email → expect 403
5. Test multi-email scoping:
   - QA-Agent-A accessing USER_B_EMAIL → expect 403
   - QA-Power-Agent accessing both → expect success
6. Test connection lifecycle via /browser-agent:
   - Create new DCR client → pending → approve → test → block → verify blocked → unblock
7. Aggregate results to test/testclaw/results/capabilities.json
```

#### [NEW] `.agent/workflows/qa-claude-code.md` — `/qa-claude-code`

**Purpose**: Test FGAC MCP in Claude Code using the tmux pattern.

```markdown
## Prerequisites
- Dev server running on localhost:3000
- fgac-gmail in .claude.json pointing to localhost:3000/api/mcp
- Playwright browser session available

## Steps
1. Start Claude Code in tmux:
   `tmux new-session -d -s fgac-qa -x 200 -y 50 "claude --dangerously-skip-permissions"`
2. Wait for prompt: poll `tmux capture-pane -t fgac-qa -p` for "❯"
3. Send /mcp: `tmux send-keys -t fgac-qa "/mcp" Enter`
4. Select fgac-gmail: `tmux send-keys -t fgac-qa Enter` (if highlighted)
5. Select Authenticate: `tmux send-keys -t fgac-qa Enter`
6. Extract auth URL from `tmux capture-pane -t fgac-qa -p -S -50`
7. Auto-consent via playwright:
   `npx @playwright/cli -s=antigravity_ui goto "<auth_url>"`
   Wait for Allow button → click it
8. Verify "Authentication successful" in tmux capture
9. Approve connection in dashboard via /browser-agent
10. Test list_accounts: `tmux send-keys -t fgac-qa "call list_accounts from fgac-gmail" Enter`
11. Verify output contains email account data
12. Test gmail_list: verify email data or correct "no access" error
13. Cleanup: `tmux kill-session -t fgac-qa`
```

#### [NEW] `.agent/workflows/qa-production.md` — `/qa-production`

**Purpose**: Validate a production deployment.

```markdown
## Prerequisites
- Production deployment live at fgac.ai
- Test accounts configured in production dashboard

## Steps
1. Read test emails from 1Password: `op read "op://FGAC/test-emails/user-a"`
2. Verify discovery endpoints:
   `curl -sf https://fgac.ai/.well-known/oauth-authorization-server | jq .`
   `curl -sf https://fgac.ai/.well-known/oauth-protected-resource/mcp | jq .`
3. Verify MCP 401 without auth:
   `curl -s -o /dev/null -w "%{http_code}" https://fgac.ai/api/mcp -X POST ...`
4. Test Claude Code MCP against production:
   - Update .claude.json to point to https://fgac.ai/api/mcp
   - Run /qa-claude-code workflow
   - Restore .claude.json to localhost after
5. Test OpenClaw skill against production:
   - Skills already point to https://gmail.fgac.ai (production default)
   - Run: `node docs/skills/gmail-fgac/scripts/gmail.js --account qa-test --action labels`
6. Test CLI scripts against production:
   - `node scripts/auth.js --action login` (against fgac.ai)
   - `node scripts/gmail.js --action list`
7. Verify send whitelist enforcement:
   - Send to USER_B_EMAIL → success
   - Send to blocked address → 403
8. Verify read blacklist enforcement
9. Screenshot production dashboard via /browser-agent
```

---

### 4. Fix: Test Emails Not Used in Actual Tests

---

The current test infrastructure hardcodes `spike-test@example.com` instead of reading from `.qa_test_emails.json`. Fix this:

#### [MODIFY] [run-qa.sh](file:///home/kyesh/GitRepos/fine_grain_access_control/test/testclaw/run-qa.sh)

Add `.qa_test_emails.json` loading at the top:

```bash
# Load test emails from config
if [ -f "$REPO_ROOT/.qa_test_emails.json" ]; then
  USER_A_EMAIL=$(jq -r '.USER_A_EMAIL' "$REPO_ROOT/.qa_test_emails.json")
  USER_B_EMAIL=$(jq -r '.USER_B_EMAIL' "$REPO_ROOT/.qa_test_emails.json")
  echo "📧 Test emails: $USER_A_EMAIL, $USER_B_EMAIL"
else
  echo "⚠️ No .qa_test_emails.json found — run: npm run qa:secrets"
fi
```

#### [MODIFY] [qa-claude-code-mcp.js](file:///home/kyesh/GitRepos/fine_grain_access_control/test/testclaw/qa-claude-code-mcp.js)

Replace `spike-test@example.com` with dynamic loading from `.qa_test_emails.json`.

---

### 5. README Index

---

#### [NEW] `docs/QA_Acceptance_Test/README.md`

```markdown
# FGAC.ai QA Acceptance Test Suite

## Architecture

4-layer test structure, each layer depends on the previous:

### Layer 1: Setup (/qa-setup)
Browser-agent-driven dashboard configuration.
- Sign in, create keys, link emails, configure rules
- Must be run first. Creates the QA baseline state.

### Layer 2: Capabilities (/qa-capabilities)  
Environment-agnostic feature validation.
- Send whitelist, read blacklist, multi-email scoping
- Executed via curl + TestClaw against dev server

### Layer 3: Environments (/qa-claude-code, etc.)
Agent runtime-specific testing.
- Hosted MCP: HTTP-level curl tests
- Claude Code MCP: tmux + playwright interactive flow  
- CLI Scripts: node scripts with FGAC OAuth
- OpenClaw: Skill installation + script invocation

### Layer 4: Production (/qa-production)
Live deployment validation.
- Same tests as Layers 2-3 but against fgac.ai
- Uses dedicated test email accounts for write tests

## Quick Start
1. `/qa-setup` — Bootstrap environment
2. `/qa-capabilities` — Run feature tests
3. `/qa-claude-code` — Test Claude Code integration  
4. `/deploy-pr-preview` → `/qa-production` — Validate deployment

## Secrets
Test credentials stored in 1Password vault "FGAC".
Run `bash scripts/qa-secrets.sh` to populate local files.
```

---

## File Summary

| Action | File | Description |
|--------|------|-------------|
| **NEW** | `scripts/qa-secrets.sh` | 1Password → local files |
| **NEW** | `.qa_test_emails.json.template` | `op://` reference template (tracked in git) |
| **NEW** | `.agent/workflows/qa-setup.md` | Browser-agent dashboard setup |
| **NEW** | `.agent/workflows/qa-capabilities.md` | Feature test runner |
| **NEW** | `.agent/workflows/qa-claude-code.md` | tmux + playwright Claude Code QA |
| **NEW** | `.agent/workflows/qa-production.md` | Production validation |
| **NEW** | `docs/QA_Acceptance_Test/README.md` | Suite index and quick start |
| **NEW** | `docs/QA_Acceptance_Test/setup/` | 3 setup docs |
| **NEW** | `docs/QA_Acceptance_Test/capabilities/` | 7 capability docs |
| **NEW** | `docs/QA_Acceptance_Test/environments/` | 4 environment docs |
| **NEW** | `docs/QA_Acceptance_Test/production/` | 2 production docs |
| **MOVE** | `docs/QA_Acceptance_Test/archive/` | 5 retired tests |
| **MODIFY** | `test/testclaw/run-qa.sh` | Load test emails from config |
| **MODIFY** | `test/testclaw/qa-claude-code-mcp.js` | Replace hardcoded spike-test email |
| **MODIFY** | `package.json` | Add `qa:secrets` script |

## Verification Plan

### Automated
1. `bash scripts/qa-secrets.sh` populates `.qa_test_emails.json` from 1Password
2. `bash test/testclaw/run-qa.sh` passes 5/5 using real test emails
3. All workflow files parse correctly as markdown

### Agent-Driven (via workflow skills)
1. `/qa-setup` → dashboard screenshot shows keys + rules + both emails
2. `/qa-capabilities` → TestClaw + curl tests pass
3. `/qa-claude-code` → Claude Code authenticates + calls tools
4. `/qa-production` → discovery + tool calls work against fgac.ai
