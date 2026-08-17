# Sheets Grant Recovery — Implementation Plan v1

Branch: `claude/sheets-access-error-analysis-86fef7`

## Why (production evidence, 2026-08-15 → 08-17 UTC)

PostHog shows the sheets funnel is a dead end for every real user since the
connector-directory launch:

- 5 external users called a sheets tool → all hit `denied_by_policy`, each
  denial minting a `sheets_expose` magic link (that part works).
- 3 of the 5 opened the link and approved (`approval_link_approved`).
- **All 3 then got `error` on every retry and churned.** One retried across
  four sessions over ~10 hours, minting six links. Zero external users have
  ever had a successful sheets tool call in production; the only successes
  are the internal test account.

## Root cause (confirmed in code)

Sheets access has TWO halves, and the magic-link approval only completes one:

1. **FGAC half** — `approveMagicLink` (`src/app/dashboard/actions.ts`)
   inserts an `accessRules` row for the spreadsheet id and tells the user
   "The agent can retry its request now."
2. **Google half** — the app never requests a Sheets OAuth scope. All sheets
   API access rides on per-file `drive.file` grants, which Google registers
   ONLY when the user picks the file in the Google Picker with our `appId`
   set (`src/app/dashboard/useGooglePicker.ts`). The approval page never
   launches the Picker.

So after approval: FGAC policy passes → Sheets API called with a token that
has no grant for that file → Google 404/403 → generic
"❌ Google resource not found (404). Check the ID and try again." — which is
actively misleading (the id is fine; the grant is missing).

Secondary finding: an approval assigns the rule to the payload's proxy key;
one user was back to `denied_by_policy` in a later session (new connection /
different key), minting fresh links for a sheet they had already approved.

## Fix design

### A. Shared verifier (server)

`src/lib/sheetsGrantCheck.ts` — `verifySheetsGrant(token, spreadsheetId)`:
metadata GET `https://sheets.googleapis.com/v4/spreadsheets/{id}?fields=properties.title`.
Returns `{ state: 'ok', title }` | `{ state: 'missing' }` (403/404 — no
Google-side grant) | `{ state: 'unknown', status }` (network/5xx/429 — do not
alarm the user). Reuses the same token-resolution helper the MCP path uses
(`getGoogleToken(ownerEmail, user)`).

### B. Approval flow verifies before declaring success

`approveMagicLink` for `sheets_expose` / `sheets_write`: after inserting the
rule, run the verifier with the owner's token.

- Verified → today's success page (unchanged).
- Missing → redirect to `result=picker` state: rule was created, but the
  page now says **"One more step — let Google share this sheet with FGAC"**
  and renders `SheetsGrantRecovery` (client component):
  - Launches the Google Picker via the existing `useGooglePicker` flow
    (including first-time `drive.file` consent round-trip; the approve page
    consumes `autoOpenPicker` on the return leg).
  - Embeds the Sheets demo video (`TrackedVideoEmbed`,
    `https://share.descript.com/embed/Fv9pwXugLUa`) so a confused user can
    watch the exact setup.
  - After a pick, POSTs `/api/rules/grant-sheets-access` (upsert — the rule
    exists; the pick is what registers the Google grant), re-verifies, and
    flips to "✓ Verified — the agent can retry now."
- Analytics: `sheets_grant_verification` `{ result: 'ok' | 'missing' }` at
  approval; `sheets_grant_recovered` when the recovery pick verifies.

### C. Dashboard detects stranded rules

Sheets rules whose spreadsheet fails verification get a
"⚠ Needs Google access" chip in `ExposedSheetsManager` and a recovery panel
(same component: picker + video). Verification results come from a new
`GET /api/rules/verify-sheets-access` (server-side check per rule, small N,
cached per page load). This catches the users stranded *today* and the
sheet-picked-on-wrong-account case.

### D. Honest MCP error when the grant is missing

In the sheets tool paths (`sheets_*` and raw `google_api_*` sheets family),
when policy ALLOWED the call but Google returns 403/404, say what is true:
the sheet is approved in FGAC but Google hasn't shared it with FGAC yet, and
the user must finish setup on the dashboard (`{DASHBOARD_URL}/dashboard` —
the chip from C). No more "Check the ID and try again" for this case.

### E. QA capability 17 + agent docs

`docs/QA_Acceptance_Test/capabilities/17_sheets_grant_recovery.md` models the
real user journey (assertions in `### A<n>:` form for
`scripts/qa-coverage-check.ts`), and all four `agents/*.md` runbooks gain a
capability-17 section. Local replication of the production event sequence
(denied_by_policy → approval_link_approved → error) is assertion A1.

## Out of scope (noted for later)

- Multi-account: the Picker grants on the browser's signed-in Google account
  via the token bridge; delegated/linked secondary accounts may still miss
  grants. The recovery panel names the account it is granting for.
- The approval→key-scoping gap (approved rule not applying to a later
  connection's key) is real but separate; capability 17 records it as a
  known-issue assertion, fix tracked separately.

## Validation

- Replicate locally first (dev server + MCP): unexposed sheet → denial link
  → approve → confirm post-approval `error` and the same PostHog sequence.
- Then with the fix: approve → picker state → pick → verified success; MCP
  retry succeeds. Run capability 17 via the hosted-MCP runbook; lint + build.
