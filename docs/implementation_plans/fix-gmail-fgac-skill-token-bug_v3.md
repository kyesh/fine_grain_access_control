# Strategic Reassessment: FGAC.AI Auth Workflow

## The Problem

The `universe_domain` feature was adopted based on the premise that Google SDKs would **automatically** route all API traffic through `*.fgac.ai` when a credential file contains `"universe_domain": "fgac.ai"`. This was documented as a "zero code change" solution.

**My investigation proves this is wrong.** Here's exactly what happens:

## What `universe_domain` Actually Does

`universe_domain` was built by Google for [Sovereign Cloud / Trusted Partner Cloud](https://cloud.google.com/blog/products/identity-security/google-cloud-sovereign-controls) — isolated Google Cloud deployments in regulated jurisdictions (Germany, France, etc.). It is designed for:

| Library Type | `universe_domain` Support | Auto-routes API traffic? |
|---|---|---|
| `@google-cloud/*` (GAPIC) libraries | ✅ Full support | ✅ Yes — `service.{universe_domain}` |
| `googleapis` npm / `google-api-python-client` | ⚠️ Reads the field | ❌ **No** — hardcoded to `gmail.googleapis.com` |
| Auth (`google-auth-library`) | ✅ Reads field, changes auth behavior | ⚠️ Changes to self-signed JWT, bypasses token exchange |
| `gtoken` (JWT→token exchange) | ❌ No support | ❌ Hardcoded to `oauth2.googleapis.com` |

### The Critical Mismatch

Gmail, Calendar, Drive — the APIs we proxy — are **Google Workspace** APIs, not **Google Cloud** APIs. They use `googleapis` / `google-api-python-client`, NOT the `@google-cloud/*` GAPIC libraries. The GAPIC libraries are for things like BigQuery, Cloud Storage, Pub/Sub — services that actually run in sovereign clouds.

**Google Workspace APIs will never auto-resolve `universe_domain` because Gmail doesn't run in sovereign clouds.** There is no `gmail.my-sovereign-cloud.example` — Gmail runs on `gmail.googleapis.com`, period.

### What Actually Happens End-to-End

```
User drops in fgac-credentials.json with universe_domain: "fgac.ai"
  │
  ▼
Google SDK reads universe_domain → "fgac.ai" (not default)
  │
  ▼
Auth: SDK switches to self-signed JWT path (no token exchange)
  │  SDK creates JWT: iss=sk_proxy_xxx@fgac.ai, signs with RSA key
  │  This JWT is used directly as Bearer token
  │
  ▼
API call: SDK uses HARDCODED gmail.googleapis.com (ignores universe_domain)
  │  Sends: GET https://gmail.googleapis.com/gmail/v1/users/me/labels
  │  Header: Authorization: Bearer <self-signed JWT>
  │
  ▼
Google rejects: 401 — "sk_proxy_xxx@fgac.ai" is not a Google service account
```

Traffic **never reaches our servers**. Both auth and API calls go to Google directly.

## The Three Options

---

### Option A: Revert to Simple Bearer Token + Explicit Endpoint (Recommended)

**This is what already worked before the `universe_domain` experiment**, and what the existing Claude Code, Claude Cowork, and OpenClaw skills already use.

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
  rootUrl: 'https://fgac.ai/api/proxy/',
  auth: new google.auth.OAuth2().setCredentials({ access_token: PROXY_KEY })
});
```

**Pros:**
- Works today, right now, with zero DNS changes
- No fragile dependency on SDK internals
- Simple to explain: "Here's your key, here's your endpoint"
- Works across ALL languages and SDKs
- Works with non-Google HTTP clients (curl, fetch, requests)
- Our existing skills already document this pattern

**Cons:**
- Requires 2 lines of code change (endpoint + auth)
- Not the "zero code change" dream

**What to do with existing infrastructure:**
- Keep the `/api/auth/token` endpoint — it still works and is useful for the Service Account JSON format
- Keep the RSA keypair gen — adds security value even for Bearer token flow
- Remove `oauth2.fgac.ai` and `gmail.fgac.ai` DNS/middleware routing — unnecessary complexity
- Update the setup page to stop saying "Zero code changes needed"

---

### Option B: Hybrid — Keep SA JSON, Require `rootUrl` Override

Keep downloading the Service Account JSON, but explicitly document that agents must override the API endpoint. The token exchange through our `/api/auth/token` endpoint still works IF:
1. DNS is set up for `oauth2.fgac.ai`
2. The skill/agent patches `gtoken` to use the custom `token_uri`

```javascript
// Agent code
const creds = JSON.parse(fs.readFileSync('fgac-credentials.json'));
const gmail = google.gmail({
  version: 'v1',
  rootUrl: `https://gmail.${creds.universe_domain}/`,  // Still need this!
  auth: /* still complex */
});
```

**Pros:**
- The credential file feels more "Google-native"
- RSA-signed JWT adds a security layer vs raw Bearer tokens

**Cons:**
- Still requires code changes (rootUrl override)
- Requires DNS subdomain setup (oauth2, gmail)
- More complex auth flow — agents must handle JWT signing, token exchange
- The SA JSON creates a false expectation of "drop-in" compatibility
- The `gtoken` library hardcodes Google's token URL — we'd need to monkey-patch or fork it

---

### Option C: FGAC.AI Wrapper SDK

Build thin wrapper packages (`@fgac/gmail`, `fgac-gmail-python`) that handle the endpoint override internally.

```javascript
// npm install @fgac/gmail
const gmail = require('@fgac/gmail')('path/to/fgac-credentials.json');
const messages = await gmail.users.messages.list({ userId: 'me' });
```

**Pros:**
- Truly zero code change after install
- Full control over auth and routing
- Nice DX

**Cons:**
- Significant engineering investment (build + maintain per-language SDKs)
- Users must install our package instead of the official Google SDK
- Ecosystem lock-in concern
- Not viable short-term

---

## Recommendation

> [!IMPORTANT]
> **Go with Option A.** It's what already works, what the existing skills already document, and it's honest. The `universe_domain` approach was a bet that didn't pay off — the Google SDK simply doesn't support it for Workspace APIs.

### Concrete Changes

1. **Setup page**: Remove "Zero code changes needed" claim. Be upfront: "Two lines of configuration — endpoint URL and Bearer token."
2. **Credential download**: Keep the SA JSON download as an *optional* advanced path. Add a simpler "Copy Bearer Token" option as the primary flow.
3. **Skills**: Update the `gmail-fgac` skill for OpenClaw to use explicit `rootUrl` + Bearer token. No `universe_domain` magic.
4. **Documentation**: Update `user_guide.md` to reflect reality. Include copy-paste examples for Python, Node.js, curl.
5. **Middleware**: Keep the subdomain routing code (`gmail.*` → proxy) for the future, but don't actively set up DNS for it. It costs nothing to leave in place.
6. **Token endpoint**: Keep `/api/auth/token` alive — it's useful if anyone DOES set up the full SA flow. But it's not the primary path.

### What NOT to rip out

The RSA keypair infrastructure is still valuable:
- It adds a cryptographic signature verification layer beyond just checking `sk_proxy_xxx` strings
- It enables key rotation without credential file redistribution
- It's the foundation for future mTLS or short-lived token flows

## Open Question

> [!IMPORTANT]
> **Do you want to deprecate the SA JSON download entirely**, or keep it as a secondary option alongside a simpler "Copy your API key + endpoint" primary flow?
>
> The SA JSON still has value — it bundles the key AND the endpoint URL in one file, and adds RSA signature security. But it creates the false impression of "just set GOOGLE_APPLICATION_CREDENTIALS and go", which simply doesn't work.
