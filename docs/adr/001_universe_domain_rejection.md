# ADR-001: Rejection of Google `universe_domain` for API Traffic Routing

## Status

**REJECTED** — April 2026

## Context

We explored using Google's `universe_domain` field in Service Account JSON credentials to achieve **zero-code-change** routing of Google API traffic through our FGAC.AI proxy. The idea: set `"universe_domain": "fgac.ai"` in the credential file, and Google SDKs would automatically send all API requests to `*.fgac.ai` instead of `*.googleapis.com`.

This was implemented in commit `459b368` ("feat: universe domain automated credentials") and shipped to production. The FGAC.AI dashboard generated Service Account JSON files with `universe_domain: "fgac.ai"`, and the setup page / user guide told users "Zero code changes needed."

## Decision

**REJECTED.** `universe_domain` does not work for Google Workspace APIs (Gmail, Calendar, Drive). The "zero code change" promise was false. We reverted to Option A: explicit `api_endpoint` / `rootUrl` override with Bearer token authentication.

## Technical Evidence

### What `universe_domain` is designed for

`universe_domain` is a Google Sovereign Cloud / Trusted Partner Cloud feature. It enables isolated Google Cloud deployments in regulated jurisdictions (Germany, France, etc.) where services like BigQuery, Cloud Storage, and Pub/Sub run on separate infrastructure under a custom domain.

It was **never designed** for Google Workspace APIs (Gmail, Calendar, Drive), which only run on `*.googleapis.com`.

### SDK behavior matrix

| Library Layer | `universe_domain` Support | Auto-routes API traffic? |
|---|---|---|
| `@google-cloud/*` (GAPIC) — BigQuery, Storage, etc. | ✅ Full support | ✅ Yes — `service.{universe_domain}` |
| `googleapis` npm / `google-api-python-client` — Gmail, Drive, Calendar | ⚠️ Reads the field | ❌ **No** — hardcoded to `gmail.googleapis.com` |
| `google-auth-library` (auth layer) | ✅ Reads field | ⚠️ Switches to self-signed JWT, bypasses token exchange |
| `gtoken` (JWT→token exchange) | ❌ No support | ❌ Hardcoded to `oauth2.googleapis.com` |

### Live test results (April 12, 2026)

We reproduced the failure using the production credential file and traced the exact request flow:

```
1. SDK reads universe_domain → "fgac.ai" (not default)
2. Auth: SDK switches to self-signed JWT path (bypasses token exchange entirely)
   - Creates JWT: iss=sk_proxy_xxx@fgac.ai, signs with RSA key
   - Uses this JWT directly as Bearer token
3. API call: SDK uses HARDCODED gmail.googleapis.com (ignores universe_domain)
   - Sends: GET https://gmail.googleapis.com/gmail/v1/users/me/labels
   - Header: Authorization: Bearer <self-signed JWT>
4. Google rejects: 401 — "sk_proxy_xxx@fgac.ai" is not a Google service account
```

**Traffic never reached our proxy.** Both auth and API calls went directly to Google.

### Root cause evidence in SDK source code

- **`googleapis` npm** (v171.4.0): `options.rootUrl || 'https://gmail.googleapis.com/'` — hardcoded default, does NOT read `universe_domain` ([gmail/v1.js line 76](https://github.com/googleapis/google-api-nodejs-client))
- **`gtoken`** (v7.1.0): `GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'` — hardcoded, does NOT accept custom token URI ([index.cjs line 55](https://github.com/googleapis/node-gtoken))
- **`google-auth-library`** (v10.5.0): When `universeDomain !== DEFAULT_UNIVERSE`, takes self-signed JWT path via `JWTAccess` class, never calls `gtoken` for token exchange ([jwtclient.js line 74](https://github.com/googleapis/google-auth-library-nodejs))

### Why this cannot be fixed by upgrading SDKs

Google Workspace APIs (Gmail, Calendar, Drive) are **not Cloud services**. They will never run in sovereign clouds. There is no `gmail.my-sovereign-cloud.example` — Gmail runs on `gmail.googleapis.com`, period. The `@google-cloud/*` GAPIC libraries that do support `universe_domain` are for Cloud services (BigQuery, Cloud Storage, Pub/Sub), not Workspace APIs.

## Consequences

### What we use instead

**Option A: Explicit endpoint override + Bearer token** (the pattern that worked before the `universe_domain` experiment):

```python
# Python
service = build("gmail", "v1",
    credentials=Credentials(token=PROXY_KEY),
    client_options={"api_endpoint": "https://fgac.ai/api/proxy"})
```

```javascript
// Node.js
const gmail = google.gmail({
  version: 'v1',
  auth: oauth2Client,  // with access_token = sk_proxy_xxx
  rootUrl: 'https://fgac.ai/api/proxy/'
});
```

This requires two lines of configuration (endpoint + auth), not zero. We are transparent about this in our documentation.

### What we kept

- `/api/auth/token` endpoint — still functional for users who want the SA JSON + explicit `rootUrl` flow
- RSA keypair generation — adds cryptographic signature security independent of `universe_domain`
- Subdomain routing middleware — dormant but costs nothing to maintain

### What we removed/reverted

- "Zero code changes needed" claims from landing page, setup page, user guide
- `GOOGLE_APPLICATION_CREDENTIALS` instructions
- SA JSON download as the primary credential flow (now secondary/advanced)

## DO NOT REVISIT

> **⚠️ This decision should NOT be revisited unless Google fundamentally changes how the `googleapis` npm package / `google-api-python-client` handles `universe_domain` for Workspace APIs.** As of April 2026, there is no indication this will happen — Gmail, Calendar, and Drive are not sovereign cloud services.
>
> If a future engineer or agent suggests using `universe_domain` for zero-code integration, point them to this ADR and the test results above. The idea is elegant on paper but does not work in practice.

## References

- Commit that introduced `universe_domain`: `459b368` ("feat: universe domain automated credentials")
- Implementation plans: `docs/implementation_plans/feature-universe-domain_v1.md`, `v2.md`
- Bug report: `docs/bug_reports/demoClaw_fgac_token_401.md`
- Root cause analysis: `docs/implementation_plans/fix-gmail-fgac-skill-token-bug_v3.md`
- Our own architecture doc predicted this: `docs/architecture_and_strategy.md` line 12 — "The 'Zero Code' Myth"
