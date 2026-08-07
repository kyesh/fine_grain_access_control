/**
 * Default profile (connector-growth Phase B — instant-start).
 *
 * Every user gets one auto-created "Default Profile": a proxy key flagged
 * is_default with access to the user's OWN mailbox only. New MCP connections
 * auto-attach to it (status approved) so a first tool call succeeds with no
 * dashboard visit. The posture is read-only by construction:
 *   - no send_whitelist rule exists → sending is denied by default
 *   - no sheets rules exist → every spreadsheet is denied by default
 *   - the sensitive-mail shield is OFF by default (decision log 2026-08-06,
 *     connector-growth_v1.md) — the dashboard offers one-click enable
 * Delegated mailboxes are never auto-granted here.
 */
import { db } from '@/db';
import { proxyKeys, keyEmailAccess } from '@/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';

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

/** Own mailbox only — delegated addresses require an explicit delegation
 * and are never part of instant-start. */
async function ensureOwnEmailAccess(proxyKeyId: string, email: string) {
  await db.insert(keyEmailAccess).values({
    proxyKeyId,
    delegationId: null,
    targetEmail: email,
  }).onConflictDoNothing();
}

export async function ensureDefaultProfile(userId: string, email: string) {
  const existing = await findLiveDefault(userId);
  if (existing) return existing;

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
    await ensureOwnEmailAccess(adopted.id, email);
    return adopted;
  }

  try {
    const [key] = await db.insert(proxyKeys).values({
      userId,
      key: `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`,
      label: DEFAULT_PROFILE_LABEL,
      isDefault: true,
    }).returning();
    await ensureOwnEmailAccess(key.id, email);
    return key;
  } catch (err) {
    // Two concurrent first requests can race the create; the loser adopts
    // whatever the winner made.
    const winner = await findLiveDefault(userId);
    if (winner) return winner;
    throw err;
  }
}
