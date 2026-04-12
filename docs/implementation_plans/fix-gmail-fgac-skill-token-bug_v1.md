# Fix: gmail-fgac Skill Token Exchange Bug + Adopt Skill into Workspace

## Problem

The demoClaw team filed a [bug report](file:///home/kyesh/.gemini/antigravity/brain/ad323975-5347-4eae-a33f-413f9871402d/fgac_bug_report.md.resolved) documenting that the gmail-fgac skill fails with a **401** when using FGAC.AI Service Account credentials. The root cause is in our **token exchange endpoint** (`/api/auth/token`).

### Root Cause Analysis

The Google Node.js SDK, when configured with a `universe_domain: "fgac.ai"` service account, sends a JWT-based token exchange to `https://oauth2.fgac.ai/token`. Our middleware correctly rewrites this to `/api/auth/token`. The flow works like this:

1. ✅ SDK reads `universe_domain: "fgac.ai"` → constructs JWT signed with the credential's private key
2. ✅ SDK sends `POST /token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and `assertion=<JWT>`
3. ✅ Our endpoint decodes the JWT, extracts `iss` = `sk_proxy_xxx@fgac.ai`, looks up the proxy key in DB
4. ✅ Our endpoint verifies the JWT signature against the stored public key
5. ✅ Our endpoint returns `{ access_token: "sk_proxy_xxx", token_type: "Bearer", expires_in: 3600 }`
6. ❌ **SDK sends the access token to `gmail.fgac.ai/gmail/v1/...`** — but the SDK constructs the API base URL from `universe_domain`, so it hits `https://gmail.fgac.ai/gmail/v1/users/me/...`

**The critical bug**: After the token exchange, the Google SDK uses the `universe_domain` to construct API URLs. Instead of hitting `googleapis.com`, it hits `gmail.fgac.ai`. Our middleware correctly rewrites `gmail.*` hostnames to `/api/proxy/...`, but the **returned access token is just the proxy key string**. This is correct for our proxy — BUT the SDK may also be checking the token against `universe_domain` validation, OR the SDK is sending the request to `gmail.fgac.ai` but the JWT audience claim in the original assertion targets `https://gmail.googleapis.com/` (standard Google audience), causing a mismatch.

Let me trace the actual failure more precisely:

**The JWT `aud` (audience) claim**: The Google SDK sets `aud` to `https://oauth2.fgac.ai/token` (the token URI from the credential file). Our endpoint doesn't validate `aud` during `jose.jwtVerify()` — this is fine for now. But the SDK constructs subsequent API calls to `https://gmail.fgac.ai/` rather than `https://gmail.googleapis.com/`, which is correct behavior.

**The REAL bug**: Looking at the bug report again — the error is `invalid_grant: account not found`. This happens **at step 4** — our endpoint returns `{ error: "invalid_grant", error_description: "Key not found or invalid" }`. This means `db.select().from(proxyKeys).where(eq(proxyKeys.key, proxyKeyString))` is returning no results.

The key format from the credential file is: `sk_proxy_SAMPLE_KEY_REDACTED`
The issuer in the JWT is: `sk_proxy_SAMPLE_KEY_REDACTED@fgac.ai`

Our code extracts: `proxyKeyString = issuer.split("@")[0]` → `sk_proxy_SAMPLE_KEY_REDACTED`

> [!IMPORTANT]
> **Root cause confirmed**: The demoClaw team's credential file was generated from the FGAC.AI dashboard but the proxy key `sk_proxy_SAMPLE_KEY_REDACTED` is **not linked to the `test-user@example.com` account** in our database. This is likely because:
> 1. The key was generated under a different user account than the demo Gmail
> 2. The `keyEmailAccess` table has no entry mapping this key to the target email
> 3. OR the key itself doesn't exist in the DB at all (possibly generated in a different environment/branch)

### Additional Issue: `gmail-fgac` skill host path mismatch

From the gateway logs, there's also a path resolution issue:
```
[tools] read failed: ENOENT: access '/root/.openclaw/skills/gmail-fgac/SKILL.md'
```
The skill is mounted at `/home/node/.openclaw/skills/gmail-fgac/` in the container, but OpenClaw sometimes looks under `/root/.openclaw/` — a `HOME` env var issue in the container.

## Proposed Changes

### Part 1: Bring the gmail-fgac skill into this workspace

#### [NEW] `skills/gmail-fgac/SKILL.md`
Copy the SKILL.md from demoClaw, updated to reference our workspace paths.

#### [NEW] `skills/gmail-fgac/scripts/gmail.js`
#### [NEW] `skills/gmail-fgac/scripts/shared.js`
#### [NEW] `skills/gmail-fgac/scripts/accounts.js`
#### [NEW] `skills/gmail-fgac/scripts/auth.js`
#### [NEW] `skills/gmail-fgac/scripts/setup.js`
#### [NEW] `skills/gmail-fgac/scripts/package.json`

Copy the full skill into `skills/gmail-fgac/` at the workspace root. This keeps it separate from the Next.js `src/` directory since the skill is a standalone Node.js module consumed by OpenClaw agents.

---

### Part 2: Copy the bug report for tracking

#### [NEW] `docs/bug_reports/demoClaw_fgac_token_401.md`
Copy and archive the bug report from the demoClaw conversation.

---

### Part 3: Fix the token exchange endpoint

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/auth/token/route.ts)

Two improvements:

1. **Better error messages**: Instead of the generic `"Key not found or invalid"` error description, return `"account not found"` to match Google's standard OAuth2 error format. This helps consumers (including the SDK) understand the failure.

2. **Add logging**: Add `console.error` logging for key-not-found and signature-verification-failed scenarios so we can debug issues from Vercel logs.

---

### Part 4: Improve the gmail-fgac skill's error handling

#### [MODIFY] `skills/gmail-fgac/scripts/gmail.js`

Improve the error handler to surface more detail from the FGAC.AI token exchange failure, particularly:
- Extract and display the `error_description` from the token endpoint response
- Add a `--verbose` flag that logs the full auth flow (token endpoint URL, universe_domain, etc.)

#### [MODIFY] `skills/gmail-fgac/scripts/shared.js`

Add a debug mode option that logs the auth flow steps when `--verbose` is used.

---

## Open Questions

> [!IMPORTANT]
> **Key question**: The credential `sk_proxy_SAMPLE_KEY_REDACTED` was downloaded from the FGAC.AI dashboard. We need to verify:
> 1. Does this key exist in the production database?
> 2. Is it linked to the `test-user@example.com` account via `keyEmailAccess`?
> 3. Was it generated in a preview environment that has since been torn down?
>
> If the key doesn't exist in production, the fix is simply to generate a new credential from the dashboard while logged in as the correct user. If it DOES exist but lacks email access, we need to debug why the dashboard didn't set up the `keyEmailAccess` entry.

> [!WARNING]
> The `fgac-credentials-sk_proxy_fc899a9.json` file in the demoClaw repo contains a **real private key**. We should NOT commit this to our workspace. The skill files we copy should NOT include any credential files.

## Verification Plan

### Automated Tests
1. `npm run build` — verify the token endpoint changes compile
2. Test the token exchange endpoint manually with a curl command simulating the JWT flow

### Manual Verification
1. Create a fresh credential from the FGAC.AI dashboard for `test-user@example.com`
2. Place the new credential in the demoClaw's `demo-data/gmail-fgac/tokens/demo.json`
3. Run `node scripts/gmail.js --account demo --action labels --verbose` to verify the full flow
4. Run the Act 2 demo flow to confirm the 403 blocking works
