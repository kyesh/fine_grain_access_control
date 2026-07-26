import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { tombstoneUser } from '@/db/tombstoneUser';

/**
 * Clerk webhook receiver.
 *
 * Handles `user.deleted` by tombstoning the matching FGAC user: proxy keys
 * revoked, delegations revoked both ways, granted access rows removed, row kept
 * for audit. Without this, deleting a Clerk account left live `sk_proxy_` keys
 * and delegations behind, owned by an identity that no longer exists — and the
 * next sign-up with that address could inherit them.
 *
 * Configure in the Clerk dashboard: endpoint `/api/webhooks/clerk`, subscribed
 * to `user.deleted`, with the signing secret in CLERK_WEBHOOK_SIGNING_SECRET.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const payload = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  // Verify before trusting anything in the body — this endpoint is public and
  // an unverified `user.deleted` would be a free way to revoke someone's access.
  let event: { type: string; data: { id?: string } };
  try {
    event = new Webhook(secret).verify(payload, headers) as typeof event;
  } catch (err) {
    console.error('[clerk-webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type !== 'user.deleted') {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const clerkUserId = event.data?.id;
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
  }

  const dbUser = await db.select().from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1).then(res => res[0]);

  if (!dbUser) {
    // Deleted before they ever hit the dashboard — nothing to retire.
    console.log(`[clerk-webhook] user.deleted ${clerkUserId}: no FGAC row`);
    return NextResponse.json({ ok: true, tombstoned: false });
  }

  const result = await tombstoneUser(dbUser.id);
  console.log(
    `[clerk-webhook] Tombstoned ${dbUser.id}: keys=${result?.keysRevoked} ` +
    `delegationsOut=${result?.delegationsRevokedOut} delegationsIn=${result?.delegationsRevokedIn} ` +
    `accessRows=${result?.accessRowsDeleted}`,
  );

  return NextResponse.json({ ok: true, tombstoned: true });
}
