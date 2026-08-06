/**
 * Pub/Sub notification processing: resolve subscriptions for the notified
 * mailbox, diff Gmail history from each subscription's cursor, filter the new
 * messages through the bound key's READ RULES, and enqueue outbox rows for the
 * survivors. A message the key cannot read is never even announced.
 *
 * Runs inside the Pub/Sub push request but must stay fast — content fetches are
 * metadata-only, and partner delivery is async (outbox + drainer), with one
 * inline best-effort attempt so the happy path is real-time.
 */
import { db } from '@/db';
import {
  notificationSubscriptions, webhookDeliveries, agentConnections, proxyKeys,
} from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { loadApplicableRules, checkReadRestrictions } from '@/lib/gmailRules';
import { diffHistory, fetchMessageMetadata } from './gmail';
import { deliverPendingForSubscription } from './deliver';

export interface ProcessResult {
  subscriptionsSeen: number;
  enqueued: number;
  filtered: number;
}

export async function processGmailNotification(
  emailAddress: string, notificationHistoryId: string,
): Promise<ProcessResult> {
  const subs = await db.select({
    sub: notificationSubscriptions,
    connection: agentConnections,
  })
    .from(notificationSubscriptions)
    .innerJoin(agentConnections, eq(notificationSubscriptions.connectionId, agentConnections.id))
    .where(and(
      eq(notificationSubscriptions.targetEmail, emailAddress),
      eq(notificationSubscriptions.status, 'active'),
    ));

  const result: ProcessResult = { subscriptionsSeen: subs.length, enqueued: 0, filtered: 0 };

  for (const { sub, connection } of subs) {
    // Connection must still be live and keyed — a detached partner gets nothing.
    if (connection.status !== 'approved' || !connection.proxyKeyId) continue;
    const key = await db.query.proxyKeys.findFirst({
      where: eq(proxyKeys.id, connection.proxyKeyId),
    });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) continue;

    // First notification for a fresh subscription: adopt the cursor, diff next time.
    if (!sub.lastHistoryId) {
      await db.update(notificationSubscriptions)
        .set({ lastHistoryId: notificationHistoryId, updatedAt: new Date() })
        .where(eq(notificationSubscriptions.id, sub.id));
      continue;
    }

    let messageIds: string[] = [];
    let newHistoryId: string | null = null;
    try {
      ({ messageIds, newHistoryId } = await diffHistory(emailAddress, sub.lastHistoryId));
    } catch (err) {
      // historyId too old (Gmail retains ~1 week) → resync cursor; the gap is
      // surfaced in logs. Anything else: leave cursor, Pub/Sub redelivery retries.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404')) {
        console.warn(`[Notify] History gap for sub=${sub.id}; resyncing cursor to ${notificationHistoryId}`);
        await db.update(notificationSubscriptions)
          .set({ lastHistoryId: notificationHistoryId, updatedAt: new Date() })
          .where(eq(notificationSubscriptions.id, sub.id));
        continue;
      }
      throw err;
    }

    // Rule-filter each new message with the SAME check the read path uses.
    const rules = await loadApplicableRules(connection.userId, key.id, emailAddress);
    for (const messageId of messageIds) {
      let restricted: string | null = null;
      try {
        const meta = await fetchMessageMetadata(emailAddress, messageId);
        restricted = checkReadRestrictions(rules, meta);
      } catch (err) {
        // Metadata fetch failed → fail CLOSED (do not announce what we could not check).
        console.error(`[Notify] Metadata fetch failed for ${messageId}:`, err);
        restricted = 'metadata unavailable';
      }
      if (restricted) {
        result.filtered++;
        continue;
      }
      // Unique (subscriptionId, messageId) absorbs Pub/Sub at-least-once replays.
      // nextAttemptAt uses the APP clock, not the DB default — the inline claim
      // below compares against the app clock, and DB/app skew otherwise leaves
      // fresh rows "not due" until the next cron tick.
      const inserted = await db.insert(webhookDeliveries)
        .values({ subscriptionId: sub.id, messageId, nextAttemptAt: new Date(Date.now() - 1000) })
        .onConflictDoNothing()
        .returning({ id: webhookDeliveries.id });
      if (inserted.length > 0) result.enqueued++;
    }

    // Advance the cursor monotonically.
    const advanceTo = newHistoryId ?? notificationHistoryId;
    await db.update(notificationSubscriptions)
      .set({
        lastHistoryId: sql`GREATEST(${notificationSubscriptions.lastHistoryId}::bigint, ${advanceTo}::bigint)::text`,
        updatedAt: new Date(),
      })
      .where(eq(notificationSubscriptions.id, sub.id));

    // Inline best-effort first delivery — cron only mops up failures.
    if (result.enqueued > 0) {
      try {
        await deliverPendingForSubscription(sub.id);
      } catch (err) {
        console.error(`[Notify] Inline delivery attempt failed for sub=${sub.id}:`, err);
      }
    }
  }

  return result;
}
