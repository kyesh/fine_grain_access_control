# FGAC.ai Skill Distribution & Low-Friction Packaging (v4)

Make FGAC.ai trivially installable for OpenClaw and Claude Code. Remove CASA-era friction gates. Support MCP OAuth and CLI workflows — all scoped to agent profiles with IAM-style credential management.

---

## Phase 0: Clerk Spike (De-Risk First)

> [!CAUTION]
> **We've been burned before by assuming Clerk capabilities.** This spike validates 5 critical capabilities before we commit engineering effort to the MCP server. If any capability is missing, we pivot before investing.

### What We're Validating

| # | Capability | Risk Level | What Breaks If Missing |
|---|-----------|------------|----------------------|
| 1 | **DCR works** — An MCP client can dynamically register via Clerk's endpoint | HIGH | MCP clients can't connect at all |
| 2 | **OAuth token issuance** — Clerk issues access tokens via Authorization Code + PKCE | MEDIUM | No OAuth flow, API keys only |
| 3 | **Custom claims in tokens** — We can inject `fgac_profile_id` into the access token | HIGH | Can't bind OAuth session to agent profile |
| 4 | **Custom consent redirect** — We can intercept the consent flow to show our agent profile picker | HIGH | Can't let user select which agent gets access |
| 5 | **Token verification** — `@clerk/mcp-tools` verifyClerkToken works in our Next.js setup | MEDIUM | Must build custom JWT verification |

### Spike Implementation

#### [NEW] `src/app/api/spike/mcp/route.ts` (throwaway)
Minimal MCP endpoint that:
- Registers 1 tool: `spike_whoami` — returns the decoded token claims
- Uses `@clerk/mcp-tools` for auth
- Logs everything to console for inspection

```typescript
// Validates: token verification (#5), custom claims (#3)
server.tool('spike_whoami', 'Returns auth context', {}, async (_, { authInfo }) => {
  console.log('AUTH INFO:', JSON.stringify(authInfo, null, 2));
  return { content: [{ type: 'text', text: JSON.stringify(authInfo) }] };
});
```

#### [NEW] `src/app/.well-known/oauth-protected-resource/mcp/route.ts`
- Minimal metadata pointing to Clerk
- Validates: DCR discovery (#1)

#### [NEW] `src/app/.well-known/oauth-authorization-server/route.ts`
- Clerk's authorization server metadata
- Validates: OAuth endpoint discovery (#1, #2)

#### Spike Test Sequence

```bash
# 1. Install deps
npm install @clerk/mcp-tools mcp-handler

# 2. Enable DCR in Clerk Dashboard (manual step)

# 3. Start dev server
npm run dev

# 4. Test discovery endpoints
curl http://localhost:3000/.well-known/oauth-protected-resource/mcp
curl http://localhost:3000/.well-known/oauth-authorization-server

# 5. Test with Claude Code
claude mcp add --transport http fgac-spike http://localhost:3000/api/spike/mcp

# 6. In Claude Code session, ask Claude to call spike_whoami
# → Observe: Does OAuth flow trigger? Does consent screen appear?
# → Inspect: What fields are in authInfo.extra?

# 7. Test custom claims
# → Configure JWT template in Clerk Dashboard with custom claim
# → Re-run spike_whoami
# → Verify custom claim appears in authInfo
```

#### Custom Consent Page Test

```bash
# 8. Create a test consent page
# [NEW] src/app/oauth/consent/page.tsx (minimal)
# → Just shows "Select Agent Profile" with hardcoded options
# → Configure Clerk to redirect to this page during consent
# → Verify: Does the redirect work? Can we pass data back?
```

### Spike Success Criteria

| # | Test | Pass | Fail → Fallback |
|---|------|------|-----------------|
| 1 | DCR endpoint responds, Claude Code registers | ✅ Proceed | ❌ Manual OAuth app registration in Clerk Dashboard per-agent |
| 2 | OAuth flow completes, token issued | ✅ Proceed | ❌ API key only (no OAuth for MCP) |
| 3 | Custom claim appears in `authInfo.extra` | ✅ Proceed | ❌ Post-auth API call to resolve user→profile (2-step) |
| 4 | Custom consent page renders during flow | ✅ Proceed | ❌ Post-auth profile selection tool in MCP (`select_profile`) |
| 5 | `verifyClerkToken` validates successfully | ✅ Proceed | ❌ Manual JWT verification with `jose` (already a dependency) |

> [!IMPORTANT]
> **If #1 or #2 fail**, the MCP OAuth approach is not viable with Clerk, and we fall back to API-key-only MCP auth (still works, just not zero-key). If #3 or #4 fail, we can work around them with a post-auth profile selection step. **The spike determines the Phase 2 approach — we update the plan based on results.**

### Spike Timeline
- **Effort**: ~2-4 hours of coding + testing
- **Dependencies**: Clerk Dashboard access (DCR toggle, JWT template)
- **Output**: Spike results document + revised Phase 2 plan

---

## Data Model: Agent Profiles (IAM Architecture)

> [!IMPORTANT]
> **Agent profiles are the identity. Credentials are how they authenticate.** Just like an AWS IAM user can have multiple access keys, an agent profile can have multiple credentials. Rotating a credential doesn't break other credentials for the same profile.

### Current Schema (flat — credential IS identity)

```
proxyKeys (credential = identity)
  ├── keyEmailAccess (permissions on credential)
  └── keyRuleAssignments (rules on credential)
```

### Proposed Schema (IAM-style separation)

```
agent_profiles (identity — the "who")
  ├── id, userId, label, createdAt
  ├── profileEmailAccess (permissions on profile)
  └── profileRuleAssignments (rules on profile)

agent_credentials (authentication — the "how")
  ├── id, profileId, type, createdAt, revokedAt, expiresAt
  ├── type = 'api_key' → key = "sk_proxy_xxx"
  ├── type = 'oauth_session' → clerkSessionId, lastUsedAt
  └── type = 'cli_oauth' → refreshToken, lastUsedAt
```

### Benefits

| Scenario | Old (flat) | New (IAM) |
|----------|-----------|-----------|
| Rotate API key | Create new key, re-assign all email access + rules | Rotate credential, profile permissions unchanged |
| Agent connects via MCP OAuth | Must create/select a key | Binds to profile, auto-creates credential |
| Same agent, multiple auth methods | Two separate keys with duplicated permissions | One profile, two credentials |
| Audit: "what can this agent do?" | Query key → email access + rules | Query profile → all permissions in one place |
| Revoke one credential | May break agent if it had only one key | Other credentials still work |

### Migration Path

The `proxyKeys` table becomes `agent_credentials` with `type = 'api_key'`. We create `agent_profiles` from existing keys (1:1 initially). All `keyEmailAccess` and `keyRuleAssignments` FKs migrate to profile-level. **Backward compatible** — existing `sk_proxy_xxx` keys continue to work, they just resolve through: credential → profile → permissions.

> [!NOTE]
> **This schema change is Phase 2 work**, not Phase 0 (spike) or Phase 1 (auth cleanup). The spike validates Clerk capabilities using the EXISTING schema. We only refactor the schema once we know the full auth architecture.

---

## Phase 1: Auth Flow & Waitlist Removal
**Branch: `feature/auth-flow-cleanup`** — Can start immediately (parallel with spike)

#### [MODIFY] [page.tsx (landing)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx)
- Replace `"Join Beta Waitlist"` → `"Get Started"` pointing to `/sign-up`
- Remove "pending Google API Verification" copy, all "beta" language

#### [MODIFY] [page.tsx (waitlist)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/waitlist/page.tsx)
- Convert to redirect: `/waitlist` → `/sign-up`

#### Archive CASA Documents
Move to `docs/archive/casa-tier-2/`:
- All `docs/CASA_*.md` files, `docs/CASA_Evidence/`, `scripts/fill_saq.sh`
- CASA implementation plans from `docs/implementation_plans/`
- Root-level scan artifacts (zap, semgrep, trivy, fluidattacks, etc.)

Keep `next.config.ts` security headers.

#### Update QA Tests
- [QA 07](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/07_waitlist_and_signup_flow.md): Rewrite for direct signup
- [QA 01](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/01_signup_and_credential_workflow.md): Remove waitlist references
- "Unverified app" warning: note as prod-only check

---

## Phase 2: MCP Server with Agent-Scoped OAuth
**Branch: `feature/mcp-server`** — Starts AFTER spike results

*This section describes the "happy path" where all 5 spike tests pass. If any fail, we update this section with the corresponding fallback from the spike table.*

### Agent-Scoped OAuth Flow

```
  Agent → MCP endpoint → Clerk OAuth (DCR + PKCE)
    → User signs in → Custom consent page (select agent profile)
    → Token issued with fgac_profile_id claim
    → MCP tools enforce that profile's permissions
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `gmail_list` | List emails (search, filters) |
| `gmail_read` | Read full message |
| `gmail_send` | Send email (subject to rules) |
| `gmail_forward` | Forward email (subject to rules) |
| `gmail_labels` | List labels |
| `gmail_attachment` | Download attachment |
| `get_my_permissions` | Show this agent profile's rules, email grants, blocked patterns |
| `request_permission` | Request additional access (pending user approval in dashboard) |

### Schema Changes

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Add `agent_profiles` table
- Add `agent_credentials` table (replaces `proxyKeys` as auth layer)
- Migrate `keyEmailAccess` → `profileEmailAccess`
- Migrate `keyRuleAssignments` → `profileRuleAssignments`
- Add `permission_requests` table
- Keep `proxyKeys` as a view/alias during migration for backward compat

### New Routes
- `src/app/mcp/route.ts` — MCP handler
- `src/app/oauth/consent/page.tsx` — Agent profile picker
- `src/app/.well-known/*` — OAuth discovery (promoted from spike)
- `src/lib/mcp-tools.ts` — Shared tool implementations

### CLI OAuth
- `packages/fgac-cli/` or `scripts/fgac-cli.js`
- `fgac auth login` → browser OAuth → profile selection → token stored locally
- `fgac auth token` → outputs current token (auto-refresh)
- Reuses same consent page and OAuth endpoints as MCP

### QA Tests
- `docs/QA_Acceptance_Test/11_mcp_server_oauth.md`

---

## Phase 3: Skill Packaging & Distribution
**Branch: `feature/skill-packaging`**

### Separate Installs (MCP vs CLI)
- **MCP plugin**: `fgac-gmail-mcp` — remote HTTP MCP server
- **CLI plugin**: `fgac-gmail-cli` — SKILL.md instructions
- Users install ONE, not both

### Own Marketplace
- `kyesh/fgac-marketplace` GitHub repo
- `/plugin marketplace add kyesh/fgac-marketplace`

### External Registries
- ClawHub: `clawhub skill publish`
- ClaudeMarketplaces.com
- mcp.hosting

### Setup Page UX
- 4 cards: MCP Server, CLI Skill, OpenClaw, Claude Cowork
- Copy-to-clipboard install commands
- Link to dashboard for agent profile creation (not key embedding)
- MCP card: "No API key needed — authenticates via your browser"

### Env Var Standardization
- `FGAC_PROXY_KEY` — universal env var for API key auth
- `FGAC_ROOT_URL` — local dev override only

### QA Tests
- `docs/QA_Acceptance_Test/12_clawhub_skill_install.md`
- `docs/QA_Acceptance_Test/13_claude_code_skill_install.md`
- `docs/QA_Acceptance_Test/14_plugin_marketplace.md`

### Documentation Updates
- README.md, user_guide.md, architecture_and_strategy.md

---

## Execution Order

```
         ┌─────────────────────────┐
         │  Phase 0: Clerk Spike   │ ◄── START HERE
         │  (~2-4 hours)           │
         └────────┬────────────────┘
                  │ results
         ┌────────▼────────────────┐    ┌──────────────────────────┐
         │  Phase 2: MCP Server    │    │  Phase 1: Auth Cleanup   │
         │  (updated based on      │    │  (parallel with spike)   │
         │   spike results)        │    │                          │
         └────────┬────────────────┘    └────────┬─────────────────┘
                  │                               │
                  └───────────┬───────────────────┘
                              │
                  ┌───────────▼───────────────────┐
                  │  Phase 3: Skill Packaging      │
                  │  (after MCP URL is known)      │
                  └────────────────────────────────┘
```

---

## Verification Plan

### Spike Validation
- Document results in `docs/spike_results/clerk-mcp-oauth.md`
- Update Phase 2 based on findings
- Commit spike code (even if throwaway — it proves what works)

### QA Acceptance Tests (New)

| # | File | Validates | Harness |
|---|------|-----------|---------|
| 11 | `11_mcp_server_oauth.md` | MCP endpoint, agent-scoped OAuth, profile selection, tools | MCP mock client + browser agent |
| 12 | `12_clawhub_skill_install.md` | ClawHub validation, skill structure | CLI commands |
| 13 | `13_claude_code_skill_install.md` | Skill download, setup page UX | cURL + browser agent |
| 14 | `14_plugin_marketplace.md` | Plugin manifest, marketplace install | Claude Code env |

### Testing Harnesses
- `scripts/test-mcp-client.ts` — JSON-RPC client for MCP endpoint testing
- `scripts/test-agent-mock.ts` — Simulates agent following SKILL.md
- Browser agent tests via `/browser-agent` workflow
