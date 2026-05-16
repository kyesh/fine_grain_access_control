# QA Test Restructuring & Coverage Expansion

## Problem Statement

Our QA tests were written over time as features shipped, resulting in:
1. **Endpoint-siloed tests** — tests only exercise the REST proxy (`gmail.fgac.ai`), leaving MCP and OpenClaw skill untested for core features
2. **No cross-endpoint validation** — email delegation, multi-key isolation, and access rules are only tested via one surface
3. **Browser-agent not used** — Chrome remote debugging was available but wasn't invoked, leaving all dashboard UI tests unverified
4. **No containerized OpenClaw test environment** — OpenClaw tests require manual setup

---

## Open Questions

> [!IMPORTANT]
> **Test organization: Feature-first vs Endpoint-first?**
>
> **Recommendation: Feature-first with an endpoint matrix in each test.**
>
> Rationale: Core security behaviors (send whitelist, read blacklist, delegation, multi-email isolation) are the _invariants_ that must hold regardless of which endpoint the agent uses. Grouping by feature and testing across all endpoints within each test ensures:
> - Every new endpoint automatically inherits the full test suite
> - Feature regressions are caught across all surfaces simultaneously
> - Test files map 1:1 to security properties users care about
>
> The alternative (endpoint-first: one giant QA per plugin) creates duplicate test logic and makes it easy to forget to add a new feature test to each endpoint file.

> [!IMPORTANT]
> **MCP vs Dashboard separation?**
> Per your comment, I recommend splitting QA 11 into:
> - **11a: MCP Server Protocol Tests** (discovery, 401, tool execution, SSE)
> - **11b: Dashboard Connection Management** (approve, block, nickname, UI states)

---

## Current Coverage Audit

### Feature × Endpoint Matrix

| Feature | REST Proxy | MCP Server | Claude Code Skill | OpenClaw Skill | Dashboard UI |
|---------|:----------:|:----------:|:-----------------:|:--------------:|:------------:|
| Signup & credentials | QA 01 | — | — | — | QA 01 |
| **OAuth/credential flow** | QA 01 | — | ❌ **MISSING** | ❌ **MISSING** | — |
| Send whitelist | QA 02 | — | ❌ **MISSING** | QA 10 | QA 02 |
| Read blacklist | QA 02 | — | ❌ **MISSING** | QA 10 | QA 02 |
| Deletion controls | QA 02 | — | — | — | QA 02 |
| Multi-email isolation | QA 03 | — | ❌ **MISSING** | — | QA 03 |
| Global vs key-specific rules | QA 03 | — | — | — | QA 03 |
| Key revocation/rolling | QA 03 | — | — | — | QA 03 |
| Email delegation | QA 04 | — | ❌ **MISSING** | — | QA 04 |
| Label-based access | QA 05 | — | — | — | — |
| Google verification | QA 06 | — | — | — | — |
| Waitlist removal | — | — | — | — | QA 07 |
| Missing scopes | — | — | — | — | QA 08a |
| Light mode | — | — | — | — | QA 08b |
| Universe domain | QA 09 | — | — | QA 09 | — |
| OpenClaw skill e2e | — | — | — | QA 10 | — |
| MCP connection flow | — | QA 11 | — | — | QA 11 |
| MCP pending approval | — | QA 11 | — | — | — |
| **Claude Code skill e2e** | — | — | ❌ **MISSING** | — | — |
| **Skill install + auth flow** | — | — | ❌ **MISSING** | ❌ **MISSING** | — |

### Key Gaps (❌ = missing, should exist)

| Gap | Impact | Priority |
|-----|--------|----------|
| **Claude Code skill — no test at all** | Entire distribution channel untested | 🔴 Critical |
| **OAuth credential flow per skill** | Don't know if install → auth → tools actually works | 🔴 Critical |
| **Send whitelist via MCP/Claude Code** | Agent could bypass restrictions | 🔴 High |
| **Read blacklist via MCP/Claude Code** | Agent could read sensitive emails | 🔴 High |
| **Multi-email via MCP/Claude Code** | `list_accounts` + `account` param untested e2e | 🔴 High |
| **Email delegation via MCP/Claude Code** | Delegated email token resolution untested | 🟡 Medium |
| **Dashboard connection approve/block/nickname** | Never run via browser-agent | 🟡 Medium |
| **OpenClaw skill delegation** | Only tested via REST proxy | 🟡 Medium |
| **OpenClaw skill install + token setup** | Only tested manually, no QA script | 🟡 Medium |
| **Deletion controls via MCP** | Not implemented in MCP tools yet | 🟢 Low (future) |

---

## Proposed Changes

### Strategy: Add Endpoint Matrix Sections to Existing Feature Tests

Rather than creating new files, we add **"Endpoint Matrix"** sections to each existing feature test. This keeps the security property as the organizing principle while ensuring every endpoint is covered.

---

### [MODIFY] [02_gmail_fine_grain_control.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/02_gmail_fine_grain_control.md)
Add sections:
- **Section 5: MCP Endpoint** — Test send whitelist and read blacklist via `gmail_send` and `gmail_read` MCP tools
- **Section 6: OpenClaw Skill** — Test same features via `node scripts/gmail.js --action send` and `--action read`
- Each section references the same rules configured in Section 1-3 (dashboard setup is shared)

---

### [MODIFY] [03_multi_email_multi_key.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/03_multi_email_multi_key.md)
Add sections:
- **Section 10: MCP Multi-Email** — Test `list_accounts` returns correct scoping, `gmail_list` with `account` param respects key boundaries
- **Section 11: MCP Agent Isolation** — Two MCP agents with different proxy keys see different email sets
- **Section 12: OpenClaw Multi-Account** — Test `node scripts/gmail.js --account <label>` across keys

---

### [MODIFY] [04_email_delegation.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/04_email_delegation.md)
Add sections:
- **Section 11: MCP Delegation** — Test that an MCP agent approved with a key that includes delegated email can access delegated inbox via `gmail_list --account delegated@email.com`
- **Section 12: Claude Code Delegation** — Same flow but invoked via Claude Code after `claude mcp add`
- **Section 13: OpenClaw Delegation** — Same test via `node scripts/gmail.js --account <delegated-label>`

---

### [SPLIT] [11_mcp_connection_flow.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/11_mcp_connection_flow.md)
Split into:

#### [NEW] 11a_mcp_server_protocol.md
- Test 1: Discovery endpoints (OAuth metadata)
- Test 2: Protected resource metadata
- Test 3: Unauthenticated 401
- Test 4: Tool listing
- Test 5: Approved agent tool execution
- Test 6: get_my_permissions
- Test 7: Blocked agent rejection

#### [NEW] 11b_dashboard_connection_management.md
- Test 1: Pending connection appears after first MCP call
- Test 2: Approve with proxy key selector
- Test 3: Block a connection
- Test 4: Nickname editing (inline)
- Test 5: Unblock a blocked connection
- Test 6: Two agents, different keys — dashboard shows both
- **All tests use `/browser-agent` workflow**

---

### [NEW] 12_credential_flow_per_channel.md

This is the **missing critical test** — validates that each distribution channel's auth/credential setup actually works end-to-end. Each section is a complete install → auth → first-tool-call flow.

#### Section 1: REST Proxy (API Key)
1. Create proxy key in dashboard (`sk_proxy_...`)
2. Set `FGAC_PROXY_KEY` env var
3. `curl -H "Authorization: Bearer $FGAC_PROXY_KEY" https://gmail.fgac.ai/gmail/v1/users/me/messages`
4. **Verify:** 200 OK with message list

#### Section 2: MCP Server (OAuth via DCR)
1. Register DCR client: `POST /.well-known/oauth-authorization-server` → `registration_endpoint`
2. Build authorization URL with `client_id`, `redirect_uri`, PKCE `code_verifier`
3. User completes consent in browser
4. Exchange code for token at `token_endpoint`
5. Call `tools/call` with `list_accounts`
6. **Verify:** Returns pending approval message with dashboard link
7. Approve in dashboard
8. Retry `list_accounts`
9. **Verify:** Returns accessible email accounts

#### Section 3: Claude Code Skill (MCP via `claude mcp add`)
1. Run: `claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp`
2. Open Claude Code, invoke: "List my email accounts using fgac-gmail"
3. **Verify:** Claude Code opens browser for Clerk OAuth consent
4. Complete consent
5. **Verify:** First tool call returns "⚠️ Pending approval" with dashboard link
6. Visit dashboard, approve connection, assign proxy key
7. Re-invoke: "List my email accounts using fgac-gmail"
8. **Verify:** Returns email list
9. Invoke: "Read my latest email" → **Verify:** Returns email content
10. Invoke: "Send a test email to allowed@example.com" → **Verify:** Succeeds if whitelisted, blocked if not

> [!IMPORTANT]
> This is the only test that validates the Claude Code SKILL.md actually works when followed. Without it, we're shipping a skill we've never installed ourselves.

#### Section 4: OpenClaw Skill (Token File)
1. Copy `gmail-fgac` skill to `~/.openclaw/skills/gmail-fgac/`
2. Create token file: `~/.openclaw/gmail-fgac/tokens/test.json` with `proxyKey` and `proxyEndpoint`
3. Run: `node scripts/gmail.js --account test --action list`
4. **Verify:** Returns email list via proxy
5. Run: `node scripts/gmail.js --account test --action send --to allowed@example.com --subject "Test" --body "Hello"`
6. **Verify:** Send succeeds or blocked by whitelist (both valid outcomes)

#### Section 5: OAuth Token Refresh
1. After Section 2 or 3 completes, wait for token to approach expiration (or simulate with short-lived token)
2. Make another tool call
3. **Verify:** The client uses the refresh token to get a new access token transparently
4. **Verify:** No re-consent required

---

### [NEW] 13_claude_code_skill_e2e.md

Dedicated end-to-end test for the Claude Code distribution channel, analogous to QA 10 for OpenClaw.

#### Prerequisites
- Claude Code CLI installed (`claude` command available)
- Chrome with remote debugging for dashboard approval steps
- Dev server running or preview URL available

#### Test 1: Skill Installation
1. `claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp`
2. `claude mcp list` → **Verify:** `fgac-gmail` appears with status

#### Test 2: First Connection — Pending Approval
1. In Claude Code: "Use fgac-gmail to list my email accounts"
2. **Verify:** OAuth browser flow triggers (Clerk consent)
3. Complete consent
4. **Verify:** Tool response contains "⚠️ This connection has not been approved yet"
5. **Verify:** Response includes dashboard URL

#### Test 3: Dashboard Approval (via `/browser-agent`)
1. Navigate to dashboard connections tab
2. **Verify:** New pending connection visible with Claude Code's client name
3. Assign nickname + proxy key
4. Click Approve
5. **Verify:** Connection moves to Approved section

#### Test 4: Core Tool Validation
1. `list_accounts` → **Verify:** Returns mapped emails
2. `gmail_list` → **Verify:** Returns recent messages
3. `gmail_read --messageId <id>` → **Verify:** Returns message content
4. `gmail_labels` → **Verify:** Returns labels
5. `get_my_permissions` → **Verify:** Returns rules + key info

#### Test 5: Access Rule Enforcement
1. Configure a send whitelist rule in dashboard
2. `gmail_send --to allowed@example.com` → **Verify:** Succeeds
3. `gmail_send --to blocked@evil.com` → **Verify:** Blocked with whitelist message
4. Configure a read blacklist rule
5. `gmail_read` on blocked content → **Verify:** Blocked with rule name

#### Test 6: Multi-Email via Claude Code
1. Map two emails to the proxy key
2. `list_accounts` → **Verify:** Shows both emails
3. `gmail_list --account second@email.com` → **Verify:** Returns that inbox
4. `gmail_list --account unauthorized@email.com` → **Verify:** Access denied

#### Test 7: Revoke and Re-approve
1. Block the connection in dashboard
2. Any tool call → **Verify:** "🚫 This connection has been blocked"
3. Unblock in dashboard
4. Tool call → **Verify:** Works again

#### Test 8: Skill Removal
1. `claude mcp remove fgac-gmail`
2. `claude mcp list` → **Verify:** `fgac-gmail` no longer present

---

### [NEW] TestClaw Docker Environment

#### Directory: `test/testclaw/`

Based on the DemoClaw pattern, create a containerized OpenClaw instance for automated testing:

```
test/testclaw/
├── docker-compose.yml     # OpenClaw + FGAC proxy network
├── Dockerfile             # OpenClaw with gmail-fgac skill pre-installed
├── entrypoint.sh          # Start gateway + install skill
├── .env.example           # Template for test credentials
├── skills/
│   └── gmail-fgac/        # Symlink/copy of docs/skills/gmail-fgac/
└── run-qa.sh              # Orchestrator script for QA 10
```

**Key differences from DemoClaw:**
- No Tailscale (runs locally, not exposed)
- No GOG CLI (not needed for FGAC testing)
- Pre-provisions proxy key token file
- Can target local dev server or preview URL
- `run-qa.sh` executes OpenClaw skill commands and validates outputs

---

## Browser-Agent Gap Analysis

> [!WARNING]
> **Why browser-agent was not used during Phase 2/3 execution:**
>
> I did not invoke the `/browser-agent` workflow despite Chrome being available on port 9222. This was an oversight — I defaulted to curl-based API testing and did not attempt browser-based dashboard validation.
>
> **Root cause:** The deploy-pr-preview workflow says "you MUST launch a browser_subagent mission" but the Phase 2/3 execution was done in a standalone testing pass, not during the deploy workflow. There was no explicit checkpoint in the task.md that said "run browser-agent for dashboard tests."

### Fix: Add Browser-Agent Checkpoints

#### [MODIFY] [task.md template]
For any task that modifies dashboard UI, the task tracker must include:
```markdown
- [ ] **Browser validation** — run `/browser-agent` against preview URL
  - [ ] Navigate to dashboard
  - [ ] Screenshot connections panel
  - [ ] Test approve/block flow
```

#### [MODIFY] [11b_dashboard_connection_management.md]
Each test case will include explicit browser-agent commands:
```bash
# Step 1: Attach to Chrome
npx @playwright/cli attach --cdp=http://localhost:9222 -s=qa_connections

# Step 2: Navigate
npx @playwright/cli -s=qa_connections goto http://localhost:3000/dashboard

# Step 3: Snapshot and identify elements
npx @playwright/cli -s=qa_connections snapshot

# Step 4: Interact (approve, block, etc.)
npx @playwright/cli -s=qa_connections click e<ref>

# Step 5: Screenshot proof
npx @playwright/cli -s=qa_connections screenshot qa_11b_test1.png
```

---

## Verification Plan

### Automated
1. `npm run build` — ensure all code compiles
2. Run QA 11a tests via curl (already proven)
3. Run QA 11b tests via browser-agent
4. Run QA 02 MCP sections via curl
5. Build TestClaw container: `docker compose -f test/testclaw/docker-compose.yml up`

### Manual
- User reviews restructured QA test files
- User runs `/deploy-pr-preview` and validates preview

---

## Implementation Order

1. **QA 12: Credential flow per channel** — write and validate (🔴 Critical, blocks everything)
2. **QA 13: Claude Code skill e2e** — write and run Tests 1-4 (🔴 Critical)
3. Split QA 11 → 11a + 11b (unblocks browser testing)
4. Run browser-agent for 11b + 13-Test3 against current preview (dashboard validation)
5. Add MCP + Claude Code sections to QA 02, 03, 04 (high-priority coverage)
6. Create TestClaw Docker scaffolding
7. Add OpenClaw sections to QA 02, 03, 04 (requires TestClaw)
