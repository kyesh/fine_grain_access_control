# Fix: gmail-fgac Skill Token Exchange Bug + Adopt Skill into Workspace

## Problem

The demoClaw team filed a [bug report](file:///home/kyesh/.gemini/antigravity/brain/ad323975-5347-4eae-a33f-413f9871402d/fgac_bug_report.md.resolved) documenting that the gmail-fgac skill fails with a **401** when using FGAC.AI Service Account credentials.

## Root Cause (Confirmed via Live Debugging)

I reproduced the issue locally and traced the exact failure. The root cause is **two-fold** — both in the skill code and in missing DNS infrastructure.

### Bug 1: SDK sends API requests to `gmail.googleapis.com`, not `gmail.fgac.ai`

The Google Node.js SDK (`googleapis` v171.4.0) defaults the Gmail API root URL to `https://gmail.googleapis.com/`. Even though the credential has `universe_domain: "fgac.ai"`, the SDK does **not** automatically derive the API endpoint from the universe domain for Google Workspace APIs. The `rootUrl` must be explicitly overridden:

```javascript
// Current (broken) — goes to gmail.googleapis.com
const gmail = google.gmail({ version: 'v1', auth: client });

// Fixed — routes through our proxy
const gmail = google.gmail({ version: 'v1', auth: client, rootUrl: 'https://gmail.fgac.ai/' });
```

**Evidence**: My test shows the request goes to `https://gmail.googleapis.com/gmail/v1/users/me/labels` and Google rejects the self-signed JWT because `sk_proxy_xxx@fgac.ai` is not a Google service account.

### Bug 2: Auth uses self-signed JWTs, which Google rejects

For non-default `universe_domain`, the SDK takes the **self-signed JWT code path** (line 74 of `jwtclient.js`), not the token exchange path. This means:
- The SDK creates a JWT signed with the credential's private key
- This JWT is used directly as a `Bearer` token in the `Authorization` header
- Google's Gmail API rejects it with 401 because the issuer `sk_proxy_xxx@fgac.ai` is unknown to Google

The `getAccessToken()` call (gtoken-based token exchange) separately fails because `gtoken` hardcodes the token URL to `https://oauth2.googleapis.com/token`, ignoring the credential's custom `token_uri`. But this code path is never actually reached for non-default universe domains.

### Bug 3: `oauth2.fgac.ai` and `gmail.fgac.ai` DNS subdomains don't exist

Neither subdomain resolves in DNS:
```
$ dig oauth2.fgac.ai +short  →  (empty - no DNS record)
$ dig gmail.fgac.ai +short   →  (empty - no DNS record)
```

Even if we fix the skill code, the requests have nowhere to go.

> [!IMPORTANT]
> **Summary of what needs to happen**: We need to:
> 1. Add `oauth2.fgac.ai` and `gmail.fgac.ai` CNAME records pointing to Vercel
> 2. Add both subdomains to the Vercel project
> 3. Fix the gmail-fgac skill to explicitly set `rootUrl` and handle the token exchange properly
> 4. Our middleware already handles the subdomain routing correctly — no backend changes needed

### Database Verification (No DB Issues)

I verified the production database. The key chain is **fully intact**:

| Check | Status | Detail |
|---|---|---|
| Proxy key exists | ✅ | `sk_proxy_SAMPLE_KEY_REDACTED` — created 2026-04-12 |
| Key has public key | ✅ | RSA public key stored |
| Key not revoked | ✅ | `revoked_at` is NULL |
| Key owner | ✅ | User `test-user@example.com` (Clerk: `user_3CEigU8CYN8qoKZMp4B0WeR3k9D`) |
| Email access | ✅ | `key_email_access` entry linking key to `test-user@example.com` |
| Access rules | ✅ | 1 send_whitelist rule: `Principle@preshool.com` |

The backend token endpoint (`/api/auth/token`) and proxy (`/api/proxy/[...path]`) code is correct. The problem is entirely that traffic never reaches them.

## Proposed Changes

### Part 1: DNS & Vercel Configuration (requires user action)

> [!CAUTION]
> These DNS changes modify production infrastructure. I'll prepare the commands but they require your explicit approval.

1. **Add Vercel domains**: `oauth2.fgac.ai` and `gmail.fgac.ai` to the Vercel project
2. **Add Cloudflare CNAME records**: Both pointing to `cname.vercel-dns.com` (DNS-only, no proxy)

---

### Part 2: Bring gmail-fgac skill into the workspace

Per your comment about confusing coding agents — I'll place the skill under `docs/skills/gmail-fgac/` instead of the workspace root. This signals it's documentation/reference material, not a skill consumed by agents in this workspace.

#### [NEW] `docs/skills/gmail-fgac/SKILL.md`
#### [NEW] `docs/skills/gmail-fgac/scripts/gmail.js`
#### [NEW] `docs/skills/gmail-fgac/scripts/shared.js`
#### [NEW] `docs/skills/gmail-fgac/scripts/accounts.js`
#### [NEW] `docs/skills/gmail-fgac/scripts/auth.js`
#### [NEW] `docs/skills/gmail-fgac/scripts/setup.js`
#### [NEW] `docs/skills/gmail-fgac/scripts/package.json`

Copy the full skill from demoClaw. **Does NOT include credentials or `node_modules`**.

---

### Part 3: Fix the gmail-fgac skill code

#### [MODIFY] `docs/skills/gmail-fgac/scripts/gmail.js`

Fix the Gmail API client initialization to route through the FGAC.AI proxy:

```javascript
// Before
const gmailOpts = { version: 'v1', auth };
if (token.type === 'service_account' && token.universe_domain) {
  const client = await auth.getClient();
  gmailOpts.auth = client;
}

// After
const gmailOpts = { version: 'v1', auth };
if (token.type === 'service_account' && token.universe_domain) {
  // Route API requests through the FGAC.AI proxy
  gmailOpts.rootUrl = `https://gmail.${token.universe_domain}/`;
}
```

Remove the `getClient()` call — we don't want self-signed JWTs. Instead, do a proper token exchange and use the returned access token.

#### [MODIFY] `docs/skills/gmail-fgac/scripts/shared.js`

Fix `getAuthClient()` for service account to do token exchange explicitly, then set the access token on a standard OAuth2 client:

```javascript
if (token.type === 'service_account') {
  // Exchange JWT for access token via FGAC.AI token exchange
  const jwt = createSignedJWT(token);
  const accessToken = await exchangeToken(token.token_uri, jwt);
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return oauth2;
}
```

This bypasses the SDK's built-in JWT handling entirely and uses our token exchange endpoint directly.

---

### Part 4: Archive the bug report

#### [NEW] `docs/bug_reports/demoClaw_fgac_token_401.md`

Archive the bug report with our root cause findings appended.

---

### Part 5: Improve token endpoint logging

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/auth/token/route.ts)

Add `console.log` for incoming token exchange requests (key extraction, lookup result) so we can monitor usage in Vercel logs.

## Verification Plan

### Automated Tests
1. `npm run build` — verify all changes compile
2. Run `node docs/skills/gmail-fgac/scripts/gmail.js --account demo --action labels --verbose` to test the full flow

### Manual Verification
1. After DNS propagation, verify `dig oauth2.fgac.ai` and `dig gmail.fgac.ai` resolve
2. `curl -X POST https://oauth2.fgac.ai/token -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=test"` — verify it reaches our endpoint (should return 400, not DNS error)
3. Run the demoClaw Act 2 demo flow end-to-end
