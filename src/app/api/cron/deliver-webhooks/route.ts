/**
 * Webhook delivery drainer cron — every minute (vercel.json). The inline
 * attempt in the Pub/Sub receiver covers the happy path; this mops up retries
 * on the backoff ladder. Guarded by CRON_SECRET when configured (Vercel sends
 * it as a Bearer token on cron invocations).
 */
import { NextRequest, NextResponse } from 'next/server';
import { deliverPending } from '@/lib/notifications/deliver';

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.VERCEL_ENV !== 'production';
  return req.headers.get('Authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const stats = await deliverPending();
    if (stats.delivered + stats.retried + stats.dead > 0) {
      console.log(`[Cron:deliver] delivered=${stats.delivered} retried=${stats.retried} dead=${stats.dead} suspended=${stats.suspendedSubs.length}`);
    }
    return NextResponse.json({ status: 'ok', ...stats });
  } catch (err) {
    console.error('[Cron:deliver] failed:', err);
    return NextResponse.json({ error: 'drain failed' }, { status: 500 });
  }
}
