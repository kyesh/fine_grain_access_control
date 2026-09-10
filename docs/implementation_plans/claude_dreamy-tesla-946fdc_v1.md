# Approve-page double submit: pending guard + replay-safe analytics (v1)

Branch: `claude/dreamy-tesla-946fdc` · Date: 2026-09-05

## Problem (PostHog, production, 7d to 2026-09-05 10:00 UTC, internal accounts excluded)

- Rage clicks on `/dashboard/approve`, all on the file-grant submit button
  (`FileApprovalFlow`), 6 days out of 7. Every rage-clicking user was approving a
  sheets/docs grant.
- `approval_link_approved` fires many times per link. Per action, unique
  `request_id` vs raw events: sheets_expose 15 links / 26 events, docs_expose
  1 / 14, docs_write 4 / 13, sheets_write 8 / 11. Link-level conversion is
  30/81 = 37%; the raw-event ratio (66/93 = 71%) overstates it.
- Since 2026-08-25 (deterministic links): 29 links approved once, 8 links
  approved 2–20 times. **Every multi-fire link since 2026-09 carries
  `substituted`/`granted_count`**, i.e. came through the picked-file path in
  `applyFileGrantApproval`, not the generic path.
- The replays are not analytics-only: `rule_saved{via=magic_link}` shows one
  sheets link writing **11 rules for 1 file in 12 seconds**, another 8 rules
  for 4 files in 1 second. Duplicate access rules reach the user's rules list.

## Root cause (code, main @ b5c27b6)

1. `FileApprovalFlow.tsx` renders a plain `<button type="submit">` with no
   `useFormStatus` pending guard. The sibling `ApproveSubmitButton` (generic
   approvals) has the guard and a header comment describing exactly this
   double-submit failure (2026-08-17). React 19 queues every submit while the
   action is in flight, so N clicks → N sequential server-action calls.
2. `approveMagicLink` skips its grant-level idempotency check whenever a pick is
   present (`!pickedSheets?.length && grantActiveForApproval(...)`), because a
   pick may substitute a different file. The picked path in
   `applyFileGrantApproval` then re-verifies every pick with Google (one Drive
   call per pick per replay, plus up to 2×3.5s grace retries), inserts a rule
   per pick with no dedupe, and emits `approval_link_approved` again.
3. The generic path's short-circuit (`already approved, nothing changed`) emits
   nothing, so replay frequency there is invisible.

## Plan

1. **Button guard** — make `ApproveSubmitButton` accept a label (default
   "Approve this grant") and use it inside `FileApprovalFlow`'s form, so both
   labels ("Approve this grant" / "Grant access to what I picked") disable and
   read "Approving…" while pending. Disable the secondary "Pick again" /
   "That's not right" buttons while pending too.
2. **Server-side dedupe on the picked path** — before inserting a rule for a
   verified pick, check `grantActiveForApproval` for that file id at the chosen
   level; skip active ones. If nothing was inserted the submit is a replay:
   emit `approval_link_replayed {action, request_id, path: 'picked'}` and
   return the existing "already approved, nothing changed" success. Emit the
   same event (`path: 'grant_active'`) from the generic short-circuit.
   `approval_link_approved` then fires only when a grant is actually written;
   `request_id` stays on minted/approved/replayed so per-link joins work.
3. **Test** — `scripts/test-approve-submit-button.ts` (happy-dom + React
   `act`): the button disables and flips to "Approving…" while the form action
   is unresolved, re-enables after, for both labels. Wired into `mcp:lint`.
4. **Docs** — `docs/analytics.md`: event table rows for `approval_link_approved`
   (write-only) and `approval_link_replayed`; note that raw approve counts
   between 2026-08-25 and this fix are inflated and must be read as
   `uniq(request_id)`. `docs/monitoring.md`: new named query 7.14 for
   approval-link conversion per request. Daily review prompt already says
   "minted vs approved conversion" — leave a note that it must be per link.

## Verification

- Pre-fix repro (local, USER_A, injected `picked`, 6 clicks in ~1s): recorded
  by a QA runner — see v2 for numbers.
- Post-fix: same flow locally and on the preview deployment; expect one POST to
  produce one `approval_link_approved`, further clicks blocked client-side, and
  a forced replay (re-open the link, submit again with a pick) to emit
  `approval_link_replayed` and write no rule.
