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
