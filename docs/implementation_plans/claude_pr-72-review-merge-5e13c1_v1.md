# PR #72 salvage — production QA gate, adoption instrumentation, directory-error demotion

Branch: `claude/pr-72-review-merge-5e13c1`

## Motivation

PR #72 ("review merge") predates ~200 commits of divergence on `main` — the MCP
route was reshaped (windowed reads, raw-API classification, failure_reason,
scope pre-flights), the sheets funnel became kind-parameterized for Docs, and
the analytics catalog grew a taxonomy the old branch never knew about. A
mechanical merge was not reviewable, so the salvage re-derives the PR's intent
as three workstreams rebased onto current `main`, and drops what `main`
superseded:

- **Dropped: the blanket "recoverable errors" reclassification.** The old
  branch demoted broad swaths of Google errors out of `isError`. Since then,
  `main` grew the precise machinery (`failure_reason`, `error_reason`/
  `error_domain`, `google_scope_missing` pre-flights, `size_capped`) that
  handles most of those classes individually. What survives is the narrower
  Workstream C demotion: exactly three user/caller-fixable guidance results,
  each already carrying its own ❌ remediation text.
- **Dropped: the separate `rule_created` event.** `main` already had
  `rule_saved`/`rule_save_failed` via `reportRuleSave`; the new signal is
  folded into the existing events as the `via` + `file_id` props instead of a
  parallel event name that would split every query.

## Workstream A — /qa-production confirmation gate (docs/runbooks only)

`/qa-production` now requires explicit in-session user confirmation before it
runs; the production runbooks refuse to execute unless the dispatch prompt
contains a confirmation sentence. No source changes. (Owned by the
commands/runbooks edit stream, listed here for completeness.)

## Workstream B — sheets/docs adoption instrumentation

Closes the funnel blind spots between "user wants an agent on a file" and
"first successful call on that file":

1. **`rule_saved` gains `via` + `file_id`** (`reportRuleSave`,
   `src/app/dashboard/actions.ts`): `via` ∈ `dashboard_manual` (hand-typed
   rule form) | `dashboard_picker` (Picker expose) | `magic_link`
   (approval-page grant); `file_id` when the rule targets a sheet/doc. New
   firing sites: `exposeFilesFromPicker` (`via=dashboard_picker`, plus
   `profile_scoped`; `mode` create|update) and magic-link `insertFileRule`
   (`via=magic_link`, plus `request_id` — joins the approval funnel).
   `rule_save_failed` gains `via: dashboard_manual`. Patterns still never
   leave the server (shape props only).
2. **Grant verification at rule birth** (`createRule`): a hand-typed
   sheet/doc id is verified against the Google `drive.file` grant at creation
   and fires `sheets_grant_verification` / `docs_grant_verification`
   `{result: ok|missing|unknown, via: dashboard_manual,
   spreadsheet_id|document_id}` — the stranded-at-birth case becomes visible
   the moment it exists. Telemetry only: a Google hiccup never fails rule
   creation.
3. **Every recovery re-check captured**
   (`verifyFileAccessGET`, `context=recovery`,
   `src/app/api/rules/fileAccessHandlers.ts`): fires
   `sheets_grant_verification`/`docs_grant_verification`
   `{result, via: recovery, spreadsheet_id|document_id}` on EVERY recovery
   re-check — attempts that stay `missing` are the funnel's stuck users.
   Previously only successes were visible via `sheets_grant_recovered`,
   which still fires on `ok`.
4. **Client picker events** (`src/app/dashboard/useGooglePicker.ts`, all
   carrying `kind: sheet|doc`, page context from `$pathname`):
   `picker_scope_redirect` (before the OAuth consent redirect — the funnel's
   riskiest hop), `picker_opened {from_oauth_return}`, `picker_picked
   {count}`, `picker_cancelled`. Existing `picker_flow_error
   {stage, message}` unchanged.
5. **`$mcp_tool_call` gains `file_id` + `file_service`**, stamped in
   `checkFilePermission` (`src/app/api/mcp/route.ts`) — every sheets/docs
   typed tool, comments tool, and raw per-file API call, denied outcomes
   included. Per-file time-to-first-success becomes queryable, joining to
   `rule_saved.file_id`.

Funnel definition (docs/analytics.md): `picker_scope_redirect` →
`picker_opened` → `picker_picked` → `rule_saved{via}` →
`*_grant_verification{result=ok}` → first successful `$mcp_tool_call` with
that `file_id`.

## Workstream C — directory error demotion (`src/app/api/mcp/route.ts`)

Three user/caller-fixable Google-guidance results demote from `isError`
(outcome `error`, `$mcp_is_error=true` — the field the Anthropic Connector
Directory's published per-tool error rates read) to ❌ text (outcome
`failed`):

- (a) `fileGrantErrorResult` — post-policy 403/404 "sheet/doc not picked in
  the Picker" setup-link guidance;
- (b) `gmailNotFoundResult` — 404 stale message-id / attachment-id guidance
  (both branches; `gmail_404_site` still stamped);
- (c) `commentsErrorResult` — stale-comment-404 guidance.

Boundary: `error` = FGAC/Google unhealthy (5xx, `timeout`, `network`,
throttling 403s, exceptions — all unchanged); `failed` = the caller or user
can fix it by acting differently. Internal props are untouched
(`error_status`, `error_reason`, `error_domain`, `gmail_404_site`), so
observability loses nothing — only the published error rate stops counting
conditions FGAC cannot heal. Error-rate trend queries must split on
`outcome` and date-bound at the deploy window (documented in
docs/analytics.md).

## Validation

1. `npx tsc --noEmit` and `npm run lint` clean.
2. Local scoped QA run: capabilities **16 (analytics events)** and
   **17 (sheets grant recovery)** via a scoped `qa-env-runner` dispatch —
   new assertions 16 A15–A17 (rule_saved via/file_id; `$mcp_tool_call`
   file_id/file_service; not-picked call classifies `failed` +
   `$mcp_is_error=false` + `error_status`) and 17 A10–A11
   (`via: dashboard_manual` at rule birth; `via: recovery` on re-checks even
   when `missing`), plus rewritten 17 A7 (demotion) and the updated 16 A10
   bullets. `npx tsx scripts/qa-coverage-check.ts` arbitrates completeness.
3. `/deploy-pr-preview` and re-verify the event assertions against
   `environment='preview'` per capability 16 conventions.

## Doc changes in this revision

- `docs/analytics.md`: catalog rows for `rule_saved`/`rule_save_failed` and
  the four picker events (+ `picker_flow_error`), extended
  `sheets_grant_verification` `via` enum (`dashboard_manual`, `recovery`),
  `file_id`/`file_service` on `$mcp_tool_call`, the `error` vs `failed`
  boundary note, and the sheets/docs adoption funnel definition.
- `docs/QA_Acceptance_Test/capabilities/16_analytics_events.md`: A10 updated
  for the demotion; new A15–A17.
- `docs/QA_Acceptance_Test/capabilities/17_sheets_grant_recovery.md`: A7
  rewritten for the demotion; new A10–A11.
