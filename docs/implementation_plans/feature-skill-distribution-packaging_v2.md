# FGAC.ai Skill Distribution & Low-Friction Packaging (v2)

Make FGAC.ai trivially installable for both OpenClaw and Claude Code users through native distribution channels. Remove CASA-era friction gates. Support both MCP (zero-key OAuth) and CLI (API key) workflows.

---

## Parallel Branch Strategy

This work naturally splits into **3 independent branches** that can be developed in parallel:

| Branch | Scope | Dependencies |
|--------|-------|-------------|
| `feature/auth-flow-cleanup` | Remove waitlist gate, update landing page CTAs, update QA tests 07/01 | None — can start immediately |
| `feature/mcp-server` | Build MCP endpoint, Clerk OAuth 2.1, permission introspection tools | Clerk Dashboard config (DCR) |
| `feature/skill-packaging` | ClawHub publication, Claude Code plugin, env var standardization, setup page UX | Depends on MCP endpoint URL being known |

> [!TIP]
> **Branch 1 (auth-flow-cleanup)** is the fastest win and can be PR'd and merged first. Branch 2 (MCP) and Branch 3 (skill-packaging) can run in parallel after Branch 1 lands.

---

## Phase 1: Auth Flow & Waitlist Removal
**Branch: `feature/auth-flow-cleanup`**

Now that CASA Tier 2 is complete, the "unverified app" friction gates and waitlist-only signup flow should be removed.

### What Changes

#### [MODIFY] [page.tsx (landing)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx)
- Replace `"Join Beta Waitlist"` CTA buttons (lines 18-31) with direct `"Get Started"` → `/sign-up` and `"Sign In"` → `/sign-in`
- Remove waitlist link entirely for signed-out users
- Keep `"Setup Guide"` link to `/setup`
- Update copy: remove "beta" language, remove "pending Google API Verification" references

#### [MODIFY] [page.tsx (waitlist)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/waitlist/page.tsx)
- Convert to a redirect page: `/waitlist` → `/sign-up` (preserve backward compat for any bookmarked links)
- Or keep as a simpler "interest capture" for enterprise leads (your call)

#### [MODIFY] [QA 07](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/07_waitlist_and_signup_flow.md)
- Rewrite to test the new direct signup flow (no waitlist gate)
- Verify: Landing page → "Get Started" → Clerk sign-up → Google OAuth → Dashboard (direct)
- Verify: No "unverified app" warnings visible anywhere in the UI

#### [MODIFY] [QA 01](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/01_signup_and_credential_workflow.md)
- Update to reflect removal of waitlist intermediary step
- Test direct: Landing → Sign Up → Dashboard → Create Key → Copy instructions

#### CASA Artifacts — KEEP (No Deletion)
Per your feedback, all CASA documentation stays in `docs/` for re-verification reference. No archival needed.

---

## Phase 2: MCP Server with Clerk OAuth 2.1
**Branch: `feature/mcp-server`**

### Architecture: Dual Auth Model

FGAC.ai will support two authentication methods that converge into the same proxy pipeline:

```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│ MCP OAuth Flow (Zero-Key)    │     │ API Key Flow (CLI/Scripts)    │
│                              │     │                              │
│ Agent connects via MCP       │     │ User creates sk_proxy_ key   │
│ Clerk OAuth 2.1 + PKCE      │     │ in dashboard, passes as      │
│ User approves in browser     │     │ Bearer token in requests     │
│ Token identifies USER        │     │ Key identifies KEY → USER    │
└──────────┬───────────────────┘     └──────────┬───────────────────┘
           │                                     │
           ▼                                     ▼
    ┌──────────────────────────────────────────────┐
    │         Unified Proxy Pipeline                │
    │  1. Resolve user + email access grants       │
    │  2. Evaluate fine-grained rules              │
    │  3. Fetch real Google token from Clerk       │
    │  4. Forward to googleapis.com                │
    └──────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **MCP OAuth eliminates key management entirely** — agents authenticate on behalf of the user. But CLI/script users still need the sk_proxy_ key workflow. Both must be first-class citizens.

### MCP Tool Scope

All Gmail actions from our approved scope, **plus permission introspection tools**:

| Tool | Description |
|------|-------------|
| `list_emails` | List recent emails (supports Gmail search queries) |
| `read_email` | Read a specific email by Message ID |
| `send_email` | Compose and send a new email |
| `forward_email` | Forward an existing email to a recipient |
| `list_labels` | List all Gmail labels |
| `download_attachment` | Download email attachments |
| `get_permissions` | **NEW**: Show the agent's current fine-grained permissions (active rules, email access grants, blocked patterns) |
| `request_permission` | **NEW**: Request additional permissions (e.g., access to a new email, new send whitelist). Creates a pending approval in the dashboard for the user to manually approve |

### New Files

#### [NEW] `src/app/.well-known/oauth-protected-resource/mcp/route.ts`
- RFC 9728 metadata endpoint for MCP client discovery
- Points to Clerk as the authorization server

#### [NEW] `src/app/.well-known/oauth-authorization-server/route.ts`
- RFC 8414 metadata endpoint
- Returns Clerk's authorize, token, and registration endpoints

#### [NEW] `src/app/mcp/route.ts`
- MCP handler using `mcp-handler` + `@clerk/mcp-tools`
- Registers all 8 tools above
- `experimental_withMcpAuth()` wraps with Clerk token verification
- On auth: resolves Clerk userId → looks up user's proxy rules → executes

#### [MODIFY] [middleware.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/middleware.ts)
- Add route matching for `/.well-known/*` and `/mcp` paths
- Ensure MCP routes bypass Clerk's standard middleware (MCP has its own auth)

#### [NEW] `src/lib/mcp-tools.ts`
- Shared tool implementation that wraps the existing proxy logic
- Used by the MCP route handler
- Each tool maps to the same Gmail API operations as the existing REST proxy

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Add `permission_requests` table for `request_permission` tool
- Fields: `id`, `userId`, `requestType`, `requestData`, `status` (pending/approved/denied), `createdAt`

#### Clerk Dashboard Configuration
- Enable **Dynamic Client Registration** under OAuth Applications
- This is a manual step, not code — documented in setup instructions

#### [NEW] QA Test: `docs/QA_Acceptance_Test/11_mcp_server_oauth.md`
- Test MCP discovery endpoints return valid JSON
- Test `claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp`
- Test tool discovery: agent can see all 8 tools
- Test `get_permissions` returns current rules
- Test `request_permission` creates a pending row in the database
- Test `list_emails` / `read_email` through MCP

---

## Phase 3: ClawHub Publication & CLI Skill
**Branch: `feature/skill-packaging`**

### Common vs Distinct Component Strategy

```
┌─────────────────────────────────────────────────────────┐
│                    COMMON (shared)                       │
│                                                         │
│  ● Proxy endpoint: https://gmail.fgac.ai                │
│  ● Auth token format: sk_proxy_xxx (Bearer)             │
│  ● Env var: FGAC_PROXY_KEY                              │
│  ● Token file format: JSON with type=service_account    │
│  ● Gmail API actions: list, read, send, forward,        │
│    labels, attachment                                    │
│  ● Error codes & messages: 401/403/500 semantics        │
│  ● User guide: https://fgac.ai/setup                    │
│  ● Dashboard: https://fgac.ai/dashboard                 │
│                                                         │
├─────────────────────────────────────────────────────────┤
│         DISTINCT: OpenClaw (ClawHub)                     │
│                                                         │
│  ● Distribution: `openclaw skills install gmail-fgac`   │
│  ● Format: SKILL.md + scripts/ (Node.js CLI)            │
│  ● Auth: Token JSON file at ~/.openclaw/gmail-fgac/     │
│    tokens/<label>.json                                   │
│  ● Invocation: `node gmail.js --account <label> ...`    │
│  ● Config: openclaw.json manifest                       │
│  ● Env override: FGAC_ROOT_URL (for local dev)          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│         DISTINCT: Claude Code (MCP)                      │
│                                                         │
│  ● Distribution: `claude mcp add ...` or Plugin         │
│  ● Format: Remote HTTP MCP server (JSON-RPC 2.0)        │
│  ● Auth: Clerk OAuth 2.1 (zero-key) — automatic         │
│  ● Invocation: Agent calls tools natively                │
│  ● Config: .mcp.json or claude settings                  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│         DISTINCT: Claude Code (CLI Skill)                │
│                                                         │
│  ● Distribution: curl or Plugin marketplace              │
│  ● Format: SKILL.md instructions file                    │
│  ● Auth: FGAC_PROXY_KEY env var (sk_proxy_)             │
│  ● Invocation: Agent writes Python/Node scripts          │
│  ● Config: .claude/skills/fgac/SKILL.md                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> [!NOTE]
> **Claude Code CLI Skill and MCP are complementary, not competing**. The MCP server gives Claude native tool access. The CLI Skill teaches Claude how to write standalone scripts using the REST API. Some users prefer MCP (instant, zero-config). Others prefer CLI scripts (portable, debuggable, version-controllable). We ship both.

### Env Var Standardization

| Variable | Purpose | Used By |
|----------|---------|---------|
| `FGAC_PROXY_KEY` | The `sk_proxy_xxx` API key | All platforms (CLI skill, scripts, cURL) |
| `FGAC_ROOT_URL` | Override proxy base URL (for local dev only) | OpenClaw scripts, CLI testing |

Remove any other env var variants. All documentation and skills reference `FGAC_PROXY_KEY` consistently.

### ClawHub Changes

#### [MODIFY] [SKILL.md (gmail-fgac)](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/SKILL.md)
- Add `signature` field (required for ClawHub integrity verification)
- Add `when_to_use` with semantic-search-optimized trigger phrases
- Add `license: MIT-0`
- Update `metadata.version` to `"1.1.0"`
- Lead description with "Gmail" for discoverability

#### [MODIFY] [setup.js](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/scripts/setup.js)
- Add interactive flow: prompt for proxy key → validate against proxy → write token JSON
- Support `openclaw skills install` post-install hook

#### [NEW] `docs/skills/gmail-fgac/README.md`
- Quick-start guide for ClawHub listing page
- Link to fgac.ai for account creation

### Claude Code Changes

#### [MODIFY] [SKILL.md (claude-code)](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)
- Add Node.js code example alongside existing Python
- Add cURL example for tool-use agents
- Add error handling instructions for 403 responses
- Clarify this is the **CLI/script skill** (not MCP)

#### [NEW] `public/.mcp.json` (downloadable template)
- Pre-configured for `https://gmail.fgac.ai/mcp`
- Uses `${FGAC_PROXY_KEY}` env var for fallback (non-OAuth mode)

### Setup Page UX

#### [MODIFY] [page.tsx (setup)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/setup/page.tsx)
- Add **4 cards** (was 3): MCP Server, CLI Skill, OpenClaw, Claude Cowork
- Each card shows a **one-line install command** with copy-to-clipboard
- MCP card: `claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp`
- OpenClaw card: `openclaw skills install gmail-fgac`
- CLI Skill card: `mkdir -p .claude/skills/fgac && curl -o .claude/skills/fgac/SKILL.md https://fgac.ai/skills/claude-code/SKILL.md`
- Keys are **agent-specific** — the setup page should link to dashboard for key creation, not embed a key. Install commands use placeholder `YOUR_KEY` or reference the `FGAC_PROXY_KEY` env var.

#### [NEW] QA Test: `docs/QA_Acceptance_Test/12_clawhub_skill_install.md`
- Test `clawhub skill validate docs/skills/gmail-fgac/` passes
- Test skill structure integrity (SKILL.md, scripts/, README.md)
- Test post-install setup.js interactive flow

#### [NEW] QA Test: `docs/QA_Acceptance_Test/13_claude_code_skill_install.md`
- Test CLI skill download: `curl https://fgac.ai/skills/claude-code/SKILL.md`
- Test `.mcp.json` download: `curl https://fgac.ai/.mcp.json`
- Test MCP add command with preview URL
- Browser agent test: navigate to /setup, verify copy-to-clipboard works

---

## Phase 4: Claude Code Plugin & Marketplace
**Branch: `feature/skill-packaging`** (same branch as Phase 3)

#### [NEW] `.claude-plugin/plugin.json`
```json
{
  "name": "fgac-gmail",
  "version": "1.0.0",
  "description": "Secure Gmail access for AI agents via FGAC.ai fine-grained access control proxy",
  "author": "fgac-ai",
  "components": {
    "mcpServers": {
      "fgac-gmail": {
        "type": "http",
        "url": "https://gmail.fgac.ai/mcp"
      }
    },
    "skills": ["skills/fgac/SKILL.md"]
  }
}
```

This bundles both the MCP server connection AND the CLI skill instructions into a single installable plugin:
```bash
# Users install with:
/plugin marketplace add kyesh/fine_grain_access_control
/plugin install fgac-gmail@kyesh
```

#### [NEW] QA Test: `docs/QA_Acceptance_Test/14_claude_code_plugin.md`
- Test plugin.json manifest validates
- Test `/plugin install` workflow (requires Claude Code environment)

---

## Phase 5: Documentation Updates
**Branch: `feature/skill-packaging`**

#### [MODIFY] [README.md](file:///home/kyesh/GitRepos/fine_grain_access_control/README.md)
- Add install badges (ClawHub, MCP compatible)
- Add quick-install section with one-liners for each platform
- Remove references to beta/waitlist

#### [MODIFY] [user_guide.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/user_guide.md)
- Update "Ready-Made Agent Skills" section (lines 115-119) with new install methods
- Add MCP server documentation section
- Add permission introspection tools documentation

#### [MODIFY] [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md)
- Update Section 4 (MCP) — we now HAVE an MCP endpoint
- Add Section 5: Distribution Strategy (ClawHub, MCP, Plugin)
- Add Section 6: Dual Auth Model (OAuth vs API Key)

---

## Verification Plan

### New QA Acceptance Tests

| Test | File | What it Validates | Automation |
|------|------|-------------------|------------|
| **11** | `11_mcp_server_oauth.md` | MCP endpoint, tool discovery, OAuth flow, permission tools | CLI commands + browser agent for OAuth consent |
| **12** | `12_clawhub_skill_install.md` | ClawHub validation, skill structure, post-install setup | CLI commands (clawhub CLI) |
| **13** | `13_claude_code_skill_install.md` | Skill download, .mcp.json, setup page UX | cURL + browser agent for setup page |
| **14** | `14_claude_code_plugin.md` | Plugin manifest, /plugin install workflow | Claude Code environment |

### Testing Harnesses

#### MCP Mock Client
For testing the MCP server without a real Claude Code instance:
```bash
# Harness: scripts/test-mcp-client.ts
# - Sends JSON-RPC requests to /mcp endpoint
# - Tests tool discovery, tool invocation, error handling
# - Can be run in CI or locally
```

#### Agent Behavior Mock
For validating that skills produce correct agent behavior:
```bash
# Harness: scripts/test-agent-mock.ts
# - Simulates an agent following SKILL.md instructions
# - Executes the same commands the SKILL.md teaches
# - Validates output format matches expectations
```

### Browser Agent Tests
Using the `/browser-agent` workflow:
- Navigate to `/setup` page → verify 4 install cards render
- Click copy-to-clipboard → verify command copies correctly
- Navigate to `/` → verify "Get Started" links to `/sign-up` (no waitlist)
- Navigate to `/waitlist` → verify redirect to `/sign-up`

### Build Verification
```bash
npm run build  # Must pass with all new routes
npm run lint   # Must pass
```

### Deploy & Validate
```bash
/deploy-pr-preview  # For each branch
# Then run browser agent tests against preview URL
```
