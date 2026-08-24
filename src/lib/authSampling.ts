/**
 * Sampling gate for `mcp_auth_attempt` success telemetry.
 *
 * Success events are sampled 1-in-N to keep event volume inside the PostHog
 * free tier (~220k MCP requests/mo); failures always capture. The decision is
 * deterministic on the token, so a retry of the *same* request is consistently
 * in or out and never double-counts.
 *
 * Note this samples per TOKEN, not per session: Clerk access tokens are
 * short-lived and refreshed constantly, so one user's requests spread across
 * many tokens and land in the sample at roughly the nominal rate.
 *
 * History — why this hashes the signature: the original implementation hashed
 * the first 64 characters of the bearer token. For a Clerk JWT the header
 * segment alone is ~143 chars, so those 64 characters are entirely inside the
 * per-instance-constant header ({"alg","cat","kid","typ"}). Every token minted
 * by one Clerk instance produced the *same* hash, turning the sample into an
 * all-or-nothing gate — which on production resolved to "never". Between
 * 2026-08-23 and this fix, zero `outcome='ok'` rows were recorded against
 * ~900 successful tool calls. The signature segment is the part that actually
 * varies per token.
 */

export const AUTH_SUCCESS_SAMPLE = 20;

/**
 * The highest-entropy slice of a bearer token: an RS256 JWT signature (~342
 * base64url chars, unique per token). Opaque, non-JWT tokens have no `.`, so
 * `lastIndexOf` yields -1 and the whole token is used — which is correct for
 * them. A suspiciously short trailing segment also falls back to the whole
 * token rather than sampling on a handful of characters.
 */
function entropySlice(token: string): string {
  const sig = token.slice(token.lastIndexOf('.') + 1);
  return sig.length >= 16 ? sig : token;
}

/**
 * Whether this token's success event should be captured.
 *
 * FNV-1a followed by the murmur3 finalizer: FNV alone leaves the low bits
 * dominated by the last few characters, and `% rate` reads exactly those bits.
 * The avalanche step is what makes the modulus uniform over a base64url
 * alphabet. Unsigned (`>>> 0`) rather than `Math.abs`, which folds two
 * residues onto one and skews the buckets.
 */
export function inSuccessSample(token?: string, rate: number = AUTH_SUCCESS_SAMPLE): boolean {
  if (!token) return true;
  if (rate <= 1) return true;

  const basis = entropySlice(token);
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return (h >>> 0) % rate === 0;
}
