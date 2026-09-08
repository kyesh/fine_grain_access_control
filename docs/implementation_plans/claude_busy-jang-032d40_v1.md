# Docs approval links: where the 0-of-13 loss actually is (v1)

Branch: `claude/busy-jang-032d40` · Date: 2026-09-08 · Base: main @ e60a8f7 (PR #122 deployed 14:34Z)

## Question

PostHog (production, trailing 7 days, internal accounts excluded) showed 13
`docs_expose` approval links minted and none approved, against 16 of 34 for
`sheets_expose`. Before shipping anything, establish: (1) the true per-link
outcome, since a `docs_expose` link approved at the write level is recorded as
`docs_write`; (2) where the non-converting users stopped; (3) whether the docs
approve path works at all (local reproduction); (4) whether the docs denial text
prepares the user for the approve page as well as the sheets one does.

## Data (per link = `uniq(request_id)`, production, internal accounts excluded)

Funnel, 7 days to 2026-09-08 ~23:00 UTC, `approval_link_minted` → `_opened` →
`_approved` joined on `request_id`:

| action | links | opened | approved |
| --- | --- | --- | --- |
| docs_expose | 13 | 1 | 0 |
| docs_write | 25 | 22 | 20 |
| sheets_expose | 36 | 24 | 17 |
| sheets_write | 18 | 11 | 8 |

1. **The 13/0 figure is real, not relabeling.** Joining every
   `approval_link_approved` in 30 days back to its mint: all 20 `docs_write`
   approvals were minted as `docs_write`; no `docs_expose` link was approved
   under any action, and none was replayed. (Side fact that confused the raw
   counts: a write attempt on an unexposed doc is denied with
   `denial_code=docs_not_exposed` but mints a **`docs_write`** link — denial
   code and link action are different things.)
2. **12 of 13 links were never opened.** Eight accounts minted them. Seven
   never loaded an approve page for a docs link (no `approval_link_opened`, no
   `$pageview` with `a=docs_expose`); five of those seven opened and approved
   sheets links in the same week, so they know how to open a link. Compare
   the sheets_expose open rate of 24/36.
3. **The one opener is where the Picker matters.** A Google Workspace domain
   account opened two docs links (same document, re-minted), landed in the
   pick-first state (`docs_grant_verification{link_open, missing}`), opened the
   Picker five times on the approve page and twice more from the dashboard
   ("+ Expose a doc", Accounts page), and cancelled every time within 4–12
   seconds. The session recording metadata shows 9 clicks and **0 keypresses**
   in six minutes: they never typed in the Picker's search box. No FGAC error,
   no `picker_flow_error`, no server-action failure.
4. **The rage clicks were not docs.** The 2026-09-03 rage-click session named
   in the brief was a `sheets_expose` link that approved 11 times in 12
   seconds — the PR #122 double-submit, already fixed. No `docs_expose` link
   ever reached a submit, so the pre-#122 bug cannot have hurt docs.
5. **Docs verification fires at every stage.** `docs_grant_verification` this
   week: `link_open` missing 9 / ok 17, `magic_link` ok 29, `post_approval`
   ok 20, `grant_api` ok 3. Three accounts completed the pick-first docs path
   on `docs_write` links (one picked 62 files at once and approved a
   substitution; one cancelled the Picker once, reopened it, picked, approved).
   The docs Picker view, mime handling and verification work in production.
6. **All 13 denied document ids are well-formed** (44 characters, id charset).
   No pasted `/edit` suffixes, no 33-character Drive ids of non-native files.
   (Sheets did see three 33-character ids from one account — an uploaded
   `.xlsx` that neither the Sheets API nor the SPREADSHEETS Picker view can
   serve; out of scope, noted for later.)
7. **Denial text is identical for docs and sheets.** `checkFilePermission`
   builds one kind-neutral sentence ("Document/Spreadsheet '<id>' is not
   exposed in your FGAC rules") and `policyDenialWithLink` appends the same
   link line, relay wording and agent protocol. Neither kind tells the user
   the page may ask them to pick the file in Google's Picker. The tool
   descriptions (`docs_read_document` vs `sheets_read_range`) are equally
   silent about the approval flow.
8. **Context of the docs denials is incidental, not user-driven.** One account
   probed four different documents in 64 seconds in the middle of a sheets
   session and went straight back to sheets. One hit a doc after 13 minutes of
   Gmail reading (an id from an email link) and made no further call. One's
   first-ever tool call after `list_accounts` was the docs read. Three of the
   seven non-openers made 36–129 more (non-docs) tool calls after the denial;
   three went quiet.
9. **Account type.** 14 days: docs_expose minters 4 consumer / 5 Workspace;
   the docs Picker on Workspace accounts: 8 opens, 7 cancels, 1 pick (three
   accounts, dominated by the user in item 3); consumer: 9 opens, 6 picks,
   1 cancel. Sheets Picker cancels are 5/21 (consumer) and 4/13 (Workspace).

## Verdicts

- **(a) A docs-specific bug in the approve / Picker / verification path —
  rejected.** Items 5 and 6; local reproduction below.
- **(b) The pre-#122 double submit hurt docs disproportionately — rejected.**
  Item 4. Nothing to re-measure after #122 for docs: no docs link reached a
  submit before or after the deploy.
- **(c) Users abandon at the Picker — true for 1 of 13; the other 12 were
  lost before the page.** The docs_expose leak is an *open-step* leak: the
  denial reaches the agent, and the user never opens the link. Item 8 says
  why: docs ids arrive from emails and Drive probing rather than from the
  user asking for that document, so the link is a side note in the agent's
  reply. Sheets requests are user-initiated and the same users open them.

## Where PR #123 (open, `claude/brave-varahamihira-4d3682`) already sits

It covers the Picker-cancel dead end (recovery panel with an in-place retry,
by-name hint, `attempt`/`elapsed_ms` on the Picker events), stores a
`request_access` title so the approve page can show a name, adds protocol rule
(4) telling agents to relay the file's name, and instruments the failed
post-pick verification loop. This branch does not touch those files' hot spots
and adds no more denial text.

## What this branch does

1. **Picker: show shared drives.** Google's Picker reference states shared
   drives and their files are shown only when `DocsView.setEnableDrives(true)`
   is called; FGAC builds `new google.picker.View(ViewId.<kind>)`, and the base
   `View` has no such method, so a Workspace user whose document lives in a
   shared drive opens a Picker that cannot list it — consistent with the
   quick, search-less cancels in item 3 (a Workspace account), though that
   user's file location is not observable. Change `useGooglePicker` to build a
   `DocsView` for the kind's `pickerViewId` with `setEnableDrives(true)` and
   `setIncludeFolders(true)` (folders are navigable, not selectable). Applies to
   sheets and docs alike, keyed off the kind descriptor. Docs/Sheets API
   verification needs no `supportsAllDrives` flag; raw Drive passthrough is the
   agent's own query string.
2. **Docs.** `docs/analytics.md`: how to read the per-action funnel (open-step
   vs Picker-step loss, denial code ≠ link action). `docs/monitoring.md` 7.16:
   the minted → opened → approved per-action query. QA capability 19 A6: links
   are permanent and deterministic, not single-use with a 30-minute TTL
   (capability 14 A12/A13 wording).
3. **Not shipping.** Denial-text or approve-page copy changes (PR #123's
   ground); any server-side change to the docs grant path (nothing is broken).

## Verification plan

- Local: a `qa-setup-driver` reproduces the production flow on main — new
  Google Doc as USER_A, `docs_read_document` over MCP → `docs_expose` denial,
  approve link → pick-first → Picker (keyboard) → confirm → approve →
  `docs_read_document` succeeds; also the cancel path and two malformed-id
  shapes. Results in v2.
- Local, after the Picker change: same flow still completes for USER_A; the
  Picker for USER_B (Workspace domain) shows a shared-drives entry if that
  account has any shared drive; no regression to multiselect or the keyboard
  path.
- Preview via `/deploy-pr-preview`: capability 19 A6 and the approve flow
  scoped run.

## Queries (HogQL, sanitized — replace `<internal>` with the exclusion list)

```sql
-- funnel per action, per link
WITH minted AS (SELECT properties.request_id AS rid, any(properties.action) AS action
  FROM events WHERE event='approval_link_minted' AND properties.environment='production'
  AND timestamp > now() - INTERVAL 7 DAY AND person.properties.email NOT IN (<internal>) GROUP BY rid),
opened AS (SELECT DISTINCT properties.request_id AS rid FROM events WHERE event='approval_link_opened' AND timestamp > now() - INTERVAL 30 DAY),
appr AS (SELECT DISTINCT properties.request_id AS rid FROM events WHERE event='approval_link_approved' AND timestamp > now() - INTERVAL 30 DAY)
SELECT m.action, count() AS links, countIf(o.rid != '') AS opened, countIf(a.rid != '') AS approved
FROM minted m LEFT JOIN opened o ON o.rid = m.rid LEFT JOIN appr a ON a.rid = m.rid
GROUP BY m.action ORDER BY m.action
```

```sql
-- relabel check: approved action vs minted action
WITH mint AS (SELECT properties.request_id AS rid, any(properties.action) AS mint_action
  FROM events WHERE event='approval_link_minted' AND timestamp > now() - INTERVAL 30 DAY GROUP BY rid)
SELECT a.properties.action AS appr_action, m.mint_action, uniq(a.properties.request_id) AS links
FROM events a LEFT JOIN mint m ON m.rid = a.properties.request_id
WHERE a.event='approval_link_approved' AND a.properties.environment='production'
  AND a.timestamp > now() - INTERVAL 7 DAY GROUP BY appr_action, m.mint_action
```

ClickHouse LEFT JOIN fills unmatched strings with `''` and DateTimes with the
1970 epoch — test `!= ''`, never `IS NOT NULL`.
