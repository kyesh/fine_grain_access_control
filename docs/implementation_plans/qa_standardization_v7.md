# QA Framework Restructure (v4)

## Core Model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              SETUP (Layer 1)                                │
│    Browser agent configures dashboard: users, keys, rules, emails           │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
       ┌───────────────┬───────────┼───────────┬───────────────┐
       │               │           │           │               │
       ▼               ▼           ▼           ▼               │
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Hosted MCP  │ │ Claude Code │ │ Claude Code │ │  OpenClaw   │
│ (curl)      │ │ MCP (tmux)  │ │ CLI (scripts│ │  (Docker)   │
│ Package #1  │ │ Package #3  │ │) Package #4 │ │ Package #2  │
│             │ │             │ │             │ │             │
│ ALL caps ✓  │ │ ALL caps ✓  │ │ ALL caps ✓  │ │ ALL caps ✓  │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       │               │               │               │
       │          LOCAL DEV (Layer 2)                   │
       └───────────────┼───────────────┼───────────────┘
                       │               │
       ┌───────────────┼───────────────┼───────────────┐
       │               │               │               │
       ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Hosted MCP  │ │ CC MCP via  │ │ CC CLI via  │ │ OpenClaw via│
│ via curl    │ │ marketplace │ │ SKILL.md    │ │ ClawHub     │
│ against     │ │ install     │ │ Option B    │ │ install     │
│ fgac.ai     │ │ against     │ │ against     │ │ against     │
│             │ │ fgac.ai     │ │ gmail.fgac  │ │ gmail.fgac  │
│ ALL caps ✓  │ │ ALL caps ✓  │ │ ALL caps ✓  │ │ ALL caps ✓  │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
                  PRODUCTION (Layer 3)
                  Install from REAL distribution channels
```

**4 agent interfaces × all capabilities = full coverage**, at both local dev and production.

Capability docs are shared assertion checklists. Agent docs describe *how* to execute those assertions in that runtime. Production repeats the same matrix but installed from real distribution channels against production URLs.

---

## Resolved Questions

| Question | Decision |
|----------|----------|
| 1Password vault | `FGAC`, `op` v2.34.0 installed, needs desktop app integration |
| Test emails | `USER_A@example.com` (USER_A), `USER_B@example.com` (USER_B) — stored in 1Password |
| Proxy keys | Generated during `/qa-setup` via browser agent |
| DCR agents | Fresh-generated each test run |
| Production writes | Allowed — test email accounts are dedicated for this |
| `08_strict_light_mode.md` | Kept — recurring issue |
| Workflows | Thin pointers to QA docs, never duplicate content |
| OpenClaw testing | Genuine OpenClaw Docker instance, not standalone scripts |
| Production testing | Install via real distribution channels |

---

## BASE_URL Strategy

| Context | URL | Override |
|---------|-----|----------|
| **Dev testing** | `http://localhost:3000` | `FGAC_ROOT_URL=http://localhost:3000` |
| **PR preview** | Vercel preview URL | `FGAC_ROOT_URL=<preview-url>` |
| **Production** | `https://fgac.ai` / `https://gmail.fgac.ai` | None — skills use built-in defaults |

---

## Proposed Changes

### 1. 1Password Secret Management

---

#### [NEW] `.qa_test_emails.json.template`

Committed template with `op://` references (safe to track in git):

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

#### Prerequisites (one-time manual)

1. Enable desktop app integration: 1Password app → Settings → Developer → "Integrate with 1Password CLI"
2. Create vault item: vault `FGAC`, item `test-emails`, fields `user-a` and `user-b`
3. Verify: `op vault list` succeeds

---

### 2. QA Directory Restructure

---

```
docs/QA_Acceptance_Test/
├── README.md                              # [NEW] Index, execution model, dependency graph
│
├── setup/                                 # LAYER 1: Dashboard configuration
│   ├── 01_signup_and_credential.md        # Sign up, link Google, create first key
│   ├── 02_multi_account_linking.md        # Link USER_B, create multi-email keys
│   └── 03_rules_configuration.md          # Send whitelist, read blacklist, deletion rules
│
├── capabilities/                          # SHARED ASSERTIONS (not a standalone workflow)
│   ├── README.md                          # [NEW] "These are assertion checklists, not tests.
│   │                                      #  Execute via an agent interface workflow."
│   ├── 01_send_whitelist.md               # What to verify: allowed send, blocked send
│   ├── 02_read_blacklist.md               # What to verify: content blocking, rule names
│   ├── 03_multi_email_scoping.md          # What to verify: key-to-email isolation
│   ├── 04_delegation.md                   # What to verify: delegated email access
│   ├── 05_label_access.md                 # What to verify: label-based filtering
│   ├── 06_connection_lifecycle.md         # What to verify: pending→approve→block→unblock
│   ├── 07_key_lifecycle.md                # What to verify: revoke, roll, cross-user isolation
│   └── 08_strict_light_mode.md            # What to verify: no dark mode leaks
│
├── agents/                                # LAYER 2: Per-agent test runbooks (local dev)
│   ├── 01_hosted_mcp.md                   # HOW to run all capabilities via curl
│   ├── 02_claude_code_mcp.md              # HOW to run all capabilities via tmux + playwright
│   ├── 03_claude_code_cli.md              # HOW to run all capabilities via local scripts
│   └── 04_openclaw.md                     # HOW to run all capabilities via Docker OpenClaw
│
├── production/                            # LAYER 3: Real distribution channels → prod
│   ├── 00_smoke_test.md                   # Discovery endpoints, 401, basic auth
│   ├── 01_hosted_mcp.md                   # curl against fgac.ai/api/mcp → ALL caps
│   ├── 02_claude_code_mcp.md              # Install from marketplace → ALL caps
│   ├── 03_claude_code_cli.md              # Install from SKILL.md Option B → ALL caps
│   └── 04_openclaw.md                     # Install from ClawHub → ALL caps
│
└── archive/                               # Retired one-time-fix tests
    ├── 07_waitlist_and_signup_flow.md
    ├── 08_missing_google_scopes.md
    ├── 09_universe_domain_rollback.md
    └── 06_google_verification_compliance.md
```

#### How capabilities and agents connect

Each **capability doc** defines assertions only — what to check and what the expected outcome is. Example from `capabilities/01_send_whitelist.md`:

```markdown
## Assertion 1: Send to whitelisted address succeeds
- Send an email to USER_B_EMAIL
- Expected: success, email delivered

## Assertion 2: Send to blocked address returns 403
- Send an email to blocked@evil.com
- Expected: 403 error, message explains whitelist

## Assertion 3: get_my_permissions shows send whitelist rules
- Query permissions
- Expected: send_whitelist rules visible
```

Each **agent doc** references ALL capabilities and describes how to execute them in that runtime. Example from `agents/01_hosted_mcp.md`:

```markdown
## Prerequisites
- /qa-setup completed
- Dev server running
- Fresh DCR client registered + approved

## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### Assertion 1: Send to whitelisted address
curl -s $BASE_URL/api/mcp -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"gmail_send",
       "arguments":{"to":"USER_A@example.com","subject":"QA Test"}},"id":1}'
- [ ] Returns success

### Assertion 2: Send to blocked address
curl ... -d '{"params":{"name":"gmail_send","arguments":{"to":"blocked@evil.com"}}}'
- [ ] Returns 403

## Capability: Read Blacklist (→ capabilities/02_read_blacklist.md)
...

## Capability: Multi-Email Scoping (→ capabilities/03_multi_email_scoping.md)
...
```

The agent doc for Claude Code MCP (`agents/02_claude_code_mcp.md`) runs the same assertions via tmux:

```markdown
## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### Assertion 1: Send to whitelisted address
tmux send-keys -t fgac-qa "Send an email to USER_A@example.com with subject 'QA Test'" Enter
- [ ] Claude Code invokes gmail_send, email sent

### Assertion 2: Send to blocked address
tmux send-keys -t fgac-qa "Send an email to blocked@evil.com" Enter
- [ ] Claude Code reports whitelist error from fgac-gmail
```

And `agents/04_openclaw.md` runs the same via the OpenClaw gateway:

```markdown
## Capability: Send Whitelist (→ capabilities/01_send_whitelist.md)

### Assertion 1: Send to whitelisted address
curl -X POST http://localhost:18789/api/chat \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -d '{"message": "Send an email to USER_A@example.com with subject QA Test"}'
- [ ] OpenClaw invokes gmail-fgac skill, email sent

### Assertion 2: Send to blocked address
curl -X POST http://localhost:18789/api/chat \
  -d '{"message": "Send an email to blocked@evil.com"}'
- [ ] OpenClaw reports whitelist error from skill output
```

---

### 3. Workflow Skills (Thin Pointers)

---

> [!IMPORTANT]
> Each workflow maps 1:1 to a layer. There is no standalone `/qa-capabilities` — capabilities are always executed through a specific agent interface.

#### [NEW] `.agent/workflows/qa-setup.md` — `/qa-setup`

```markdown
---
description: Bootstrap QA environment via browser agent
---
# QA Setup (/qa-setup)

1. Pull secrets: `bash scripts/qa-secrets.sh`
2. Read `.qa_test_emails.json` for USER_A and USER_B
3. Verify dev server running (`curl -sf http://localhost:3000`)
4. Discover and execute ALL setup docs in order:
   `ls docs/QA_Acceptance_Test/setup/*.md | sort`
   For each file, read it and follow its instructions using /browser-agent.
5. Screenshot final dashboard state as proof
```

#### [NEW] `.agent/workflows/qa-hosted-mcp.md` — `/qa-hosted-mcp`

```markdown
---
description: Run all capability tests through the Hosted MCP interface
---
# Hosted MCP QA (/qa-hosted-mcp)

Requires: /qa-setup completed, dev server running.

Read and execute: `docs/QA_Acceptance_Test/agents/01_hosted_mcp.md`

This doc runs ALL capabilities via curl against the MCP endpoint.
Capability assertions are defined in `docs/QA_Acceptance_Test/capabilities/`.
If new capability files are added there, the agent doc must be updated to cover them.
```

#### [NEW] `.agent/workflows/qa-claude-code.md` — `/qa-claude-code`

```markdown
---
description: Run all capability tests through Claude Code MCP via tmux
---
# Claude Code MCP QA (/qa-claude-code)

Requires: /qa-setup completed, dev server running, tmux + playwright available.

Read and execute: `docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md`

This doc runs ALL capabilities from `capabilities/` via tmux + playwright.
```

#### [NEW] `.agent/workflows/qa-claude-code-cli.md` — `/qa-claude-code-cli`

```markdown
---
description: Run all capability tests through Claude Code CLI local scripts
---
# Claude Code CLI QA (/qa-claude-code-cli)

Requires: /qa-setup completed, dev server running.

Read and execute: `docs/QA_Acceptance_Test/agents/03_claude_code_cli.md`

This doc runs ALL capabilities from `capabilities/` via local scripts
(auth.js, gmail.js) — the same scripts shared with the OpenClaw skill.
```

#### [NEW] `.agent/workflows/qa-openclaw.md` — `/qa-openclaw`

```markdown
---
description: Run all capability tests through a genuine OpenClaw Docker instance
---
# OpenClaw QA (/qa-openclaw)

Requires: /qa-setup completed, dev server running, Docker available.

Read and execute: `docs/QA_Acceptance_Test/agents/04_openclaw.md`

This doc starts a real OpenClaw container and runs ALL capabilities
through the gateway API — not standalone scripts.
```

#### [NEW] `.agent/workflows/qa-production.md` — `/qa-production`

```markdown
---
description: Validate production via real distribution channels (all 4 agents)
---
# Production QA (/qa-production)

Requires: Production deployment live at fgac.ai.

Discover and execute ALL production docs in order:
`ls docs/QA_Acceptance_Test/production/*.md | sort`

For each file, read it and follow its instructions.
The 00_ file is the smoke test; 01_-04_ are per-agent channel tests.
Each agent doc installs from the real distribution channel,
then runs ALL capabilities against production URLs.
```

---

### 4. OpenClaw: Genuine Agent Testing

---

> [!WARNING]
> Current `run-qa.sh` runs `node gmail.js` directly — this doesn't test OpenClaw at all. It only tests the script in isolation.

#### [MODIFY] [run-qa.sh](file:///home/kyesh/GitRepos/fine_grain_access_control/test/testclaw/run-qa.sh)

Rewrite to start the OpenClaw gateway and send prompts through it:

1. Start gateway: `node dist/index.js gateway --port 18789 --bind lan &`
2. Wait for health: `curl -sf http://localhost:18789/health`
3. Test via gateway API:
   ```bash
   # Natural language prompt → skill invocation → verify output
   curl -X POST http://localhost:18789/api/chat \
     -H "Authorization: Bearer $GATEWAY_TOKEN" \
     -d '{"message": "List my recent emails using gmail-fgac"}'
   ```
4. Validate the response contains actual skill output (not just an echo)

#### [MODIFY] [docker-compose.yml](file:///home/kyesh/GitRepos/fine_grain_access_control/test/testclaw/docker-compose.yml)

Ensure entrypoint starts the OpenClaw gateway, not just runs scripts.

#### [MODIFY] [qa-claude-code-mcp.js](file:///home/kyesh/GitRepos/fine_grain_access_control/test/testclaw/qa-claude-code-mcp.js)

Load test emails dynamically from `.qa_test_emails.json` instead of hardcoding `spike-test@example.com`.

---

### 5. Production: Real Distribution Channels

---

#### Production docs mirror the agent structure

Each production doc handles one distribution channel:

| Doc | Channel | Install Method | Target URL |
|-----|---------|---------------|------------|
| `production/01_hosted_mcp.md` | Direct HTTP | `curl` against `fgac.ai/api/mcp` | `fgac.ai` |
| `production/02_claude_code_mcp.md` | Plugin Marketplace | `/plugin marketplace browse` → "fgac" | `fgac.ai/api/mcp` |
| `production/03_claude_code_cli.md` | SKILL.md Option B | Copy scripts per instructions | `gmail.fgac.ai` |
| `production/04_openclaw.md` | ClawHub | `clawhub skill install gmail-fgac` | `gmail.fgac.ai` |

Each doc: install from channel → run ALL capabilities against production URLs (no override).

---

### 6. Migration from Current Files

---

| Old File | New Location | Notes |
|----------|-------------|-------|
| `01_signup_and_credential_workflow.md` | `setup/01_signup_and_credential.md` | Move |
| `02_gmail_fine_grain_control.md` §1 | `capabilities/01_send_whitelist.md` | Extract assertions |
| `02_gmail_fine_grain_control.md` §2-3 | `capabilities/02_read_blacklist.md` | Extract assertions |
| `02_gmail_fine_grain_control.md` §5-7 | `agents/01_hosted_mcp.md` | Merge into agent doc |
| `03_multi_email_multi_key.md` §1 | `setup/02_multi_account_linking.md` | Extract setup steps |
| `03_multi_email_multi_key.md` §3-6 | `capabilities/03_multi_email_scoping.md` | Extract assertions |
| `03_multi_email_multi_key.md` §7-8 | `capabilities/07_key_lifecycle.md` | Extract assertions |
| `03_multi_email_multi_key.md` §10-13 | Split across `agents/` docs | Each agent runs these |
| `04_email_delegation.md` | `capabilities/04_delegation.md` | Move |
| `05_gmail_label_based_access.md` | `capabilities/05_label_access.md` | Move |
| `08_strict_light_mode.md` | `capabilities/08_strict_light_mode.md` | Move (keep!) |
| `10_openclaw_gmail_fgac_skill.md` | `agents/04_openclaw.md` | Rewrite for gateway |
| `11_mcp_connection_flow.md` | `capabilities/06_connection_lifecycle.md` | Merge |
| `11a_mcp_server_protocol.md` | `agents/01_hosted_mcp.md` | Merge |
| `11b_dashboard_connection_management.md` | `capabilities/06_connection_lifecycle.md` | Merge |
| `12_credential_flow_per_package.md` | Split across `agents/` docs | Each agent gets its auth section |
| `06_google_verification_compliance.md` | `archive/` | CASA-specific |
| `07_waitlist_and_signup_flow.md` | `archive/` | Waitlist removed |
| `08_missing_google_scopes.md` | `archive/` | One-time fix |
| `09_universe_domain_rollback.md` | `archive/` | One-time fix |

---

## File Summary

| Action | File | Description |
|--------|------|-------------|
| **NEW** | `scripts/qa-secrets.sh` | 1Password → local files |
| **NEW** | `.qa_test_emails.json.template` | `op://` reference template |
| **NEW** | `.agent/workflows/qa-setup.md` | Pointer → `setup/` docs |
| **NEW** | `.agent/workflows/qa-hosted-mcp.md` | Pointer → `agents/01_hosted_mcp.md` |
| **NEW** | `.agent/workflows/qa-claude-code.md` | Pointer → `agents/02_claude_code_mcp.md` |
| **NEW** | `.agent/workflows/qa-claude-code-cli.md` | Pointer → `agents/03_claude_code_cli.md` |
| **NEW** | `.agent/workflows/qa-openclaw.md` | Pointer → `agents/04_openclaw.md` |
| **NEW** | `.agent/workflows/qa-production.md` | Pointer → `production/` docs (all 4 agents) |
| **NEW** | `docs/QA_Acceptance_Test/README.md` | Index with execution model diagram |
| **NEW** | `docs/QA_Acceptance_Test/setup/` (3 files) | Dashboard config via browser agent |
| **NEW** | `docs/QA_Acceptance_Test/capabilities/` (8 + README) | Shared assertion checklists |
| **NEW** | `docs/QA_Acceptance_Test/agents/` (4 files) | Per-agent runbooks, each runs ALL capabilities |
| **NEW** | `docs/QA_Acceptance_Test/production/` (5 files) | Smoke + 4 per-agent channel install + verify |
| **MOVE** | `docs/QA_Acceptance_Test/archive/` (4 files) | Retired tests |
| **MODIFY** | `test/testclaw/run-qa.sh` | Route through OpenClaw gateway |
| **MODIFY** | `test/testclaw/docker-compose.yml` | Start gateway in entrypoint |
| **MODIFY** | `test/testclaw/qa-claude-code-mcp.js` | Load emails from config |
| **MODIFY** | `package.json` | Add `qa:secrets` |

---

## Verification Plan

### Step 1: 1Password & Secrets
- `op vault list` shows the `FGAC` vault
- `bash scripts/qa-secrets.sh` populates `.qa_test_emails.json` with real emails
- Verify `.qa_test_emails.json` is NOT the example file (contains real addresses, not `user_a@example.com`)

### Step 2: Agent Authenticity Checks

> [!IMPORTANT]
> Each agent test MUST prove the **real runtime** processed the request, not just that a standalone script returned the right output. The following evidence is required:

| Agent | How to prove it's real (not faked) |
|-------|-----------------------------------|
| **Hosted MCP** | HTTP response headers include `x-mcp-session-id`. Request goes through full OAuth DCR → token → MCP endpoint chain. Raw `curl` output captured as proof. |
| **Claude Code MCP** | `tmux capture-pane` output shows Claude Code's TUI rendering the tool call and response. Screenshot of the Claude Code session showing the fgac-gmail tool invocation — not just a `claude -p` one-liner. |
| **Claude Code CLI** | `claude` interactive session (via tmux) invokes the local scripts — verified by checking that Claude's TUI shows the script execution, not a direct `node gmail.js` call from the test harness. |
| **OpenClaw** | Docker container logs (`docker logs testclaw-testclaw-1`) show the OpenClaw gateway receiving the chat prompt, discovering the `gmail-fgac` skill, and invoking it. The test sends prompts to the gateway API (`localhost:18789/api/chat`), NOT directly to `node gmail.js`. |

For each agent, the test doc must include a **"Proof of Authenticity"** section that captures this evidence.

### Step 3: Full QA Matrix Execution

Run every workflow and record results in a matrix:

| Capability | Hosted MCP | CC MCP | CC CLI | OpenClaw | Notes |
|-----------|:---:|:---:|:---:|:---:|-------|
| Send whitelist (allowed) | | | | | |
| Send whitelist (blocked) | | | | | |
| Read blacklist (blocked) | | | | | |
| Read blacklist (quick-add rules) | | | | | |
| Multi-email: key-A accesses email-A | | | | | |
| Multi-email: key-A blocked from email-B | | | | | |
| Multi-email: power key accesses both | | | | | |
| Delegation | | | | | |
| Label-based access | | | | | |
| Connection: pending → approve | | | | | |
| Connection: block → rejected | | | | | |
| Connection: unblock → restored | | | | | |
| Key revocation | | | | | |
| Key rolling | | | | | |
| Cross-user isolation | | | | | |
| Strict light mode | | | | | |

Each cell gets: ✅ (pass), ❌ (fail + issue), ⏭️ (not applicable to this agent), 🔲 (not yet run)

### Step 4: Issue Tracker

During execution, document every issue encountered:

```markdown
## QA Issues Log

### Issue 1: [Title]
- **Agent**: Which agent environment
- **Capability**: Which capability test
- **Severity**: Blocker / Major / Minor
- **Description**: What happened
- **Expected**: What should have happened
- **Root Cause**: If identified
- **Resolution**: Fix applied or ticket created
```

Save this to `test/testclaw/results/qa-issues.md` after each run.

### Step 5: Production Verification

Repeat the matrix from Step 3 but against production URLs:
- Each agent installs from its real distribution channel (not local files)
- No `FGAC_ROOT_URL` override — skills use built-in production URLs
- Document any differences between local and production results

| Agent | Distribution Channel | Install OK | Auth OK | All Caps | Notes |
|-------|---------------------|:---:|:---:|:---:|-------|
| Hosted MCP | Direct curl | | | | |
| CC MCP | Plugin marketplace | | | | |
| CC CLI | SKILL.md Option B | | | | |
| OpenClaw | ClawHub | | | | |
