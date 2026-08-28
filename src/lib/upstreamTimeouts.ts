/**
 * Shared bounds for upstream calls from the MCP and proxy routes. Both routes
 * run with maxDuration = 60; an unbounded upstream await rides into that kill,
 * which destroys the analytics capture along with the response — the failure
 * class that made the 2026-08-27 user-reported Sheets timeouts invisible.
 * Bounding the awaits turns a hung upstream into a classified, captured
 * failure. Rationale for the numbers lives in
 * docs/implementation_plans/sheets-tool-timeout-errors-82e433_v1.md.
 */

// Upper bound for one Google API exchange (connect + headers + body). Chosen
// from 30 days of production $mcp_duration_ms (2026-08-28): every tool's p99
// is ≤ ~13 s, but the 2026-08-23 Google slowdown produced sheets reads that
// stalled 42–59 s and then SUCCEEDED — so the bound sits above that recovery
// band, and below maxDuration (60 s).
export const GOOGLE_FETCH_TIMEOUT_MS = 50_000;

// Clerk's token endpoint is a metadata call (Google is only involved when a
// refresh is due), so 15 s is generous.
export const CLERK_TOKEN_TIMEOUT_MS = 15_000;

/** Bound a promise that offers no AbortSignal of its own (Clerk SDK calls). */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`timed out after ${ms}ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * True when a fetch rejection is our own timeout signal firing. The callers
 * attach no other signal, so an abort IS the timeout (undici surfaces
 * AbortSignal.timeout as TimeoutError; AbortError kept for runtime variance).
 * withTimeout rejections use the same TimeoutError name deliberately.
 */
export function isUpstreamTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}
