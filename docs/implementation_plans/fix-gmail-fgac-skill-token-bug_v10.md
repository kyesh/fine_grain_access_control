# Root URL Override: Fix Broken SDK Configuration Across All Skills & Docs

## Root Cause

The `scripts/qa_agent/` directory uses **raw `fetch()` with manually-constructed URLs**, completely bypassing the Google SDKs:

```javascript
// scripts/qa_agent/gmail_api.js — THIS IS THE PROBLEM
const url = `${PROXY_URL}${endpoint}`;  // PROXY_URL + "/gmail/v1/users/me/messages"
await fetch(url, { headers: { Authorization: `Bearer ${PROXY_API_KEY}` } });
```

This made the proxy *appear* to work, because the QA tests never tested the actual SDK configuration we tell users to use. Meanwhile:
- The Python `api_endpoint` value is **wrong** (missing `/gmail/v1`)
- The Node.js `rootUrl` value **gets its path stripped** by the SDK internals

**We were testing a different code path than our users would follow.**

---

## Empirical SDK Test Results (Local)

### Node.js `googleapis` v171.4.0

Tested against a local HTTP capture server on port 9876:

| Option Passed | Request Arrived at Server? | URL Path Received |
|--------------|---------------------------|-------------------|
| `rootUrl: 'http://localhost:9876/'` | ✅ YES | `/gmail/v1/users/me/labels` |
| `rootUrl: 'http://localhost:9876/api/proxy/'` | ✅ YES | `/gmail/v1/users/me/labels` (**`/api/proxy` stripped!**) |
| `apiEndpoint: 'http://localhost:9876/'` | ❌ NO — went to `googleapis.com` | N/A |
| `api_endpoint: 'http://localhost:9876/'` | ❌ NO — went to `googleapis.com` | N/A |

**Why**: `googleapis-common/build/src/apirequest.js` line 131 does `new URL(path, rootUrl)` where `path` starts with `/`, so `new URL('/gmail/v1/...', 'http://x.com/api/proxy/')` resolves to `http://x.com/gmail/v1/...` — the base's path is overridden.

### Python `google-api-python-client` (Source Code)

From `discovery.py` line 575: `api_endpoint` **replaces `rootUrl + servicePath`**. So:
- `api_endpoint="https://fgac.ai/api/proxy"` → requests go to `https://fgac.ai/api/proxy/users/me/labels` (**missing `/gmail/v1/`!**)
- `api_endpoint="https://fgac.ai/api/proxy/gmail/v1"` → requests go to `https://fgac.ai/api/proxy/gmail/v1/users/me/labels` ✅

### Proxy Route Validation (Against Local Dev Server)

| URL Pattern | HTTP Status | Source |
|------------|-------------|--------|
| `/api/proxy/users/me/labels` | **404 from Google** | Python with wrong `api_endpoint` |
| `/api/proxy/gmail/v1/users/me/labels` | **200 ✅ (20 labels)** | Python with correct `api_endpoint` |
| `/gmail/v1/users/me/labels` | **200 ✅ (20 labels, via middleware)** | Node.js `rootUrl` (path stripped) |

---

## Terminology Decision

Use the **language-specific parameter names** since they ARE different. Documentation must clearly explain both:

| Language | Parameter | Correct Value |
|----------|----------|---------------|
| **Python** | `client_options={"api_endpoint": ...}` | `https://gmail.fgac.ai/gmail/v1` |
| **Node.js** | `rootUrl: ...` | `https://gmail.fgac.ai/` |
| **cURL** | URL | `https://gmail.fgac.ai/gmail/v1/users/me/labels` |

Docs should explain: "Each Google SDK has its own parameter for overriding where API requests are sent. The parameter name and value differ between Python and Node.js."

---

## Changes Required

### Phase 1: DNS Setup

#### [NEW] Set up `gmail.fgac.ai` subdomain via Cloudflare CLI
- Point `gmail.fgac.ai` to the same Vercel deployment as `fgac.ai`
- The existing middleware already handles `hostname.startsWith('gmail.')` rewrites
- This gives us a clean, consistent URL pattern across both SDKs

---

### Phase 2: Fix All User-Facing Code Examples

#### [MODIFY] `docs/user_guide.md`
Lines 58, 68, 84, 92, 103, 109

Current (broken):
```python
# Python — WRONG: missing /gmail/v1
PROXY_URL = "https://fgac.ai/api/proxy"
client_options={"api_endpoint": PROXY_URL}
```
```javascript
// Node.js — WRONG: rootUrl path gets stripped
rootUrl: PROXY_URL + "/",
```

Fixed:
```python
# Python
service = build("gmail", "v1", credentials=creds,
    client_options={"api_endpoint": "https://gmail.fgac.ai/gmail/v1"})
```
```javascript
// Node.js
const gmail = google.gmail({ version: "v1", auth,
    rootUrl: "https://gmail.fgac.ai/" });
```
```bash
# cURL
curl -H "Authorization: Bearer sk_proxy_..." \
  "https://gmail.fgac.ai/gmail/v1/users/me/messages?maxResults=5"
```

---

#### [MODIFY] `src/app/dashboard/KeyControls.tsx`
Line 82, 123-124 — Fix the post-creation dialog

Current (broken):
```
Python: client_options={"api_endpoint": "https://fgac.ai/api/proxy"}
Node.js: rootUrl: "https://fgac.ai/api/proxy/"
```

Fixed:
```
Python: client_options={"api_endpoint": "https://gmail.fgac.ai/gmail/v1"}
Node.js: rootUrl: "https://gmail.fgac.ai/"
cURL:    https://gmail.fgac.ai/gmail/v1/users/me/messages
```

---

#### [MODIFY] `public/skills/claude-code/SKILL.md`
Line 33, 43 — Fix the Claude Code Python skill

Current (broken):
```python
PROXY_URL = "https://fgac.ai/api/proxy"
client_options={"api_endpoint": PROXY_URL}
```

Fixed:
```python
PROXY_URL = "https://gmail.fgac.ai/gmail/v1"
client_options={"api_endpoint": PROXY_URL}
```

---

#### [MODIFY] `docs/skills/gmail-fgac/SKILL.md`
Line 30, 88 — Fix the OpenClaw skill doc

Current (misleading):
```javascript
rootUrl: 'https://fgac.ai/api/proxy/',
```

Fixed:
```javascript
rootUrl: 'https://gmail.fgac.ai/',
```

---

#### [MODIFY] `docs/skills/gmail-fgac/scripts/gmail.js`
Line 117-128 — Fix the actual OpenClaw skill code

Current:
```javascript
const PROXY_URL = process.env.FGAC_PROXY_URL || 'https://fgac.ai/api/proxy';
rootUrl: PROXY_URL + '/',
```

Fixed:
```javascript
const PROXY_ROOT_URL = process.env.FGAC_ROOT_URL || 'https://gmail.fgac.ai';
rootUrl: PROXY_ROOT_URL + '/',
```

---

### Phase 3: Fix QA Testing

#### [MODIFY] `scripts/qa_agent/gmail_api.js`
**This is the core problem.** Replace raw `fetch()` with actual Google SDK calls so we test the same code path users use.

Current (bypasses SDK):
```javascript
const url = `${PROXY_URL}${endpoint}`;
await fetch(url, { headers: { Authorization: `Bearer ${PROXY_API_KEY}` } });
```

Fixed — use the Google SDK with `rootUrl`:
```javascript
const { google } = require('googleapis');
const auth = new google.auth.OAuth2();
auth.setCredentials({ access_token: PROXY_API_KEY });
const gmail = google.gmail({ version: 'v1', auth, rootUrl: ROOT_URL + '/' });
// Now use gmail.users.labels.list(), gmail.users.messages.list(), etc.
```

#### [MODIFY] `scripts/qa_agent/config.js`
Change `PROXY_URL` to `ROOT_URL` to reflect the correct concept:
```javascript
export const ROOT_URL = process.env.FGAC_ROOT_URL || 'https://gmail.fgac.ai';
```

#### [MODIFY] `docs/QA_Acceptance_Test/10_openclaw_gmail_fgac_skill.md`
- Update all test commands to use `FGAC_ROOT_URL` instead of `FGAC_PROXY_URL`
- Add a test that verifies the SDK actually sends to the correct URL

#### [MODIFY] `docs/QA_Acceptance_Test/09_universe_domain_rollback.md`
- Fix any references that conflate `api_endpoint` and `rootUrl`

---

### Phase 4: Update Architecture Docs

#### [MODIFY] `docs/architecture_and_strategy.md`
Lines 24-25 — Fix the code examples:

Current:
```
Python: client_options={'api_endpoint': 'https://proxy.ourdomain.com'}
Node.js: rootUrl: 'https://proxy.ourdomain.com'
```

Fixed:
```
Python: client_options={'api_endpoint': 'https://gmail.ourdomain.com/gmail/v1'}
Node.js: rootUrl: 'https://gmail.ourdomain.com/'
cURL:    curl https://gmail.ourdomain.com/gmail/v1/users/me/messages
```

Add a note explaining why the values differ between Python and Node.js.

---

## Verification Plan

### 1. DNS Verification
```bash
dig gmail.fgac.ai
curl -s -o /dev/null -w "%{http_code}" https://gmail.fgac.ai/
```

### 2. SDK Integration Tests (the REAL test — not raw fetch)
```javascript
// Node.js — must use Google SDK with rootUrl
const gmail = google.gmail({ version: 'v1', auth, rootUrl: 'https://gmail.fgac.ai/' });
const labels = await gmail.users.labels.list({ userId: 'me' });
```

```python
# Python — must use Google SDK with api_endpoint
service = build("gmail", "v1", credentials=creds,
    client_options={"api_endpoint": "https://gmail.fgac.ai/gmail/v1"})
results = service.users().messages().list(userId="me").execute()
```

### 3. Local Dev Smoke Test
- Node.js skill: `FGAC_ROOT_URL=http://localhost:3000 node gmail.js --account qa-test --action labels`
  - Should work via the middleware rewrite (`/gmail/v1/*` → `/api/proxy/gmail/v1/*`)
- Verify the QA agent scripts use the SDK, not raw fetch

### 4. Production Smoke Test (after deploy)
- Run both Python and Node.js SDK calls against `gmail.fgac.ai`
- Verify access rules still apply
