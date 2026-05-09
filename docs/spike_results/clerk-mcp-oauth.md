# Clerk MCP OAuth Spike — Test Script & Results

## Objective
Validate 5 critical Clerk capabilities before committing to the MCP server build.

## Prerequisites
- [ ] `npm install @clerk/mcp-tools mcp-handler` (done)
- [ ] Enable DCR in Clerk Dashboard (see below) — **BLOCKING: registration_endpoint not yet in metadata**
- [x] Dev server running (`npm run dev`)

## Step 1: Enable DCR in Clerk Dashboard

1. Go to https://dashboard.clerk.com → your FGAC.ai app
2. Navigate to **Configure → OAuth applications**
3. Toggle **Dynamic Client Registration** to ON
4. Note: This creates a public, unauthenticated registration endpoint

## Step 2: Test Discovery Endpoints

```bash
# Test RFC 9728 — Protected Resource Metadata
curl -s http://localhost:3000/.well-known/oauth-protected-resource/mcp | python3 -m json.tool

# Expected: JSON with authorization_servers array pointing to Clerk
# Example:
# {
#   "resource": "http://localhost:3000",
#   "authorization_servers": ["https://your-instance.clerk.accounts.dev"]
# }

# Test RFC 8414 — Authorization Server Metadata
curl -s http://localhost:3000/.well-known/oauth-authorization-server | python3 -m json.tool

# Expected: JSON with authorization_endpoint, token_endpoint, registration_endpoint
# Example:
# {
#   "issuer": "https://your-instance.clerk.accounts.dev",
#   "authorization_endpoint": "https://your-instance.clerk.accounts.dev/oauth/authorize",
#   "token_endpoint": "https://your-instance.clerk.accounts.dev/oauth/token",
#   "registration_endpoint": "https://your-instance.clerk.accounts.dev/oauth/register",
#   ...
# }
```

### Result: Discovery Endpoints (TESTED 2026-05-09)
- [x] Protected Resource returns valid JSON with authorization_servers → `https://pumped-quetzal-63.clerk.accounts.dev`
- [x] Auth Server Metadata returns valid JSON with all required endpoints (authorization, token, revocation, jwks)
- [ ] registration_endpoint is **NOT present** — DCR needs to be enabled in Clerk Dashboard

**Actual Protected Resource Response:**
```json
{
  "resource": "http://localhost:3000",
  "authorization_servers": ["https://pumped-quetzal-63.clerk.accounts.dev"]
}
```

**Key Auth Server Metadata fields:**
- `authorization_endpoint`: `https://pumped-quetzal-63.clerk.accounts.dev/oauth/authorize`
- `token_endpoint`: `https://pumped-quetzal-63.clerk.accounts.dev/oauth/token`
- `code_challenge_methods_supported`: `["S256"]` (PKCE ✅)
- `scopes_supported`: `openid, profile, email, public_metadata, private_metadata, offline_access`

## Step 3: Test MCP Endpoint Directly

```bash
# Test that the MCP endpoint responds (should 401 without auth)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/spike/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Expected: 401 (Unauthorized)
```

### Result: MCP Endpoint (TESTED 2026-05-09)
- [x] Returns 401 without auth token: `{"error":"invalid_token","error_description":"No authorization provided"}`
- [x] WWW-Authenticate header: `Bearer error="invalid_token", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"`
- [x] Server logs confirm `verifyClerkToken` correctly returns undefined for unauthenticated requests

## Step 4: Test with Claude Code

```bash
# Add the spike MCP server to Claude Code
claude mcp add --transport http fgac-spike http://localhost:3000/api/spike/mcp
```

Then in a Claude Code session:
1. Ask Claude: "Call the spike_whoami tool"
2. Observe:
   - Does a browser window open for Clerk OAuth?
   - Does the Clerk consent screen appear?
   - Does Claude receive a response?

### Result: Claude Code Integration
- [ ] `claude mcp add` command succeeds
- [ ] OAuth flow triggers (browser opens)
- [ ] Clerk consent/login screen appears
- [ ] Claude receives tool response
- [ ] `spike_whoami` output shows authInfo

## Step 5: Inspect Auth Context

From the `spike_whoami` output, document what's in `authInfo`:

```json
// Paste actual output here after test
```

### Key Questions:
- [ ] Is `authInfo.extra.userId` present? (Clerk user ID)
- [ ] What other fields are in `authInfo.extra`?
- [ ] Is `authInfo.clientId` set? (MCP client identifier from DCR)
- [ ] What `authInfo.scopes` were granted?
- [ ] Can we see session claims / custom JWT template data?

## Step 6: Test Custom Claims (if Step 5 passes)

1. Go to Clerk Dashboard → **Sessions** → **Customize session token**
2. Add a custom claim: `"fgac_test": "hello_from_clerk"`
3. Re-run `spike_whoami`
4. Check if the custom claim appears in `authInfo.extra`

### Result: Custom Claims
- [ ] Custom claim appears in authInfo
- [ ] We can inject arbitrary data into the OAuth token
- [ ] This confirms we can inject `fgac_profile_id` later

## Spike Verdict

| # | Capability | Status | Notes |
|---|-----------|--------|-------|
| 1 | DCR works | ⬜ BLOCKED | `registration_endpoint` missing from metadata — need to enable in Clerk Dashboard |
| 2 | OAuth token issuance | ⬜ PENDING | Depends on DCR or manual client registration |
| 3 | Custom claims in tokens | ⬜ PENDING | Need to test after successful OAuth flow |
| 4 | Custom consent redirect | ⬜ PENDING | Need to test after successful OAuth flow |
| 5 | Token verification | ✅ PARTIAL | `verifyClerkToken` correctly rejects unauthenticated requests; need to test with valid token |

### Overall: ⬜ PARTIALLY VALIDATED — need Clerk Dashboard DCR toggle to proceed

**Next steps based on results:**
- All pass → Proceed with Phase 2 as designed
- #3 fails → Use post-auth `select_profile` MCP tool instead of token claims
- #4 fails → Use post-auth `select_profile` MCP tool instead of consent page
- #1 or #2 fails → Fall back to API-key-only MCP auth
