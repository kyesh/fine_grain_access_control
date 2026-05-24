# FGAC.ai Skill Distribution — Mega Plan

> Consolidated plan across all phases. References [distribution_architecture.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/distribution_architecture.md) for the canonical 4-package model.

---

## Distribution Packages (Reference)

| # | Package | Auth | Status |
|---|---------|------|--------|
| 1 | Hosted MCP Server | OAuth (Clerk DCR → Pending Approval) | ✅ Built |
| 2 | OpenClaw Skill | OAuth in local scripts | ⚠️ Scripts exist but auth is **Google BYOK, NOT FGAC OAuth** |
| 3 | Claude Code MCP Plugin | OAuth (via hosted MCP) | ✅ Built (`claude mcp add`) |
| 4 | Claude Code CLI Plugin | OAuth in local scripts (shared w/ #2) | ❌ Not started |

---

## Phase 0: Clerk MCP OAuth Spike ✅ COMPLETE

Validated DCR, OAuth token issuance (auth code + PKCE), token verification, and scope limitations. Full results in [spike docs](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/spike_results/clerk-mcp-oauth.md).

**Key constraints discovered:** No custom token claims, no consent customization, `offline_access` auto-granted, refresh tokens never expire, access tokens last 24h.

---

## Phase 0.5: Pending Approval Spike ✅ COMPLETE

Validated deny-by-default pattern: agent authenticates → pending record created → user approves in dashboard → proxy key assigned. Tested with two distinct DCR clients (Claude-Code-Agent, Third-Party-Bot).

**Architecture decision:** Agent must NEVER control its own permissions. `select_profile` tool approach was rejected.

---

## Phase 1: Auth Flow & Waitlist Removal ✅ COMPLETE

- Landing page CTAs changed from "Join Waitlist" → "Get Started"
- `/waitlist` route redirects to `/dashboard`
- CASA Tier 2 docs archived to `docs/archive/casa-tier-2/`
- QA Test 07 rewritten for waitlist removal validation
- Browser-agent workflow updated with explicit steps

**Branch:** `feature/auth-flow-cleanup` (merged into `feature/skill-distribution-packaging`)

---

## Phase 2: MCP Server + Pending Approval Dashboard

### 2A: Schema ✅ COMPLETE
`agent_connections` table exists with FK constraints to users and proxyKeys.

### 2B: MCP Server ✅ COMPLETE
Production MCP server at [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/mcp/route.ts) with:
- 6 tools: `list_accounts`, `gmail_list`, `gmail_read`, `gmail_send`, `gmail_labels`, `get_my_permissions`
- Multi-email via `account` param + `key_email_access` resolution
- Delegated email token resolution (fetches owner's Clerk Google token)
- Send whitelist + read blacklist enforcement
- Pending approval flow with dashboard deep link

### 2C: Dashboard Connections Panel ✅ COMPLETE
[ConnectionsPanel.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/ConnectionsPanel.tsx) with:
- Pending/approved/blocked connection views
- Approve with proxy key selector, block, nickname editing
- Subtle pulse animation on pending cards

### 2D: Post-Auth Browser Redirect ⚠️ PARTIAL
OAuth callback page exists at `src/app/oauth/callback/` but explicit redirect to dashboard connections tab with `?highlight=conn_id` has not been fully validated.

### 2E: CLI OAuth ❌ NOT STARTED
`packages/fgac-cli/` does not exist. The `npx fgac auth login` flow (standalone OAuth client with local token storage at `~/.fgac/credentials.json`) has not been built.

> [!WARNING]
> Phase 2E is the CLI-only auth path where **we** are the OAuth client. It must store + refresh tokens locally. This is distinct from #2/#4 scripts which use FGAC OAuth through the REST proxy.

### 2F: Spike Cleanup ❌ NOT DONE
`src/app/api/spike/mcp/route.ts` still exists. Should be deleted now that production route is verified.

---

## Phase 3: Skill Packaging & Distribution

### 3A: Claude Code MCP Plugin ✅ COMPLETE
[SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md) updated with:
- Option A: MCP Server (`claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/api/mcp`)
- Option B: API Key Mode (for CLI users — BUT scripts not yet implemented for CC CLI)

> [!WARNING]
> **SKILL.md Option B references scripts that don't exist yet for Claude Code CLI.** The current Python example uses `FGAC_PROXY_KEY` env var (API key mode), not the planned OAuth-in-scripts flow. This needs to be updated when CC CLI scripts are built (Phase 3E).

### 3B: OpenClaw Skill ⚠️ PARTIALLY COMPLETE
[SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/SKILL.md) updated to v2.0.0 with ClawHub frontmatter.

**BUT:** The scripts still use **Google BYOK OAuth** (Google `client_id`/`client_secret` in `auth.js`), NOT the planned FGAC OAuth flow. The auth flow currently:
1. Uses Google OAuth directly (not through FGAC)
2. Saves raw Google tokens (not FGAC-proxied tokens)
3. Does NOT go through pending approval
4. Does NOT get a proxy key assignment

**What needs to happen:**
- Rewrite `auth.js` to use FGAC/Clerk OAuth instead of direct Google OAuth
- Token exchange goes through our server, creating an agent connection
- Pending approval flow applies (same as MCP)
- Proxy key resolves server-side from the OAuth identity
- Scripts use proxy key via REST proxy API (same `gmail.fgac.ai` endpoint)

### 3C: CLI Distribution ❌ NOT STARTED
`@fgac/cli` npm package does not exist. Depends on Phase 2E.

### 3D: Documentation ✅ COMPLETE
- [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md) updated with MCP server section
- [distribution_architecture.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/distribution_architecture.md) — NEW canonical reference for 4-package model

### 3E: Claude Code CLI Plugin ❌ NOT STARTED
Shares scripts with OpenClaw (#2). Blocked by OpenClaw script rewrite (3B).

**What needs to happen:**
- Once OpenClaw scripts are rewritten for FGAC OAuth, package them for Claude Code CLI
- SKILL.md Option B updated with working script instructions
- Scripts installed alongside Claude Code (e.g., in workspace `.fgac/` directory)

---

## Phase 4: QA — Test Restructuring & Execution

### 4A: Permanent Architecture Documentation ✅ COMPLETE
Created [distribution_architecture.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/distribution_architecture.md) — canonical reference for the 4-package model, preventing the confusion that occurred in this session.

### 4B: QA Test 11 Split ❌ NOT DONE
Split current [11_mcp_connection_flow.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/11_mcp_connection_flow.md) into:

- **11a_mcp_server_protocol.md** — Discovery, 401, tool listing, execution, permissions, blocked rejection
- **11b_dashboard_connection_management.md** — Pending appears, approve, block, nickname edit, unblock (all via `/browser-agent`)

### 4C: QA Test 12 — Credential Flow Per Package ❌ NOT DONE
New test: [12_credential_flow_per_package.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/12_credential_flow_per_package.md)

Tests install → auth → first-tool-call for each package:
- §1: Hosted MCP Server (DCR → OAuth → pending → approve → tool call)
- §2: Claude Code MCP (`claude mcp add` → OAuth → pending → approve → tool call)
- §3: Claude Code CLI (scripts → OAuth → token saved → `gmail.js --action list`)
- §4: OpenClaw Skill (scripts → OAuth → token saved → agent invokes skill)
- §5: OAuth token refresh (access token expires → refresh works transparently)

> [!IMPORTANT]
> §3 and §4 are **blocked** by Phase 3B (OpenClaw script rewrite) and Phase 3E (CC CLI scripts).

### 4D: Add Package-Matrix Sections to Feature Tests ❌ NOT DONE

Add sections to existing feature tests so each security property is tested across all packages:

#### [02_gmail_fine_grain_control.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/02_gmail_fine_grain_control.md)
- §5: Hosted MCP — send whitelist + read blacklist via `gmail_send`/`gmail_read`
- §6: Claude Code MCP — same tests via Claude Code
- §7: Claude Code CLI — same tests via local scripts
- *(OpenClaw already covered in QA 10)*

#### [03_multi_email_multi_key.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/03_multi_email_multi_key.md)
- §10: Hosted MCP — `list_accounts` scoping, `account` param enforcement
- §11: Claude Code MCP — same multi-email tests
- §12: Claude Code CLI — same tests via scripts
- §13: OpenClaw — `gmail.js --account <label>` with different tokens

#### [04_email_delegation.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/04_email_delegation.md)
- §11: Hosted MCP — delegated email access, token resolved from owner
- §12: Claude Code MCP — same delegation test
- §13: Claude Code CLI — same test via scripts
- §14: OpenClaw — `gmail.js --account <delegated-label>`

### 4E: TestClaw Docker Environment ❌ NOT DONE
Create `test/testclaw/` based on [DemoClaw](file:///home/kyesh/GitRepos/demoClaw):
- Docker container with OpenClaw + gmail-fgac skill pre-installed
- No Tailscale, no GOG CLI
- Pre-provisions OAuth tokens
- Can target local dev server or Vercel preview
- `run-qa.sh` orchestrator for QA 10 + package-matrix sections

### 4F: Browser-Agent Execution ❌ NOT DONE
Run `/browser-agent` workflow against current preview for:
- QA 11b: Dashboard connection management
- QA 12§2: Claude Code MCP approval in dashboard
- QA 02-04 dashboard setup steps

> [!WARNING]
> **Why browser-agent was not used previously:** Chrome was available on port 9222 but the workflow was not invoked — oversight, not a tooling gap. Fix: all task.md files for dashboard work must include browser-agent checkpoints.

---

## Implementation Order

| Step | What | Phase | Blocked By | Priority |
|------|------|-------|-----------|----------|
| 1 | Rewrite OpenClaw `auth.js` for FGAC OAuth | 3B | — | 🔴 Critical |
| 2 | Create CC CLI scripts (share with OpenClaw) | 3E | Step 1 | 🔴 Critical |
| 3 | Update CC SKILL.md Option B with working scripts | 3A | Step 2 | 🔴 Critical |
| 4 | Write QA 12 (credential flow per package) | 4C | — (can write test before impl) | 🔴 Critical |
| 5 | Split QA 11 → 11a + 11b | 4B | — | 🟡 Medium |
| 6 | Run browser-agent for 11b + dashboard tests | 4F | Step 5 | 🟡 Medium |
| 7 | Add package-matrix sections to QA 02, 03, 04 | 4D | — | 🟡 Medium |
| 8 | Build TestClaw Docker env | 4E | — | 🟡 Medium |
| 9 | Run QA 12 all sections | 4C | Steps 1, 2 | 🔴 Critical |
| 10 | Run QA 02-04 package-matrix tests | 4D | Steps 1, 2, 8 | 🟡 Medium |
| 11 | Delete spike route | 2F | — | 🟢 Low |
| 12 | Build CLI npm package | 2E, 3C | Step 2 | 🟢 Low (separate channel) |

---

## Feature × Package Coverage Matrix (Target State)

| Feature | REST Proxy | Hosted MCP | CC MCP | CC CLI | OpenClaw | Dashboard |
|---------|:----------:|:----------:|:------:|:------:|:--------:|:---------:|
| OAuth/credential flow | QA 01 | QA 12§1 | QA 12§2 | QA 12§3 | QA 12§4 | — |
| Send whitelist | QA 02 | QA 02§5 | QA 02§6 | QA 02§7 | QA 10 | QA 02 |
| Read blacklist | QA 02 | QA 02§5 | QA 02§6 | QA 02§7 | QA 10 | QA 02 |
| Multi-email | QA 03 | QA 03§10 | QA 03§11 | QA 03§12 | QA 03§13 | QA 03 |
| Email delegation | QA 04 | QA 04§11 | QA 04§12 | QA 04§13 | QA 04§14 | QA 04 |
| MCP protocol | — | QA 11a | — | — | — | QA 11b |
| Connection mgmt | — | — | — | — | — | QA 11b |

> **CC = Claude Code.** `§5` = Section 5 within that file.
