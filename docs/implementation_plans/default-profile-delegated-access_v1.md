# Default Profile: auto-grant delegated mailboxes

**Branch:** `claude/default-profile-delegated-access`
**Date:** 2026-08-16
**Status:** v1 — initial plan

## Goal

Polish the multi-email workflow: a user's **Default Profile** should have access to
**all mailboxes actively delegated to them**, automatically — in addition to their own
mailbox. Today the Default Profile reaches exactly one account (the user's own email),
and delegated mailboxes only become reachable by creating a brand-new custom profile
with the right checkboxes. That extra step defeats the point of instant-start: the
owner already performed an explicit, deliberate act (delegating), yet the delegate's
default agent connections still can't see the mailbox.

This reverses the decision recorded in `connector-growth_v1.md` ("Delegated inboxes —
never auto-attached"). Rationale for the reversal: delegation **is** the inbox owner's
explicit action; requiring a second, delegate-side ceremony adds friction without
adding consent. Custom (non-default) profiles remain strictly opt-in per mailbox.

## Current behavior (verified in code)

- `key_email_access` is the sole account-access source of truth; deny-by-default
  (`src/db/schema.ts:66-76`). Every enforcement point reads it:
  `resolveAccountAndToken` (`src/app/api/mcp/route.ts:585`), the REST proxy check
  (`src/app/api/proxy/[...path]/route.ts:289`), `cli-token`/`partner-token`, dashboard.
- `ensureDefaultProfile` (`src/db/defaultProfile.ts`) creates/adopts the default key and
  inserts **one** row: the user's own email. Called from `resolveConnection`
  (`src/app/api/mcp/route.ts:110`) only when a new connection is auto-created.
- `createDbUser` (`src/db/userHelpers.ts:81`) creates a signup-time key labeled
  `Default Profile` but **without** `isDefault: true`; `ensureDefaultProfile`'s
  legacy-adoption branch flips the flag later.
- `createDelegation` (`src/app/dashboard/actions.ts:30`) writes only the
  `email_delegations` row; no profile is touched.
- `revokeDelegation` already deletes all `key_email_access` rows carrying the
  delegation id, and every read path re-checks liveness via
  `filterLiveDelegatedAccess` (`src/db/delegationQueries.ts:17`).

## Design: materialize, don't special-case reads

Keep `key_email_access` as the single enforcement source (5+ read paths stay
untouched) and add the missing **writers** so the invariant "default profile ⊇ own
email + active delegations" holds:

1. **`src/db/defaultProfile.ts`**
   - New `ensureDelegatedEmailAccess(proxyKeyId, email)`: for each active delegation
     to `email` (`getActiveDelegationsToEmail`), insert
     `{proxyKeyId, delegationId, targetEmail: ownerEmail}` with `onConflictDoNothing`.
   - Call it in **all three** branches of `ensureDefaultProfile` (existing
     early-return, legacy adoption, fresh create). The early-return call is a cheap
     self-heal that runs once per new connection.
   - New exported `syncDefaultProfileDelegatedAccess(delegateEmail)`: for every
     non-tombstoned `users` row with that email (duplicate-row workaround, same
     rationale as `delegationQueries.ts`), find the live default key and run
     `ensureDelegatedEmailAccess`. No-op when the user has no flagged default key yet
     (adoption at first connection covers that case).
   - Update the file-header comment (currently says "delegated mailboxes are never
     auto-granted here").

2. **`createDelegation` (`src/app/dashboard/actions.ts`)** — after creating or
   re-activating the delegation (and on the already-active early return, as
   self-heal), call `syncDefaultProfileDelegatedAccess(delegateUser.email)`.

3. **`createDbUser` (`src/db/userHelpers.ts`)** — set `isDefault: true` on the
   signup-created Default Profile so the flag is authoritative from signup. Closes the
   gap where a delegation lands between signup and first MCP connection: the sync in
   (2) matches on the flag.

4. **Migration `src/db/migrations/0008_default_profile_delegated_access.sql`** —
   hand-written, idempotent data backfill (migrations re-run on every build):

   ```sql
   INSERT INTO key_email_access (proxy_key_id, delegation_id, target_email)
   SELECT pk.id, d.id, owner_u.email
   FROM email_delegations d
   JOIN users owner_u    ON owner_u.id = d.owner_user_id AND owner_u.deleted_at IS NULL
   JOIN users delegate_u ON delegate_u.id = d.delegate_user_id
   JOIN users delegate_all ON lower(delegate_all.email) = lower(delegate_u.email)
                          AND delegate_all.deleted_at IS NULL
   JOIN proxy_keys pk    ON pk.user_id = delegate_all.id
                        AND pk.is_default = true AND pk.revoked_at IS NULL
   WHERE d.status = 'active'
   ON CONFLICT (proxy_key_id, target_email) DO NOTHING;
   ```

   Because `build` re-runs all migrations, this also acts as a per-deploy self-heal
   for any drift. It intentionally targets only `is_default = true` keys; unflagged
   legacy `Default Profile` keys get adopted + synced at their next new connection.

### Revocation / teardown — already correct, no changes

- `revokeDelegation` deletes rows by `delegationId` → default profiles lose the
  mailbox instantly.
- `filterLiveDelegatedAccess` guards reads even if a row lingers.
- `tombstoneUser` already deletes delegation-backed rows.
- `rollProxyKey` copies rows including `delegationId` → rolled defaults keep grants.

### What does NOT change

- Custom profiles: still explicit checkbox opt-in at creation (`createProxyKey`).
- Partner consent provisioning: still single selected mailbox.
- Default-profile posture: still no send whitelist, no Sheets rules, shield off —
  the delegated mailbox is readable-only-by-construction like the own mailbox.

## Docs / QA updates

- `docs/user_guide.md` delegation section: delegate no longer needs to create a
  custom key just to reach a delegated mailbox from default-profile connections.
- `docs/QA_Acceptance_Test/capabilities/04_delegation.md`: new assertion — after
  delegation, the delegate's Default Profile lists/reaches the owner's mailbox;
  revocation removes it.
- `docs/QA_Acceptance_Test/capabilities/13_default_profile_instant_start.md`:
  A1 ("only own email") holds only for users with no active delegations; amend
  wording + add delegated-mailbox assertion.
- `docs/implementation_plans/connector-growth_v1.md` stays as historical record;
  this plan documents the reversal.

## Security note (flagged, accepted by product direction)

Instant-start default connections currently get read access with the shield off. After
this change that read access extends to delegated mailboxes without further
delegate-side action. Justification: the grant is the owner's explicit act, and the
owner's alternative (the delegate hand-building a power profile) yields the same
access. The shield/one-click-harden path applies to delegated reads exactly as to own
reads.

## Validation

1. `npm run lint` + `tsc --noEmit` (via `next build` or `npx tsc`).
2. `npm run db:migrate` against the isolated Neon branch (verifies 0008 discovery,
   idempotency on re-run).
3. Local dev-server spot check of the delegation flow if QA sessions permit; then
   `/deploy-pr-preview` with targeted QA on delegation + default-profile capabilities.
