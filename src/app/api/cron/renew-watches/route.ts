/**
 * Watch renewal cron — daily (vercel.json). Gmail watches expire after ~7
 * days; re-arm every active subscription whose watch is missing (failed arm at
 * consent time) or expires within 48h. Renewal never regresses the history
 * cursor — armWatch's historyId is only adopted when no cursor exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { notificationSubscriptions } from '@/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { armWatch } from '@/lib/notifications/gmail';

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.VERCEL_ENV !== 'production';
  return req.headers.get('Authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() + 48 * 3600 * 1000);
  const due = await db.select().from(notificationSubscriptions)
    .where(and(
      eq(notificationSubscriptions.status, 'active'),
      or(
        isNull(notificationSubscriptions.watchExpiresAt),
        lt(notificationSubscriptions.watchExpiresAt, cutoff),
      ),
    ));

  // One arm per mailbox is enough — the watch is account-scoped.
  const byEmail = new Map<string, typeof due>();
  for (const sub of due) {
    (byEmail.get(sub.targetEmail) ?? byEmail.set(sub.targetEmail, []).get(sub.targetEmail)!).push(sub);
  }

  let renewed = 0; const failures: string[] = [];
  for (const [email, subs] of byEmail) {
    try {
      const { historyId, expiration } = await armWatch(email);
      for (const sub of subs) {
        await db.update(notificationSubscriptions)
          .set({
            lastHistoryId: sub.lastHistoryId ?? historyId,
            watchExpiresAt: expiration,
            updatedAt: new Date(),
          })
          .where(eq(notificationSubscriptions.id, sub.id));
        renewed++;
      }
    } catch (err) {
      console.error(`[Cron:renew] Failed to re-arm watch for ${email}:`, err);
      failures.push(email);
    }
  }

  console.log(`[Cron:renew] due=${due.length} renewed=${renewed} failures=${failures.length}`);
  return NextResponse.json({ status: 'ok', due: due.length, renewed, failedMailboxes: failures.length });
}
