import { db } from '@/db';
import { proxyKeys } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { slugifyProfileLabel } from './profileSlugs';

/**
 * Deep link to the Connected Agents card for a user, now that agent profiles
 * live at /dashboard/agents/[slug]. Replaces the dead
 * `?tab=connections&highlight=` links (nothing ever read those params).
 *
 * The card renders on every profile tab (pending connections are not
 * profile-scoped), so the default (else first) active profile is the right
 * landing spot. Falls back to /dashboard — whose redirect preserves the
 * fragment in the browser — when no profile resolves a slug.
 */
export async function connectionsDeepLink(baseUrl: string, userId: string): Promise<string> {
  try {
    const keys = await db.select({ label: proxyKeys.label, isDefault: proxyKeys.isDefault })
      .from(proxyKeys)
      .where(and(eq(proxyKeys.userId, userId), isNull(proxyKeys.revokedAt)));
    const ordered = [...keys.filter(k => k.isDefault), ...keys.filter(k => !k.isDefault)];
    for (const k of ordered) {
      const slug = slugifyProfileLabel(k.label);
      if (slug) return `${baseUrl}/dashboard/agents/${slug}#connected-agents`;
    }
  } catch {
    // A failed lookup must never fail the caller's response — the fallback
    // link still lands on the right card.
  }
  return `${baseUrl}/dashboard#connected-agents`;
}
