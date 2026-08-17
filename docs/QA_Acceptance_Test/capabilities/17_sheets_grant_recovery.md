# Capability: Sheets Grant Recovery (Approval → Google Grant → Verified Success)

## Overview
Models the real connector-directory user journey observed in production
(2026-08-16 launch cohort): an agent calls a sheets tool on a sheet the user
never exposed, the denial mints a `sheets_expose` magic link, the user
approves — and, before this capability existed, every retry then failed with
a generic Google 404/403 because approving created only the FGAC rule, never
the Google-side `drive.file` per-file grant (which registers only via a
Google Picker pick). Production data: 3 of 3 users who approved churned on
post-approval errors; zero external users ever reached a successful sheets
call.

This capability asserts the whole loop is now honest and recoverable: the
approval page verifies the Google half, walks the user through the Picker
with the embedded Sheets demo video when the grant is missing, the dashboard
flags stranded rules, and the MCP error for a rule-covered-but-ungranted
sheet tells the truth.

## Pre-requisites
* `/qa-setup` complete; dev server running; USER_A signed in (built-in browser).
* An MCP connection with an approved proxy key for USER_A (hosted MCP or
  Claude Code MCP per the agent runbook).
* A fixture spreadsheet owned by USER_A that has **never** been picked via
  the FGAC Google Picker in this environment (a fresh Neon branch resets
  FGAC rules but NOT Google-side drive.file grants — prefer a
  freshly-created spreadsheet to guarantee the ungranted state).
* Picker automation limits per capability 09's harness note: the picker
  iframe is cross-origin; use the app-API seam
  (`POST /api/rules/grant-sheets-access` cannot register a Google grant, so
  the *granted* end-state is simulated with a sheet that HAS been picked
  before — e.g. the standing QA fixture sheet — while the *ungranted* path
  uses the fresh sheet) or the Playwright CDP path for full fidelity.

## Assertions

### A1: The production failure sequence is reproducible up to the fix
- With the fresh (never-picked) spreadsheet: call `sheets_get_spreadsheet`
  via MCP → expect a denial whose text contains a `/dashboard/approve` link
  (token action `sheets_expose`, per capability 14 A10).
- **Expected**: The denial fires `$mcp_tool_call` with
  `outcome=denied_by_policy` and an `approval_link_minted` event with
  `action=sheets_expose` — the same event signature as the production
  incident. (This assertion pins the replication baseline; A2–A8 assert the
  new behavior on top of it.)

### A2: A missing Google grant makes the pick come FIRST — no blind approve
- Open the A1 link signed in as USER_A.
- **Expected**: The page verifies the Google-side grant on load (fires
  `sheets_grant_verification {via: link_open, result: missing}`) and shows
  the picker-first state: an explanation that Google hasn't shared the
  sheet, a "Step 1 — Pick the sheet in Google Picker" button, and **no
  approve/submit control** until a pick happens. No FGAC rule exists yet
  (`GET /api/rules/grant-sheets-access` unchanged) and the link is NOT
  consumed by merely opening the page.

### A3: The pick-first state embeds the setup video
- On the A2 page.
- **Expected**: The pick button launches the Google Picker flow (the
  `.picker-dialog` iframe opens, or the first-time `drive.file` consent
  redirect per capability 09 A2 — which must return to the approve page
  WITH the token still in the URL), AND the Sheets demo video (Descript
  embed `Fv9pwXugLUa`, rendered via `TrackedVideoEmbed`) is present.
  Playing it fires `video_played` with the approve page's `page` property.

### A4: Picking the requested sheet leads to confirm → approve → success
- Complete a pick that includes the requested sheet (Playwright CDP path
  for the real pick; app-API seam otherwise — see Pre-requisites), then
  approve (Read Only) on the confirm step that appears.
- **Expected**: The confirm step shows the sheet's real title; approval
  creates the rule and lands on the success page. The retried MCP call
  succeeds (`$mcp_tool_call` outcome=success) with no new approval link
  minted. The legacy recovery page at `/dashboard/sheets-setup` still
  performs pick → `sheets_grant_recovered` → verified for rules stranded
  before this flow existed (dashboard-chip entry path).

### A5: Approving a sheet that already has a Google grant skips the pick
- Mint a fresh denial link for a spreadsheet that HAS been picked before
  (standing QA fixture sheet) by calling `sheets_read_range` on it before
  any FGAC rule exists; open and approve the link as USER_A.
- **Expected**: The page goes straight to the one-click confirm (no pick
  step), showing the sheet's title resolved from Google; approving lands
  on the success state and `sheets_grant_verification` fires with
  `result=ok` (once via `link_open`, once via `magic_link`); the retried
  read succeeds.

### A9: Picking a DIFFERENT sheet becomes an explicit substitution
- From the A2 pick-first state, pick a sheet that is NOT the requested id
  (any real sheet USER_A owns).
- **Expected**: An explicit substitution confirmation appears — naming
  both the picked sheet and the agent's wrong id — and approving creates
  rule(s) for the PICKED sheet only; the requested id gets NO rule
  (`GET /api/rules/grant-sheets-access` shows no row for it, and no
  "needs Google access" chip appears later). `approval_link_approved`
  carries `substituted: true`. The agent's retry on the wrong id gets a
  fresh not-exposed denial (no phantom rule means no misleading A7 state),
  while `get_my_permissions` lists the picked sheet, and a call on the
  picked sheet succeeds. Server-side guard: a
  forged `picked` payload naming a sheet Google does NOT grant creates
  nothing and leaves the link unconsumed (retryable).

### A6: Dashboard flags rules whose sheets lack a Google grant
- With the A2 rule present but its sheet still un-picked, load `/dashboard`
  (profile Sheets card) and `/dashboard/accounts`.
- **Expected**: That rule's row carries a visible "needs Google access"
  indicator with a working recovery affordance (opens the same picker +
  video panel). Rules whose sheets verify OK show no indicator. The
  indicator never blocks the rest of the dashboard from rendering (a
  Google outage degrades to no-indicator, not a broken page).

### A7: Post-policy Google 403/404 on a sheets call returns an honest error
- With the A2 rule present and the sheet still un-picked, retry
  `sheets_get_spreadsheet` via MCP.
- **Expected**: The error is NOT the generic "Google resource not found
  (404). Check the ID and try again." It states that the sheet is approved
  in FGAC but Google access is not set up yet, and points the user at the
  dashboard to finish setup. `$mcp_tool_call` still records
  `outcome=error` (it IS an error) — but the text is actionable.

### A8: Recovery analytics distinguish the funnel stages
- Replay A1→A4 and inspect captured events (PostHog debug/local capture per
  capability 16 conventions).
- **Expected**: The sequence contains `approval_link_minted(sheets_expose)`
  → `approval_link_approved(sheets_expose)` → `sheets_grant_verification`
  `{result: 'missing'}` → `sheets_grant_recovered` → `$mcp_tool_call`
  success — each stage attributable to the same person, so the production
  dashboard can measure recovery rate directly.
