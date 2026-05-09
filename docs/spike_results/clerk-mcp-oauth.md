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
We cannot inject `fgac_profile_id` into the Clerk OAuth token, and we cannot replace the consent page.

### Solution: Post-Auth Profile Selection

```
Agent → MCP → Clerk OAuth (sign-in + consent)
  → Token issued with just userId
  → MCP server receives token
  → Looks up userId → finds user's agent profiles
  → If 1 profile: auto-select
  → If 0 profiles: auto-create default
  → If N profiles: MCP exposes `select_profile` tool
     → Agent calls select_profile before any other tool
     → Server stores selection in MCP session
  → All subsequent calls use selected profile's permissions
```

This is the **Fallback #4** from the original spike plan, and it works cleanly:

1. **Zero friction for single-profile users** — auto-selection
2. **Agent-driven for multi-profile users** — the agent calls `select_profile` (the agent can describe the profiles to the human and help them choose)
3. **No custom consent UI needed** — works with Clerk's standard flow
4. **Session-scoped** — profile selection persists for the MCP session

### Required MCP Tools (updated)

| Tool | When Available |
|------|---------------|
| `select_profile` | Always first call — returns list or auto-selects |
| `get_my_permissions` | After profile selected |
| `gmail_list/read/send/...` | After profile selected |
| `request_permission` | After profile selected |

---

## Environment Notes

- Clerk instance: `pumped-quetzal-63.clerk.accounts.dev`
- DCR: enabled in development
- Valid scopes: `email profile offline_access`
- Test user: `user_3BJN08XElmDVNILqWw1IT4fXzUd` (test user)
- Test client: `dGd3hVEbAbMZNBbK`
