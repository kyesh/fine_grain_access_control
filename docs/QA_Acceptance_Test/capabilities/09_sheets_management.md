# Capability: Google Sheets Management (Expose, Discover, Access)

## Overview
Covers the full sheets lifecycle from both sides: the dashboard UX for exposing a
sheet to a profile (Google Picker flows, including the first-time drive.file consent
round-trip), and the agent-side API surface for discovering and reaching exposed
sheets. Written after two field reports: users being detoured to the Accounts page
instead of getting the picker, dropped back with no picker after first-time consent —
and an agent stranded with a sheets rule that carried no spreadsheet id while Drive
listing returned empty.

## Pre-requisites
* `/qa-setup` complete; dev server running; USER_A signed in on the dashboard.
* At least one proxy key (Agent Profile) exists with a known bearer token.
* UI assertions (A1-A4): built-in browser, signed-in session. API assertions
  (A5-A7): curl with the profile's `sk_proxy_` bearer against the proxy endpoints.

## Harness note — automating the Google Picker
The picker modal renders inside a cross-origin `docs.google.com` iframe. The built-in
browser can OPEN it and see it in screenshots (allow ~10s to paint), but its input
events do not route into the iframe — tiles cannot be clicked from this harness
(verified empirically). Two sanctioned ways to cover the post-pick assertions:
1. **App-API seam (default)**: A1/A2 prove the picker opens; for A3/A4, drive the same
   code path the picker callback invokes — `POST /api/rules/grant-sheets-access` (or the
   `exposeSheetsFromPicker` action) as the signed-in user with a known fixture
   spreadsheet id. This is the application's own API, allowed by Database Rule 7; only
   Google's own picker UI (not our code) goes unexercised.
2. **Playwright CDP path (full-fidelity) — CONFIRMED WORKING (2026-07-26)**: the
   Playwright CLI's snapshots expose the picker iframe's contents as frame refs
   (`f<N>e<M>`), tiles are clickable, and a full pick-to-rule flow was executed end to
   end (tile → Select → rule row with Read Only default). Requires the one-time manual
   Google sign-in of the `.playwright_user_data` Chrome profile at the MAIN clone. Use
   for release-level verification of the actual pick interaction, including the
   real first-time drive.file consent round-trip (also verified live).

## Assertions

### A1: "+ Expose a sheet" on a profile opens the Google Picker directly
- On `/dashboard`, select any profile tab and click **+ Expose a sheet** in the
  Google Sheets Rules card.
- **Expected**: The Google Picker modal (`.picker-dialog` with a
  `docs.google.com/picker` iframe) opens on this page. No popover pointing at the
  Accounts page, no navigation, no dead-end message. (If the drive.file grant is
  missing, a redirect to Google consent is acceptable — see A2 for the return leg.)

### A2: First-time consent round-trip returns to the same page and auto-opens the picker
- Deterministic proxy for the return leg (works without revoking any grant):
  navigate directly to `/dashboard?autoOpenPicker=true&pickerContext=<profileId>`.
- **Expected**: The URL is cleaned (params consumed) AND the Google Picker modal
  opens on `/dashboard` — not a silent landing. Same check on
  `/dashboard/accounts?autoOpenPicker=true` for the Accounts-page flow. The consent
  redirect URL must target the page the flow started on (`location.pathname`), never
  a hardcoded route.

### A3: A sheet picked from a profile is scoped to that profile without narrowing others
- With a sheet exposed from profile P's card, check the rules state (dashboard or
  `GET /api/rules/grant-sheets-access`).
- **Expected**: The new rule carries the spreadsheet's `targetResourceId` and
  `resourceName`, defaults to Read Only, and is assigned to P. Pre-existing global
  sheet rules remain global (picking the same sheet again must NOT restrict it), and
  other profiles' assignments are untouched.

### A4: Accounts-page "Add Google Sheet +" still works and creates a global rule
- On `/dashboard/accounts`, click **Add Google Sheet +**.
- **Expected**: Picker opens directly; a picked sheet appears in the table with its
  ID shown; the rule is global (applies to all profiles).

### A5: get_my_permissions carries the spreadsheet id for sheets rules
- As an agent (MCP `get_my_permissions` with the profile's connection, or the
  equivalent proxy call), inspect the returned rules.
- **Expected**: Every sheets rule includes `spreadsheetId` (the
  `targetResourceId`) and `resourceName` — an agent must be able to go from the rule
  straight to a Sheets API call without asking the user to paste a URL. A sheets
  rule with a null spreadsheet id reaching an agent is a failure.

### A6: get_my_permissions returns only rules applicable to the calling key
- Create a rule assigned ONLY to a different profile, then call
  `get_my_permissions` as this profile.
- **Expected**: The other profile's rule is absent. Global rules and this key's
  rules are present, each labeled with its scope (`global` / `this-key`). The
  owner's full rule set leaking to every agent is a failure.

### A8: Write succeeds with Read & Write permission — and only then
- Set the exposed sheet's FGAC permission to **Read & Write** (dashboard dropdown, or
  the app's own `grant-sheets-access` API as the signed-in user), then write a
  QA-tagged row via MCP (`sheets_append_rows` or `sheets_update_range`) AND via the
  raw API proxy (PUT/POST on the Sheets values endpoint).
- **Expected**: Both writes succeed against the real Google Sheet, and the written
  values read back correctly. Cleanup is part of the assertion: restore the
  permission to **Read Only** and confirm the same write is blocked again with the
  Read-Only error — proving the permission toggle is live in both directions.

### A9: sheets_edit applies batchUpdate under the same write matrix (2026-08-23 reshape)
- With the exposed sheet at **Read Only**: call `sheets_edit` with a harmless
  formatting request (e.g. `repeatCell` setting a background color on one QA cell).
- **Expected**: 🚫 denied with `denial_code=sheets_read_only` and a `sheets_write`
  approval link. After flipping to **Read & Write**: the same `sheets_edit` call
  succeeds against the real sheet (Google returns the batchUpdate reply), and an
  `addSheet` request creates a QA-tagged tab visible via `sheets_get_spreadsheet`.
  Cleanup: delete the QA tab (`deleteSheet` request) and restore **Read Only**.
  The success response of a values write (`sheets_update_range`) carries an
  `fgac_hint` naming `sheets_edit` (capability 10 A10 cross-check).

### A7: Drive listing is Google-native; per-file Drive access respects sheet rules
- `GET {proxy}/drive/v3/files` with the profile's bearer token, then
  `GET {proxy}/drive/v3/files/<id>` for (a) an exposed sheet, (b) a sheet with a
  `sheet_block` rule, and (c) an unexposed id.
- **Expected**: The LIST passes through to Google untouched — a well-formed
  `drive#fileList`, even if empty (empty is legitimate `drive.file`-scope behavior for
  picker-granted files; FGAC does not override native discovery — agents get sheet ids
  from `get_my_permissions`, per A5). Per-FILE access is guarded: (a) succeeds, (b) and
  (c) return 403 with the FGAC error text; a write-shaped request (POST/PATCH) on a
  Read-Only sheet also 403s. Drive get/export must never be a bypass around the Sheets
  rules.
