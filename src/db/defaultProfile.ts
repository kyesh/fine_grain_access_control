/**
 * Default profile (connector-growth Phase B — instant-start).
 *
 * Every user gets one auto-created "Default Profile": a proxy key flagged
 * is_default with access to the user's OWN mailbox plus every mailbox with an
 * ACTIVE delegation to them. New MCP connections auto-attach to it (status
 * approved) so a first tool call succeeds with no dashboard visit. The posture
 * is read-only by construction:
 *   - no send_whitelist rule exists → sending is denied by default
 *   - no sheets/docs rules exist → every spreadsheet and document is denied
 *     by default
 *   - the sensitive-mail shield is OFF by default (decision log 2026-08-06,
 *     connector-growth_v1.md) — the dashboard offers one-click enable
 *
 * Delegated mailboxes ride along because delegation is the inbox owner's own
 * explicit act (decision reversal, default-profile-delegated-access plan) —
 * custom profiles still require per-mailbox opt-in at creation. Grants are
 * materialized as key_email_access rows carrying the delegationId, so
 * revokeDelegation's row teardown and filterLiveDelegatedAccess both apply
 * unchanged. Writers keeping the invariant: this file (at ensure time),
 * createDelegation (via syncDefaultProfileDelegatedAccess), and migrations
 * 0008/0009 (per-deploy backfill/self-heal; 0009 also flags legacy
 * 'Default Profile' keys so users with only pre-existing connections are
 * covered without waiting for a new-connection adoption).
 */
import { db } from '@/db';
import { users, proxyKeys, keyEmailAccess } from '@/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getActiveDelegationsToEmail } from '@/db/delegationQueries';

export const DEFAULT_PROFILE_LABEL = 'Default Profile';

async function findLiveDefault(userId: string) {
  return db.select().from(proxyKeys)
    .where(and(
      eq(proxyKeys.userId, userId),
      eq(proxyKeys.isDefault, true),
      isNull(proxyKeys.revokedAt),
    ))
    .orderBy(asc(proxyKeys.createdAt))
    .limit(1).then(r => r[0]);
}

async function ensureOwnEmailAccess(proxyKeyId: string, email: string) {
  await db.insert(keyEmailAccess).values({
    proxyKeyId,
    delegationId: null,
    targetEmail: email,
  }).onConflictDoNothing();
}

/** Materialize every ACTIVE delegation to `email` onto the key. Rows carry the
 * delegationId, so revocation teardown and liveness filtering work exactly as
 * they do for hand-built profiles. */
async function ensureDelegatedEmailAccess(proxyKeyId: string, email: string) {
  const delegations = await getActiveDelegationsToEmail(email);
  for (const d of delegations) {
    await db.insert(keyEmailAccess).values({
      proxyKeyId,
      delegationId: d.id,
      targetEmail: d.counterpartEmail,
    }).onConflictDoNothing();
  }
}

async function ensureEmailAccess(proxyKeyId: string, email: string) {
  await ensureOwnEmailAccess(proxyKeyId, email);
  await ensureDelegatedEmailAccess(proxyKeyId, email);
}

/**
 * Re-materialize delegated access onto the delegate's Default Profile(s).
 * Called when a delegation is created or re-activated, so the grant reaches
 * the delegate's default key without them touching the dashboard.
 *
 * Looks the delegate up by EMAIL across all non-tombstoned user rows (the
 * duplicate-row workaround — see delegationQueries.ts): the live default key
 * may hang off a different row than the delegation does. A delegate whose
 * default key is not flagged yet (pre-instant-start signup, never connected)
 * is fine to skip — ensureDefaultProfile adopts and syncs it at their next
 * new connection, and migration 0008 re-syncs on every deploy.
 */
export async function syncDefaultProfileDelegatedAccess(delegateEmail: string) {
  const userRows = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, delegateEmail), isNull(users.deletedAt)));
  for (const row of userRows) {
    const key = await findLiveDefault(row.id);
    if (!key) continue;
    await ensureDelegatedEmailAccess(key.id, delegateEmail);
  }
}

export async function ensureDefaultProfile(userId: string, email: string) {
  const existing = await findLiveDefault(userId);
  if (existing) {
    // Cheap self-heal, once per new connection: delegations created while no
    // sync writer was in place (or that raced one) get materialized here.
    await ensureDelegatedEmailAccess(existing.id, email);
    return existing;
  }

  // Adopt a pre-existing profile the user already named "Default Profile"
  // (the pre-instant-start signup flow created these). Creating a second,
  // identically-named profile would silently split the user's configuration
  // — QA capability 06 A3 caught exactly that.
  const legacy = await db.select().from(proxyKeys)
    .where(and(
      eq(proxyKeys.userId, userId),
      eq(proxyKeys.label, DEFAULT_PROFILE_LABEL),
      isNull(proxyKeys.revokedAt),
    ))
    .orderBy(asc(proxyKeys.createdAt))
    .limit(1).then(r => r[0]);
  if (legacy) {
    const [adopted] = await db.update(proxyKeys)
      .set({ isDefault: true })
      .where(eq(proxyKeys.id, legacy.id))
      .returning();
    await ensureEmailAccess(adopted.id, email);
    return adopted;
  }

  try {
    const [key] = await db.insert(proxyKeys).values({
      userId,
      key: `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`,
      label: DEFAULT_PROFILE_LABEL,
      isDefault: true,
    }).returning();
    await ensureEmailAccess(key.id, email);
    return key;
  } catch (err) {
    // Two concurrent first requests can race the create; the loser adopts
    // whatever the winner made.
    const winner = await findLiveDefault(userId);
    if (winner) return winner;
    throw err;
  }
}
