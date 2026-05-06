# CASA Tier 2 – TAC Security DAST Report Remediation

The TAC Security ESOF scan returned 11 findings (1 Medium, 4 Low, 6 Info). This plan categorizes each finding as **Fix** (we need to write code), **Dispute** (false positive / not applicable), or **Accept** (informational, no action required for CASA).

## Recommended Strategy

> [!IMPORTANT]
> **Fix everything fixable first, then submit fixes + disputes as a single package for rescan.** This is the most successful approach based on industry experience with CASA. TAC Security charges per revalidation round, so batching is critical to avoid wasted cycles.

1. Apply all code fixes (security headers + favicon fix + SVG cleanup)
2. Self-scan locally with `curl` to verify fixes work
3. Deploy to the `staging` preview branch
4. **Generate a formal dispute document** (saved to `docs/CASA_Dispute_Response.md`) for findings we cannot fix
5. Submit the updated staging URL + dispute doc to TAC Security together and request a single rescan

## Observation Summary

| # | Finding | Severity | Verdict | Action |
|---|---------|----------|---------|--------|
| 1 | Source Code Disclosure – File Inclusion | **Medium** | 🔧 Fix | Explicit headers on favicon + all public assets |
| 2 | Cross-Domain Misconfiguration (CORS `*`) | Low | 🔧 Partial Fix | Tighten CORS on API routes; static assets are fine |
| 3 | Missing Anti-clickjacking Header | Low | 🔧 Fix | Add `X-Frame-Options` + CSP `frame-ancestors` |
| 4 | Proxy Disclosure | Low | 🟡 Dispute | Vercel infrastructure, not under our control |
| 5 | Sub Resource Integrity Attribute Missing | Low | 🟡 Dispute | Clerk injects its own `<script>` tags at runtime |
| 6 | X-Content-Type-Options Header Missing | Info | 🔧 Fix | Add `X-Content-Type-Options: nosniff` |
| 7 | Cross-Domain JavaScript Source File Inclusion | Info | 🟡 Dispute | Clerk SDK is a legitimate external dependency |
| 8 | X-Powered-By Header Leaks Info | Info | 🔧 Fix | Suppress `X-Powered-By: Next.js` |
| 9 | Storable but Non-Cacheable Content | Info | 🟡 Dispute | Informational; `no-store` is actually correct |
| 10 | Retrieved from Cache | Info | 🟡 Dispute | Vercel CDN `Age: 0` header; benign |
| 11 | User Agent Fuzzer | Info | 🟡 Dispute | Informational recon finding, no action needed |

---

## Proposed Changes

### 1. Security Headers (Fixes #3, #6, #8)

All three of these are solved in a single place: adding a `headers()` function to `next.config.ts`.

#### [MODIFY] [next.config.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/next.config.ts)

Add the following security response headers to **all routes** (`/**`):

| Header | Value | Fixes |
|--------|-------|-------|
| `X-Frame-Options` | `DENY` | #3 – Anti-clickjacking |
| `Content-Security-Policy` | `frame-ancestors 'none'` | #3 – Anti-clickjacking (modern) |
| `X-Content-Type-Options` | `nosniff` | #6 – MIME sniffing |
| `X-Powered-By` | *(removed)* | #8 – Info leakage |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Proactive hardening |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Proactive hardening |

Next.js has a built-in `poweredByHeader: false` config option to suppress `X-Powered-By`.

---

### 2. Favicon & Public Asset Headers (Fix for #1 – MEDIUM)

This is the **most important fix** because it's the only Medium-severity finding. The ZAP scanner works by:
1. Requesting `/favicon.ico` → gets a binary ICO file (200 OK, `image/x-icon`)
2. Requesting `/favicon.ico?favicon.RANDOM.ico` → still gets the same binary ICO
3. Requesting a random nonsense path → gets an HTML 404 page
4. Comparing responses: binary ICO ≠ HTML 404 = "50% difference" → flags as "Source Code Disclosure"

#### [MODIFY] [next.config.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/next.config.ts)

Add targeted headers for all intentionally public files so the scanner recognizes them as deliberate:

| Route Pattern | Headers | Purpose |
|--------------|---------|---------|
| `/favicon.ico` | `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=86400` | Fixes #1 Medium |
| `/(*.png\|*.ico)` | `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=86400` | Covers `logo-v2.png`, `logo.png`, `logo-square.png` |
| `/skills/**` | `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=0, must-revalidate` | Covers SKILL.md files and openclaw.json |

---

### 3. Delete Unused Boilerplate SVGs (Attack Surface Reduction)

#### [DELETE] Unused Next.js boilerplate files

The following files in `/public` are leftover from `create-next-app` scaffolding and are not referenced anywhere in the application. SVGs are XML-based and can be a vector for XSS via inline `<script>` tags. Deleting them eliminates unnecessary attack surface:

- `public/file.svg`
- `public/globe.svg`
- `public/next.svg`
- `public/vercel.svg`
- `public/window.svg`

---

### 4. CORS Tightening (Partial Fix for #2)

#### Finding details
The scanner flagged `Access-Control-Allow-Origin: *` on static assets (`_next/static/chunks/*.js`, `favicon.ico`, `logov2.png`). These are **Vercel's default CDN headers for static files** and are standard behaviour — static assets are intentionally public.

> [!IMPORTANT]
> **What we should verify:** That our **API routes** (`/api/proxy/*`, `/api/auth/*`, `/api/keys/*`) do NOT return `Access-Control-Allow-Origin: *`. If they do, we should tighten them. If they don't (which is the default for Next.js API routes), then this finding is a false positive on static assets only.

#### [MODIFY] [next.config.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/next.config.ts)

We can explicitly set restrictive CORS headers on `/api/**` routes as an extra safety layer using the same `headers()` function.

---

### 5. Dispute Document (Findings #4, #5, #7, #9, #10, #11)

#### [NEW] [CASA_Dispute_Response.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/CASA_Dispute_Response.md)

Generate a standalone dispute document that can be copy-pasted or uploaded directly to the ESOF portal alongside the rescan request. This document will cover all findings we cannot fix with code changes, with structured per-finding responses including:

- Finding number and title (matching the report)
- CWE ID
- Our classification (False Positive / Infrastructure / Third-Party SDK)
- Evidence URL from the report
- Technical explanation of why the finding is not applicable
- What mitigations we *have* applied (where relevant)

---

## Verification Plan

### Automated Tests

After applying the header changes to `next.config.ts`:

```bash
# 1. Build locally and verify headers
npm run build && npm run start

# 2. Check security headers on the landing page
curl -sI http://localhost:3000 | grep -iE "x-frame|x-content|x-powered|content-security|referrer"

# Expected output:
# X-Frame-Options: DENY
# Content-Security-Policy: frame-ancestors 'none'
# X-Content-Type-Options: nosniff
# Referrer-Policy: strict-origin-when-cross-origin
# (X-Powered-By should be ABSENT)

# 3. Check favicon headers specifically
curl -sI http://localhost:3000/favicon.ico | grep -iE "x-content|content-disposition|cache-control"

# Expected:
# X-Content-Type-Options: nosniff
# Content-Disposition: inline
# Cache-Control: public, max-age=86400

# 4. Verify SVGs are deleted
curl -sI http://localhost:3000/file.svg
# Expected: 404

# 5. Check API routes don't have wildcard CORS
curl -sI http://localhost:3000/api/keys | grep -i "access-control"
# Expected: no Access-Control-Allow-Origin: * header
```

### Deployment Verification

Deploy via `/deploy-pr-preview` and run the same curl checks against the live staging URL to confirm headers are set in the Vercel environment.

### Deliverables for TAC Security Rescan

Submit together as a single package:
1. ✅ Updated staging URL (with all fixes deployed)
2. ✅ `docs/CASA_Dispute_Response.md` — formal dispute document for findings #4, #5, #7, #9, #10, #11
