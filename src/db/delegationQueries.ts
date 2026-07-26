import { alias } from 'drizzle-orm/pg-core';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, emailDelegations } from '@/db/schema';

/**
 * Delegation lookups resolved by EMAIL rather than by user row id.
 *
 * `users` is keyed on `clerkUserId`, and Clerk can hand out a new user id for
 * the same person — session re-creation, re-signup, a dev instance reset. When
 * that happens `createDbUser` inserts a second row for the same email, and any
 * delegation created against the older row stops resolving: the dashboard looks
 * the delegate up by the *current* row's id and finds nothing, so the delegate
 * silently loses access with no error anywhere.
 *
 * `createDelegation` already worked around the duplicates on the write side
 * (it picks the most recent row for an email); these are the matching read-side
 * queries. Matching on email makes the lookup independent of which duplicate
 * row the delegation happened to be written against.
 *
 * The real fix is to stop creating duplicates — see the note in
 * docs/bug_reports. This keeps existing delegations working meanwhile.
 */

const ownerUsers = alias(users, 'owner_users');
const delegateUsers = alias(users, 'delegate_users');

export interface DelegationRow {
  id: string;
  status: string;
  createdAt: Date;
  counterpartEmail: string;
}

/** Delegations granted TO this email — mailboxes they can build profiles against. */
export async function getDelegationsToEmail(email: string): Promise<DelegationRow[]> {
  const rows = await db.select({
    id: emailDelegations.id,
    status: emailDelegations.status,
    createdAt: emailDelegations.createdAt,
    counterpartEmail: ownerUsers.email,
  })
    .from(emailDelegations)
    .innerJoin(ownerUsers, eq(ownerUsers.id, emailDelegations.ownerUserId))
    .innerJoin(delegateUsers, eq(delegateUsers.id, emailDelegations.delegateUserId))
    .where(eq(delegateUsers.email, email));

  return dedupeByCounterpart(rows);
}

/** Delegations granted BY this email — people who can act on their mailbox. */
export async function getDelegationsFromEmail(email: string): Promise<DelegationRow[]> {
  const rows = await db.select({
    id: emailDelegations.id,
    status: emailDelegations.status,
    createdAt: emailDelegations.createdAt,
    counterpartEmail: delegateUsers.email,
  })
    .from(emailDelegations)
    .innerJoin(ownerUsers, eq(ownerUsers.id, emailDelegations.ownerUserId))
    .innerJoin(delegateUsers, eq(delegateUsers.id, emailDelegations.delegateUserId))
    .where(eq(ownerUsers.email, email));

  return dedupeByCounterpart(rows);
}

/** Same as above, restricted to active grants. */
export async function getActiveDelegationsToEmail(email: string): Promise<DelegationRow[]> {
  const rows = await db.select({
    id: emailDelegations.id,
    status: emailDelegations.status,
    createdAt: emailDelegations.createdAt,
    counterpartEmail: ownerUsers.email,
  })
    .from(emailDelegations)
    .innerJoin(ownerUsers, eq(ownerUsers.id, emailDelegations.ownerUserId))
    .innerJoin(delegateUsers, eq(delegateUsers.id, emailDelegations.delegateUserId))
    .where(and(
      eq(delegateUsers.email, email),
      eq(emailDelegations.status, 'active'),
    ));

  return dedupeByCounterpart(rows);
}

/**
 * Duplicate user rows can produce several delegation rows for one counterpart
 * email. Show one per counterpart, preferring an active grant, then the newest.
 */
function dedupeByCounterpart(rows: DelegationRow[]): DelegationRow[] {
  const best = new Map<string, DelegationRow>();
  for (const row of rows) {
    const key = row.counterpartEmail.toLowerCase();
    const current = best.get(key);
    if (!current) { best.set(key, row); continue; }
    const rowWins =
      (row.status === 'active' && current.status !== 'active') ||
      (row.status === current.status && row.createdAt > current.createdAt);
    if (rowWins) best.set(key, row);
  }
  return [...best.values()];
}
