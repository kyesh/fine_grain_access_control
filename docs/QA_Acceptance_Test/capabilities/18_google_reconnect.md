# Capability: Google Reconnect (Grant Repair)

> A user's Google grant can break — expired verification (e.g. an abandoned
> consent attempt), revoked scopes, or a grant that never included
> `drive.file`. Every error that says "reconnect Google from the Accounts
> page" must point at a control that actually exists and works, and the repair
> must not depend on the thing it repairs (2026-08-19 incident: the picker
> died at token fetch BEFORE reaching the reconnect leg — the user's only
> symptom was a button that did nothing). Shared leg: `googleReconnect.ts`
> (reauthorize when verified; destroy-and-recreate otherwise — Clerk's
> designed recovery, safe only when completed in one pass).

## Assertions

### A1: The Accounts page has a working "Reconnect Google" button
- As a signed-in user, open `/dashboard/accounts` and click "Reconnect Google"
  on the Connected Google Account card
- **Expected**: The browser navigates to Google's OAuth consent (account
  chooser or consent screen) — never a silent no-op. After completing consent,
  the user returns to `/dashboard/accounts?reconnected=1` with a "✓ Google
  reconnected." note, and the scope badges show `gmail.modify` + `drive.file`
  (not "Scopes missing or revoked"). A `google_reconnect_started` event fires
  with `source: accounts_page`

### A2: A broken grant routes the picker into reconnect instead of dying
- With a broken/expired Google grant (token bridge `/api/auth/
  google-picker-token` returns an error), open a sheets approval link and
  click "Step 1 — Pick the sheet in Google Picker"
- **Expected**: The click navigates to Google's consent flow (the reconnect
  leg) — NOT a dead button, NOT an unexplained failure. The signed approval
  token survives the round-trip in the return URL (`autoOpenPicker=true`
  plus the original `token` param)

### A3: Every picker/reconnect failure is visible and actionable
- Force any failure in the flow (e.g. Clerk returns no verification URL, or
  the Google Picker script is blocked)
- **Expected**: An inline error renders next to the triggering button —
  "Google flow failed: …" with concrete advice and a link to the Accounts
  page — and a `picker_flow_error` analytics event fires carrying `stage`
  (one of: token_after_oauth, oauth_return_scope_missing, google_reauthorize,
  gapi_not_loaded, open_picker, trigger, accounts_reconnect) and `message`.
  No failure path may end at console.error or a bare alert() alone

### A4: Reconnect repairs agent access end-to-end
- After completing A1 or A2's consent as the QA user, retry (a) the token
  bridge, (b) a Gmail MCP tool call, (c) the sheets picker
- **Expected**: The token bridge returns `hasDriveFileScope: true`; the
  Clerk external account's verification status is `verified`; `gmail_list`
  succeeds again (no "Could not fetch Google token"); the picker opens
  directly with no further OAuth detour

### A5: The OAuth return leg never loops
- Return from consent with the scope still missing (deny the drive.file
  checkbox on Google's consent screen, or close the consent tab early and
  reload the return URL)
- **Expected**: The page shows the "Google did not grant Sheets access on
  that pass" (or token failure) advice with a retry path — it must NOT
  redirect back to Google automatically (no consent loop), and nothing is
  granted
