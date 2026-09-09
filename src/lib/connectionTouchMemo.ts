/**
 * Per-instance memo for the MCP auth layer's eager `resolveConnection` touch.
 *
 * Why (2026-09-08 analytics review): every authenticated MCP request runs
 * resolveConnection in the auth wrapper — a users read, an agent_connections
 * read, a lastUsedAt UPDATE and a proxy-key read, four sequential Neon round
 * trips — purely so new connections appear in the dashboard immediately and
 * `lastUsedAt` stays fresh. Tool handlers re-resolve on their own
 * (requireApproval), so the auth-layer result authorizes nothing. Meanwhile
 * two Claude Code users ran automation that spawned a fresh CLI process every
 * ~30 s for 18 h a day (each spawn = initialize + notifications/initialized +
 * tools/list, zero tool calls): ~1,800 handshakes and ~5,000 needless DB
 * touches a day from one idle client. (The initialize telemetry itself is
 * deliberately left uncoalesced — its per-event grain is what exposed the
 * pattern; see docs/monitoring.md 7.15.)
 *
 * Contract:
 *   - Routing hint ONLY. A memo hit skips a DB touch whose result
 *     was never used for authorization; a wrong entry can delay a dashboard
 *     "last used" timestamp or a client-name backfill by at most TTL_MS, never
 *     grant or deny access.
 *   - An `initialize` (clientInfo present) is never skipped until the
 *     connection's product name has been backfilled (`named`), so the
 *     one-shot `mcp_connection_client_identified` still fires on the first
 *     initialize after creation.
 *   - Bounded LRU keyed by user+client so bogus ids cannot grow it.
 *   - Per function instance; cold starts always run the full path.
 */

export const TOUCH_MEMO_TTL_MS = 5 * 60 * 1000;
export const TOUCH_MEMO_MAX = 500;

interface TouchEntry {
  /** Last time the eager resolve actually ran (ms epoch). */
  touchedAt: number;
  /** Connection row carries a real product name (backfill done). */
  named: boolean;
}

const memo = new Map<string, TouchEntry>();

const key = (userId: string, clientId: string) => `${userId} ${clientId}`;

function lruGet(k: string): TouchEntry | undefined {
  const v = memo.get(k);
  if (v !== undefined) {
    memo.delete(k);
    memo.set(k, v);
  }
  return v;
}

function lruSet(k: string, v: TouchEntry): void {
  if (memo.has(k)) {
    memo.delete(k);
  } else if (memo.size >= TOUCH_MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(k, v);
}

/**
 * Whether the auth layer may skip its eager resolveConnection for this
 * request. `isInitialize` = the request carries clientInfo (an `initialize`),
 * which must reach the DB until the name backfill has happened.
 */
export function shouldSkipEagerResolve(
  userId: string,
  clientId: string,
  isInitialize: boolean,
  now: number = Date.now(),
): boolean {
  const e = lruGet(key(userId, clientId));
  if (!e) return false;
  if (now - e.touchedAt >= TOUCH_MEMO_TTL_MS) return false;
  if (isInitialize && !e.named) return false;
  return true;
}

/**
 * Record that the eager resolve ran and what it found. `named` is whether the
 * connection row now carries a real product name (clientName !== clientId).
 * Call only after a resolve that did not throw.
 */
export function recordEagerResolve(
  userId: string,
  clientId: string,
  named: boolean,
  now: number = Date.now(),
): void {
  const k = key(userId, clientId);
  const e = lruGet(k);
  if (e) {
    e.touchedAt = now;
    e.named = named;
    lruSet(k, e);
  } else {
    lruSet(k, { touchedAt: now, named });
  }
}

/** Test hook. */
export function resetTouchMemoForTests(): void {
  memo.clear();
}

/** Test hook. */
export function touchMemoSize(): number {
  return memo.size;
}
