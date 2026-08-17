# Sheets Adoption Instrumentation (v1)

Branch: `claude/sheets-adoption-instrumentation` · Date: 2026-08-17
Builds on: PR #71 (picker-first sheets grant recovery + its `sheets_grant_*`
events). This branch also carries PR #69 (production-QA confirmation gate) and
PR #70 (recoverable Google errors) so all three ship as one deploy.

## Goal

Make "a user successfully added a Google Sheet" measurable end-to-end, on all
three creation surfaces, including where users get stuck.

## Gap analysis (post-#71)

Covered already: magic-link approvals (`sheets_grant_verification` via
link_open/magic_link, `approval_link_approved` with substitution), recovery
successes (`sheets_grant_recovered`).

Dark spots found:
1. **Dashboard rule creation emitted no events at all** — neither the manual
   form (`createRule`) nor the picker path (`exposeSheetsFromPicker`).
2. **Manual sheet rules were never grant-verified** — a hand-typed spreadsheet
   id creates the same stranded rule #71 fixed for magic links, silently.
3. **The Google Picker client flow was invisible** — no way to distinguish
   "never opened the picker", "lost in the OAuth consent round-trip",
   "cancelled the picker", and "picked".
4. **Recovery re-checks that stay missing were invisible** (only successes
   fired an event).
5. **`$mcp_tool_call` had no `spreadsheet_id`** — a successful sheets call
   could not be tied back to the specific sheet that was just added, so
   time-to-first-success per sheet was unqueryable.

## Changes

- `useGooglePicker.ts` (client): `sheets_picker_scope_redirect`,
  `sheets_picker_opened{from_oauth_return}`, `sheets_picker_picked{count}`,
  `sheets_picker_cancelled`, `sheets_picker_error{message}`. Surface
  (approve / sheets-setup / dashboard) comes free from `$pathname`.
- `actions.ts`: unified `rule_created` event
  {service, action_type, via: dashboard_manual|dashboard_picker|magic_link,
  spreadsheet_id, keys_assigned/profile_scoped} at all three creation sites;
  `createRule` additionally verifies the Google grant for sheets rules and
  fires `sheets_grant_verification{via=dashboard_manual}`.
- `verify-sheets-access/route.ts`: recovery context now fires
  `sheets_grant_verification{via=recovery}` on every re-check (kept
  `sheets_grant_recovered` on success).
- `mcp/route.ts`: `checkSheetsPermission` stamps
  `addToolCallProps({spreadsheet_id})` — one choke point covering all four
  sheets tools plus the raw-Google-API sheets branch, on allowed and denied
  outcomes.
- `docs/analytics.md`: catalog rows + sheet-adoption funnel definition.

## Non-goals

- No payload capture (sheet content never reaches PostHog; ids only, same as
  the existing `sheets_grant_*` events).
- No schema changes; no new QA capability doc in this revision (capability 16's
  taxonomy is untouched; a follow-up may add funnel assertions).

## Merge-resolution note (PR #70 × PR #71)

`sheetsErrorResult` (from #71) keeps its picker-aware guidance text but now
returns it as a success-shaped `textResult` per #70's recoverable-error policy;
`GoogleFetchResult` failures carry both `status` and `recoverable`. #70's
generic 403 "share the spreadsheet" hint was dropped as misleading — the
correct sheets fix is the Picker, and `sheetsErrorResult` owns that message.
