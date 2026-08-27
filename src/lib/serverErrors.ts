/**
 * Turning an unexpected server-side throw into an MCP tool response.
 *
 * The MCP SDK converts any error thrown out of a tool callback straight into
 * the tool result: `createToolError(error.message)` (see
 * @modelcontextprotocol/sdk server/mcp.js). Whatever is in `.message` is what
 * the agent — and the person reading its transcript — sees.
 *
 * That is a problem for database errors specifically. Drizzle's
 * `DrizzleQueryError` message is literally
 *
 *     Failed query: <the entire SQL statement>
 *     params: <every bound parameter>
 *
 * so a single unguarded query put a raw `users` SELECT and the caller's Clerk
 * user id in front of an MCP client on 2026-08-26. CLAUDE.md's Strict UI
 * Policy: debug identifiers and internal error objects belong in server logs
 * only, never in a response.
 *
 * The split below is deliberate:
 *
 *   - `describeErrorForLog` is verbose ON PURPOSE, and walks the `cause`
 *     chain. `DrizzleQueryError.message` names the query but NOT the reason —
 *     the real failure (connection refused, auth rejected, missing column)
 *     lives in `.cause`. The 2026-08-26 report was hard to triage precisely
 *     because the only string anyone had was the half that omits the cause.
 *   - `clientErrorMessage` takes no arguments. It cannot leak, because it
 *     never sees the error. Anything derived from an error message is one
 *     upstream library change away from leaking again.
 */

/** Maximum links of the `cause` chain to render, so a cyclic or deep chain
 * cannot produce an unbounded log line. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Flatten an error and its `cause` chain into one server-log string.
 *
 * Safe to include internals: this goes to `console.error`, never to a client.
 */
export function describeErrorForLog(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;

  for (let depth = 0; current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH; depth++) {
    const prefix = depth === 0 ? '' : ' <- caused by: ';

    if (current instanceof Error) {
      parts.push(`${prefix}${current.name}: ${current.message}`);
      // DrizzleQueryError carries the statement and bound params as own
      // properties; the message already repeats them, but a non-Drizzle
      // wrapper in the chain may not.
      const q = (current as { query?: unknown }).query;
      if (typeof q === 'string' && !current.message.includes(q)) {
        parts.push(` [query: ${q}]`);
      }
      current = current.cause;
    } else {
      parts.push(`${prefix}${String(current)}`);
      current = undefined;
    }
  }

  if (parts.length === 0) return String(err);

  const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
  return parts.join('') + stack;
}

/**
 * The only thing an MCP client is told about an unexpected server failure.
 *
 * A constant, by design — see the module header. No SQL, no identifiers, no
 * error text. It does say the request had no effect, because that is what the
 * agent needs in order to decide whether retrying is safe.
 */
export function clientErrorMessage(): string {
  return '❌ FGAC hit an internal error and could not complete this request. '
    + 'The request had no effect, so it is safe to retry. '
    + 'If it keeps failing, the details are in the FGAC server logs.';
}

/**
 * Log the full detail server-side and return the client-safe message.
 *
 * `context` identifies the call site (e.g. the tool name) and must not embed
 * user data — it is a log-only label.
 */
export function logAndSanitize(context: string, err: unknown): string {
  console.error(`[MCP] ${context}:`, describeErrorForLog(err));
  return clientErrorMessage();
}

/** The MCP CallToolResult shape for a sanitized server failure. */
export interface SanitizedToolError {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

/**
 * What a tool must RETURN when it would otherwise throw.
 *
 * Returning matters more than the message here. An MCP tool callback that
 * throws hands control to the SDK, which stringifies `error.message` into the
 * result; a callback that returns keeps the response under our control. This
 * is the single value every unhandled tool exception collapses to.
 */
export function toolErrorResult(context: string, err: unknown): SanitizedToolError {
  return {
    content: [{ type: 'text', text: logAndSanitize(context, err) }],
    isError: true,
  };
}
