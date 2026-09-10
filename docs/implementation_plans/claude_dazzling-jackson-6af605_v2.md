# Approve page: the "opened, never approved" leak, re-read per person (v2)

Branch: `claude/dazzling-jackson-6af605` · Date: 2026-09-09 · PR #128 · Builds on PR #123
(cancel-recovery panel, `resourceName`, `attempt`/`elapsed_ms`, deployed 2026-09-08)
and sits beside PR #126 (shared drives as a second Picker view — not duplicated here).

## Brief

Trailing-7-day approval funnel: 161 `approval_link_minted` vs 67 `approval_link_approved`.
In the sheets sub-funnel the largest drop is gate-hit → link-opened (PR #126 analyses
it for docs); the next, opened → approved, had three accounts this week that opened a
sheets link, ran the `link_open` verification, and never emitted a Picker event or an
approval. Two more opened the Picker repeatedly, cancelled every time, and left.

Establish first (from the brief): (1) what the page rendered for B and C after
`link_open`; (2) whether the pick control can be disabled/invisible without an event;
(3) why A's Picker closed with no pick after a successful reconnect; (4) whether the
Sept 8 Clerk token failures touched these accounts.

## Evidence (PostHog, production, 2026-09-02 10:00Z → 09-09 10:00Z, internal accounts excluded)

Re-verified with HogQL before building. Accounts by letter, never by identifier.

| event | rows | distinct links | persons |
| --- | --- | --- | --- |
| `approval_link_minted` | 170 | 112 | 44 |
| `approval_link_opened` | 143 | 68 | 39 |
| `approval_link_approved` | 71 | 51 | 25 |
| `picker_opened` / `picker_cancelled` / `picker_picked` | 59 / 18 / 32 | — | 29 / 9 / 25 |
| `picker_flow_error` | 0 in 7 d (2 in 30 d, one person, 2026-08-27) | — | — |

Per action (PR #126's 7.19 query, this week): sheets_expose 38 links / 27 opened /
18 approved; sheets_write 18 / 11 / 7; docs_write 25 / 22 / 20; docs_expose 14 / 1 / 0.

### Question 1 — B and C: what the page rendered, and what happened next

Both `link_open` verifications returned `missing` (C: three of four opens; B: one), so
both saw the standard pick-first panel ("Google hasn't shared the sheet the agent
asked for (Google id …) … Step 1 — Pick the sheet in Google Picker"). `status` on the
opens was `fresh`, `agent_driven: false`, ordinary Chrome on Windows (C) and Mac (B).

What the review's query could not see:

- **Both accounts are telemetry-blind.** Over 30 days B has 39 server-side dashboard
  events and 43 tool calls, C has 23 and 59 — and **zero** client-side events of any
  kind (`$pageview`, `$autocapture`, `$web_vitals`, `picker_*`). posthog-js never
  reached PostHog from their browsers (content blocker). "No picker event" is therefore
  unobservable for them, not a behaviour. Across the 30-day cohort, 8 of the 65 people
  who opened an approval link have this property; 4 of those 8 approved a link (their
  `sheets_grant_verification{via=magic_link}` proves a pick the client funnel never saw).
- **Both agents built a substitute.** C: denied on sheet id X 09-07 19:33–19:36
  (opened the link 4× in those minutes), denied once more 09-08 07:29, then 07:31
  `google_api_modify` success → `agent_sheet_created {auto_granted: true}` → 60+
  successful `sheets_update_range`/`sheets_edit`/`sheets_read_range` on two NEW ids on
  09-08 and 09-09. B: opened the link 09-09 05:57:28, `google_api_modify` success at
  05:58:44 (76 s later) → `agent_sheet_created` ×2 → 30 successful sheets calls on two
  new ids by 06:07; the original id was denied again at 06:43 (the re-mint the brief
  saw). Two more gate-hit accounts this week did the same without ever opening the
  link. The approve funnel reads all four as leaks; the user's need was met by a file
  the agent created (auto-granted by design, `route.ts` `sheets_create`).

Verdict on (1): the page state was the normal pick-first panel; the "leak" for B and C
is a measurement artefact (blocked client telemetry) on top of a real product event
(agent-created substitute) that the funnel does not read.

### Question 2 — can the pick control stall without an event?

Code paths that leave the button inert: `openPickerFlow` returns silently when Clerk's
`user` is not yet loaded; a hanging token fetch keeps `isLoading` true ("Opening Google
Picker…") with no event; a Picker overlay that never loads fires no CANCEL. Measured
since `picker_opened` exists (2026-09-03): **every** pick-button `$autocapture` click on
the approve page was followed by a `picker_opened`, `picker_scope_redirect` or
`picker_flow_error` — no silent no-op observed in 14 days. Orphan opens
(`picker_opened` with neither cancel nor pick) exist — 8 of 59 — and every one is the
user leaving the page with the Picker open (the next event is a pageview elsewhere or
nothing), which fires no callback. Verdict: no fix to the gating; the leak needs a
server-side row per click, which is what `picker_token_requested` adds.

### Question 3 — A: why the Picker closed with no selection

A signed up 09-05 13:55:59 from the Claude desktop app and opened every link inside
the app's in-app browser (UA `… Claude/1.46388.4 Chrome/148 …`, Windows — which
the `AGENT_UA` regex classified as `agent_driven: true`; A's own pageviews and
pick-button clicks prove a person). Sequence: 13:57 open → pick click →
`picker_opened` → left within 7 s (session recording: 1 click, 7 s active). 18:17
same, twice. Then the dashboard: enabled Shield and send-all, Accounts → "Reconnect
Google" (returned + verified in 6 s), profile → "+ Expose a sheet" → `picker_opened`
→ `picker_cancelled` after 40 s → Clerk "Manage account" → "Remove" ×2 → sign out.
Never back since; the agent's hourly job keeps failing.

The tell is the agent: every `sheets_read_range` that is not a policy denial fails
with `failure_reason: account_not_permitted` — the agent names an `account` the key
does not cover, and PR #123's branch-DB check found the user's own address IS on the
key. So the agent is asking for a sheet in a **second Google account**. The Picker
lists the Drive of the one Google account connected to FGAC; that sheet can never
appear in it, and 40 s of looking ends in a cancel. Nothing on the page said whose
Drive the Picker was searching. E (the 3-cancel account, 09-03) shows the same
shape: cancels at 18 s / 7 s / 4 s, then "Manage account" → Sign out → "Sign in with
Google" again → Accounts → "+ Add account" → "Delegate Access" → "Grant" → "Add
Google Sheet +" → cancel after 4 s → sign out. E had `drive_file_scope_missing`
failures before the gate. Both were hunting for the other account.

D (6 cancels within 4–12 s, docs, Workspace domain) is PR #126's shared-drive case.

Verdict: not shared drive, not the reconnect; the sheet lives in a Google account
the Picker cannot see. Fix: say so on the page, with the connected address and the
one step that works today (share the file with that address → "Shared with me").

### Question 4 — Sept 8 Clerk token failures

`google_token_fetch_failed` in 10 days: `oauth_token_retrieval_error` (Clerk 400,
retried) hit three accounts on 09-08/09-09 — none of A, B, C, D, E. All five
`grant_check` verifications for A/B/C read `missing` from a live token (their agents'
Google calls succeeded the same day for B and C). No dead-grant confound.

## Candidate directions — verdicts

| direction | verdict | evidence |
| --- | --- | --- |
| Emit an event when the flow stalls before `picker_opened` | **accept, server-side** — `picker_token_requested` on `/api/auth/google-picker-token` | 8 / 65 openers are telemetry-blind; the token bridge is the first request every pick click makes and it also records `has_drive_file_scope` (dead grant → reconnect leg) |
| Fix page state / copy after `link_open` | **accept, narrowly** — name the connected Google account on the pick-first panel and the recovery panel | A and E; the page could not tell them the Picker was searching the wrong Drive |
| Rely on PR #126 for unpickable files + account-mismatch hint | **accept** — PR #126 covers D (shared drives); the hint here covers A/E | no overlap with #126's `useGooglePicker` change |
| Classify Claude desktop's in-app browser as an agent | **reject / fix** — 19 opens, 7 people in 30 d were humans | `client: claude_desktop`, `agent_driven: false` |
| Treat B and C as stuck users | **reject** | agent-created substitutes, productive same day |
| Clerk token failures as the cause | **reject** | none of the five accounts affected |
| Change Picker gating (`!user` early return, hanging token fetch) | **reject for now** | zero observed instances in 14 d; the new server row would surface one |

## Changes

- `src/lib/pickerRecoveryCopy.ts` — `pickerAccountHint({short, googleEmail})`, pure,
  tested; degrades to "the Google account connected to FGAC" when the address is
  unknown.
- `src/app/dashboard/approve/FileApprovalFlow.tsx` — renders the hint under the pick
  button (`<prefix>-flow-account-hint`) and inside the cancel recovery panel; new prop
  `connectedGoogleEmail`.
- `src/app/dashboard/approve/page.tsx` — resolves the connected Google address from
  Clerk's external account (file links only); `approval_link_opened` gains `client`
  (`browser` / `claude_desktop` / `agent`) from `src/lib/approveClientClass.ts`.
- `src/app/api/auth/google-picker-token/route.ts` — `picker_token_requested {result,
  has_drive_file_scope, scope_source, app_id_resolved, page}`.
- Docs: `analytics.md` (event rows; "opened, never approved is not one population"),
  `monitoring.md` 7.15 (server-vs-client click query; substitute query), QA 17
  A13/A14, 16 A21.
- Tests: `scripts/test-approve-client-class.ts` (new, in `mcp:lint`),
  `scripts/test-picker-recovery-copy.ts` extended.

Not changed: `useGooglePicker` (PR #126 owns it this week), the denial/agent protocol
text, the agent-created auto-grant (working as designed; now readable in the funnel).

## Validation

Unit: `mcp:lint` scripts (incl. the new `test-approve-client-class.ts`), `tsc --noEmit`,
eslint — clean.

Both QA rounds were run by `qa-setup-driver` with USER_A: local dev server + branch DB,
then the Vercel preview of commit 7651e04 (code-equivalent to the branch head; the later
commits are docs only). A deterministic `sheets_expose` link for a never-picked placeholder
id was minted with a read-only, gitignored helper — no MCP denial, no DB writes, no grant
submitted. Picker interaction went through Path B (Playwright CLI on the CDP Chrome): the
built-in pane opens the Picker with a trusted click but cannot close it (its Escape returns
focus to the parent; pointer events never reach the cross-origin frame).

| assertion | local | preview |
| --- | --- | --- |
| 17 A2 pick-first, no blind approve (`link_open` → `missing`) | pass | pass |
| 17 A13 account hint under the pick button names USER_A's connected address | pass | pass |
| 17 A12 cancel → recovery panel, Try again reopens without reload | pass | pass |
| 17 A13 same account sentence inside the recovery panel | pass | pass |
| 17 A14 `picker_token_requested {ok, has_drive_file_scope: true, google-tokeninfo, app_id_resolved: true, page: /dashboard/approve}` — one per click, count = `picker_opened` | pass (3 = 3) | pass (3 = 3) |
| 16 A21 `approval_link_opened.client`: `browser` from real Chrome, `claude_desktop` from the built-in pane | pass | pass |
| substitution panel after picking the fixture sheet (not submitted) | pass | pass |

Console: no FGAC errors either round; the noise is the Descript embed's third-party
trackers blocked by CSP and Google Picker's own permissions-policy notices.

Observations from the runs, folded into the docs (commit 990083e):

- The built-in browser pane IS Claude desktop (UA `Claude/<build> Chrome/…`) — opens driven
  from it land as `client: 'claude_desktop'` by design (QA 16 A21).
- `approval_link_opened` fires per server render; extra rows appeared while the tab sat idle
  (route refreshes). Pre-existing; read the funnel per `request_id` (analytics.md).
- The pick-first panel's "First time? Google will ask you to allow…" line shows even when
  `drive.file` is already granted — harmless, not changed.

Post-deploy check (monitoring.md 7.15): within a week, `picker_token_requested` rows should
exist for people with `link_open` verifications and no `picker_opened`; the
`claude_desktop` share of `approval_link_opened` should match the old `agent_driven`
over-count (~19 opens / 7 people per 30 d); and the opened-not-approved review should list
substitutes (`agent_sheet_created`) separately from stuck users.
