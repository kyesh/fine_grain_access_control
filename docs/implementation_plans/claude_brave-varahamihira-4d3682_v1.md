# Picker-step leak on the file-grant approve page (v1)

Branch: `claude/brave-varahamihira-4d3682` · Date: 2026-09-08 · Builds on PR #118
(post-sign-in drive.file repair) and PR #122 (pending guard + replay-safe approval
analytics, merged 2026-09-05).

## Problem (PostHog, production, 2026-08-30 → 2026-09-06, internal accounts excluded)

Re-verified with HogQL before building. Counts are per `request_id` where that
matters; the raw `approval_link_approved` numbers in the brief are replay-inflated
(PR #122) and are not used here.

| action | mints | distinct links | mint users | approved links | approve users |
| --- | --- | --- | --- | --- | --- |
| sheets_expose | 50 | 34 | 27 | 17 | 17 |
| sheets_write | 27 | 17 | 13 | 9 | 6 |
| docs_write | 22 | 21 | 3 | 19 | 3 |
| docs_expose | 15 | 14 | 7 | 1 | 1 |

Load-bearing evidence is the per-user sequences (users A–E in the brief; no
identifiers here — the public-repo rule):

- **User A** (Claude desktop): 15 mints = **4 distinct links** (9 re-mints of one
  sheets_write link in 12 minutes — the agent retried despite the protocol text).
  Three opens, all `agent_driven: true`... then a Picker opened on the approve page
  at 18:18:24 with neither pick nor cancel (the user navigated to the profile page
  two minutes later — leaving the page fires no `picker_cancelled`). After the
  accounts-page reconnect (18:29:00) the Picker they opened at 18:30:03 and
  cancelled 40 s later was the **profile page's** picker, not the approve page's.
  Zero approvals. The three `sheets_read_range outcome=failed` rows are
  `failure_reason: account_not_permitted` — the agent passes an `account` the key
  does not cover; the user's own address IS on the key (branch-DB check). The
  calls recur hourly (`:37` past the hour, 17 rows by 09-08) — a scheduled job
  that will keep failing. `account_email` is NOT populated on these (the brief's
  claim was wrong; the prop is stamped only after the access check passes).
- **User B** (claude.ai): 3 opens, 3 `picker_opened`, 3 `picker_cancelled` within
  18 s / 7 s / 4 s of opening, all `from_oauth_return: false`, two on the approve
  page and one on the Accounts page. Zero approvals, silent since.
- **User C** (Claude desktop): 20 opens of ONE sheets_write link. The 08-31 burst
  (12 opens in 2 min at an ~8 s cadence, 3 pageviews, 4 `link_open`
  verifications, one `$rageclick` on the approve page) is the **retryable
  post-pick loop**: each submit runs `verifyPicks` with two 3.5 s grace waits
  (≈8 s), comes back "Google hasn't finished sharing… pick again", re-renders the
  page (server-side `approval_link_opened` fires, no pageview), and the user
  submits again. Picker events were not instrumented until 2026-09-02, so the
  pick itself is invisible. The grant landed 2 minutes later through the
  dashboard's sheets-setup page (first successful sheets call 19:30:27, then 240
  successes). Every later open of the link (09-03 → 09-07) resolved
  `status: already_granted`. **Approved is not under-reported; the approve-page
  path failed for this user and the dashboard path succeeded.**
- **User D** and the other zero-open minters: clients are Claude desktop ×3,
  claude.ai ×2, Claude Code ×3 — not a Toolbox-specific rendering problem. Claude
  desktop users open links at the same rate as the others in the minter table.
  Hypothesis rejected; no client-specific link formatting change.
- **User E**: 48 opens, 40 of them on one link in 175 s alongside 7 `$rageclick`
  on the approve page, with zero picker events. Server-side re-renders driven by
  repeated submits — PR #122's class. Not touched here.

Picker aggregate 09-03 → 09-07 (approve page + dashboard): 33 opens, 20 picks,
13 cancels (39%). Every observed cancel is `from_oauth_return: false`, so a hint
gated on the OAuth return leg would have missed all of them.

## What the user sees today (code, main @ e60a8f7)

1. `useGooglePicker` handles `Action.CANCEL` by capturing `picker_cancelled` and
   clearing the loading flag. It never tells the consumer. `FileApprovalFlow` is
   left on the same "Step 1 — Pick the sheet" panel with **no message**. The button
   still works without a reload, but nothing says so.
2. That panel names the file as `resourceName || fileId`. Denial-minted links
   carry no name (`sheetsApprovalAction` returns only the id; `resourceName` is
   "never carried in the URL"), and a file Google does not share with FGAC cannot
   be resolved by title. So the user sees **a raw Google id**, and Google's Picker
   lists files by name. Nothing tells them to look for the sheet by its name.
3. `request_access` accepts no title, even though the agent usually knows it.
4. `picker_cancelled` carries only `kind` — no elapsed time, no page, no attempt
   number, so retry-after-cancel is unmeasurable.
5. The post-pick verification loop (User C) emits nothing when it fails.

## Plan

1. **Cancel recovery panel** (`FileApprovalFlow`): `useGooglePicker` gains an
   `onCancelled` callback (elapsed ms, attempt, from-OAuth-return). On cancel the
   pick-first panel switches to a recovery state: nothing changed, the agent asked
   for **<title or "the sheet with id …">**, the Picker lists files by name so look
   for it by title, any sheet can be picked and a mismatch is flagged before
   anything is approved, and a **Try again** button that re-opens the Picker in
   place. The default pick-first copy gets the by-name hint too.
2. **Title on the approval page**: `approval_requests.resource_name` (new nullable
   column, migration 0012). `request_access` accepts an optional `resourceName`;
   the mint stores it (first non-empty value wins). The approve page reads it by
   `request_id` and uses it wherever `resourceName` is shown (heading, pick-first
   panel, recovery panel). `AGENT_APPROVAL_PROTOCOL` gains one rule: relay the
   file's name with the link, and pass it via `request_access` when known.
3. **Telemetry**: `picker_opened` adds `attempt` (per page session);
   `picker_cancelled` adds `elapsed_ms`, `from_oauth_return`, `attempt`;
   `approval_link_minted` adds `has_resource_name`; the failed post-pick
   verification fires `sheets_grant_verification {via: magic_link, result:
   missing, picked_count}` (docs twin likewise).
4. **`account_not_permitted` split** (open question 3): when the agent supplied an
   explicit `account` the key does not cover, answer as a 🚫 refusal
   (`denied_by_policy`, `denial_code: account_not_permitted`) that lists the usable
   accounts and says to omit the parameter. When no account was supplied and the
   owner's own address is not on the key, stay ❌ `failed` (a real malfunction).
5. Docs: `docs/analytics.md` (events + props), `docs/monitoring.md` 7.15 (picker
   cancel → retry per user), QA capabilities 15/16/17 assertions.
6. Tests: pure copy helper for the recovery panel (`scripts/test-picker-recovery-copy.ts`,
   wired into `mcp:lint`); existing suites unchanged.

## Rejected

- Gating the by-name hint on `from_oauth_return` + fast cancel: every observed
  cancel was a plain open. The hint shows on every cancel instead.
- Client-specific link formatting for Claude desktop: zero-open users span all
  three clients.
- Anything on the double-submit / re-render burst (User E): PR #122.

## Validation

- Local: `npm run mcp:lint`, `npx tsc --noEmit`, migration applied to the branch DB
  (`npm run db:migrate`), then a `qa-env-runner` pass of capability 17 A2/A12/A13,
  capability 15 A8, capability 16 A21 against the local dev server with the QA
  accounts.
- Preview: `/deploy-pr-preview`, same assertions on the preview URL.
