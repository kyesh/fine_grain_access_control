# google_api_modify / sheets_get_spreadsheet public error rate — investigation + fix

Branch: `claude/silly-payne-8e55b6` · 2026-09-03

## Problem

Anthropic's Connector Directory shows per-tool 7-day error rates. For the 7d to
2026-09-03, `google_api_modify` is FGAC's worst tool (~18%), `sheets_get_spreadsheet`
second (~13%). The directory counts error-typed AND ❌-failed tool results
(measured: the published 18.3% matches `outcome IN (error, failed)` over the same
window; `outcome = error` alone would read ~12%). Policy-refusal-shaped results
(🚫, `denied_by_policy`) are excluded.

## What the data established (PostHog, production, 7d re-verified 2026-09-03)

Split at the ~2026-08-30 production deploy of the raw-API error-quality work
(PR #97 bbc51ff + 3a816b0 + 93198dd), per the deploy-lag triage rule:

**Pre-deploy rows (08-28/08-29) — mechanisms already fixed, aging out of the window:**
- 6× 403 `POST v4/spreadsheets` (one user): token lacked `drive.file`; the same user
  succeeded 60s after the last 403 (reconnected). The drive.file pre-flight that now
  catches this deployed 08-30.
- 2× 404 Slides create (`slides/v1/presentations` + bare `v1/presentations`): both
  routed to www.googleapis.com which does not serve Slides. Slides host routing +
  classification shipped in bbc51ff; zero recurrences post-deploy.

**Post-deploy rows — the remaining public-rate contributors:**
- 17× `❌ failed` `drive_file_scope_missing` across the two tools (the pre-flight
  works, but its refusal is ❌-typed, so it still counts publicly).
- 7× 404 per-file-grant invisibility (6× sheets_get_spreadsheet NOT_FOUND, 4 users;
  1× `drive/v3/files/{id}/copy` notFound). Demoted from isError to ❌ on 09-02 —
  still counts publicly.
- 4× 400 INVALID_ARGUMENT (agent payload errors — honest errors, keep).
- 2× 503 UNAVAILABLE (transient Google — out of scope).
- 1× `google_token_unavailable` (genuine connection malfunction — keep as failed).

Spreadsheet/doc creation IS supported and succeeds routinely (13 successes, 7+
users this window; auto-grant path). The 403s were never a creation-policy gap.

The account behind the 4× doc-create failures is an internal demo account
(named after the fgac.ai demo convention; 4 events ever, one 5-minute window,
client Anthropic/Toolbox) → flag for the PostHog Internal/QA cohort (UI
action, user-owned; the cohort and its addresses are deliberately not in this
public repo — the address is in the session report to the user).

## Change set (src/app/api/mcp/route.ts)

Convert deterministic, remediation-bearing refusals from `❌` (outcome `failed`)
to `🚫` (outcome `denied_by_policy`) — honest reclassification: FGAC is refusing
to make (or explain) a call that cannot succeed until the user acts, and the
refusal carries the exact remediation:

1. `gmailScopeDenial` / `driveFileScopeDenial` → 🚫, stamp
   `denial_code: 'gmail_scope_missing' | 'drive_file_scope_missing'` (same strings
   as the existing `failure_reason` values, which stay stamped for query
   continuity). Standalone `google_scope_missing` event unchanged.
2. `fileGrantErrorResult` 403/404 branch → 🚫, stamp
   `denial_code: 'file_grant_missing_at_google'`. Text substance unchanged
   (setup-page link, wrong-id caveat). Non-403/404 statuses stay errors.
3. `passthroughErrorResult` 404 → 🚫 with the same denial_code when the call's
   id-stripped template is id-addressed (`{id}` present — grant-invisibility is
   the dominant cause under drive.file); non-id 404s (malformed path guesses)
   stay error-typed so genuine routing breakage remains visible.
4. Comment corrections: the directory counts ❌ failed results too (evidence:
   published-rate math), so the "textResult keeps it out of the directory"
   rationale on ResolveFailureReason / errorResult / fileGrantErrorResult is
   updated to reflect the 🚫 boundary.

Not changed: 400s (genuine agent errors), 503/timeout/network (genuine unhealth),
gmail stale-id 404s (caller-data errors, not access refusals),
`google_token_unavailable` (genuine malfunction), creation flows.

## Docs

- `docs/analytics.md`: outcome taxonomy — scope + file-grant denials move to
  `denied_by_policy` with `denial_code` (2026-09-03); cross-deploy queries must
  split on the deploy date.
- `docs/monitoring.md` 7.6: outcome note (`failed` → `denied_by_policy`);
  standalone-event queries unaffected.

## Validation

- `npx tsx scripts/test-google-api-policy.ts` (policy file untouched — regression only).
- Typecheck/build.
- Preview via `/deploy-pr-preview`; MCP-level spot check that a scope-missing
  account's call returns 🚫 (dev Clerk QA account state permitting).
- Post-merge PostHog check (named): `$mcp_tool_call` where
  `denial_code in ('drive_file_scope_missing','file_grant_missing_at_google')`
  appears with `outcome='denied_by_policy'`, and `outcome='failed'` rows with
  `failure_reason='drive_file_scope_missing'` stop after the deploy.
