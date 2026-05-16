# QA Framework Restructure & Secrets Automation (v3)

Redesign the QA acceptance test suite into a layered architecture: **Setup → Capabilities → Agent Environments → Production**, with 1Password CLI for secret management and agent-driven workflow skills for test orchestration.

---

## Resolved Questions

| Question | Decision |
|----------|----------|
| 1Password vault name | `FGAC` (single vault) |
| `op` CLI | ✅ Installed: `/usr/bin/op` v2.34.0 — needs desktop app integration enabled |
| Proxy key storage | Generated during `/qa-setup` flow via browser agent, NOT stored in 1Password |
| Clerk auth | Not needed — browser agent is already signed into Google. Use Google OAuth SSO. |
| Test emails | `USER_A@example.com` (USER_A), `USER_B@example.com` (USER_B) — stored in 1Password |
| DCR agents | Fresh-generated each run |
| Production write tests | Allowed using dedicated QA email accounts |
| `08_strict_light_mode.md` | **Keep** — recurring issue, not a one-time fix |
| Workflow vs QA docs | Workflows are **thin pointers** that steer the agent to QA docs, never duplicate content |
| OpenClaw testing | Must run **genuine OpenClaw instance** in Docker, not standalone scripts |
| Production install | Must install via **real distribution channels** (ClawHub, Claude Code `/plugin` marketplace) |

---

## BASE_URL Strategy

> [!IMPORTANT]
> Packaged skills (`SKILL.md`, `.claude.json`) **always point to production** (`https://gmail.fgac.ai`, `https://fgac.ai/api/mcp`). These are the URLs end-users see.

| Context | BASE_URL | When Used |
|---------|----------|-----------|
| **Dev testing** (Layers 1-3) | `http://localhost:3000` | Local dev via `FGAC_ROOT_URL` override |
| **PR preview** (Layer 3-4) | Vercel preview URL | Via `/deploy-pr-preview` |
| **Production** (Layer 4) | `https://fgac.ai` / `https://gmail.fgac.ai` | No override — skills use defaults |

**For dev testing**, the agent overrides with `FGAC_ROOT_URL=http://localhost:3000`.  
**For production testing**, skills and plugins use their built-in production URLs — no override needed.

---

## Proposed Changes

### 1. 1Password Secret Management

---

> [!NOTE]
> `op` CLI v2.34.0 is installed at `/usr/bin/op`. It needs the desktop app integration enabled to authenticate. This is a one-time manual step.

#### Enable Desktop App Integration

```bash
# One-time: user enables in 1Password desktop app
# Settings → Developer → "Integrate with 1Password CLI"
# Then verify:
op vault list
```

#### [NEW] Create 1Password Vault Items

Vault: **`FGAC`**

| Item Name | Fields | Purpose |
|-----------|--------|---------|
| `test-emails` | `user-a`, `user-b` | QA test email accounts |

That's it — no proxy keys (generated in setup), no Clerk passwords (use Google SSO), no DCR agents (fresh each run).

#### [NEW] `.qa_test_emails.json.template`

Committed template with `op://` secret references:

```json
{
  "USER_A_EMAIL": "op://FGAC/test-emails/user-a",
  "USER_B_EMAIL": "op://FGAC/test-emails/user-b"
}
```

#### [NEW] `scripts/qa-secrets.sh`

```bash
#!/bin/bash
set -euo pipefail
echo "📦 Pulling QA secrets from 1Password vault 'FGAC'..."
op inject -i .qa_test_emails.json.template -o .qa_test_emails.json
echo "✅ .qa_test_emails.json populated"
```

#### [MODIFY] [package.json](file:///home/kyesh/GitRepos/fine_grain_access_control/package.json)

Add `"qa:secrets": "bash scripts/qa-secrets.sh"`

---

### 2. QA Directory Restructure

---

```
docs/QA_Acceptance_Test/
├── README.md                              # [NEW] Index, dependency graph
├── setup/                                 # Layer 1: Browser-agent setup
│   ├── 01_signup_and_credential.md        # [MOVE] Sign up, link Google, create first key
│   ├── 02_multi_account_linking.md        # [EXTRACT from 03] Link USER_B, create multi-email keys
│   └── 03_rules_configuration.md          # [EXTRACT from 02,03] Whitelist/blacklist/deletion rules
├── capabilities/                          # Layer 2: Feature tests (environment-agnostic)
│   ├── 01_send_whitelist.md               # [EXTRACT from 02 §1]
│   ├── 02_read_blacklist.md               # [EXTRACT from 02 §2-3]
│   ├── 03_multi_email_scoping.md          # [EXTRACT from 03 §3-6]
│   ├── 04_delegation.md                   # [MOVE from 04]
│   ├── 05_label_access.md                 # [MOVE from 05]
│   ├── 06_connection_lifecycle.md         # [MERGE 11+11a+11b]
│   ├── 07_key_lifecycle.md                # [EXTRACT from 03 §7-8]
│   └── 08_strict_light_mode.md            # [MOVE from 08 — recurring issue, keep]
├── environments/                          # Layer 3: Agent runtime testing
│   ├── 01_hosted_mcp.md                   # [MERGE 11a + 12§1]
│   ├── 02_claude_code_mcp.md              # [NEW] tmux + playwright
│   ├── 03_claude_code_cli.md              # [MOVE from 12§3]
│   └── 04_openclaw_skill.md               # [MERGE 10 + 12§4] — uses real OpenClaw Docker
├── production/                            # Layer 4: Live deployment validation
│   ├── 01_smoke_test.md                   # [NEW] Discovery + basic auth
│   └── 02_distribution_channels.md        # [NEW] Install from ClawHub + marketplace
└── archive/                               # Retired one-time-fix tests
    ├── 07_waitlist_and_signup_flow.md
    ├── 08_missing_google_scopes.md
    ├── 09_universe_domain_rollback.md
    └── 06_google_verification_compliance.md
```

#### Key Design Principles

1. **Setup docs** describe what the browser agent must do in the dashboard
2. **Capability docs** describe what to verify (environment-agnostic assertions)
3. **Environment docs** describe how to execute those assertions in each agent runtime
4. **Production docs** describe distribution channel install + live validation

Each **capability doc** has an "Execution Matrix" linking to the relevant environment docs.

---

### 3. Agent-Driven Workflow Skills (Thin Pointers)

---

> [!IMPORTANT]
> Workflows are **routing instructions** — they tell the agent which QA doc to read, not what steps to take. All test logic lives in `docs/QA_Acceptance_Test/`. This prevents duplication and drift.

#### [NEW] `.agent/workflows/qa-setup.md` — `/qa-setup`

```markdown
---
description: Bootstrap QA environment by running setup tests
---
# QA Setup Workflow (/qa-setup)

Bootstraps the QA test environment. Read and execute the setup test docs.

## Steps

1. Pull secrets: `bash scripts/qa-secrets.sh`
2. Read test emails: `cat .qa_test_emails.json`
3. Start dev server: `npm run dev` (with `--max-old-space-size=4096`)
4. Start browser: verify Chrome remote debugging at localhost:9222
5. Execute setup tests IN ORDER:
   - Read and follow `docs/QA_Acceptance_Test/setup/01_signup_and_credential.md`
   - Read and follow `docs/QA_Acceptance_Test/setup/02_multi_account_linking.md`
   - Read and follow `docs/QA_Acceptance_Test/setup/03_rules_configuration.md`
6. Screenshot final dashboard state as proof
```

#### [NEW] `.agent/workflows/qa-capabilities.md` — `/qa-capabilities`

```markdown
---
description: Run environment-agnostic capability tests
---
# QA Capabilities Workflow (/qa-capabilities)

Runs the capability test suite. Requires /qa-setup completed first.

## Steps

1. Verify dev server running at localhost:3000
2. Execute capability tests IN ORDER:
   - Read and follow `docs/QA_Acceptance_Test/capabilities/01_send_whitelist.md`
   - Read and follow `docs/QA_Acceptance_Test/capabilities/02_read_blacklist.md`
   - Read and follow `docs/QA_Acceptance_Test/capabilities/03_multi_email_scoping.md`
   - Read and follow `docs/QA_Acceptance_Test/capabilities/04_delegation.md`
   - Read and follow `docs/QA_Acceptance_Test/capabilities/05_label_access.md`
   - Read and follow `docs/QA_Acceptance_Test/capabilities/06_connection_lifecycle.md`
   - Read and follow `docs/QA_Acceptance_Test/capabilities/07_key_lifecycle.md`
   - Read and follow `docs/QA_Acceptance_Test/capabilities/08_strict_light_mode.md`
3. Save results to test/testclaw/results/
```

#### [NEW] `.agent/workflows/qa-claude-code.md` — `/qa-claude-code`

```markdown
---
description: Test FGAC in Claude Code using tmux + playwright
---
# Claude Code QA Workflow (/qa-claude-code)

Tests FGAC MCP integration in Claude Code. Requires /qa-setup completed.

## Steps

1. Verify dev server running at localhost:3000
2. Read and follow `docs/QA_Acceptance_Test/environments/02_claude_code_mcp.md`
3. For each capability in the environment doc's "Capabilities Covered" list,
   verify the assertions from the corresponding capability doc
```

#### [NEW] `.agent/workflows/qa-production.md` — `/qa-production`

```markdown
---
description: Validate production deployment via real distribution channels
---
# Production QA Workflow (/qa-production)

Tests the production deployment using real distribution channels.
Requires a production deployment at fgac.ai.

## Steps

1. Read and follow `docs/QA_Acceptance_Test/production/01_smoke_test.md`
2. Read and follow `docs/QA_Acceptance_Test/production/02_distribution_channels.md`
   This includes installing from ClawHub and Claude Code plugin marketplace.
3. For each environment verified, run the applicable capability assertions
```

---

### 4. OpenClaw Testing: Genuine Agent, Not Scripts

---

> [!WARNING]
> The current `test/testclaw/run-qa.sh` runs scripts directly (`node gmail.js`), bypassing the actual OpenClaw agent runtime. This doesn't validate that OpenClaw can discover, invoke, and parse skill output correctly.

#### Current problem

```bash
# run-qa.sh line 64 — runs the script directly, NOT through OpenClaw
GMAIL_OUTPUT=$(FGAC_ROOT_URL="$FGAC_URL" node /home/node/.openclaw/skills/gmail-fgac/scripts/gmail.js --action list)
```

This only tests that `gmail.js` works in isolation. It does NOT test:
- OpenClaw's skill discovery and invocation
- SKILL.md parsing and `when_to_use` matching
- OpenClaw's ability to handle FGAC error responses
- The agent-user interaction loop (e.g., "I need approval, here's the dashboard link")

#### Proposed fix

The **TestClaw Dockerfile** already builds from `openclaw:local` and starts the OpenClaw gateway (`node dist/index.js gateway`). The environment doc for OpenClaw (`environments/04_openclaw_skill.md`) should describe testing through the **actual gateway API**:

```markdown
## Testing via OpenClaw Gateway (Genuine Agent)

1. Start TestClaw: `docker compose -f test/testclaw/docker-compose.yml up -d`
2. Wait for gateway: `curl -sf http://localhost:18789/health`
3. Send a prompt to the OpenClaw gateway:
   ```bash
   curl -X POST http://localhost:18789/api/chat \
     -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"message": "List my recent emails using the gmail-fgac skill"}'
   ```
4. Verify the agent:
   - Discovers the gmail-fgac skill
   - Invokes `gmail.js --action list`
   - Returns parsed email data to the user
5. Test error handling:
   ```bash
   curl -X POST http://localhost:18789/api/chat \
     -d '{"message": "Send an email to blocked@evil.com"}'
   ```
6. Verify the agent:
   - Gets 403 from FGAC proxy
   - Reports the whitelist error to the user (doesn't crash)
```

#### [MODIFY] `test/testclaw/run-qa.sh`

Update tests 3-4 to interact with the **OpenClaw gateway** instead of running scripts directly. The script should:
1. Start the OpenClaw gateway (if not already running)
2. Send natural language prompts to the gateway API
3. Verify the gateway response includes correct skill invocations

#### [MODIFY] `test/testclaw/docker-compose.yml`

Ensure the entrypoint starts the OpenClaw gateway before running QA, not just the scripts.

---

### 5. Production Testing: Real Distribution Channels

---

> [!IMPORTANT]
> Production tests must validate the actual user experience — installing from ClawHub, plugin marketplaces, and `claude mcp add` — not from local files.

#### [NEW] `docs/QA_Acceptance_Test/production/02_distribution_channels.md`

```markdown
# Production QA: Distribution Channel Validation

## Channel 1: ClawHub (OpenClaw)

1. Install the skill from ClawHub:
   ```bash
   clawhub skill install gmail-fgac
   ```
2. Verify skill files installed to `~/.openclaw/skills/gmail-fgac/`
3. Verify SKILL.md has correct production URLs (`gmail.fgac.ai`)
4. Start OpenClaw and prompt: "List my recent emails"
5. Verify the agent discovers and invokes the installed skill

## Channel 2: Claude Code Plugin Marketplace

1. Install via marketplace:
   ```
   /plugin marketplace browse
   ```
   Search for "fgac" → Install
2. Verify the plugin registers `fgac-gmail` MCP server
3. Verify MCP server URL is `https://fgac.ai/api/mcp`
4. Authenticate: `/mcp` → fgac-gmail → consent
5. Test tool call: "List my email accounts"

## Channel 3: Claude Code MCP (Manual Add)

1. Add MCP server:
   ```bash
   claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp
   ```
2. Verify: `claude mcp list` shows fgac-gmail
3. Authenticate and test as above

## Channel 4: Claude Code CLI (Local Scripts)

1. Install per SKILL.md Option B instructions:
   ```bash
   cp -r docs/skills/gmail-fgac ~/.config/claude/skills/gmail-fgac
   ```
2. Run OAuth: `node ~/.config/claude/skills/gmail-fgac/scripts/auth.js --action login`
3. Verify consent flow opens browser → fgac.ai OAuth
4. Test: `node scripts/gmail.js --action list`
```

---

### 6. Fix: Test Emails Not Used in Tests

---

#### [MODIFY] [qa-claude-code-mcp.js](file:///home/kyesh/GitRepos/fine_grain_access_control/test/testclaw/qa-claude-code-mcp.js)

Replace hardcoded `spike-test@example.com` with dynamic loading:

```javascript
// Load real test emails
const testEmailsPath = path.join(__dirname, '../../.qa_test_emails.json');
let USER_A_EMAIL = 'spike-test@example.com'; // fallback
if (existsSync(testEmailsPath)) {
  const emails = JSON.parse(readFileSync(testEmailsPath, 'utf-8'));
  USER_A_EMAIL = emails.USER_A_EMAIL;
}
```

Then use `USER_A_EMAIL` in the verification assertions.

---

## File Summary

| Action | File | Description |
|--------|------|-------------|
| **NEW** | `scripts/qa-secrets.sh` | 1Password → local files |
| **NEW** | `.qa_test_emails.json.template` | `op://` reference template (tracked in git) |
| **NEW** | `.agent/workflows/qa-setup.md` | Thin pointer → `setup/` QA docs |
| **NEW** | `.agent/workflows/qa-capabilities.md` | Thin pointer → `capabilities/` QA docs |
| **NEW** | `.agent/workflows/qa-claude-code.md` | Thin pointer → `environments/02_claude_code_mcp.md` |
| **NEW** | `.agent/workflows/qa-production.md` | Thin pointer → `production/` QA docs |
| **NEW** | `docs/QA_Acceptance_Test/README.md` | Suite index and quick start |
| **NEW** | `docs/QA_Acceptance_Test/setup/` | 3 setup docs (browser-agent driven) |
| **NEW** | `docs/QA_Acceptance_Test/capabilities/` | 8 capability docs (incl. light mode) |
| **NEW** | `docs/QA_Acceptance_Test/environments/` | 4 environment docs |
| **NEW** | `docs/QA_Acceptance_Test/production/` | 2 production docs (real distribution channels) |
| **MOVE** | `docs/QA_Acceptance_Test/archive/` | 4 retired tests (NOT light mode) |
| **MODIFY** | `test/testclaw/run-qa.sh` | Route tests through OpenClaw gateway, not direct scripts |
| **MODIFY** | `test/testclaw/docker-compose.yml` | Ensure gateway starts before QA |
| **MODIFY** | `test/testclaw/qa-claude-code-mcp.js` | Load test emails dynamically |
| **MODIFY** | `package.json` | Add `qa:secrets` script |

---

## Verification Plan

### 1Password
1. `op vault list` shows vaults (requires desktop app integration)
2. `bash scripts/qa-secrets.sh` populates `.qa_test_emails.json`

### Setup Layer
1. `/qa-setup` → agent follows setup docs → dashboard screenshot shows keys + rules + both emails

### Capabilities Layer
1. `/qa-capabilities` → agent follows capability docs → all assertions pass

### Environment Layer
1. `docker compose -f test/testclaw/docker-compose.yml up` → OpenClaw gateway starts
2. OpenClaw gateway processes natural language prompts through gmail-fgac skill
3. `/qa-claude-code` → Claude Code authenticates + calls tools via tmux

### Production Layer
1. `/qa-production` → installs from ClawHub + plugin marketplace
2. Tools work against `fgac.ai` / `gmail.fgac.ai` production URLs
