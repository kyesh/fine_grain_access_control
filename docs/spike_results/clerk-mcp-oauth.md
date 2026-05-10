# Clerk MCP OAuth Spike — Results

## Final Verdict

| # | Capability | Status | Notes |
|---|-----------|--------|-------|
| 1 | **DCR works** | ✅ **PASS** | Programmatic client registration via `POST /oauth/register` |
| 2 | **OAuth token issuance** | ✅ **PASS** | Auth Code + PKCE flow completes, returns `access_token` + `refresh_token` |
| 3 | **Custom claims in tokens** | ⚠️ **PARTIAL** | Token only has `sub` (userId). Custom claims need JWT template config. |
| 4 | **Consent page** | ✅ **PASS** | Clerk shows built-in consent at `accounts.dev/oauth-consent`. Shows app name, user, scopes. We can't replace this page, but we CAN add a post-consent agent profile step. |
| 5 | **Token verification** | ✅ **PASS** | `verifyClerkToken()` returns `authInfo` with `userId`. Auth pipeline works end-to-end. |

### Overall: ✅ VIABLE — proceed with Phase 2 (with adjustments)

---

## Detailed Findings

### Test 1: Dynamic Client Registration (DCR)

**Status:** ✅ PASS

```bash
curl -X POST https://pumped-quetzal-63.clerk.accounts.dev/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name": "fgac-spike-test", ...}'
```

**Response:**
```json
{
  "client_id": "dGd3hVEbAbMZNBbK",
  "client_secret": "xVUG5Ep9Od84G5ECRKwtYeHoXzz551bZ",
  "scope": "email offline_access profile",
  "token_endpoint_auth_method": "client_secret_post"
}
```

**Key finding:** DCR auto-assigns scopes `email offline_access profile`. Custom scopes like `openid`, `public_metadata`, `private_metadata` are **rejected** if requested.

### Test 2: OAuth Token Issuance

**Status:** ✅ PASS

Full Auth Code + PKCE flow completed:
1. Authorization URL → Clerk sign-in → Google account → Google consent → Clerk consent → Callback
2. Token exchange returned HTTP 200

**Token response:**
```json
{
  "access_token": "eyJhbG...",
  "expires_in": 86400,
  "refresh_token": "MDFLOWVJM2...",
  "scope": "email profile offline_access",
  "token_type": "bearer"
}
```

**Scope constraint discovered:**
- `openid` → ❌ rejected
- `public_metadata` → ❌ rejected
- `private_metadata` → ❌ rejected
- `email profile offline_access` → ✅ accepted

### Test 3: Access Token Claims

**Status:** ⚠️ PARTIAL

Decoded JWT claims:
```json
{
  "client_id": "dGd3hVEbAbMZNBbK",
  "exp": 1778445423,
  "iat": 1778359022,
  "iss": "https://pumped-quetzal-63.clerk.accounts.dev",
  "jti": "oat_T6R0A1C379HWAWRF",
  "nbf": 1778359012,
  "scope": "email profile offline_access",
  "sub": "user_3BJN08XElmDVNILqWw1IT4fXzUd"
}
```

**Key finding:** The token contains `sub` (Clerk user ID) but **no custom claims**. We have `sub = user_3BJN08XElmDVNILqWw1IT4fXzUd` which we can use to look up the user. Custom claims (like `fgac_profile_id`) would need JWT template configuration.

**Impact on architecture:** Since we can't inject `fgac_profile_id` into the token natively, we use a **post-auth profile selection step** instead (see updated architecture below).

### Test 4: Consent Page

**Status:** ✅ PASS (with caveat)

Clerk provides a **built-in consent page** at `accounts.dev/oauth-consent`:
```
"fgac-spike-test wants to access Fine-Grain-Access-Control 
 on behalf of user@example.com"

This will allow fgac-spike-test access to:
- Your email address
- Your basic profile information

[Deny] [Allow]
```

**Key finding:** We **cannot replace** Clerk's consent page with our own custom agent profile picker. The consent page is hosted on Clerk's domain and is part of their OAuth flow.

**Impact on architecture:** Agent profile selection must happen AFTER OAuth consent, not during it. See updated architecture below.

### Test 5: Token Verification

**Status:** ✅ PASS

Server logs confirm:
```
Clerk auth userId: user_3BJN08XElmDVNILqWw1IT4fXzUd 
verifyClerkToken result: SUCCESS 
authInfo.extra keys: [ 'userId' ]
```

`verifyClerkToken()` from `@clerk/mcp-tools/next` successfully:
- Validates the JWT signature
- Extracts `userId` from the token
- Returns it in `authInfo.extra.userId`

---

## Architecture Revision Based on Findings

### Problem
1. We cannot inject `fgac_profile_id` into the Clerk OAuth token
2. We cannot replace the consent page
3. The agent must NEVER control its own permissions — user must bind profiles

### Solution: User-Controlled Pending Approval (Validated in Spike #2)

```
Agent → MCP endpoint → OAuth → Clerk consent → Token issued (userId + clientId)
  → Agent calls MCP tool → MCP creates "pending" connection record
  → MCP returns: "⚠️ Not approved yet. Ask user to visit dashboard."
  → User opens dashboard → sees new pending connection
  → User approves + assigns a proxy key (agent profile) + optional nickname
  → Agent retries → MCP resolves connection → approved → uses profile's permissions
  → Future sessions with same clientId auto-inherit (one-time approval)
```

### Why This Works

1. **User controls permissions** — The agent NEVER selects its own profile
2. **Deny-by-default** — Unapproved connections can't access anything
3. **One-time friction** — Same `client_id` reconnecting auto-inherits approval
4. **Third-party safe** — Give any agent your MCP URL; approve with specific permissions
5. **Distinguishable agents** — Each DCR client has a unique name shown in Clerk consent

---

## Spike #2: Pending Approval Flow — ✅ VALIDATED

### Setup
- Registered two distinct DCR clients: `Claude-Code-Agent` and `Third-Party-Bot`
- Each got a unique `client_id` (persistent per agent)
- Clerk consent page shows the correct `client_name` for each

### Results

| Test | Client 1 (Claude-Code-Agent) | Client 2 (Third-Party-Bot) |
|------|------|------|
| DCR registration | ✅ `uJytZBYnERUpjv4g` | ✅ `fol7nvq2PC6ctcQu` |
| Clerk consent name | "Claude-Code-Agent" | "Third-Party-Bot" |
| Connection created | ✅ `80c1f9ac-...` (pending) | ✅ `f829fc24-...` (pending) |
| MCP before approval | ⚠️ "pending_approval" + dashboard link | ⚠️ "pending_approval" + dashboard link |
| User approves Client 1 | ✅ Bound to "Restricted Agent" key | — |
| MCP after approval | ✅ Returns proxy_key_id + nickname | ⚠️ Still pending |

### Key Validation Points

1. **Two agents, same user, different approval states** — Confirmed
2. **Pending connection blocks all MCP tools** — Confirmed
3. **Approval binds connection to specific proxy key** — Confirmed
4. **Approved connection returns proxy_key_id** — Confirmed
5. **Dashboard link included in pending message** — Confirmed

### Schema

```sql
agent_connections (
  id, user_id, client_id, client_name, nickname,
  proxy_key_id (NULL=pending), status, created_at, approved_at, last_used_at
  UNIQUE(user_id, client_id)
)
```

---

## Environment Notes

- Clerk instance: `pumped-quetzal-63.clerk.accounts.dev`
- DCR: enabled in development
- Valid scopes: `email profile offline_access`
- mcp-handler basePath: `/api/spike` (handler appends `/mcp` automatically)
- Test clients: `uJytZBYnERUpjv4g` (Claude-Code-Agent), `fol7nvq2PC6ctcQu` (Third-Party-Bot)
