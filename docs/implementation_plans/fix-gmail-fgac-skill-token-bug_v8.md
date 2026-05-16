# Root URL Override vs API Endpoint Override: Decision & Documentation Cleanup

## The Problem

Our codebase and docs use `api_endpoint` and `rootUrl` interchangeably as if they're the same concept in different languages. **They are not.** They replace different parts of the URL and produce different final request paths. This confusion has led to inconsistent code, broken local testing, and misleading documentation.

## Research Findings (From Source Code)

### How Google SDKs construct URLs

The Gmail API discovery document defines:
- `rootUrl`: `https://gmail.googleapis.com/`
- `servicePath`: `gmail/v1/`
- Method path: `users/{userId}/labels`

**Default final URL** = `rootUrl` + `servicePath` + method path = `https://gmail.googleapis.com/gmail/v1/users/me/labels`

### Python SDK (`google-api-python-client`)

```python
# discovery.py line 561
base = urllib.parse.urljoin(service["rootUrl"], service["servicePath"])
# base = "https://gmail.googleapis.com/gmail/v1/"

# discovery.py line 575-576
if client_options.api_endpoint:
    base = client_options.api_endpoint  # REPLACES the entire base
```

`api_endpoint` **replaces `rootUrl + servicePath`** — the entire base URL including the service path.

So: `api_endpoint="https://fgac.ai/api/proxy"` → final URL = `https://fgac.ai/api/proxy/users/me/labels`

> [!IMPORTANT]
> Notice: **no `/gmail/v1/` in the path**. The service path is gone because `api_endpoint` replaced the whole base.

### Node.js SDK (`googleapis` npm)

```javascript
// gmail/v1.js line 76-79 (generated code)
const rootUrl = options.rootUrl || 'https://gmail.googleapis.com/';
url: (rootUrl + '/gmail/v1/users/{userId}/labels').replace(/([^:]\/)\//+/g, '$1')
```

`rootUrl` **only replaces the domain/origin** — the service path (`/gmail/v1/`) is hardcoded into each generated method.

So: `rootUrl: "https://fgac.ai/api/proxy/"` → final URL = `https://fgac.ai/api/proxy/gmail/v1/users/me/labels`

> [!IMPORTANT]
> Notice: `/gmail/v1/` IS in the path. The proxy must be able to handle this prefix.

### Summary: The Critical Difference

| Override | What it replaces | Example URL produced |
|----------|-----------------|---------------------|
| Python `api_endpoint="https://proxy.com"` | `rootUrl` + `servicePath` | `https://proxy.com/users/me/labels` |
| Node.js `rootUrl: "https://proxy.com/"` | Only `rootUrl` | `https://proxy.com/gmail/v1/users/me/labels` |

**These produce different request paths to our proxy.** Our proxy route handler at `/api/proxy/[...path]/route.ts` must handle BOTH patterns.

---

## Option A: Use `rootUrl` override as our standard

**How it works**: Override just the root URL. The SDK appends `gmail/v1/` to the path automatically.

- Node.js: `rootUrl: 'https://fgac.ai/api/proxy/'` → `https://fgac.ai/api/proxy/gmail/v1/users/me/labels`
- Python: NOT directly supported. `api_endpoint` replaces the full base, so you'd need `api_endpoint="https://fgac.ai/api/proxy/gmail/v1"` to get the same effect, which is awkward and service-specific.
- cURL: `curl https://fgac.ai/api/proxy/gmail/v1/users/me/labels`

**Pros**:
- Paths include the service prefix (`gmail/v1/`) which is explicit and easy to route
- Our existing proxy catch-all route (`/api/proxy/[...path]`) already handles this
- Matches what the Node.js SDK does natively

**Cons**:
- Python users can't just set one simple `api_endpoint` — they'd need to include the service path in it
- Different instructions per language

---

## Option B: Use `api_endpoint` override as our standard

**How it works**: Override the full base URL (rootUrl + servicePath). Method paths are appended directly.

- Python: `api_endpoint="https://fgac.ai/api/proxy/gmail/v1"` → `https://fgac.ai/api/proxy/gmail/v1/users/me/labels`
- Node.js: Not directly supported. `rootUrl` always appends the service path, so setting `rootUrl: "https://fgac.ai/api/proxy/"` already produces the service path. This IS actually the same final URL.
- cURL: `curl https://fgac.ai/api/proxy/gmail/v1/users/me/labels`

Wait — actually, if we set Python `api_endpoint="https://fgac.ai/api/proxy/gmail/v1"`, it produces `https://fgac.ai/api/proxy/gmail/v1/users/me/labels`. And Node.js `rootUrl: "https://fgac.ai/api/proxy/"` produces `https://fgac.ai/api/proxy/gmail/v1/users/me/labels`. **The final URLs are the same!**

**Pros**:
- Both SDKs produce the same final URL: `https://fgac.ai/api/proxy/gmail/v1/users/me/labels`
- The proxy only needs to handle one URL pattern

**Cons**:
- Python `api_endpoint` must include the service name+version (e.g., `/gmail/v1`) which feels service-specific
- Not truly a single "endpoint" if you also use Calendar, Drive, etc. — each service would need its own `api_endpoint`

---

## Option C (Recommended): Subdomain routing (production) + rootUrl/api_endpoint (SDK config)

> [!IMPORTANT]
> This is what we actually already have in production but haven't documented clearly.

**How it works in production**: The middleware rewrites based on subdomain.
- `gmail.fgac.ai/gmail/v1/users/me/labels` → Next.js rewrites to `/api/proxy/gmail/v1/users/me/labels`

**SDK configuration**:
- Node.js: `rootUrl: 'https://gmail.fgac.ai/'` → SDK sends to `https://gmail.fgac.ai/gmail/v1/users/me/labels`
- Python: `api_endpoint='https://gmail.fgac.ai/gmail/v1'` → SDK sends to `https://gmail.fgac.ai/gmail/v1/users/me/labels`
- cURL: `curl https://gmail.fgac.ai/gmail/v1/users/me/labels`
- All routes to the same proxy handler

**For local dev**: The middleware dev rewrite handles `/gmail/v1/...` → `/api/proxy/gmail/v1/...`

**Pros**:
- Clean separation: one subdomain per Google service
- Both SDKs produce correct URLs naturally
- Proxy route handler only sees one pattern
- Scales to Calendar (`calendar.fgac.ai`), Drive (`drive.fgac.ai`) trivially

**Cons**:
- Requires DNS/subdomain setup in production (we already have this)
- Local dev needs the middleware rewrite (we already have this)

---

## Recommendation

**Option C** — this is what we're already running. We just need to:

1. **Document it clearly instead of conflating `api_endpoint` and `rootUrl`**
2. **Update code comments** to explain the subdomain routing, not claim they're interchangeable
3. **Update the QA test** to use Local proxy URL correctly
4. **Update user_guide.md** with correct per-language instructions

## Proposed Changes

### Documentation updates (no code changes needed):

#### [MODIFY] `docs/architecture_and_strategy.md`
- Line 24-25: Update code examples to show the correct per-SDK configuration with subdomain URLs
- Add a note explaining that `api_endpoint` (Python) and `rootUrl` (Node.js) work differently

#### [MODIFY] `docs/user_guide.md`
- Update Python/Node.js code examples with correct parameter values
- Clarify the subdomain routing pattern

#### [MODIFY] `docs/skills/gmail-fgac/scripts/gmail.js`
- Update comment block to accurately describe what `rootUrl` does vs `api_endpoint`

#### [MODIFY] `docs/QA_Acceptance_Test/10_openclaw_gmail_fgac_skill.md`
- Remove all `api_endpoint` / `rootUrl` conflation
- Document the local dev proxy test flow clearly

#### [MODIFY] `docs/QA_Acceptance_Test/09_universe_domain_rollback.md`
- Fix any references that conflate the two concepts

#### [MODIFY] `src/app/dashboard/KeyControls.tsx`
- Update the key creation dialog copy to show correct per-language instructions

### Code change (already done):

#### `src/middleware.ts`
- Dev rewrite for `/gmail/v1/*` → `/api/proxy/gmail/v1/*` (already in place)

## Open Questions

> [!IMPORTANT]
> 1. **Do we have `gmail.fgac.ai` DNS configured in production?** If not, we need to decide: set it up, or use the `/api/proxy/` path-based approach everywhere. This affects which SDK instructions we give users.
> 2. **What about Calendar, Drive, etc.?** If we plan to proxy other Google services, subdomain routing scales naturally. But if Gmail is the only service, path-based may be simpler.

## Verification Plan

### Automated Tests
1. Run the skill through the local proxy with `FGAC_PROXY_URL` and verify labels/list/read all work
2. Run `curl` against both `http://localhost:3000/api/proxy/gmail/v1/users/me/labels` and (if subdomain is set up) `http://gmail.localhost:3000/gmail/v1/users/me/labels`

### Manual Verification
- Review all updated docs for consistency
- Deploy PR preview and verify the dashboard key creation dialog shows correct instructions
