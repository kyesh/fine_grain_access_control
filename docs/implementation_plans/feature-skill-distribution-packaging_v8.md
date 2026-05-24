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

**Multi-email support** (mirrors proxy API behavior):
- Connection → proxy_key → `key_email_access` → list of authorized emails
- For delegated emails, resolve the email owner's Clerk user → fetch their Google OAuth token
- Each Gmail tool takes an optional `account` parameter (defaults to key owner's email)

**Tools:**
- `list_accounts()` → returns emails this agent can access (from `key_email_access`)
- `gmail_list({ account?, query?, max? })` → list emails
- `gmail_read({ account?, messageId })` → read a specific email
- `gmail_send({ account?, to, subject, body })` → send (enforces send_whitelist rules)
- `gmail_forward({ account?, messageId, to })` → forward
- `gmail_labels({ account? })` → list labels
- `gmail_attachment({ account?, messageId, attachmentId })` → download attachment
- `get_my_permissions()` → show current access rules
- `request_permission({ description })` → request expanded access

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
  - **Nickname** (user-editable, prominent) — the user's label for this agent
  - **App name** (from DCR `client_name`) shown as subtitle under the nickname
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

#### [NEW] `packages/fgac-cli/`

**What gets installed on the user's machine:** The CLI is distributed as an npm package (e.g., `@fgac/cli` or `fgac`). When the user runs `npx fgac auth login`, npx downloads it temporarily — nothing persists except `~/.fgac/credentials.json`.

**Dependencies:** The CLI only needs built-in Node.js APIs (`node:http` for the local callback server, `node:https` for the token exchange POST, `node:fs` for credential storage). No heavy SDKs required — the OAuth token exchange is a single HTTP POST to Clerk's `/oauth/token` endpoint.

**Commands:**
- `npx fgac auth login` — opens browser, runs OAuth, saves tokens locally
- `npx fgac auth status` — shows current connection status (pending/approved)
- `npx fgac auth refresh` — manually refresh an expired access token

**Token storage:** `~/.fgac/credentials.json`
```json
{
  "server": "https://gmail.fgac.ai",
  "access_token": "eyJhbG...",
  "refresh_token": "MDFLOWVJM2...",
  "expires_at": 1778446914,
  "client_id": "uJytZBYnERUpjv4g"
}
```

**Refresh logic:** On each CLI invocation, check `expires_at`. If expired, POST `grant_type=refresh_token` to Clerk's token endpoint, save the new access token. If refresh fails (revoked), prompt `fgac auth login` again. This is ~50 lines of standard Node.js code.

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

### ClawHub Trust Scoring — Research Findings

ClawHub does **not** have a single "trust score" number. Trust is derived from multiple signals:

| Signal | What it checks | Impact on our skill |
|--------|---------------|-------------------|
| **VirusTotal scan** | Auto-scans published skill files. Labels: "benign" / "suspicious" / "malicious" | Our SKILL.md + scripts are clean — should pass ✅ |
| **Behavioral analysis** | Checks for undeclared credential requests, **unauthorized network installations**, runtime instruction inconsistencies | ⚠️ An `npx` install step could flag this |
| **Community signals** | Download counts, stars, version history | New skill starts at zero — needs time |
| **Publisher reputation** | GitHub activity, history | Our FGAC.ai GitHub is active ✅ |
| **"100/3 Rule"** | Community advice: prefer 100+ downloads, 3+ months on ClawHub | We'll need early adopters |

> [!WARNING]
> **NPX concern is valid.** ClawHub's behavioral scanner checks for "unauthorized network installations." An `npx fgac auth login` step in a SKILL.md could be flagged as suspicious because:
> 1. The scanner can't inspect the npm package contents (opaque external dependency)
> 2. It looks like the skill is downloading and executing arbitrary code
> 3. It breaks the "all behavior visible in SKILL.md" transparency principle

### Strategy: Platform-Appropriate Distribution

Different platforms have different strengths. Rather than force one approach:
- **Claude Code** → Remote MCP server (native MCP support, auto-discovery)
- **OpenClaw** → Local scripts + REST proxy API (code flexibility, full API surface, scanner-friendly)
- **CLI** → Separate npm package (independent distribution)

### 3A: Claude Code MCP Plugin

#### [MODIFY] [SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)

Install command:
```bash
claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp
```

After running:
1. Claude Code discovers OAuth endpoints via `/.well-known/`
2. Opens browser for Clerk sign-in → consent
3. Returns to Claude Code with token
4. First tool call → "⚠️ Pending approval. Visit your dashboard."
5. User approves in dashboard → all subsequent calls work

### 3B: ClawHub (OpenClaw) Distribution — Local Scripts + REST API

> [!IMPORTANT]
> **OpenClaw should NOT use the remote MCP server.** OpenClaw's core value is that the agent can read, modify, and extend skill code. A remote MCP server is:
> - An opaque black box (worse than npx for scanner trust)
> - Limited to only the MCP tools we predefine
> - Kills OpenClaw's ability to innovate on the full Gmail API
>
> Instead, keep the **local scripts approach** that already exists in `docs/skills/gmail-fgac/`. The agent calls our REST proxy API directly, which gives it the full Gmail API surface with FGAC access controls.

#### [MODIFY] `docs/skills/gmail-fgac/SKILL.md`
- Update auth flow for pending approval pattern
- Update `scripts/auth.js` to use Clerk OAuth (replacing manual token setup)
- Keep `scripts/gmail.js` — full Gmail API through REST proxy
- Keep `scripts/accounts.js` — multi-account management
- All scripts are local, readable, modifiable by the agent

```yaml
---
name: gmail-fgac
description: "Secure Gmail access for AI agents with fine-grained permissions"
signature: "sha256:..."
when_to_use: |
  User wants to read, send, or manage Gmail through a security proxy
  that enforces per-agent permission boundaries.
license: MIT-0
metadata:
  author: fgac-ai
  version: "2.0.0"
  openclaw:
    emoji: "🛡️"
    requires:
      bins: [node]
      network: true
---
```

**Why this is better for ClawHub trust:**
- VirusTotal can scan all `.js` files directly ✅
- Behavioral analysis sees code that matches described behavior ✅
- No opaque external dependencies (the REST proxy URL is declared) ✅
- Agent can read/modify scripts to add features or adapt workflows ✅

### 3C: CLI Distribution (Separate from ClawHub)

The CLI is distributed **independently** via npm, not bundled into the ClawHub skill:

```bash
npx fgac auth login
```

This is for users who prefer CLI workflows or use agents without built-in MCP OAuth. It's a separate npm package (`@fgac/cli`) with its own README, not part of the ClawHub listing.

**Trust impact on ClawHub:** None — completely separate distribution channel.

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

### Token Expiration & Re-consent ✅

#### Spike Validation — Refresh Tokens Confirmed

| Evidence | Source | Result |
|----------|--------|--------|
| Spike #1 token response | Token exchange HTTP 200 | `"refresh_token": "MDFLOWVJM2..."` ✅ |
| Spike #2 Client 1 | Claude-Code-Agent callback | `"has_refresh_token": true` ✅ |
| Spike #2 Client 2 | Third-Party-Bot callback | `"has_refresh_token": true` ✅ |
| `offline_access` scope | DCR auto-granted | `"scope": "email profile offline_access"` ✅ |
| Clerk server metadata | `grant_types_supported` | `["authorization_code", "refresh_token"]` ✅ |

#### Token Lifetimes (Clerk — fixed, not configurable)

| Token Type | Lifetime | Implication |
|-----------|----------|-------------|
| Access token | **24 hours** | Short-lived JWT, verified locally |
| Refresh token | **Never expires** | Used to silently renew access tokens |
| Authorization code | 10 minutes | Standard OAuth |

#### Refresh Token Responsibility — Per Auth Path

| Auth Path | Who is the OAuth client? | Who manages refresh tokens? | Our code needed? |
|-----------|-------------------------|---------------------------|-----------------|
| **MCP OAuth** (Claude Code, OpenClaw) | The MCP host app | Host app handles it per MCP spec | **No** — server only validates access tokens |
| **API Key** (`sk_proxy_...`) | N/A — no OAuth | No tokens at all | **No** — keys are long-lived |
| **CLI** (`npx fgac auth login`) | **Our CLI tool** | **Our CLI code** | **Yes** — must store + refresh tokens |

> [!WARNING]
> The CLI tool (Phase 2E) is the one auth path where **we** are the OAuth client. It must:
> - Store `access_token` + `refresh_token` in `~/.fgac/credentials.json`
> - Detect expired access tokens → exchange refresh token for a new one
> - Handle revoked refresh tokens gracefully (prompt `fgac auth login` again)
>
> This is ~50 lines of standard OAuth client code using built-in Node.js APIs (`node:https` for the token exchange POST). No heavy SDK dependency needed — see Phase 2E for details.

**Our MCP server** (the resource server) never sees or stores refresh tokens regardless of path. It only validates the short-lived access token JWT.

**Impact on UX:** Re-consent is only needed when:
- Refresh token is lost (e.g., agent reinstalled, CLI credentials deleted) — user re-authenticates once, connection mapping persists
- User revokes grant in Clerk dashboard — refresh token invalidated, full re-auth required
- Day-to-day use: **zero re-consent friction** ✅

This is acceptable UX ✅

### Connection Nickname UX ✅

Show **both** the user-assigned nickname (prominent) and the original DCR `client_name` (as subtitle). Example:
```
┌─────────────────────────────────────┐
│  My Work Agent                      │  ← user-assigned nickname
│  Claude-Code-Agent                  │  ← DCR client_name (subtitle)
│  Proxy Key: Restricted Agent        │
│  Last used: 2 minutes ago           │
└─────────────────────────────────────┘
```

## Remaining Open Questions

> [!NOTE]
> **DCR client lifecycle:** When an agent does DCR, the `client_id` persists. But what happens if the user revokes the Clerk OAuth grant? Does the `client_id` still work for re-registration? We should test this in Phase 2.
