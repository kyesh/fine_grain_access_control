/**
 * Consent decision endpoint for the /oauth/authorize interstitial.
 *
 * Approve: provision (key + email access + rule copies + approved connection +
 * optional notification subscription), then 303 into Clerk's real authorize
 * endpoint — which, with consent_screen_enabled=false, silently issues the
 * code to the partner's redirect_uri.
 *
 * Deny: 303 straight back to the partner with error=access_denied.
 *
 * Security: session-bound (Clerk cookie), partner + redirect_uri re-validated
 * server-side, and the redirect into Clerk carries only re-validated params.
 * Skipping this endpoint entirely (driving Clerk's authorize directly) is safe:
 * the resulting connection is pending-by-default and tools refuse to run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { db } from '@/db';
import { partnerApps } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { resolveDbUser } from '@/db/userHelpers';
import { parseManifest } from '@/lib/partner/manifest';
import { provisionPartnerConnection } from '@/lib/partner/provision';
import { expectedClerkIssuer } from '@/lib/partner/clerkOauth';
import { clerkPrimaryEmail } from '@/lib/clerkPrimaryEmail';

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const form = await req.formData();
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const clientId = get('client_id');
  const redirectUri = get('redirect_uri');
  const decision = get('decision');
  const selectedEmail = get('email');
  const state = get('state');

  if (!clientId || !redirectUri || !decision) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const partner = await db.query.partnerApps.findFirst({
    where: eq(partnerApps.clientId, clientId),
  });
  if (!partner || partner.status !== 'active') {
    return NextResponse.json({ error: 'Unknown application' }, { status: 404 });
  }
  if (!((partner.redirectUris as string[]) ?? []).includes(redirectUri)) {
    return NextResponse.json({ error: 'redirect_uri not registered for this application' }, { status: 400 });
  }

  const denyUrl = new URL(redirectUri);
  if (decision !== 'approve') {
    denyUrl.searchParams.set('error', 'access_denied');
    if (state) denyUrl.searchParams.set('state', state);
    return NextResponse.redirect(denyUrl, 303);
  }

  const manifest = parseManifest(partner.manifest);
  if (!manifest) {
    return NextResponse.json({ error: 'Invalid partner manifest' }, { status: 500 });
  }
  if (!selectedEmail) {
    return NextResponse.json({ error: 'No mailbox selected' }, { status: 400 });
  }

  const clerkUser = await currentUser();
  const email = clerkUser ? clerkPrimaryEmail(clerkUser) : undefined;
  if (!email) return NextResponse.json({ error: 'Account has no email' }, { status: 400 });
  const dbUser = await resolveDbUser(userId, email);
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  try {
    const { connectionId } = await provisionPartnerConnection({
      user: { id: dbUser.id, email: dbUser.email },
      partner: {
        id: partner.id,
        clientId: partner.clientId,
        name: partner.name,
        manifestVersion: partner.manifestVersion,
        webhookUrl: partner.webhookUrl,
      },
      manifest,
      selectedEmails: [selectedEmail],
    });
    console.log(`[Consent] Provisioned partner connection ${connectionId} for user=${dbUser.id} partner=${partner.name}`);
  } catch (err) {
    console.error('[Consent] Provisioning failed:', err);
    const detail = err instanceof Error ? err.message : 'provisioning failed';
    return NextResponse.json({ error: detail }, { status: 400 });
  }

  const issuer = expectedClerkIssuer();
  if (!issuer) {
    return NextResponse.json({ error: 'Clerk issuer unavailable' }, { status: 500 });
  }

  const authorizeUrl = new URL(`${issuer}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', get('response_type') ?? 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  for (const k of ['state', 'scope', 'code_challenge', 'code_challenge_method'] as const) {
    const v = get(k);
    if (v) authorizeUrl.searchParams.set(k, v);
  }

  return NextResponse.redirect(authorizeUrl, 303);
}
