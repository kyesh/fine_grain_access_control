# FGAC.ai Skill Distribution — Implementation Plan v7

> Post-spike comprehensive plan incorporating all validated findings.

---

## Phase 0: Clerk MCP OAuth Spike ✅ COMPLETE

> [!NOTE]
> Full results: [clerk-mcp-oauth.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/spike_results/clerk-mcp-oauth.md)

### Validated Capabilities

| # | Capability | Status | Impact on Architecture |
|---|-----------|--------|----------------------|
| 1 | DCR (Dynamic Client Registration) | ✅ PASS | Each agent gets a unique, persistent `client_id` — this is the agent's fingerprint |
| 2 | OAuth token issuance (Auth Code + PKCE) | ✅ PASS | Standard flow works. 24h access tokens + refresh tokens |
| 3 | Custom token claims | ⚠️ PARTIAL | Token only has `sub` (userId) + `client_id`. No custom claims → we resolve permissions server-side |
| 4 | Consent page | ✅ PASS | Clerk's built-in page shows DCR `client_name`. We **cannot** replace it or inject profile selection |
| 5 | Token verification | ✅ PASS | `verifyClerkToken()` returns `authInfo.extra.userId` — full auth pipeline works |

### Key Constraints Discovered
- **Scope limitation:** DCR clients only get `email profile offline_access`. `openid`, `public_metadata`, `private_metadata` are rejected
- **No consent customization:** Can't add agent profile picker to Clerk's consent page
- **No custom claims injection:** OAuth access tokens don't support custom claims like `fgac_profile_id`
- **mcp-handler basePath:** Appends `/mcp` automatically — use `basePath: '/api/spike'` for endpoint at `/api/spike/mcp`

---

## Phase 0.5: Pending Approval Spike ✅ COMPLETE

### Architecture Decision

The agent must **NEVER** control its own permissions. The `select_profile` MCP tool approach was rejected because it lets the agent choose its own access level. Instead, we validated the **Pending Approval** pattern:

```
Agent → MCP → Clerk OAuth → Token (userId + clientId)
  → Agent calls any MCP tool
  → MCP creates "pending" connection record (deny-by-default)
  → MCP returns: "⚠️ Not approved. Ask user to visit dashboard."
  → User opens dashboard → approves connection → assigns proxy key + nickname
  → Agent retries → works with that proxy key's permissions
  → Future sessions with same clientId auto-inherit (one-time approval)
```

### Validated with Two Distinct Clients

| Test | Claude-Code-Agent | Third-Party-Bot |
|------|------------------|----------------|
| Unique `client_id` | `uJytZBYnERUpjv4g` | `fol7nvq2PC6ctcQu` |
| Clerk consent shows name | ✅ "Claude-Code-Agent" | ✅ "Third-Party-Bot" |
| Pending connection blocks tools | ✅ | ✅ |
| Approved → returns proxy_key_id | ✅ (Restricted Agent) | ⚠️ Still pending |
| Dashboard link in rejection | ✅ | ✅ |

### What Already Exists (from spike)

| Component | Status | Location |
|-----------|--------|----------|
| `agent_connections` table | ✅ Built | `src/db/schema.ts` |
| MCP connection check | ✅ Built (spike) | `src/app/api/spike/mcp/route.ts` |
| Connections API | ✅ Built (spike) | `src/app/api/connections/route.ts` |
| Discovery endpoints | ✅ Built | `src/app/.well-known/*/route.ts` |
| DB safety guard | ✅ Fixed | `src/db/index.ts` |

### Gotchas Discovered

> [!WARNING]
> - **drizzle schema:** Must pass `schema` to `drizzle()` for `db.query.*` relational queries
> - **Dev vs prod Clerk IDs:** User IDs differ between Clerk instances. DB branches from prod have prod Clerk IDs, not dev Clerk IDs
> - **DB safety:** Added production database safety guard in `db/index.ts` — in dev mode, refuses to fall back to `DATABASE_URL` if no branch URL exists

---

## Phase 1: Auth Flow & Waitlist Removal

*No changes from spike findings. This phase is independent.*

### What Changes

- Remove waitlist gate from landing page and sign-up flow
- Archive CASA Tier 2 documents to `docs/archive/casa-tier-2/`
- Update QA tests that reference waitlist flows

### Files

#### [MODIFY] Landing page CTAs
- Replace "Join Waitlist" → "Get Started" / "Sign Up"

#### [MODIFY] Waitlist page
- Convert to redirect to sign-up or dashboard

#### [MOVE] CASA artifacts → `docs/archive/casa-tier-2/`

#### [MODIFY] QA Tests 01, 07

---

## Phase 2: MCP Server + Pending Approval Dashboard

> [!IMPORTANT]
> This phase is the core of the architecture. The spike validated the pattern — now we productionize it.

### 2A: Schema Migration

The `agent_connections` table already exists from the spike. For production we need to:

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- `agent_connections` — already built ✅
- Verify FK constraints (userId → users, proxyKeyId → proxyKeys)
- Consider adding `client_metadata` JSONB for storing DCR registration details (logo, description)

### 2B: MCP Server (Promote from Spike)

#### [NEW] `src/app/api/mcp/route.ts`
- Promoted from `src/app/api/spike/mcp/route.ts`
- Connection authorization check at every tool call:
  1. Extract `userId` + `clientId` from auth token
  2. Look up `agent_connections` for this pair
  3. If no connection → create pending → return dashboard link
  4. If pending → return dashboard link
  5. If blocked → reject
  6. If approved → resolve `proxyKeyId` → load permissions → execute tool
- Gmail tools: `gmail_list`, `gmail_read`, `gmail_send`, `gmail_forward`, `gmail_labels`, `gmail_attachment`
- Meta tools: `get_my_permissions`, `request_permission`

#### [DELETE] `src/app/api/spike/mcp/route.ts` — replaced by production route

#### [KEEP] `src/app/.well-known/*/route.ts` — discovery endpoints already built

### 2C: Dashboard Connections Tab

#### [MODIFY] [dashboard/page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/page.tsx)
- Add "Connections" tab alongside existing tabs
- Shows all `agent_connections` for the current user:
  - **Pending:** Highlighted, prominent approve/block buttons
  - **Approved:** Shows nickname, bound proxy key label, last used timestamp
  - **Blocked:** Greyed out, option to unblock
- Each connection card shows:
  - App name (from DCR `client_name`)
  - User-editable nickname field
  - Proxy key selector dropdown (from user's existing keys)
  - Created/approved/last-used timestamps
  - Approve / Block buttons

#### [MODIFY] [connections/route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/connections/route.ts)
- Already built in spike ✅
- Add: `PATCH` method for updating nickname/reassigning proxy key
- Add: query parameter filtering (`?status=pending`)

### 2D: Post-Auth Browser Redirect (Option B Hybrid)

When OAuth completes and the browser is redirected back to the callback URL:

#### [NEW] `src/app/oauth/callback/page.tsx`
- After OAuth code exchange (done by MCP client), redirect the **user's browser** to the dashboard connections page
- The redirect includes the new connection ID: `dashboard?tab=connections&highlight=conn_id`
- This gives the user an inline "approve this connection" experience right after OAuth
- Works for browser-based flows. For headless/CLI, the agent message directs the user to the dashboard

### 2E: CLI OAuth

#### [NEW] `packages/fgac-cli/` or `scripts/fgac-auth.ts`
- `npx fgac auth login` — opens browser, runs OAuth, saves token locally
- `npx fgac auth status` — shows current connection status (pending/approved)
- Token stored in `~/.fgac/credentials.json`

### 2F: QA Tests

#### [NEW] `docs/QA_Acceptance_Test/QA_Test_11_MCP_Connection.md`
- Test: Install FGAC as MCP, verify pending → approve → working
- Test: Two agents, different proxy keys, verify isolation
- Test: Block a connection, verify rejection
- Test: Nickname a connection

---

## Phase 3: Skill Packaging & Distribution

### Impact from Spike Findings

The pending approval architecture changes the install experience:

**Before (original plan):** Install → authenticate → select profile → use
**After (validated):** Install → authenticate → told to go to dashboard → approve → use

This is actually a **better** story for distribution because:
1. The SKILL.md instructions can be dead simple: "Add this URL, authenticate"
2. The security story is strong: "Your agent can't do anything until you approve it"
3. The user controls everything from a single place (the dashboard)

### 3A: Claude Code MCP Plugin

#### [MODIFY] [SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)

Install command:
```bash
claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp
```

After running:
1. Claude Code will discover the OAuth endpoints via `/.well-known/`
2. Opens browser for Clerk sign-in → consent (shows "Claude-Code-Agent" or similar)
3. Returns to Claude Code with token
4. First tool call → "⚠️ Pending approval. Visit your dashboard."
5. User approves in dashboard → all subsequent calls work

### 3B: ClawHub (OpenClaw) Distribution

#### [MODIFY] `public/skills/openclaw/SKILL.md`
- Update for MCP-based auth flow
- ClawHub registry listing with proper frontmatter

### 3C: CLI Distribution

```bash
npx fgac auth login
# Opens browser → OAuth → creates pending connection
# "✅ Authenticated! Visit your dashboard to approve this connection."
```

### 3D: Documentation Updates

- README: Installation section with MCP + CLI instructions
- Architecture doc: Updated with pending approval flow diagram
- User guide: How to manage connections in the dashboard

---

## Verification Plan

### Automated Tests
- `npm run build` — verify no TypeScript errors
- DB branch push — verify schema is correct
- curl tests against MCP endpoint — verify pending/approved/blocked states

### Browser Tests (QA)
- QA Test 11: Full MCP connection flow
- QA Test 12: Claude Code MCP install
- QA Test 13: CLI install
- QA Test 14: ClawHub/OpenClaw install

### Manual Verification
- Install from Claude Code on a fresh machine
- Install from OpenClaw on a fresh machine
- Verify third-party agent isolation (two users, different permissions)

---

## Open Questions

> [!IMPORTANT]
> **Re-consent on reconnect:** The spike showed Clerk requires consent on every new OAuth session (not just the first). Is this acceptable UX? The connection binding persists so permissions are preserved, but the user has to click "Allow" in Clerk each time the token expires and the agent re-authenticates.

> [!NOTE]
> **DCR client lifecycle:** When an agent does DCR, the `client_id` persists. But what happens if the user revokes the Clerk OAuth grant? Does the `client_id` still work for re-registration? We should test this in Phase 2.

> [!NOTE]
> **Connection nicknames from DCR metadata:** The DCR `client_name` (e.g., "Claude-Code-Agent") is a good default but may not be meaningful to users. The nickname field lets users override it. Should we also show the original DCR name as a subtitle?
