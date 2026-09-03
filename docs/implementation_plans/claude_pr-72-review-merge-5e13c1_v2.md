# PR #72 salvage — v2: QA-run corrections

Branch: `claude/pr-72-review-merge-5e13c1` — revision of
[v1](claude_pr-72-review-merge-5e13c1_v1.md) after the full-suite hosted-MCP QA
run (run_id `2026-09-02T04:16:00Z-hosted-mcp`, 186/186 assertions covered).
v1's design survives intact; this revision records what the run corrected.

## Correction 1 — the hand-typed rule seam is `grantFileAccessPOST`, not `createRule`

v1 put the birth grant verification and `via: 'dashboard_manual'` sheets/docs
instrumentation in `createRule` (dashboard `actions.ts`), assuming the manual
rule form could target sheets/docs the way it could in PR #72's day. It cannot:
the "Create Custom Rule" modal (`RuleControls.tsx`) hardcodes its Service
select to Gmail-only, so that code path is UI-unreachable for per-file rules —
QA failed 16/A15 and 17/A10 against it.

The reachable seam for a hand-typed (or API-supplied) sheet/doc id is
`grantFileAccessPOST` (`fileAccessHandlers.ts`) — the REST endpoint behind
`POST /api/rules/grant-{sheets,docs}-access`, which serves both the dashboard's
Picker manager (`ExposedFilesManager.tsx`) and any direct API caller. Fix:

- `grantFileAccessPOST` now fires `rule_saved {mode: create|update, service,
  action_type, via: 'grant_api', file_id}` and, on create only, the birth
  grant verification `*_grant_verification {result, via: 'grant_api'}`
  (telemetry-only, try/caught).
- The `createRule` instrumentation stays: `via: 'dashboard_manual'` is live and
  correct for Gmail rules, and the sheets/docs verification block remains
  truthful for direct server-action invocation, but assertions no longer
  target it. Capability 16 A15 and 17 A10 rewritten against the `grant_api`
  seam; `docs/analytics.md` documents the via split (the dashboard Picker leg
  is `via IN ('dashboard_picker','grant_api')`).

## Correction 2 — adjacent pre-existing bugs surfaced by the run, fixed here

Both are one-to-few-line fixes in files this PR already touches, so they ride
along rather than waiting for their own deploy:

- **Windowed reassembly not byte-identical (cap 20 A5, pre-existing since
  PR #108).** `sheets_get_spreadsheet` / `sheets_read_range` /
  `docs_read_document` windowed their payload as compact
  `JSON.stringify(result.data)` while the windowless path pretty-prints via
  `jsonResult` (indent 2). Windows now serialize with `(data, null, 2)` so
  reassembly matches the unwindowed read byte-for-byte.
- **`mint_count` missing on three mint sites (cap 16 A11, pre-existing).**
  `sendDenialWithLinks` (both the per-recipient and send_all links) and the
  `request_access` tool discarded `recordApprovalMint`'s return value;
  `approval_link_minted` there fired with no `mint_count` while
  `policyDenialWithLink` stamped it. All three now stamp it.

## Not fixed here — reported to the user

- **Capability 07 A1–A4 (key lifecycle):** revoked keys return HTTP 200
  "blocked by user" text rather than a bare 401, revoked profiles vanish
  instead of showing a Revoked audit badge, and no key-roll/regenerate control
  exists. Long-standing spec-vs-product drift, not a regression from this
  branch; whether to change product or assertions is a product call.
- **Capability 03 A4 / 04 A2:** stale Google grant for USER_B in the dev
  environment (USER ACTION REQUIRED: re-auth).
- **Capability 16 A13:** `agent_driven` is `true` for every CDP-driven
  approval open — likely a harness artifact, needs a human-browser check.

## Validation delta

Scoped re-test of capabilities 16, 17, 20 after these fixes; auditor pass;
then push → PR → `/deploy-pr-preview`.
