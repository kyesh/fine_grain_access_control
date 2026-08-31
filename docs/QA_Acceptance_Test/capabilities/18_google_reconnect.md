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
  the user returns to `/dashboard/accounts?reconnected=1`, sees a brief
  "Confirming Google permissions…" state, then "✓ Google reconnected —
  gmail.modify and drive.file confirmed." (success is verified against the
  token bridge, never assumed), and the scope badges show `gmail.modify` +
  `drive.file`. A `google_reconnect_started` event fires with
  `source: accounts_page`

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

### A6: A reconnect link for a different account warns instead of auto-firing
- As USER_A (signed in to FGAC), open
  `/dashboard/accounts?reconnect=1&for=<USER_B_EMAIL>` — a reconnect link
  minted for USER_B's account
- **Expected**: The reconnect flow does NOT auto-fire (no navigation to
  Google's consent), and a warning card renders naming both accounts: the
  link is for USER_B, the session is USER_A, reconnecting here would repair
  the wrong account — sign out and sign back in as USER_B. The manual
  "Reconnect Google" button remains available. With `for=<USER_A_EMAIL>` (or
  any address on USER_A's Clerk account) the auto-fire behaves exactly as
  before — no warning

### A7: Post-reconnect success is verified, not assumed
- Land on `/dashboard/accounts?reconnected=1` while the Google grant is still
  missing a scope (e.g. deny the drive.file checkbox on the consent screen
  before returning, or craft the URL directly with a scope-less grant)
- **Expected**: NO unconditional "✓ Google reconnected." — the button polls
  the token bridge (tolerating Clerk scope-propagation lag, ~4×1.5 s) and
  then renders a failure state naming the still-missing scope(s) with advice
  to reconnect and approve every checkbox. A `google_reconnect_incomplete`
  event fires with `missing_scopes`

### A8: Scope badges are independent per scope
- With an account holding gmail.modify but NOT drive.file (or vice versa),
  open `/dashboard/accounts`
- **Expected**: The granted scope shows its normal badge and the missing one
  shows its own "missing" error badge — never one combined state rendering
  both green from a single boolean. The Connected Google Account card's
  reconnect guidance still appears when either scope is missing
