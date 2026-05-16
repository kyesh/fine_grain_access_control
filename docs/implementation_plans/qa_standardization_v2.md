# QA Framework Restructure & Secrets Automation

Redesign the QA acceptance test suite into a layered architecture: **Setup → Capabilities → Agent Environments → Production**, and add 1Password CLI integration to prevent the recurring secret/config file loss problem.

## User Review Required

> [!IMPORTANT]
> **1Password CLI (`op`) is not currently installed** on the development machine. The plan proposes installing it and storing QA credentials in a 1Password vault. Do you already have a 1Password account/vault with these credentials, or should we create a new vault structure?

> [!IMPORTANT]
> **Workflow naming convention**: The proposed workflow files (e.g., `/qa-setup`, `/qa-claude-code`) will be invocable as slash commands. Should these be prefixed differently (e.g., `/test-setup`)?

> [!WARNING]
> **Existing test numbers**: The restructure proposes renaming tests (e.g., QA 01 → `setup/01_...`). This will break any external references to the old filenames. We can keep the old files as redirects or do a clean break.

## Open Questions

1. **1Password Vault Name** — What should the vault be called? Suggested: `FGAC-QA`. Do you want separate vaults for dev vs. prod credentials?
2. **Test Email Accounts** — The current `.qa_test_emails.json` has `USER_A@example.com` and `USER_B@example.com`. Are there additional accounts we should store (e.g., for Claude Code MCP testing, OpenClaw agents)?
3. **`qa-test-agents.json`** — This has DCR client credentials. Should this also be pulled from 1Password, or is it OK to regenerate fresh DCR clients each test run?
4. **Production test scope** — Should production tests be read-only (no send/delete) or should they include guarded write tests?
5. **Test runner** — Should we create a unified `npm run qa` script that orchestrates all layers, or keep them as separate runbooks?

---

## Proposed Changes

### Layer 1: Secret Management (1Password CLI)

#### [NEW] `scripts/qa-secrets.sh`

Script that pulls QA credentials from 1Password into gitignored local files. Prevents the recurring problem of secrets being lost or overwritten with example files.

```bash
#!/bin/bash
# Pull QA secrets from 1Password vault "FGAC-QA"
# Requires: op CLI installed + authenticated (op signin)

set -euo pipefail

echo "📦 Pulling QA secrets from 1Password..."

# Test email accounts
op inject -i .qa_test_emails.json.template -o .qa_test_emails.json
echo "✅ .qa_test_emails.json"

# DCR agent credentials  
op inject -i qa-test-agents.json.template -o qa-test-agents.json
echo "✅ qa-test-agents.json"

# FGAC proxy key for OpenClaw skill testing
PROXY_KEY=$(op read "op://FGAC-QA/proxy-key/credential")
mkdir -p ~/.openclaw/gmail-fgac/tokens
cat > ~/.openclaw/gmail-fgac/tokens/qa-test.json <<EOF
{
  "type": "service_account",
  "private_key_id": "$PROXY_KEY",
  "client_email": "fgac-proxy@fgac.ai",
  "token_uri": "https://fgac.ai/api/auth/token"
}
EOF
echo "✅ ~/.openclaw/gmail-fgac/tokens/qa-test.json"

echo "🎉 All QA secrets populated."
```

#### [NEW] `.qa_test_emails.json.template`

Committed template with `op://` references:

```json
{
  "USER_A_EMAIL": "op://FGAC-QA/test-emails/user-a",
  "USER_B_EMAIL": "op://FGAC-QA/test-emails/user-b"
}
```

#### [NEW] `qa-test-agents.json.template`

```json
{
  "qa-agent-v2": {
    "client_id": "op://FGAC-QA/dcr-agent/client-id",
    "client_secret": "op://FGAC-QA/dcr-agent/client-secret",
    "pkce": {
      "verifier": "op://FGAC-QA/dcr-agent/pkce-verifier",
      "challenge": "op://FGAC-QA/dcr-agent/pkce-challenge"
    }
  }
}
```

#### [MODIFY] [package.json](file:///home/kyesh/GitRepos/fine_grain_access_control/package.json)

Add `qa:secrets` npm script:

```json
"scripts": {
  "qa:secrets": "bash scripts/qa-secrets.sh",
  "qa:setup": "npm run qa:secrets && echo 'Ready for QA'"
}
```

#### [MODIFY] [.gitignore](file:///home/kyesh/GitRepos/fine_grain_access_control/.gitignore)

Ensure templates are tracked but real files are gitignored (already done for `.qa_test_emails.json` and `qa-test-agents.json`).

---

### Layer 2: QA Directory Restructure

Current flat structure (15 files) → organized into 4 layers:

```
docs/QA_Acceptance_Test/
├── README.md                          # [NEW] Index/overview
├── setup/                             # Layer 1: Test Setup
│   ├── 01_signup_and_credential.md    # [MOVE from 01_*]
│   ├── 02_multi_account_linking.md    # [NEW from 03_* §1]
│   └── 03_key_and_rule_creation.md    # [NEW from 03_* §2-6]
├── capabilities/                      # Layer 2: Feature Tests
│   ├── 01_send_whitelist.md           # [REFACTOR from 02_* §1]
│   ├── 02_read_blacklist.md           # [REFACTOR from 02_* §2-3]
│   ├── 03_multi_email_scoping.md      # [REFACTOR from 03_* §3-6]
│   ├── 04_delegation.md              # [MOVE from 04_*]
│   ├── 05_label_access.md            # [MOVE from 05_*]
│   ├── 06_connection_lifecycle.md     # [REFACTOR from 11_*, 11a_*, 11b_*]
│   └── 07_token_refresh.md           # [MOVE from 12_* §5]
├── environments/                      # Layer 3: Agent Environments
│   ├── 01_hosted_mcp.md              # [NEW] HTTP-level MCP testing
│   ├── 02_claude_code_mcp.md         # [NEW] tmux-based Claude Code QA
│   ├── 03_claude_code_cli.md         # [REFACTOR from 12_* §3]
│   └── 04_openclaw_skill.md          # [REFACTOR from 10_*, 12_* §4]
└── production/                        # Layer 4: Production Validation
    ├── 01_smoke_test.md               # [NEW] Quick prod health check
    └── 02_cross_distribution.md       # [NEW] Cross-package parity
```

#### [NEW] `docs/QA_Acceptance_Test/README.md`

Index file explaining the layered structure, dependency graph, and how to run each layer.

#### Key principle: Capabilities tests are **environment-agnostic**

Each capability test describes what to validate (e.g., "send to whitelisted address succeeds"). The **environments** layer describes how to execute that validation in each agent runtime. This eliminates the current duplication where QA 02, 03, and 12 each have their own "Package Matrix" sections that repeat the same tests.

---

### Layer 3: New Workflow Skills

#### [NEW] `.agent/workflows/qa-setup.md`

Workflow for bootstrapping the QA environment. Invocable via `/qa-setup`.

Steps:
1. Check/install 1Password CLI
2. Run `npm run qa:secrets` to pull credentials
3. Start dev server (`npm run dev`)
4. Attach browser (`/browser-agent`)
5. Sign in as USER_A via Google SSO
6. Navigate to dashboard
7. Create proxy keys and configure email access
8. Link USER_B email via Clerk Connected Accounts
9. Configure test rules (send whitelist, read blacklist)
10. Save snapshot of dashboard state as QA baseline

#### [NEW] `.agent/workflows/qa-claude-code.md`

Workflow for testing Claude Code MCP. Invocable via `/qa-claude-code`.

Steps:
1. Verify dev server is running
2. Create tmux session: `tmux new-session -d -s fgac-claude-qa "claude --dangerously-skip-permissions"`
3. Wait for Claude Code prompt
4. Send `/mcp` → select `fgac-gmail` → Authenticate
5. Extract OAuth URL from `tmux capture-pane`
6. Auto-consent via playwright (navigate + click Allow)
7. Wait for "Authentication successful"
8. Approve connection in dashboard via playwright
9. Test tools: `list_accounts`, `get_my_permissions`, `gmail_list`
10. Capture results and clean up

#### [NEW] `.agent/workflows/qa-capabilities.md`

Workflow for running the capability test suite. Invocable via `/qa-capabilities`.

Steps:
1. Verify QA setup is complete (secrets, server, browser)
2. Run TestClaw automated tests (`bash test/testclaw/run-qa.sh`)
3. Run proxy key scoping tests via curl
4. Run send whitelist tests
5. Run read blacklist tests
6. Aggregate results to `test/testclaw/results/`

#### [NEW] `.agent/workflows/qa-production.md`

Workflow for validating a production deployment. Invocable via `/qa-production`.

Steps:
1. Set BASE_URL to production
2. Run discovery endpoint checks
3. Run OAuth DCR registration
4. Verify MCP tool availability
5. Read-only smoke tests (no send/delete in prod)
6. Report results

---

### Layer 4: Environment-Specific Test Docs

#### [NEW] `docs/QA_Acceptance_Test/environments/02_claude_code_mcp.md`

Complete runbook based on our tmux breakthrough:

```markdown
## Prerequisites
- tmux installed
- Claude Code installed (claude in PATH)
- Dev server running on localhost:3000
- Playwright browser session (for auto-consent + dashboard)
- fgac-gmail configured in .claude.json

## Automated Test
node test/testclaw/qa-claude-code-mcp.js --auto-consent --timeout 120

## Manual Walkthrough
### Phase 1: Auth via tmux
1. tmux new-session -d -s fgac-qa "claude --dangerously-skip-permissions"
2. tmux send-keys -t fgac-qa "/mcp" Enter
3. Select fgac-gmail → Authenticate
4. Open auth URL in browser → Click Allow
5. Verify: "Authentication successful. Connected to fgac-gmail."

### Phase 2: Dashboard Approval
6. Navigate to dashboard → Connections → Approve pending

### Phase 3: Tool Verification
7. tmux send-keys "call list_accounts from fgac-gmail" Enter
   Expected: returns account data
8. tmux send-keys "call gmail_list from fgac-gmail" Enter
   Expected: returns emails OR "no email access" (depending on key config)
```

#### [NEW] `docs/QA_Acceptance_Test/environments/01_hosted_mcp.md`

Consolidation of current QA 11a + QA 12 §1 into a single, complete runbook for HTTP-level MCP testing.

#### [MODIFY] `docs/QA_Acceptance_Test/environments/04_openclaw_skill.md`

Consolidation of current QA 10 (OpenClaw skill) + QA 12 §4.

---

### Layer 5: Deprecation / Migration

#### [MODIFY] Existing files that get consolidated

The following files will get a deprecation notice pointing to their new locations:

| Old File | New Location |
|----------|-------------|
| `01_signup_and_credential_workflow.md` | `setup/01_signup_and_credential.md` |
| `02_gmail_fine_grain_control.md` | `capabilities/01_send_whitelist.md` + `capabilities/02_read_blacklist.md` |
| `03_multi_email_multi_key.md` | `setup/02_multi_account_linking.md` + `capabilities/03_multi_email_scoping.md` |
| `10_openclaw_gmail_fgac_skill.md` | `environments/04_openclaw_skill.md` |
| `11_mcp_connection_flow.md` | `capabilities/06_connection_lifecycle.md` |
| `11a_mcp_server_protocol.md` | `environments/01_hosted_mcp.md` |
| `11b_dashboard_connection_management.md` | `capabilities/06_connection_lifecycle.md` |
| `12_credential_flow_per_package.md` | Split across `environments/` |

Files that remain unchanged (already single-concern):
- `04_email_delegation.md` → `capabilities/04_delegation.md`
- `05_gmail_label_based_access.md` → `capabilities/05_label_access.md`

Files that can be archived:
- `07_waitlist_and_signup_flow.md` (waitlist removed)
- `08_missing_google_scopes.md` (one-time fix)
- `08_strict_light_mode.md` (cosmetic)
- `09_universe_domain_rollback.md` (one-time fix)
- `06_google_verification_compliance.md` (CASA-specific, move to `docs/archive/`)

---

## Verification Plan

### Automated Tests
1. `npm run qa:secrets` successfully populates `.qa_test_emails.json` and `qa-test-agents.json`
2. `bash test/testclaw/run-qa.sh` passes 5/5
3. `node test/testclaw/qa-claude-code-mcp.js --auto-consent --timeout 120` passes
4. All new workflow files are syntactically valid and invocable

### Manual Verification
1. Run `/qa-setup` workflow end-to-end
2. Run `/qa-claude-code` workflow end-to-end
3. Review `docs/QA_Acceptance_Test/README.md` for completeness
4. Verify old test files have deprecation notices pointing to new locations
