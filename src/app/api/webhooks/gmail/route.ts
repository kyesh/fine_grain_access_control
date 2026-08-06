/**
 * Gmail Pub/Sub push receiver.
 *
 * Google POSTs {message:{data: b64({emailAddress, historyId}), messageId},
 * subscription} here. We verify the caller, process the notification (diff +
 * rule-filter + outbox enqueue + inline delivery attempt), and ack FAST —
 * partner delivery is never allowed to hold Google's ack hostage.
 *
 * Caller verification:
 *  - Production path: Google-signed OIDC JWT (configured on the push
 *    subscription by scripts/setup-gmail-push.ts). Verified against Google's
 *    JWKS; audience must equal PUBSUB_PUSH_AUDIENCE; if PUBSUB_PUSH_SA_EMAIL is
 *    set, the token's email claim must match it.
 *  - Non-production only: the QA pull-drain bridge authenticates with the
 *    QA_BRIDGE_SECRET header (Pub/Sub cannot push to localhost). Disabled when
 *    VERCEL_ENV === 'production'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { processGmailNotification } from '@/lib/notifications/process';

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

async function verifyGoogleOidc(token: string): Promise<boolean> {
  const audience = process.env.PUBSUB_PUSH_AUDIENCE;
  if (!audience) return false;
  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, { audience, clockTolerance: 30 });
    if (!GOOGLE_ISSUERS.includes(payload.iss ?? '')) return false;
    const expectedSa = process.env.PUBSUB_PUSH_SA_EMAIL;
    if (expectedSa && (payload as Record<string, unknown>).email !== expectedSa) return false;
    return true;
  } catch (err) {
    console.error('[GmailWebhook] OIDC verification failed:', err);
    return false;
  }
}

function bridgeAuthorized(req: NextRequest): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  const secret = process.env.QA_BRIDGE_SECRET;
  return !!secret && req.headers.get('x-qa-bridge-secret') === secret;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const oidcOk = authHeader?.startsWith('Bearer ')
    ? await verifyGoogleOidc(authHeader.slice(7))
    : false;

  if (!oidcOk && !bridgeAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let emailAddress: string | undefined;
  let historyId: string | undefined;
  try {
    const envelope = await req.json() as { message?: { data?: string } };
    const decoded = JSON.parse(
      Buffer.from(envelope.message?.data ?? '', 'base64').toString('utf8'),
    ) as { emailAddress?: string; historyId?: number | string };
    emailAddress = decoded.emailAddress;
    historyId = decoded.historyId !== undefined ? String(decoded.historyId) : undefined;
  } catch {
    // Malformed envelope: ack it — redelivery cannot fix a bad payload.
    return NextResponse.json({ status: 'ignored', reason: 'malformed envelope' });
  }

  if (!emailAddress || !historyId) {
    return NextResponse.json({ status: 'ignored', reason: 'missing emailAddress/historyId' });
  }

  try {
    const result = await processGmailNotification(emailAddress, historyId);
    console.log(`[GmailWebhook] ${emailAddress} h=${historyId} subs=${result.subscriptionsSeen} enqueued=${result.enqueued} filtered=${result.filtered}`);
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    // Transient failure → 500 so Pub/Sub redelivers (dedup absorbs the replay).
    console.error('[GmailWebhook] Processing failed:', err);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
