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
import { and, eq, isNull } from 'drizzle-orm';

export const DEFAULT_PROFILE_LABEL = 'Default Profile';

export async function ensureDefaultProfile(userId: string, email: string) {
  const existing = await db.select().from(proxyKeys)
    .where(and(
      eq(proxyKeys.userId, userId),
      eq(proxyKeys.isDefault, true),
      isNull(proxyKeys.revokedAt),
    ))
    .limit(1).then(r => r[0]);
  if (existing) return existing;

  const [key] = await db.insert(proxyKeys).values({
    userId,
    key: `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`,
    label: DEFAULT_PROFILE_LABEL,
    isDefault: true,
  }).returning();

  // Own mailbox only — delegated addresses require an explicit delegation
  // and are never part of instant-start.
  await db.insert(keyEmailAccess).values({
    proxyKeyId: key.id,
    delegationId: null,
    targetEmail: email,
  }).onConflictDoNothing();

  return key;
}
