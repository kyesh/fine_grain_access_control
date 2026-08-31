# PR 1 — Bind the Google reconnect link to its account + honest scope reporting

Implements Issue 1 from `claude_fgac-support-issues-plan-a38485_v2.md` (v2
rescopes PR 1 over v1; root cause confirmed in PostHog 2026-08-30: a
`?reconnect=1` link minted for one FGAC user was opened in a browser signed in
as a different FGAC user — the page auto-fired reconnect for the wrong user
and reported "✓ Google reconnected" unconditionally).

## Changes

### 1. Bind the reconnect deep link to the intended account

- Every minted reconnect URL gains `&for=<url-encoded email>`. Mint sites:
  `src/app/api/mcp/route.ts` :631 (describe403 scope branch), :660 (hedged
  403), :673 (401), :1253 (google_token_unavailable), :1291
  (gmailScopeDenial), :1320 (driveFileScopeDenial), and
  `src/app/api/proxy/[...path]/route.ts:718` (proxy gmail-scope denial).
- **Param value: `targetEmail` (the mailbox owner), not `conn.user.email`.**
  The dispatch brief said conn.user.email; every mint site already has
  `targetEmail` in scope, the two are equal in the non-delegated case (and in
  the incident), and for a delegated mailbox the person who must run the
  reconnect is the *mailbox owner* — whose FGAC email IS `targetEmail`
  (delegations key on `users.email`). Using conn.user.email would name the
  delegate, who cannot repair the owner's grant. A shared
  `reconnectLink(targetEmail)` helper in route.ts keeps the sites consistent.
- `src/app/dashboard/accounts/page.tsx` reads `searchParams` (`for`,
  `reconnect`); compares `for` case-insensitively against the viewer's full
  email set (dbUser.email, Clerk verified addresses, connected Google account
  email — lenient on purpose so identity drift doesn't false-alarm). On
  mismatch:
  - renders a warning card (modeled on the Google-account mismatch card at
    :101-114) naming the intended account in full (the viewer already holds a
    link naming it) and the signed-in account, instructing sign-out /
    sign-in-as-intended. No maskEmail — Issue 5's PR hasn't landed here;
    copy kept consistent with its planned card.
  - passes `blockAutoReconnect` to `ReconnectGoogleButton`, whose auto-fire
    guard (:60-69) additionally bails — the wrong user never reaches Google's
    consent.

### 2. Honest post-reconnect verification

`ReconnectGoogleButton.tsx` on `?reconnected=1` no longer renders "✓ Google
reconnected." unconditionally. It fetches `/api/auth/google-picker-token`
(real tokeninfo call; returns effective `scopes`) and renders
verifying → verified / failed states. Clerk scope-propagation lag tolerated
with the same 4×1500 ms poll `useGooglePicker.ts:115-120` uses, polling while
either scope is still missing. Failure state names the missing scope(s) and
tells the user to click Reconnect and approve the checkbox.

### 3. Per-scope dashboard badges

`googleAccess.ts` `checkGoogleAccess` returns `{ gmail, driveFile }` parsed
from the tokeninfo scope string it already fetches (drive satisfied by
`drive.file` or full `drive`, gmail by `gmail.modify` or `mail.google.com`,
matching the MCP route's GMAIL_SCOPES/DRIVE_FILE_SCOPES). Callers
(`dashboard/page.tsx:25`, `accounts/page.tsx:28`) compute
`hasCompleteGoogleAccess = gmail && driveFile`; `accounts/page.tsx:90-97`
badges each scope independently (green badge per granted scope, error badge
per missing one).

### 4. Scope state in MCP `list_accounts`

`route.ts:1622-1658`: keep `accounts` as bare strings (existing agents), add
parallel `account_details`:
`[{ email, gmail: 'granted'|'missing'|'unknown', drive_file: same,
delegated, reconnect_url? }]` — `reconnect_url` (bound with `&for=`) present
when any scope is missing. Three-state per route.ts:1308's convention:
`hasXScope === undefined` → `'unknown'`, never coerced to missing; a failed
or timed-out token fetch → `'unknown'` too.

- Concurrency: `Promise.allSettled` over accounts, each wrapped in
  `withTimeout(…, 4000)` so the first tool most agents call never rides N×15 s
  (`CLERK_TOKEN_TIMEOUT_MS`).
- Analytics hygiene: `getGoogleToken` gains an options arg
  `{ quiet?: boolean }`; the list_accounts probe passes `quiet: true`, which
  suppresses the `google_token_identity_fallback` / `google_token_fetch_failed`
  standalone captures AND the tool-call props those paths stamp — the
  monitoring queries in docs/monitoring.md §7.4/§7.6 count those events
  unfiltered, so a per-account probe on every list_accounts call would corrupt
  them. Suppression chosen over a `via` discriminator because the documented
  queries don't filter by `via` (docs/monitoring.md updated with a note).
- `next_steps.sheets/docs` point at the bound reconnect link when the drive
  scope is missing on any account.
- `toolDefs.ts` list_accounts description updated to document
  `account_details` (≤1500 chars, mcp-tool-lint enforced).

### 5. Reconnect-leg scope hygiene (hardening)

- `ConnectGoogleWarning.tsx:17-32` drops its inline gmail-only reconnect copy
  and calls the shared `startGoogleReconnect` with
  `[GMAIL_MODIFY_SCOPE, DRIVE_FILE_SCOPE]`.
- `googleReconnect.ts:52-61` destroy+recreate branch: pass requested scopes
  via `additionalScopes` on `createExternalAccount` if the Clerk SDK supports
  it (verify against @clerk/nextjs types during implementation; if the param
  doesn't exist, note it in a comment and move on).

## QA

- `docs/QA_Acceptance_Test/capabilities/18_google_reconnect.md`: new
  assertions — A6 (wrong-account mismatch warning, no auto-fire), A7 (honest
  post-reconnect failure state), A8 (independent per-scope badges).
- `list_accounts` scope-state assertion added to
  `docs/QA_Acceptance_Test/capabilities/03_multi_email_scoping.md` (the
  capability that owns list_accounts surface behavior — confirm during
  implementation; 13_default_profile_instant_start also references it).
- All four agent runbooks under `docs/QA_Acceptance_Test/agents/` pick up the
  new `### A<n>:` headings (qa-coverage-check enforces).
- Validation: `npm run mcp:lint`, `npm run build`, then `/deploy-pr-preview`.

## Out of scope (per plan v2)

Clerk-dashboard scope check (disproven), connector re-attach via rotating DCR
client_id, PRs 2–5.
