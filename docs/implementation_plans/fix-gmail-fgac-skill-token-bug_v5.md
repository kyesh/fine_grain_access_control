# Revert universe_domain: Restore Option A (Explicit Endpoint + Bearer Token)

## Background

The `universe_domain` feature was adopted based on the premise that setting `"universe_domain": "fgac.ai"` in a Service Account JSON would make Google SDKs automatically route traffic through our proxy. **Live testing proves this is false** — see [v3 analysis](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/implementation_plans/fix-gmail-fgac-skill-token-bug_v3.md) for full technical details.

Ironically, the project's own [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md#L12) (line 12) already correctly states: _"The 'Zero Code' Myth: It is architecturally impossible to securely reroute official Google SDK HTTP traffic to a proxy using only a custom credential file."_ The universe_domain experiment contradicted this finding.

## Scope — All Files Requiring Changes

Traced from `git show 459b368` (the `feat: universe domain automated credentials` commit) + full repo grep:

### Public-Facing UI/Pages (4 files)

| File | Current State | Change |
|---|---|---|
| [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx#L40) | "zero code changes required" | Remove claim, reword to "minimal configuration" |
| [setup/page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/setup/page.tsx#L79-L89) | "Download Credentials" + "Zero code changes needed" + GOOGLE_APPLICATION_CREDENTIALS | Revert to "Generate Key" with `sk_proxy_***` display + `api_endpoint` code examples |
| [KeyControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/KeyControls.tsx#L80-L107) | Auto-downloads SA JSON with `universe_domain` | Archive SA JSON to secondary option; make primary flow "Copy key" + show endpoint |
| [user_guide.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/user_guide.md#L41-L56) | "Zero Code Changes" + `GOOGLE_APPLICATION_CREDENTIALS` instructions | Restore Python/Node.js/cURL code examples with explicit `api_endpoint`/`rootUrl` |

### Documentation (3 files)

| File | Change |
|---|---|
| [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md) | Add note that universe_domain was tried and failed; reinforce "Zero Code Myth" |
| [CASA_SAQ_Answers.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/CASA_SAQ_Answers.md#L9) | Remove `universe_domain declarations` language; describe the actual Bearer token auth flow |
| **[NEW]** `docs/adr/001_universe_domain_rejection.md` | Architecture Decision Record — permanent doc explaining why this doesn't work |

### New Docs (2 files)

| File | Purpose |
|---|---|
| **[NEW]** `docs/adr/001_universe_domain_rejection.md` | **Critical doc** — prevents future agents/engineers from re-proposing universe_domain |
| **[NEW]** `docs/bug_reports/demoClaw_fgac_token_401.md` | Archived bug report with root cause findings |

### Skill Files (6 files)

| File | Purpose |
|---|---|
| **[NEW]** `docs/skills/gmail-fgac/SKILL.md` | Skill definition using `api_endpoint` method |
| **[NEW]** `docs/skills/gmail-fgac/scripts/gmail.js` | Main script — explicit endpoint, Bearer token auth |
| **[NEW]** `docs/skills/gmail-fgac/scripts/shared.js` | Auth utilities |
| **[NEW]** `docs/skills/gmail-fgac/scripts/auth.js` | Auth helper |
| **[NEW]** `docs/skills/gmail-fgac/scripts/accounts.js` | Account management |
| **[NEW]** `docs/skills/gmail-fgac/scripts/package.json` | Dependencies |

### Backend (kept, no changes)

| File | Status |
|---|---|
| `src/app/api/auth/token/route.ts` | **Keep** — token endpoint still works for SA JSON users who override `rootUrl` |
| `src/middleware.ts` | **Keep** — subdomain routing costs nothing to maintain as dormant infrastructure |
| `src/app/dashboard/actions.ts` | **Keep** — RSA keypair generation has independent security value |
| `src/db/schema.ts` | **Keep** — `publicKey` column is useful regardless |

---

## Proposed Changes (Detail)

### 1. Architecture Decision Record (Top Priority)

#### [NEW] `docs/adr/001_universe_domain_rejection.md`

> [!IMPORTANT]
> This is the single most important deliverable. It prevents this mistake from repeating.

```markdown
# ADR-001: Rejection of Google `universe_domain` for API Routing

## Status: REJECTED (April 2026)

## Context
We explored using `universe_domain: "fgac.ai"` in Service Account JSON 
credentials to achieve zero-code-change routing of Google API traffic 
through our proxy.

## Decision
REJECTED. `universe_domain` does not work for Google Workspace APIs.

## Rationale
[Full technical evidence from our testing...]

## Consequences
We use explicit api_endpoint / rootUrl overrides (Option A from architecture doc).
```

This doc will include:
- The full SDK behavior table (which library layers support it, which don't)
- The live test results showing traffic going to `gmail.googleapis.com`
- The `gtoken` hardcoded URL evidence
- The self-signed JWT code path explanation
- A clear "DO NOT REVISIT" notice unless Google fundamentally changes how `googleapis` npm handles `universe_domain`

---

### 2. Landing Page Fix

#### [MODIFY] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx)

Line 39-40: Change the "Off-The-Shelf Libraries" card:
```diff
- <h3>Off-The-Shelf Libraries</h3>
- <p>Agents can use the official Python and Node.js Google SDKs with zero code changes required.</p>
+ <h3>Standard Google SDKs</h3>
+ <p>Works with official Python and Node.js Google SDKs. Just point the endpoint at your proxy and go.</p>
```

---

### 3. Setup Page Revert

#### [MODIFY] [setup/page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/setup/page.tsx)

Revert Step 2 card from "Download Credentials" back to "Generate Key":
```diff
- Download Credentials
+ Generate API Key

- Create a new API Key in the dashboard. We will generate and download 
- a Google-compatible Service Account JSON file automatically for you.
+ Create a new API Key in the dashboard. Select which email inboxes 
+ this key should have access to. Copy the key and configure your agent.

- fgac-credentials-***.json
+ sk_proxy_****************

- Set GOOGLE_APPLICATION_CREDENTIALS pointing to this file. 
- <strong>Zero code changes needed.</strong>
+ Use this key as your Bearer token and point your SDK at 
+ <code>https://fgac.ai/api/proxy</code>.
```

---

### 4. User Guide Revert

#### [MODIFY] [user_guide.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/user_guide.md)

Restore the Python, Node.js, and cURL code examples with explicit `api_endpoint`/`rootUrl` overrides. Remove the `GOOGLE_APPLICATION_CREDENTIALS` / "zero code changes" section. Use the `client_options={"api_endpoint": ...}` pattern (matching Claude Code skill).

---

### 5. Dashboard KeyControls

#### [MODIFY] [KeyControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/KeyControls.tsx)

Change the post-create flow:
- **Primary**: Show the `sk_proxy_xxx` key with a Copy button + show the endpoint URL `https://fgac.ai/api/proxy`
- **Secondary**: Keep "Download Service Account JSON" as an expandable/collapsible option for advanced users, with a clear note that it requires `rootUrl` override

---

### 6. CASA SAQ Update

#### [MODIFY] [CASA_SAQ_Answers.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/CASA_SAQ_Answers.md)

Remove `universe_domain declarations` from the architecture description. Replace with accurate description of how agents authenticate via Bearer token through the proxy endpoint.

---

### 7. Architecture Doc Update

#### [MODIFY] [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md)

Add a note after line 12 (the "Zero Code Myth" section) referencing ADR-001:

```markdown
> **Note (April 2026):** We tested Google's `universe_domain` feature as a
> potential workaround to the Zero Code constraint. It does not work for 
> Google Workspace APIs. See [ADR-001](adr/001_universe_domain_rejection.md).
```

---

### 8. gmail-fgac Skill

#### [NEW] `docs/skills/gmail-fgac/scripts/gmail.js`

Uses the `api_endpoint` method (matching Option A and the existing Claude Code skill pattern):

```javascript
const gmail = google.gmail({
  version: 'v1',
  auth: oauthClient,  // OAuth2 client with access_token = sk_proxy_xxx
  rootUrl: 'https://fgac.ai/api/proxy/'
});
```

---

### 9. Bug Report Archive

#### [NEW] `docs/bug_reports/demoClaw_fgac_token_401.md`

Archive the original bug report with the root cause analysis appended.

---

## Verification Plan

### Build & Static Checks
1. `npm run build` — verify all TSX/TS changes compile
2. `grep -rn 'universe_domain' src/ public/ docs/user_guide.md docs/architecture_and_strategy.md docs/CASA_SAQ_Answers.md` — must return zero matches in public-facing files (only allowed in `docs/adr/`, `docs/implementation_plans/`, and `docs/bug_reports/`)
3. `grep -rn 'zero code change' src/ public/ docs/user_guide.md` (case-insensitive) — must return zero matches

### Browser-Automated Verification (via `/browser-agent`)

All UI verification will use the `/browser-agent` workflow (`@playwright/cli attach --cdp=http://localhost:9222`) against the local dev server (`npm run dev` at `http://localhost:3000`).

**Test 1: Landing Page Copy**
1. `goto http://localhost:3000`
2. `snapshot` → verify the "Off-The-Shelf Libraries" card now says "Standard Google SDKs" and does NOT contain "zero code changes"
3. `screenshot qa_proof_landing.png`

**Test 2: Setup Page — No Universe Domain Claims**
1. `goto http://localhost:3000/setup`
2. `snapshot` → verify Step 2 says "Generate API Key" (not "Download Credentials")
3. Verify no mention of `GOOGLE_APPLICATION_CREDENTIALS` or "zero code changes"
4. Verify code examples show `api_endpoint: 'https://fgac.ai/api/proxy'` pattern 
5. `screenshot qa_proof_setup.png`

**Test 3: Dashboard — Key Creation Flow**
1. `goto http://localhost:3000/dashboard` (requires auth — browser will have session cookies)
2. `snapshot` → click "Create Key" button
3. Fill in label + select emails → submit
4. Verify the post-create modal shows:
   - `sk_proxy_***` key with a Copy button
   - Endpoint URL `https://fgac.ai/api/proxy`
   - SA JSON download is available but NOT the primary action
5. `screenshot qa_proof_dashboard_key.png`

**Test 4: API Endpoint Integration (curl)**
1. Using the proxy key from the dashboard, run:
   ```bash
   curl -s -H "Authorization: Bearer sk_proxy_XXX" \
     "https://fgac.ai/api/proxy/gmail/v1/users/me/labels" | head -20
   ```
2. Verify the response is valid JSON from the Gmail API (labels list), NOT a 401 or HTML error page

### New QA Acceptance Test

#### [NEW] `docs/QA_Acceptance_Test/09_universe_domain_rollback.md`

A formal QA test to verify that all universe_domain artifacts have been removed from the public UI and that the `api_endpoint` auth pattern works end-to-end. See the file for full test cases.

### Requires Human Action
1. `/deploy-pr-preview` — deploy to Vercel preview and validate via browser agent against the preview URL
2. User reviews the PR and merges when satisfied
