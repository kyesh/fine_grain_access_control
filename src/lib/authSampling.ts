/**
 * Sampling gate for `mcp_auth_attempt` success telemetry.
 *
 * Success events are sampled 1-in-N to keep event volume inside the PostHog
 * free tier (~220k MCP requests/mo); failures always capture.
 *
 * The draw is made per REQUEST and is independent of the bearer token, the
 * user, and the client. That independence is the whole point: it is what makes
 * `count(outcome='ok') * AUTH_SUCCESS_SAMPLE` an unbiased estimate of true
 * success volume. Any gate that is a pure function of the token is NOT a
 * 1-in-N sample of requests — see the history below before changing this.
 *
 * History — two implementations shipped, both biased in the same direction:
 *
 * 1. 2026-08-23 (launch): hashed the first 64 chars of the bearer token. For a
 *    Clerk JWT the header segment alone is ~143 chars, so those 64 chars sit
 *    entirely inside the per-instance-constant header. Every production token
 *    hashed identically, and the modulus resolved to "never": zero `ok` rows
 *    against ~900 successful tool calls.
 *
 * 2. 2026-08-24 (PR #81, f9406e2): hashed the token's *signature* segment
 *    instead. This fixed the constant-hash defect but kept the gate a pure
 *    function of the token, so the decision was still made ONCE PER TOKEN
 *    rather than once per request. Consequences observed in production:
 *      - A given token was always sampled or never sampled, for its whole
 *        life. A heavy client whose token hashed non-zero contributed zero
 *        `ok` events no matter how many thousands of calls it made.
 *      - With ~50 active users the token population is small, so the result
 *        was a biased sample over a handful of tokens, not a 1-in-20 sample of
 *        requests. `ok` counts were unusable for volume estimation and the
 *        documented "multiply by 20" was wrong.
 *      - The tell was clumping: 13 consecutive hours with zero `ok` on
 *        2026-08-24 (06:00-18:00Z) across a day of continuous traffic, then 40
 *        in a single hour, while unsampled `no_token` fired every hour
 *        throughout.
 *
 * Retries: a retried request now draws again, so a retry can be counted twice
 * (or zero times). That is correct for a volume estimator — each attempt IS a
 * separate auth attempt — and it is the price of unbiasedness. The previous
 * "stable across retries" property is what produced the bias.
 */

export const AUTH_SUCCESS_SAMPLE = 20;

/**
 * Whether this request's success event should be captured.
 *
 * `Math.random()` is uniform on [0, 1), so `Math.random() * rate < 1` selects
 * with probability exactly 1/rate. Stateless by design: a counter would need
 * per-instance state, and on serverless every cold start would restart the
 * cycle at its sampled position and over-represent first-requests-after-boot
 * (production runs a ~6.7% cold-start rate).
 */
export function inSuccessSample(rate: number = AUTH_SUCCESS_SAMPLE): boolean {
  if (rate <= 1) return true;
  return Math.random() * rate < 1;
}
