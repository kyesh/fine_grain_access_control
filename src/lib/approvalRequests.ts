/**
 * Approval-request ledger — one row per request, keyed by the deterministic
 * request_id from approvalLinks.ts.
 *
 * Why this exists: before 2026-08-25 the only durable record of an approval
 * was `approval_consumptions` (a jti per CONSUMED link), so "how many people
 * asked for access, and how many never saw the link?" could only be answered
 * from analytics events keyed on a per-mint id. Every agent retry minted a
 * new id, so retries were indistinguishable from fresh demand and the funnel
 * read far worse than it was.
 *
 * Every write here is best-effort: an approval denial must never fail because
 * bookkeeping failed. Callers do not await correctness, only completion.
 */
import { db } from '@/db';
import { approvalRequests } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * Record one mint ATTEMPT. First attempt inserts; retries increment
 * `mintCount` so demand (rows) stays separable from retry pressure.
 * Returns the resulting mint count, or null if the write failed.
 */
export async function recordApprovalMint(opts: {
  requestId: string;
  userId: string;
  proxyKeyId: string;
  action: string;
  targetHash?: string;
}): Promise<number | null> {
  try {
    const [row] = await db.insert(approvalRequests)
      .values({
        requestId: opts.requestId,
        userId: opts.userId,
        proxyKeyId: opts.proxyKeyId,
        action: opts.action,
        targetHash: opts.targetHash ?? null,
      })
      .onConflictDoUpdate({
        target: approvalRequests.requestId,
        set: {
          mintCount: sql`${approvalRequests.mintCount} + 1`,
          lastMintedAt: new Date(),
        },
      })
      .returning({ mintCount: approvalRequests.mintCount });
    return row?.mintCount ?? null;
  } catch (err) {
    console.error('[approvalRequests] mint record failed:', err);
    return null;
  }
}

/** Stamp the first time a request's approve page was loaded. */
export async function markApprovalRequestOpened(requestId: string): Promise<void> {
  try {
    await db.update(approvalRequests)
      .set({ openedAt: sql`coalesce(${approvalRequests.openedAt}, now())` })
      .where(eq(approvalRequests.requestId, requestId));
  } catch (err) {
    console.error('[approvalRequests] open record failed:', err);
  }
}

/** Stamp the first time a request was approved. */
export async function markApprovalRequestApproved(requestId: string): Promise<void> {
  try {
    await db.update(approvalRequests)
      .set({ approvedAt: sql`coalesce(${approvalRequests.approvedAt}, now())` })
      .where(eq(approvalRequests.requestId, requestId));
  } catch (err) {
    console.error('[approvalRequests] approve record failed:', err);
  }
}
