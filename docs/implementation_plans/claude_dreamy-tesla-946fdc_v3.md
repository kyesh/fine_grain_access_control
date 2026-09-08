# Approve-page double submit: pending guard + replay-safe analytics (v3)

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

### Pre-fix reproduction (local, main @ b5c27b6, 2026-09-05 19:01 UTC)

QA runner, built-in browser, signed in as USER_A. Minted a `sheets_expose` link
for the All Access profile on a sheet the account already has Google access
to; the page reached the confirm step "(verified with Google)"; the Picker
result was simulated by appending the `picked` hidden input; six `click()`s
150 ms apart.

| observation | value |
| --- | --- |
| button `disabled` at clicks 0–5 | `false` every time, label never changed |
| POST `/dashboard/approve` | 6, all 303 |
| `approval_link_approved` (dev PostHog, this request_id) | 6 |
| `rule_saved{via=magic_link}` | 6 |
| `sheets_grant_verification{result=ok}` (one Google Drive call each) | 6 |
| "Demo Spreadsheet" rows on the All Access profile afterwards | 6 |

So every replay re-ran the picked path end to end: a Google call, a rule
insert and an approve event per click. The page's own on-load Google check
runs once per page load, not per replay; the wasted calls are server-side.

### Unit level

`scripts/test-approve-submit-button.ts`: guard scenarios pass for both labels;
the control (an unguarded submit button, the pre-fix shape) dispatches three
actions for three clicks — React queues them, which is the mechanism.

### Post-fix, local (fix @ d3e1cb0, 2026-09-05 19:18–19:21 UTC)

QA runner, built-in browser, USER_A, same sheets link; duplicates from the
pre-fix run cleared through the dashboard UI first. Development PostHog events
for the two request ids, per part:

| part | client observation | POSTs | rules | approved | replayed | Google verify |
| --- | --- | --- | --- | --- | --- | --- |
| B — 6 clicks, 150 ms apart | click 0 enabled; clicks 1–5 saw `disabled:true`, "Approving…" | 1 (303) | 1 | 1 | 0 | 1 |
| C — `requestSubmit()` ×3 in one tick (bypasses the button) | success page | 3 (303) | 1 | 1 | 2 (`path=picked`) | 1 |
| D — send_whitelist, `requestSubmit()` ×2 | success page | 2 (303) | 1 | 1 | 1 (`path=grant_active`) | n/a |

Re-opening either approved link renders "✓ Already approved" with no form.
Capability 14 A15 and A14 pass; A1–A13 were out of scope for the dispatch.

Environment note from the runner, not a product bug: "Detach" on a rule's last
profile converts it to a Global rule (capability 09 A4, by design), which
`grantActiveForApproval` treats as active for every key — the runner set those
rows to Blocked to get back to a fresh state. The branch database carries the
leftover Blocked rows.

### Preview — see v4
