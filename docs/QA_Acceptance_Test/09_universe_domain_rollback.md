# QA Acceptance Test: Universe Domain Rollback & api_endpoint Auth Pattern

## Prerequisites
- A testing environment with the Vercel edge proxy and Neon Postgres database running.
- Access to the `/browser-agent` workflow (`@playwright/cli attach --cdp=http://localhost:9222`).
- A test user account with Google OAuth Gmail scopes granted.
- The user's browser running with `--remote-debugging-port=9222`.

## Dependencies
- Must pass `01_signup_and_credential_workflow.md` first to ensure credentials and Web UI are functioning.

## Context
This test validates that all `universe_domain` artifacts have been removed from the public-facing UI and documentation, and that the `api_endpoint` / Bearer token authentication pattern works correctly end-to-end. See `docs/adr/001_universe_domain_rejection.md` for full rationale.

---

## Test Cases

### 1. Landing Page — No "Zero Code Changes" Claim
**Objective**: Validate that the landing page does not make false claims about zero code changes.

**Steps (Browser Agent)**:
1. Navigate to the landing page.
2. Take a snapshot of the page content.
3. Search for the text "zero code changes" (case-insensitive).
4. Verify the feature card previously labeled "Off-The-Shelf Libraries" now reads "Standard Google SDKs" or similar.
5. Verify the description does NOT promise "zero code changes required".
6. Take a proof screenshot.

**Expected Outcome**: No mention of "zero code changes" anywhere on the landing page. The feature card accurately describes the integration without overpromising.

---

### 2. Setup Page — Correct Credential Flow
**Objective**: Validate that the Setup/Integration page instructs users to use explicit `api_endpoint` overrides instead of the deprecated `GOOGLE_APPLICATION_CREDENTIALS` approach.

**Steps (Browser Agent)**:
1. Navigate to `/setup`.
2. Take a snapshot of the page content.
3. Verify Step 2 heading says "Generate API Key" (NOT "Download Credentials").
4. Verify Step 2 shows `sk_proxy_****************` display format (NOT `fgac-credentials-***.json`).
5. Verify there is NO mention of `GOOGLE_APPLICATION_CREDENTIALS`.
6. Verify there is NO text saying "Zero code changes needed".
7. Verify the page contains code examples using the `api_endpoint` pattern:
   - Python: `client_options={"api_endpoint": "https://fgac.ai/api/proxy"}`
   - Node.js: `rootUrl: "https://fgac.ai/api/proxy/"`
   - cURL: `https://fgac.ai/api/proxy/gmail/v1/...`
8. Take a proof screenshot.

**Expected Outcome**: The setup page accurately guides users to use the explicit endpoint override pattern with their proxy key. No references to `universe_domain`, `GOOGLE_APPLICATION_CREDENTIALS`, or "zero code changes".

---

### 3. Dashboard — Key Creation Primary Flow
**Objective**: Validate that creating a new API key presents the proxy key string and endpoint URL as the primary credential, with the Service Account JSON download available but secondary.

**Steps (Browser Agent)**:
1. Navigate to `/dashboard` (must be authenticated).
2. Click the "Create Key" button.
3. Fill in a label (e.g., "QA Test Key").
4. Select at least one email address for access.
5. Submit the form.
6. Verify the post-creation state shows:
   - The `sk_proxy_...` key string with a "Copy" button
   - The endpoint URL `https://fgac.ai/api/proxy` displayed prominently
   - A secondary/collapsible "Download Service Account JSON" option (NOT the primary action)
7. Take a proof screenshot of the post-creation state.

**Expected Outcome**: The primary UX after key creation is "Copy your key + use this endpoint". The SA JSON download is available but clearly secondary/advanced.

---

### 4. API Endpoint Integration — Bearer Token Pattern
**Objective**: Validate that the proxy key works correctly with the explicit `api_endpoint` pattern (matching the Claude Code skill approach).

**Steps (Command Line)**:
1. Using the proxy key from Test Case 3, execute:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -H "Authorization: Bearer sk_proxy_REPLACE_ME" \
     "https://fgac.ai/api/proxy/gmail/v1/users/me/labels"
   ```
2. Verify the HTTP response code is `200` (not `401`, `403`, or `500`).
3. Execute the full request and parse the response:
   ```bash
   curl -s -H "Authorization: Bearer sk_proxy_REPLACE_ME" \
     "https://fgac.ai/api/proxy/gmail/v1/users/me/labels" | python3 -c "
   import json, sys
   data = json.load(sys.stdin)
   labels = data.get('labels', [])
   print(f'Labels found: {len(labels)}')
   for l in labels[:5]:
       print(f'  - {l[\"name\"]}')
   "
   ```
4. Verify the output lists Gmail labels (e.g., INBOX, SENT, DRAFT).

**Expected Outcome**: The Bearer token + explicit endpoint pattern successfully authenticates and returns real Gmail data from the proxy.

---

### 5. User Guide — Correct Documentation
**Objective**: Validate that `docs/user_guide.md` contains the correct integration instructions.

**Steps (Command Line)**:
1. Run the following static checks:
   ```bash
   # Must return zero matches
   grep -ic "zero code change" docs/user_guide.md
   grep -c "GOOGLE_APPLICATION_CREDENTIALS" docs/user_guide.md
   grep -c "universe_domain" docs/user_guide.md

   # Must return at least one match each
   grep -c "api_endpoint" docs/user_guide.md
   grep -c "rootUrl" docs/user_guide.md
   grep -c "sk_proxy_" docs/user_guide.md
   ```

**Expected Outcome**: No mentions of `universe_domain`, `GOOGLE_APPLICATION_CREDENTIALS`, or "zero code changes" in the user guide. The guide includes Python, Node.js, and cURL examples with explicit endpoint overrides.

---

### 6. Architecture Decision Record Exists
**Objective**: Validate that the ADR documenting the `universe_domain` rejection is present and accessible.

**Steps (Command Line)**:
1. Verify the file exists:
   ```bash
   test -f docs/adr/001_universe_domain_rejection.md && echo "EXISTS" || echo "MISSING"
   ```
2. Verify it contains key sections:
   ```bash
   grep -c "REJECTED" docs/adr/001_universe_domain_rejection.md
   grep -c "gmail.googleapis.com" docs/adr/001_universe_domain_rejection.md
   grep -c "DO NOT REVISIT" docs/adr/001_universe_domain_rejection.md
   ```
3. Verify `docs/architecture_and_strategy.md` links to the ADR:
   ```bash
   grep -c "001_universe_domain_rejection" docs/architecture_and_strategy.md
   ```

**Expected Outcome**: The ADR exists, contains the rejection rationale with technical evidence, and is cross-referenced from the architecture doc.

---

### 7. gmail-fgac Skill — api_endpoint Pattern
**Objective**: Validate that the gmail-fgac skill uses the `api_endpoint`/`rootUrl` pattern, NOT the `universe_domain` approach.

**Steps (Command Line)**:
1. Verify the skill exists:
   ```bash
   test -f docs/skills/gmail-fgac/SKILL.md && echo "EXISTS" || echo "MISSING"
   ```
2. Verify it does NOT reference `universe_domain`:
   ```bash
   grep -ric "universe_domain" docs/skills/gmail-fgac/
   # Must return 0
   ```
3. Verify it uses the explicit endpoint pattern:
   ```bash
   grep -c "api/proxy\|rootUrl\|api_endpoint" docs/skills/gmail-fgac/scripts/gmail.js
   # Must return at least 1
   ```

**Expected Outcome**: The gmail-fgac skill uses explicit proxy endpoint configuration, with no references to `universe_domain`.

---

### 8. Source Code — No Remaining universe_domain in Public Surface
**Objective**: Final sweep to ensure no `universe_domain` references remain in public-facing source code outside of the ADR and implementation plan archives.

**Steps (Command Line)**:
1. Run the full sweep:
   ```bash
   # Search public source and docs (excluding archives)
   grep -rn "universe_domain" \
     src/ public/ docs/user_guide.md docs/architecture_and_strategy.md \
     docs/CASA_SAQ_Answers.md docs/tech_stack.md docs/DOMAIN_SETUP.md \
     --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" \
     | grep -v "node_modules" | grep -v ".next"
   ```
2. If any matches are found in UI components or active documentation, they must be remediated.

**Expected Outcome**: Zero matches. The only files containing `universe_domain` should be in `docs/adr/`, `docs/implementation_plans/`, `docs/bug_reports/`, and `docs/skills/` (only in comments explaining what NOT to do).
