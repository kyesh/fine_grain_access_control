# Duplicate `users` rows silently break delegation

**Found**: 2026-07-26, during QA of capability 04 (delegation) on branch
`feat/design-system-port`.
**Severity**: high — access is lost silently, with no error in the UI or logs.
**Status**: symptom mitigated (read path); root cause open.

## Symptom

USER_A (`kenyesh2@gmail.com`) granted delegation to USER_B (`kyesh@umich.edu`).
USER_A's Accounts page showed the grant as **Active**. USER_B signed in and their
Accounts page showed **no delegated mailbox at all**, and the new-profile dialog offered
only their own address. Nothing errored — the delegation simply did not exist as far as
the delegate's session was concerned.

## Root cause

`users` is keyed on `clerkUserId`. When Clerk issues a **new user id for the same email**
— session re-creation, re-signup, dev-instance reset — `createDbUser` inserts a *second*
row for that email rather than reconciling with the existing one.

Observed on the QA branch (two rows each, same address):

```
kyesh@umich.edu      id=7314626c…  clerk=user_3FKMT1…  created=2026-06-18
kyesh@umich.edu      id=ba6e07be…  clerk=user_3Axi2j…  created=2026-07-26
kenyesh2@gmail.com   id=28635765…  clerk=user_3EBk2C…  created=2026-06-18
kenyesh2@gmail.com   id=4af73924…  clerk=user_3EBmW0…  created=2026-07-26
```

`email_delegations.delegate_user_id` pointed at `7314626c…` (the June row, newest at the
time of the grant). After signing in, the delegate's session resolved to `ba6e07be…`, and
the dashboard queried `WHERE delegate_user_id = <current row id>` — no match.

The write path already knew about this. `createDelegation` carries the comment *"Order by
createdAt DESC to get the most recently created user record when duplicate email rows
exist (from Clerk session re-creations)"*. Only the write path was ever fixed.

## Mitigation applied

`src/db/delegationQueries.ts` resolves delegations by **email** instead of user row id,
joining `users` twice (owner + delegate aliases) and deduping per counterpart email
(preferring active, then newest). Used by `/dashboard` and `/dashboard/accounts`.

This makes lookups independent of which duplicate row a delegation was written against.

## Root cause still open

Duplicate rows are still created. Remaining exposure:

- `proxy_keys.user_id`, `access_rules.user_id`, and `key_email_access` are all still
  keyed to a specific `users.id`. After a Clerk id change the user effectively starts
  from an empty account — their existing profiles and rules belong to the orphaned row.
  **This is the bigger bug**; delegation was just where it surfaced first.
- The `email_delegations` unique index is on `(owner_user_id, delegate_user_id)`, so the
  same logical pair can be inserted repeatedly across duplicate rows.

## Follow-on: it also broke revocation (security)

Completing the QA round trip surfaced a second, worse consequence.

`createProxyKey` resolved the mailbox owner with an unordered `.limit(1)` on email. With
duplicates it picked the row *without* the delegation, found no delegation, and inserted
the `key_email_access` row with `delegation_id = NULL`.

A null `delegation_id` means "the key owner's own mailbox" everywhere downstream. So that
row:

- granted access to **someone else's** inbox,
- survived `revokeDelegation` (which deletes by `delegation_id`),
- and passed every delegation re-check, because null is treated as own-mailbox.

Combined with `revokeDelegation` only flipping a status flag and the proxy authorising
purely on `key_email_access`, **revoking a delegation did not revoke access at all** —
contradicting the revoke dialog's own promise.

Fixed in `b72fdef`: delegation resolved by email pair, refuse to grant with no active
delegation, delete granted rows on revoke, and re-check the delegation at request time in
both the proxy and MCP paths.

### Data cleanup still required

Rows already written with `delegation_id = NULL` for an address that is **not** the key
owner's own email are unbacked grants. They read as own-mailbox access and no runtime
check will catch them. A migration should find and delete them:

```sql
SELECT kea.* FROM key_email_access kea
JOIN proxy_keys pk ON pk.id = kea.proxy_key_id
JOIN users u ON u.id = pk.user_id
WHERE kea.delegation_id IS NULL
  AND lower(kea.target_email) <> lower(u.email);
```

## Suggested fix

1. Reconcile on sign-in: if no row matches `clerkUserId` but one matches the email, update
   that row's `clerkUserId` instead of inserting a new one.
2. Add a unique constraint on `users.email` to make the failure loud rather than silent.
3. Backfill: merge existing duplicates and repoint `proxy_keys`, `access_rules`,
   `key_email_access`, and `email_delegations` at the surviving row.

Step 1 is small and stops the bleeding; 2 and 3 need a migration and should be planned
together.
