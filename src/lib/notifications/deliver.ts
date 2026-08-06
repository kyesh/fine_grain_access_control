/**
 * Webhook delivery drainer. The webhook_deliveries table IS the queue and the
 * audit trail (docs/implementation_plans/third-party-handoff-permissions_v6.md,
 * "Spike 4 Expanded" — Option A).
 *
 * Semantics: at-least-once, per-row backoff ladder, rows grouped per
 * subscription into one thin ping (message IDs only). After MAX_ATTEMPTS a row
 * goes 'dead'; DEAD_STRIKES consecutive dead groups suspend the subscription.
 * Claiming uses UPDATE … RETURNING so overlapping cron ticks never double-send.
 */
import { db } from '@/db';
import {
  webhookDeliveries, notificationSubscriptions, agentConnections, partnerApps,
} from '@/db/schema';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { signWebhookBody } from './hmac';

// 1m, 5m, 15m, 1h, 6h, 24h (seconds). attempts is 1-based after first failure.
const BACKOFF_S = [60, 300, 900, 3600, 21600, 86400];
const MAX_ATTEMPTS = BACKOFF_S.length;
const DEAD_STRIKES = 3;
const DELIVERY_TIMEOUT_MS = 10_000;

interface ClaimedRow { id: string; subscriptionId: string; messageId: string; attempts: number }

async function claimDueRows(subscriptionId?: string, limit = 50): Promise<ClaimedRow[]> {
  const due = db.select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.status, 'pending'),
      lte(webhookDeliveries.nextAttemptAt, new Date()),
      ...(subscriptionId ? [eq(webhookDeliveries.subscriptionId, subscriptionId)] : []),
    ))
    .limit(limit);

  return db.update(webhookDeliveries)
    .set({ status: 'delivering' })
    .where(and(inArray(webhookDeliveries.id, due), eq(webhookDeliveries.status, 'pending')))
    .returning({
      id: webhookDeliveries.id,
      subscriptionId: webhookDeliveries.subscriptionId,
      messageId: webhookDeliveries.messageId,
      attempts: webhookDeliveries.attempts,
    });
}

async function postPing(
  webhookUrl: string, secret: string,
  payload: Record<string, unknown>, deliveryId: string,
): Promise<{ ok: boolean; detail: string }> {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FGAC-Signature': signWebhookBody(secret, ts, body),
        'X-FGAC-Timestamp': String(ts),
        'X-FGAC-Delivery-Id': deliveryId,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return res.ok
      ? { ok: true, detail: `HTTP ${res.status}` }
      : { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface DrainStats { delivered: number; retried: number; dead: number; suspendedSubs: string[] }

/** Drain due rows (optionally scoped to one subscription — the inline path). */
export async function deliverPending(subscriptionId?: string): Promise<DrainStats> {
  const stats: DrainStats = { delivered: 0, retried: 0, dead: 0, suspendedSubs: [] };
  const claimed = await claimDueRows(subscriptionId);
  if (claimed.length === 0) return stats;

  const bySub = new Map<string, ClaimedRow[]>();
  for (const row of claimed) {
    (bySub.get(row.subscriptionId) ?? bySub.set(row.subscriptionId, []).get(row.subscriptionId)!).push(row);
  }

  for (const [subId, rows] of bySub) {
    const ctx = await db.select({
      sub: notificationSubscriptions,
      connection: agentConnections,
      partner: partnerApps,
    })
      .from(notificationSubscriptions)
      .innerJoin(agentConnections, eq(notificationSubscriptions.connectionId, agentConnections.id))
      .innerJoin(partnerApps, eq(agentConnections.partnerAppId, partnerApps.id))
      .where(eq(notificationSubscriptions.id, subId))
      .limit(1)
      .then(r => r[0]);

    // No partner/webhook context, or subscription no longer active → dead-letter.
    if (!ctx || !ctx.partner.webhookUrl || !ctx.partner.webhookSecret || ctx.sub.status !== 'active') {
      await db.update(webhookDeliveries)
        .set({ status: 'dead', lastError: 'subscription inactive or partner has no webhook' })
        .where(inArray(webhookDeliveries.id, rows.map(r => r.id)));
      stats.dead += rows.length;
      continue;
    }

    const deliveryId = rows[0].id;
    const outcome = await postPing(ctx.partner.webhookUrl, ctx.partner.webhookSecret, {
      event: 'new_email',
      connection_id: ctx.connection.id,
      account: ctx.sub.targetEmail,
      message_ids: rows.map(r => r.messageId),
      deliveries: rows.map(r => ({ delivery_id: r.id, message_id: r.messageId })),
    }, deliveryId);

    if (outcome.ok) {
      await db.update(webhookDeliveries)
        .set({ status: 'delivered', deliveredAt: new Date(), lastError: null })
        .where(inArray(webhookDeliveries.id, rows.map(r => r.id)));
      await db.update(notificationSubscriptions)
        .set({ consecutiveFailures: 0, updatedAt: new Date() })
        .where(eq(notificationSubscriptions.id, subId));
      stats.delivered += rows.length;
      continue;
    }

    // Failure: per-row backoff or dead.
    let groupWentDead = false;
    for (const row of rows) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.update(webhookDeliveries)
          .set({ status: 'dead', attempts, lastError: outcome.detail })
          .where(eq(webhookDeliveries.id, row.id));
        stats.dead++;
        groupWentDead = true;
      } else {
        // attempts is 1-based here (just incremented): first failure → 1m rung.
        const delayMs = BACKOFF_S[Math.min(attempts - 1, BACKOFF_S.length - 1)] * 1000;
        await db.update(webhookDeliveries)
          .set({
            status: 'pending',
            attempts,
            lastError: outcome.detail,
            nextAttemptAt: new Date(Date.now() + delayMs),
          })
          .where(eq(webhookDeliveries.id, row.id));
        stats.retried++;
      }
    }

    if (groupWentDead) {
      const [updated] = await db.update(notificationSubscriptions)
        .set({
          consecutiveFailures: sql`${notificationSubscriptions.consecutiveFailures} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(notificationSubscriptions.id, subId))
        .returning({ failures: notificationSubscriptions.consecutiveFailures });
      if (updated && updated.failures >= DEAD_STRIKES) {
        await db.update(notificationSubscriptions)
          .set({ status: 'suspended', updatedAt: new Date() })
          .where(eq(notificationSubscriptions.id, subId));
        stats.suspendedSubs.push(subId);
        console.warn(`[Deliver] Subscription ${subId} suspended after ${updated.failures} dead delivery groups`);
      }
    }
  }

  return stats;
}

export const deliverPendingForSubscription = (subscriptionId: string) => deliverPending(subscriptionId);
