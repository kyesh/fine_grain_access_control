# FGAC.ai Skill Distribution & Low-Friction Packaging (v3)

Make FGAC.ai trivially installable for both OpenClaw and Claude Code users through native distribution channels. Remove CASA-era friction gates. Support both MCP OAuth (zero-key) and CLI (API key or OAuth) workflows — all scoped to agent-specific proxy keys.

---

## Core Architecture: Agent-Scoped OAuth

> [!IMPORTANT]
> **Permissions are per-KEY (agent profile), not per-user.** This is the foundational FGAC.ai design principle. The MCP OAuth flow must bind each connection to a specific proxy key so that agent's permissions are respected.

### How It Works

```
┌────────────────────────────────────────────────────────────────────────┐
│                     Agent-Scoped OAuth Flow                            │
│                                                                        │
│  1. Agent connects → MCP server returns protected-resource metadata    │
│  2. Agent does DCR with Clerk → gets client_id/secret                  │
│  3. Agent initiates Authorization Code + PKCE                          │
│  4. User signs in via Clerk (Google account)                           │
│  5. ★ CUSTOM CONSENT PAGE at /oauth/consent:                           │
│     ┌──────────────────────────────────────────────┐                   │
│     │  Select Agent Profile                        │                   │
│     │                                              │                   │
│     │  ● Claude Personal Agent                     │                   │
│     │    3 emails · 5 rules · created Apr 2026     │                   │
│     │                                              │                   │
│     │  ○ Work Bot                                  │                   │
│     │    1 email · 2 rules · created May 2026      │                   │
│     │                                              │                   │
│     │  ○ + Create New Agent Profile                │                   │
│     │                                              │                   │
│     │              [Authorize]                     │                   │
│     └──────────────────────────────────────────────┘                   │
│  6. Clerk issues token with claim: { fgac_key_id: "uuid" }            │
│  7. Agent calls MCP tools → server extracts fgac_key_id from token    │
│  8. Proxy pipeline resolves proxyKeys row → enforces THAT key's rules  │
│                                                                        │
│  Result: Identical permissions whether agent uses OAuth or sk_proxy_   │
└────────────────────────────────────────────────────────────────────────┘
```

### Dual Auth Convergence

```
  MCP OAuth Token                    sk_proxy_ API Key
  (fgac_key_id claim)               (database lookup)
        │                                  │
        ▼                                  ▼
  ┌────────────────────────────────────────────┐
  │    Resolve → proxyKeys row (same row!)     │
  │    ├─ keyEmailAccess (which emails)        │
  │    ├─ keyRuleAssignments (which rules)     │
  │    └─ accessRules (content filters)        │
  │                                            │
  │    Fetch Google token from Clerk           │
  │    Forward to googleapis.com               │
  └────────────────────────────────────────────┘
```

---

## Parallel Branch Strategy

| Branch | Scope | Can Start |
|--------|-------|-----------|
| `feature/auth-flow-cleanup` | Remove waitlist, archive CASA docs, update landing page | Immediately |
| `feature/mcp-server` | MCP endpoint, agent-scoped OAuth, consent page, CLI OAuth | After Clerk DCR is enabled |
| `feature/skill-packaging` | ClawHub publication, Claude Code plugin, setup page UX, marketplace submissions | After MCP endpoint URL is known |

---

## Phase 1: Auth Flow & Waitlist Removal
**Branch: `feature/auth-flow-cleanup`**

#### [MODIFY] [page.tsx (landing)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx)
- Replace `"Join Beta Waitlist"` CTAs → `"Get Started"` pointing to `/sign-up`
- Remove "pending Google API Verification" copy
- Remove all "beta" language

#### [MODIFY] [page.tsx (waitlist)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/waitlist/page.tsx)
- Convert to redirect: `/waitlist` → `/sign-up` (preserve backward compat)

#### Archive CASA Documents
Move to `docs/archive/casa-tier-2/`:
- `docs/CASA_Dispute_Response.md`
- `docs/CASA_SAQ_Answers.md`
- `docs/CASA_TAC_Data_Storage_Response.md`
- `docs/CASA_TAC_SAQ_Evidence_Response.md`
- `docs/CASA_Evidence/` (entire directory)
- `scripts/fill_saq.sh`
- `docs/implementation_plans/feature-casa-*` (6 files)
- `docs/implementation_plans/fix-casa-*` (1 file)

Keep security headers in `next.config.ts` — those are production best practices.

Root-level scan artifacts move to archive:
- `zap.yaml`, `zap_output.txt`, `zap_report.html`, `fluidattacks-config.yaml`, `run_zap.sh`
- `semgrep_results.txt`, `trivy_results.txt`, `npm_audit_results.txt`
- `Open_TAC_Security_ReportFirst_Scan_2026_1776828032.pdf`

#### [MODIFY] [QA 07](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/07_waitlist_and_signup_flow.md)
- Rewrite: test direct signup flow (Landing → "Get Started" → Clerk → Dashboard)
- Verify no "unverified app" warnings (prod-only check — note this in the test)

#### [MODIFY] [QA 01](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/01_signup_and_credential_workflow.md)
- Remove waitlist intermediary step references

---

## Phase 2: MCP Server with Agent-Scoped OAuth
**Branch: `feature/mcp-server`**

### MCP Endpoint & Tools

#### [NEW] `src/app/mcp/route.ts`
- MCP handler using `mcp-handler` + `@clerk/mcp-tools`
- `experimental_withMcpAuth()` wraps with Clerk token verification
- On auth: extracts `fgac_key_id` claim from token → resolves proxyKeys row → executes
- Fallback: if `Authorization: Bearer sk_proxy_xxx` is provided instead of OAuth token, resolve key directly (supports both auth methods on same endpoint)

#### MCP Tool Scope

| Tool | Maps to | Description |
|------|---------|-------------|
| `gmail_list` | `list` | List emails with search, max results, label filter |
| `gmail_read` | `read` | Read full message by ID |
| `gmail_send` | `send` | Compose and send (subject to whitelist rules) |
| `gmail_forward` | `forward` | Forward message (subject to whitelist rules) |
| `gmail_labels` | `labels` | List all Gmail labels |
| `gmail_attachment` | `attachment` | Download attachment by ID |
| `get_my_permissions` | NEW | Returns this agent's current rules, email grants, and blocked patterns |
| `request_permission` | NEW | Submit a permission request (pending user approval in dashboard) |

### Agent-Scoped OAuth

#### [NEW] `src/app/oauth/consent/page.tsx`
- Custom consent page shown during OAuth flow
- Lists user's existing proxy keys with details:
  - Label, email access count, rule count, created date
- User selects which key this agent connection should use
- "Create New Agent Profile" option → inline mini key-creation flow
- Auto-select behavior:
  - 1 key → auto-select, show confirmation only
  - 0 keys → auto-create default key (own email, global rules)

#### [NEW] `src/app/.well-known/oauth-protected-resource/mcp/route.ts`
- RFC 9728 metadata: points to Clerk as authorization server
- Includes `resource` identifier for FGAC.ai

#### [NEW] `src/app/.well-known/oauth-authorization-server/route.ts`
- RFC 8414 metadata: Clerk's authorize, token, registration endpoints

#### [MODIFY] [middleware.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/middleware.ts)
- Add route matching for `/.well-known/*`, `/mcp`, `/oauth/consent`
- MCP and well-known routes bypass standard Clerk middleware (own auth)

#### [NEW] `src/lib/mcp-tools.ts`
- Shared tool implementations wrapping existing proxy logic
- Each tool: validate key permissions → call Gmail API → return structured result
- Reuses the same code paths as `src/app/api/proxy/[...path]/route.ts`

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Add `permission_requests` table:
  - `id`, `proxyKeyId`, `requestType`, `requestData`, `status` (pending/approved/denied), `createdAt`
- Add `mcp_sessions` table (optional):
  - `id`, `proxyKeyId`, `clerkSessionId`, `createdAt`, `lastUsedAt`

#### Clerk Dashboard Configuration (Manual)
- Enable **Dynamic Client Registration** under OAuth Applications
- Configure custom claims to include `fgac_key_id` in access tokens
- Set consent screen to redirect to our `/oauth/consent` page

### CLI OAuth Option

#### [NEW] `packages/fgac-cli/` (or `scripts/fgac-cli.js`)
- Lightweight CLI tool for OAuth-based authentication
- Works like `gh auth login` / `vercel login`:

```bash
fgac auth login
# → Opens browser to https://fgac.ai/oauth/authorize
# → User signs in, selects agent profile on consent page
# → CLI receives authorization code via localhost callback
# → Exchanges for token with fgac_key_id claim
# → Stores at ~/.fgac/credentials.json

fgac auth token
# → Outputs current access token (auto-refreshes if expired)
# → Use in scripts: curl -H "Authorization: Bearer $(fgac auth token)" ...

fgac auth status
# → Shows current agent profile, email grants, rule count
```

**Feasibility: MEDIUM** — The OAuth and consent infrastructure built for MCP gets reused directly. The CLI tool is ~200-300 LOC of Node.js wrapping the same OAuth endpoints. Can be shipped as `npx fgac-cli auth login` initially, then npm-published later.

#### [NEW] QA Test: `docs/QA_Acceptance_Test/11_mcp_server_oauth.md`
- Test MCP discovery endpoints (`/.well-known/*`) return valid JSON
- Test `claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp`
- Test agent profile selection on consent page (browser agent test)
- Test tool discovery: agent sees all 8 tools
- Test `get_my_permissions` returns correct key's rules
- Test `request_permission` creates pending row with correct `proxyKeyId`
- Test `gmail_list` / `gmail_read` enforce the selected key's email access grants
- Test that using a key with restricted email access gets 403 on unauthorized inbox

---

## Phase 3: ClawHub Publication & Skill Packaging
**Branch: `feature/skill-packaging`**

### Common vs Distinct Strategy

```
┌──────────────────────────────────────────────────────────┐
│                 COMMON (all platforms)                     │
│                                                          │
│  ● Proxy endpoint: https://gmail.fgac.ai                 │
│  ● Auth: Bearer token (sk_proxy_xxx OR OAuth token)      │
│  ● Env var: FGAC_PROXY_KEY (for API key workflows)       │
│  ● Gmail operations: list, read, send, forward,          │
│    labels, attachment                                     │
│  ● Error semantics: 401/403/500 + clear messages         │
│  ● Dashboard: https://fgac.ai/dashboard                  │
│  ● User guide: https://fgac.ai/setup                     │
│                                                          │
├──────────────────────────────────────────────────────────┤
│         OpenClaw (ClawHub Registry)                       │
│                                                          │
│  Install: openclaw skills install gmail-fgac              │
│  Format: SKILL.md + scripts/ (Node.js CLI)               │
│  Auth: Token JSON file OR fgac auth login                │
│  Config: openclaw.json manifest                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│         Claude Code — MCP Server (separate install)       │
│                                                          │
│  Install: claude mcp add --transport http fgac-gmail      │
│           https://gmail.fgac.ai/mcp                      │
│  Format: Remote HTTP MCP (JSON-RPC 2.0)                  │
│  Auth: Clerk OAuth 2.1 (agent-scoped, zero-key)          │
│  Discovery: automatic tool discovery                     │
│                                                          │
├──────────────────────────────────────────────────────────┤
│         Claude Code — CLI Skill (separate install)        │
│                                                          │
│  Install: curl or /plugin install                        │
│  Format: SKILL.md instructions                           │
│  Auth: FGAC_PROXY_KEY env var OR fgac auth login         │
│  Invocation: Agent writes Python/Node scripts            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

> [!NOTE]
> **MCP and CLI Skill are SEPARATE installs.** Installing both would confuse the agent — it wouldn't know whether to use native MCP tools or write scripts. Users choose one based on their workflow preference.

### Plugin Marketplace Strategy

#### Our Own Marketplace (GitHub)
- Create `kyesh/fgac-marketplace` repository with `.claude-plugin/marketplace.json`
- Contains two plugins: `fgac-gmail-mcp` and `fgac-gmail-cli`
- Users add: `/plugin marketplace add kyesh/fgac-marketplace`
- Then install ONE of: `/plugin install fgac-gmail-mcp@kyesh` OR `/plugin install fgac-gmail-cli@kyesh`

#### [NEW] `.claude-plugin/plugin.json` (MCP plugin)
```json
{
  "name": "fgac-gmail-mcp",
  "version": "1.0.0",
  "description": "Secure Gmail access for AI agents via FGAC.ai — MCP server with OAuth",
  "components": {
    "mcpServers": {
      "fgac-gmail": { "type": "http", "url": "https://gmail.fgac.ai/mcp" }
    }
  }
}
```

#### Submit to External Registries
- **ClaudeMarketplaces.com** — submit listing
- **mcp.hosting** — register MCP server URL
- **ClawHub** — `clawhub skill publish` for OpenClaw

### ClawHub Changes

#### [MODIFY] [SKILL.md (gmail-fgac)](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/SKILL.md)
- Add `signature` field, `when_to_use`, `license: MIT-0`
- Lead description with "Gmail" for discoverability
- Update metadata version to `"1.1.0"`

#### [MODIFY] [setup.js](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/scripts/setup.js)
- Interactive setup: prompt for proxy key OR `fgac auth login` OAuth flow
- Validate key against proxy, write token JSON

#### [NEW] `docs/skills/gmail-fgac/README.md`

### Setup Page & Documentation

#### [MODIFY] [page.tsx (setup)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/setup/page.tsx)
- **4 cards** (separate installs):
  1. **MCP Server** (Claude Code/Desktop): `claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp`
  2. **CLI Skill** (Claude Code): `mkdir -p .claude/skills/fgac && curl -o .claude/skills/fgac/SKILL.md https://fgac.ai/skills/claude-code/SKILL.md`
  3. **OpenClaw**: `openclaw skills install gmail-fgac`
  4. **Claude Cowork** (Desktop): Download SKILL.md
- Each card has copy-to-clipboard
- Cards link to `/dashboard` for key creation (keys are agent-specific — no key embedded in install commands)
- MCP card notes: "No API key needed — authenticates via your browser"

#### [MODIFY] [SKILL.md (claude-code)](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)
- Add Node.js example alongside Python
- Add `fgac auth login` as alternative to env var
- Clarify: "This is the CLI/script skill — for native MCP tools, use the MCP server instead"

#### [MODIFY] [README.md](file:///home/kyesh/GitRepos/fine_grain_access_control/README.md)
- Quick-install section with one-liners
- Remove beta/waitlist language
- Add badges

#### [MODIFY] [user_guide.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/user_guide.md)
- Update "Ready-Made Agent Skills" section with new install methods
- Add MCP server + permission introspection docs

#### [MODIFY] [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md)
- Update Section 4 (MCP) — we now HAVE an MCP endpoint
- Add: Distribution Strategy, Dual Auth Model, Agent-Scoped OAuth

---

## Verification Plan

### New QA Acceptance Tests

| # | File | What it Validates | Automation |
|---|------|-------------------|------------|
| 11 | `11_mcp_server_oauth.md` | MCP endpoint, agent-scoped OAuth, consent page, tool discovery, permission tools | CLI + browser agent for OAuth consent |
| 12 | `12_clawhub_skill_install.md` | ClawHub validation, skill structure, post-install setup.js | CLI commands |
| 13 | `13_claude_code_skill_install.md` | Skill download, setup page UX, copy-to-clipboard | cURL + browser agent |
| 14 | `14_plugin_marketplace.md` | Plugin manifest, marketplace repo, /plugin install | Claude Code env |

### Testing Harnesses

#### MCP Mock Client (`scripts/test-mcp-client.ts`)
- Sends JSON-RPC 2.0 requests to `/mcp` endpoint
- Tests: tool discovery, tool invocation with valid/invalid tokens, agent-scoped permission enforcement
- Can run in CI (uses sk_proxy_ key as fallback auth, bypassing OAuth for automation)

#### Agent Behavior Mock (`scripts/test-agent-mock.ts`)
- Simulates an agent following SKILL.md instructions
- Executes the commands the SKILL.md teaches, validates output format

### Browser Agent Tests (via `/browser-agent` workflow)
- Setup page: verify 4 install cards render, copy-to-clipboard works
- Landing page: "Get Started" links to `/sign-up` (no waitlist)
- `/waitlist` redirects to `/sign-up`
- OAuth consent page: shows agent profiles, selection works
- **Prod-only**: Verify no "unverified app" warnings (add note in QA test)

### Build & Deploy
```bash
npm run build   # Must pass
npm run lint    # Must pass
/deploy-pr-preview  # Per branch, then browser agent tests against preview
```
