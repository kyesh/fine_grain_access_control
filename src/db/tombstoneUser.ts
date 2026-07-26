import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { users, proxyKeys, emailDelegations, keyEmailAccess } from '@/db/schema';

export interface TombstoneResult {
  userId: string;
  email: string;
  keysRevoked: number;
  delegationsRevokedOut: number;
  delegationsRevokedIn: number;
  accessRowsDeleted: number;
}

/**
 * Retire an FGAC user whose Clerk account no longer exists.
 *
 * Policy: tombstone, do not delete. The row is kept for audit but made inert —
 * proxy keys revoked, delegations revoked in both directions, and the
 * key_email_access rows those delegations granted removed. A later sign-up with
 * the same address starts a clean account (see resolveDbUser) rather than
 * inheriting any of this.
 *
 * Both directions matter:
 *   - delegations this user GRANTED — their mailbox must stop being reachable
 *     by delegates, since nobody owns it any more.
 *   - delegations GRANTED TO this user — they can no longer act on anyone.
 *
 * Idempotent: re-running on an already-tombstoned user is a no-op.
 */
export async function tombstoneUser(userId: string): Promise<TombstoneResult | null> {
  const user = await db.select().from(users)
    .where(eq(users.id, userId))
    .limit(1).then(res => res[0]);

  if (!user) return null;
  if (user.deletedAt) {
    return {
      userId, email: user.email,
      keysRevoked: 0, delegationsRevokedOut: 0, delegationsRevokedIn: 0, accessRowsDeleted: 0,
    };
  }

  const now = new Date();

  const revokedKeys = await db.update(proxyKeys)
    .set({ revokedAt: now })
    .where(and(eq(proxyKeys.userId, userId), isNull(proxyKeys.revokedAt)))
    .returning({ id: proxyKeys.id });

  const revokedOut = await db.update(emailDelegations)
    .set({ status: 'revoked', revokedAt: now })
    .where(and(eq(emailDelegations.ownerUserId, userId), eq(emailDelegations.status, 'active')))
    .returning({ id: emailDelegations.id });

  const revokedIn = await db.update(emailDelegations)
    .set({ status: 'revoked', revokedAt: now })
    .where(and(eq(emailDelegations.delegateUserId, userId), eq(emailDelegations.status, 'active')))
    .returning({ id: emailDelegations.id });

  // Remove the access those delegations granted, so no stale row survives.
  let accessRowsDeleted = 0;
  for (const d of [...revokedOut, ...revokedIn]) {
    const deleted = await db.delete(keyEmailAccess)
      .where(eq(keyEmailAccess.delegationId, d.id))
      .returning({ id: keyEmailAccess.id });
    accessRowsDeleted += deleted.length;
  }

  await db.update(users)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(users.id, userId));

  return {
    userId,
    email: user.email,
    keysRevoked: revokedKeys.length,
    delegationsRevokedOut: revokedOut.length,
    delegationsRevokedIn: revokedIn.length,
    accessRowsDeleted,
  };
}
