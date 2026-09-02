# MCP identity-drift self-heal — v1

## Problem

The 2026-08-31 analytics review found exactly one production user firing
`google_token_identity_fallback` persistently (28 calls 08-25, 23 on 08-30,
5 on 08-31 — all rescued successfully). Investigation (read-only prod DB +
Clerk + PostHog) established:

- The user's Clerk account holds exactly **one** email address — verified and
  primary — plus a matching Google external account. There is no leftover
  secondary address; the account-cleanup pass did not miss them.
- `isOwnClerkEmail` (src/app/api/mcp/route.ts) matches **any** verified Clerk
  address, including the primary, plus the Google external-account address. A
  drifted `users.email` with a clean single-address Clerk profile therefore
  still satisfies it — no secondary email required.
- `users.email` holds a **stale** address that is no longer on the Clerk
  account at all; the default profile's own-mailbox `key_email_access` row
  targets the (correct) Clerk-primary address. The split formed in the window
  where `resolveDbUser` synced `users.email` on primary change (since 5cde31d,
  2026-07-26) but did **not yet** re-point access rows (added in 4b55101,
  2026-08-24).
- The heal path gap: on the MCP request path, `resolveDbUser` runs only inside
  the `if (!user)` auto-create branch of `resolveConnection`. An **existing**
  user is loaded by `clerkUserId` and never re-synced. The only heal for
  existing users is the dashboard (`loadDashboardData`), which an MCP-only
  connector user never touches. Hence: permanent drift, fallback fires on
  every call, forever.

## Fix

Heal exactly where drift is detected — the fallback branch of
`getGoogleToken`. When `isOwnClerkEmail` confirms the target address belongs
to the key owner's Clerk account, we already hold the fresh Clerk user; if its
primary email differs from `keyOwner.email` (the DB row), run
`resolveDbUser(clerkUserId, primaryEmail)` — the same heal the dashboard uses
(email sync + own-mailbox access-row re-point). The next call takes the happy
path.

Why not heal in `resolveConnection` for existing users: that would add a Clerk
`getUser` round-trip to **every** MCP request. The fallback branch runs only
when drift actually manifests, already fetches the Clerk user, and is the
precise population that needs healing.

### Changes

1. `src/lib/identityDrift.ts` (new) — pure `ownClerkEmailMatch(user, email)`
   extracted from the route so it is unit-testable.
2. `src/app/api/mcp/route.ts` — `isOwnClerkEmail` becomes
   `checkOwnClerkEmail`, returning `{ own, primaryEmail }` from one Clerk
   fetch; the fallback branch heals via `resolveDbUser` when
   `primaryEmail !== keyOwner.email` (case-insensitive). Heal failures log and
   fall through — the fallback keeps serving the call either way. The heal
   runs on `quiet` scope probes too (quiet suppresses analytics only).
3. `scripts/test-identity-drift.ts` (new, wired into `mcp:lint`) — unit tests
   for `ownClerkEmailMatch` (primary-verified match — the production case;
   unverified rejected; Google external match; provider filter; case
   insensitivity) plus a structural guard that `getGoogleToken`'s fallback
   branch still invokes `resolveDbUser`.
4. `docs/monitoring.md` §7.4 — record the root cause; redefine healthy: each
   drifted user now fires the fallback at most once per surviving drift (heal
   on first fire), so sustained repeats from one person should no longer
   occur; growth in `uniq(person)` = new drift being created.
5. `docs/bug_reports/identity_email_drift_breaks_token_lookup.md` — follow-up
   section: the 2026-08-25 "population self-healed" conclusion missed
   MCP-only users, one of whom stayed drifted six days; fallback now heals.

### Non-goals

- No Clerk account edits. The affected account needs **no** cleanup — its
  Clerk state is already minimal and correct; the DB heals itself on the next
  MCP call after deploy.
- No change for a genuinely multi-address account calling a verified
  non-primary address: primary equals `users.email` there, so no heal runs and
  the fallback keeps serving it — that is supported behavior, not drift.
