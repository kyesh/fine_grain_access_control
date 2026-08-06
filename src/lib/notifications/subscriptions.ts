/**
 * Notification subscription lifecycle. Watches are per-mailbox at Gmail, but
 * subscriptions are per (connection, mailbox) — so a watch is only stopped
 * when the LAST active subscription on that mailbox goes away.
 */
import { db } from '@/db';
import { notificationSubscriptions, agentConnections } from '@/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { armWatch, stopWatch } from './gmail';

/** Create (or revive) a subscription and try to arm the watch. A failed arm is
 * not fatal — watchExpiresAt stays NULL and the renewal cron retries. */
export async function ensureSubscription(connectionId: string, targetEmail: string): Promise<string> {
  const [sub] = await db.insert(notificationSubscriptions)
    .values({ connectionId, targetEmail })
    .onConflictDoUpdate({
      target: [notificationSubscriptions.connectionId, notificationSubscriptions.targetEmail],
      set: { status: 'active', consecutiveFailures: 0, updatedAt: new Date() },
    })
    .returning();

  try {
    const { historyId, expiration } = await armWatch(targetEmail);
    await db.update(notificationSubscriptions)
      .set({
        // Adopt the watch-time cursor only if we do not already have one —
        // never regress an existing cursor.
        lastHistoryId: sub.lastHistoryId ?? historyId,
        watchExpiresAt: expiration,
        updatedAt: new Date(),
      })
      .where(eq(notificationSubscriptions.id, sub.id));
  } catch (err) {
    console.error(`[Subs] Failed to arm watch for ${targetEmail} (cron will retry):`, err);
  }
  return sub.id;
}

/** Cancel every subscription on a connection (detach/block/revoke path), and
 * stop the Gmail watch for any mailbox left with no other active subscriber. */
export async function cancelSubscriptionsForConnection(connectionId: string): Promise<void> {
  const subs = await db.select().from(notificationSubscriptions)
    .where(and(
      eq(notificationSubscriptions.connectionId, connectionId),
      ne(notificationSubscriptions.status, 'cancelled'),
    ));
  if (subs.length === 0) return;

  await db.update(notificationSubscriptions)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(notificationSubscriptions.connectionId, connectionId));

  for (const sub of subs) {
    const others = await db.select({ id: notificationSubscriptions.id })
      .from(notificationSubscriptions)
      .where(and(
        eq(notificationSubscriptions.targetEmail, sub.targetEmail),
        eq(notificationSubscriptions.status, 'active'),
      ))
      .limit(1);
    if (others.length === 0) {
      try {
        await stopWatch(sub.targetEmail);
      } catch (err) {
        console.error(`[Subs] Failed to stop watch for ${sub.targetEmail}:`, err);
      }
    }
  }
}

/** Re-enable a suspended subscription (dashboard action). The caller should
 * follow with a reconciliation sweep if gap coverage matters. */
export async function reenableSubscription(subscriptionId: string): Promise<void> {
  await db.update(notificationSubscriptions)
    .set({ status: 'active', consecutiveFailures: 0, updatedAt: new Date() })
    .where(eq(notificationSubscriptions.id, subscriptionId));
}

/** Connections owned by a user, for authorization checks on sub actions. */
export async function subscriptionBelongsToUser(subscriptionId: string, userId: string): Promise<boolean> {
  const row = await db.select({ id: notificationSubscriptions.id })
    .from(notificationSubscriptions)
    .innerJoin(agentConnections, eq(notificationSubscriptions.connectionId, agentConnections.id))
    .where(and(
      eq(notificationSubscriptions.id, subscriptionId),
      eq(agentConnections.userId, userId),
    ))
    .limit(1);
  return row.length > 0;
}
