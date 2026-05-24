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

| Feature | REST Proxy | MCP Server | OpenClaw Skill | Dashboard UI |
|---------|:----------:|:----------:|:--------------:|:------------:|
| Signup & credentials | QA 01 | — | — | QA 01 |
| Send whitelist | QA 02 | — | QA 10 | QA 02 |
| Read blacklist | QA 02 | — | QA 10 | QA 02 |
| Deletion controls | QA 02 | — | — | QA 02 |
| Multi-email isolation | QA 03 | — | — | QA 03 |
| Global vs key-specific rules | QA 03 | — | — | QA 03 |
| Key revocation/rolling | QA 03 | — | — | QA 03 |
| Email delegation | QA 04 | — | — | QA 04 |
| Label-based access | QA 05 | — | — | — |
| Google verification | QA 06 | — | — | — |
| Waitlist removal | — | — | — | QA 07 |
| Missing scopes | — | — | — | QA 08a |
| Light mode | — | — | — | QA 08b |
| Universe domain | QA 09 | — | QA 09 | — |
| OpenClaw skill e2e | — | — | QA 10 | — |
| MCP connection flow | — | QA 11 | — | QA 11 |
| MCP pending approval | — | QA 11 | — | — |

### Key Gaps (❌ = missing, should exist)

| Gap | Impact | Priority |
|-----|--------|----------|
| **Send whitelist via MCP** | Agent could bypass restrictions | 🔴 High |
| **Read blacklist via MCP** | Agent could read sensitive emails | 🔴 High |
| **Multi-email via MCP** | `list_accounts` + `account` param untested e2e | 🔴 High |
| **Email delegation via MCP** | Delegated email token resolution untested | 🟡 Medium |
| **Dashboard connection approve/block/nickname** | Never run via browser-agent | 🟡 Medium |
| **OpenClaw skill delegation** | Only tested via REST proxy | 🟡 Medium |
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
- **Section 12: OpenClaw Delegation** — Same test via `node scripts/gmail.js --account <delegated-label>`

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

1. Split QA 11 → 11a + 11b (immediate, unblocks browser testing)
2. Run browser-agent for 11b against current preview (validate dashboard)
3. Add MCP sections to QA 02, 03, 04 (high-priority coverage gaps)
4. Create TestClaw Docker scaffolding
5. Add OpenClaw sections to QA 02, 03, 04 (requires TestClaw)
