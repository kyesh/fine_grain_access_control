/**
 * The scopes a Google access token ACTUALLY carries, from Google's tokeninfo
 * endpoint — as opposed to Clerk's `scopes` metadata, which is a record of
 * the last OAuth request that completed for the account.
 *
 * The two disagree in practice: a plain Google sign-in rewrites Clerk's record
 * with the sign-in request's scope set (no drive.file), and Clerk's record can
 * lag a consent round-trip by seconds. The dashboard (googleAccess.ts) and
 * the Picker token bridge already treat tokeninfo as the truth; the MCP
 * pre-flight consults it here before denying a call on Clerk metadata alone,
 * so the three readers cannot disagree in the direction that locks a user
 * out.
 *
 * Cached per token (in-memory, per function instance) so a scope-less
 * account that hammers a denied tool costs one Google round-trip, not one
 * per call. The cache holds only the scope list, never anything it could
 * leak — but the key is the token, so it must never be logged or exposed.
 */

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 3_000;

const cache = new Map<string, { scopes: string[]; at: number }>();

/**
 * Returns the token's scope list, or null when tokeninfo could not be
 * consulted (timeout, network, non-2xx) — callers fall back to whatever they
 * already knew; a tokeninfo outage must never widen or narrow access on its
 * own.
 */
export async function liveTokenScopes(
  token: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string[] | null> {
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.scopes;

  try {
    const res = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const info = await res.json();
    const scopes = typeof info?.scope === 'string' ? info.scope.split(' ').filter(Boolean) : [];
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(token, { scopes, at: Date.now() });
    return scopes;
  } catch {
    return null;
  }
}
