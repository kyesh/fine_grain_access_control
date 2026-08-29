# Gmail scope pre-flight check + missing-scope observability (v3)

Branch: `claude/eager-blackburn-7556e7` · 2026-08-28

## Problem

`gmail_list` errors at 9.5% over the trailing 7d (34 errors / 358 calls, 15 users),
versus 2.0% for `gmail_read`. The errors concentrate as repeated upstream Google
403s on specific users (PostHog 14d: three users with 7/3/2 repeated 403s; one ran
32 calls with 4 successes). Those users are effectively locked out of Gmail while
the rest of their traffic partially works.

## Findings (2026-08-28)

1. **The 403-classification work already shipped and is live.** Commits `1f437f2`
   ("stop conflating Google failure causes on the Gmail path") and `20b2480`
   landed on main via PR #93 and auto-deployed to production 2026-08-27 22:51 EDT.
   `googleFetch` now stamps `error_reason`/`error_domain` on every failed call and
   `describe403` branches rate-limit vs `domainPolicy` vs scope reasons. The
   measured 7d window is almost entirely PRE-fix data.
2. **Root-cause hypothesis: grant connected without the Gmail scope.** FGAC
   requests exactly one Gmail scope — `gmail.modify`, passed as `additionalScopes`
   at Clerk sign-in (`src/app/layout.tsx`). Google's granular-consent screen lets
   a user leave the Gmail checkbox unchecked and still complete sign-in; Clerk
   stores a verified Google account whose token Google will 403 on every Gmail
   call. The dashboard detects this (`checkGoogleAccess` pings tokeninfo and
   demands `gmail.modify`), but the MCP path uses whatever token Clerk returns
   without ever looking at scopes.
3. **Why it concentrates on `gmail_list`:** it is the documented entry-point tool
   ("Reads work out of the box" — the server's own instructions). A scope-less
   user's agent dies on the first `gmail_list` and never produces the `gmail_read`
   volume that healthy users do, so the per-tool error-rate gap is a funnel
   artifact of a per-user lockout, not a per-tool bug.
4. Identity-drift fallback (`google_token_identity_fallback`) was a single-user,
   single-day event (2026-08-25, self-healed) — unrelated mechanism; it changes
   which Clerk user's token is used, not the token's scopes.

Verification gaps (blocked in this session, stated per CLAUDE.md):
- PostHog re-verification of the 9.5%/34 numbers and the post-deploy
  `error_reason` mix is blocked: `POSTHOG_PERSONAL_API_KEY` is unprovisioned
  (deliberately — creating it is a user action) and the claude.ai PostHog
  connector is absent from this headless session.
- A read-only production Clerk sweep (verification status + granted scopes per
  user) was written but blocked by the session's permission classifier. The
  sweep script pattern is preserved in the session scratchpad; the user can
  equivalently check the affected users in the Clerk dashboard.

## Change

All in `src/app/api/mcp/route.ts` (no schema changes):

1. `getGoogleToken` returns `{ token, hasGmailScope }` instead of a bare token.
   `hasGmailScope` comes from Clerk's reported granted scopes
   (`gmail.modify` or the broader `mail.google.com`); `undefined` when Clerk
   doesn't report scopes (never enforce on missing metadata).
2. When a token is returned but the Gmail scope is missing, stamp
   `google_scope_missing: true` on the tool-call event and fire a standalone
   countable `google_scope_missing` event (same two-signal pattern as
   `google_token_identity_fallback`), so PostHog can size and track the affected
   population.
3. Pre-flight denial on Gmail surfaces: `gmail_list`, `gmail_read`,
   `gmail_get_attachment`, `gmail_send`, `gmail_labels`, and gmail-family raw
   `google_api_get/modify` calls return a targeted ❌ message (reconnect + check
   the Gmail checkbox, STOP retrying) via `resolveFailure`-style `textResult`
   with new `failure_reason: 'gmail_scope_missing'`. This classifies as
   `outcome='failed'` (never reached Google) instead of today's upstream-403
   `outcome='error'`, which is both semantically right and stops these
   deterministic lockouts from inflating the published error rate.
4. Sheets/docs/drive tools are untouched: the scope check is Gmail-specific and
   only consulted on Gmail surfaces.

## Rejected / deferred

- Minting one-click links (policyDenialWithLink pattern) for reconnect: reconnect
  requires the *account owner* signed into the dashboard anyway; the
  `/dashboard/accounts` deep link the existing 401/403 texts use is the same
  destination. No new link infrastructure needed.
- Changing the requested scope set at sign-up: `gmail.modify` is already
  requested; Google's granular consent cannot be forced. The dashboard already
  warns (`ConnectGoogleWarning`) — the gap was the MCP path, fixed here.
- Extending `SCOPE_REASONS` with Google's generic `forbidden`: deliberately
  excluded by `20b2480`; unchanged.

## Validation

- `npm run lint` + `npm run build`.
- Local: exercise a Gmail tool with a mocked scopes list (manual code-path review
  — no unit-test harness exists for route.ts).
- Preview via `/deploy-pr-preview`; QA smoke of gmail_list/gmail_read on the QA
  accounts (both have the scope, so the pre-flight must be a no-op for them).
- Post-deploy: PostHog `google_scope_missing` event count identifies the affected
  users; their agent-facing text now names the exact fix.

## v2 revision (2026-08-28)

The `google_scope_missing` event and tool-call property moved from
`getGoogleToken` into `gmailScopeDenial`: firing at token-fetch time would have
recorded the event on sheets/docs calls by an affected user, where nothing is
denied. The event now means exactly "a Gmail call was pre-flight denied for
missing scope" — Gmail calls only.

## v3 revision (2026-08-28): PostHog verification landed mid-session

The PostHog connector became available after the code shipped; the blocked
checks were run:

- 7d rates confirmed: gmail_list 33/358 errors (9.2%, 14 users) vs gmail_read
  2.0%.
- The 14d 403 population splits cleanly in two: **4 users with zero Gmail
  successes ever** (repeated 403s from their sign-up day, non-Google FGAC
  tools fine, sheets failures are FGAC policy denials not Google errors, no
  google_token_fetch_failed events — and three are consumer @gmail.com
  accounts, ruling out Workspace domainPolicy) — the missing-scope signature
  this change targets; and 5 healthy users with transient/burst 403s that the
  PR #93 rate-limit branch now messages correctly.
- All 22 recorded gmail_list 403s predate the #93 production deploy
  (2026-08-27 22:51 EDT); zero since, so `error_reason` carries no data yet.
  The 4 locked-out users' next Gmail call will either hit this pre-flight
  (scope absent in Clerk) or stamp `error_reason` — both diagnosable.
- Identify the users via the monitoring §7.6 query (emails stay out of this
  public repo).

Still user-verifiable in the Clerk production dashboard: the 4 users'
external-account granted scopes (the read-only API sweep stayed blocked by
session permissions).
