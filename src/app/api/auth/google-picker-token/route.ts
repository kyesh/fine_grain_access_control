import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { captureServerEvent } from '@/lib/posthogServer';

export const dynamic = 'force-dynamic';

/**
 * Pathname of the page that asked for the token (approve page vs profile vs
 * Accounts), from the Referer header — never the query string, which on the
 * approve page carries the signed link.
 */
function requestingPage(request: NextRequest): string | null {
  try {
    const ref = request.headers.get('referer');
    return ref ? new URL(ref).pathname : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  let userId: string | null = null;
  const page = requestingPage(request);
  try {
    ({ userId } = await auth());
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clerkClient();
    const tokenResponse = await client.users.getUserOauthAccessToken(userId, 'oauth_google');
    const googleToken = tokenResponse.data?.[0]?.token;
    const scopes = tokenResponse.data?.[0]?.scopes || [];

    if (!googleToken) {
      // The first server-visible step after a pick-button click. Captured
      // here (not only in the browser) because posthog-js is blocked for a
      // share of users — 8 of the 65 people who opened an approval link in
      // the 30 days to 2026-09-09 sent no client-side event at all — so the
      // client-side picker_* funnel alone cannot say whether they clicked.
      captureServerEvent(userId, 'picker_token_requested', {
        result: 'no_token', has_drive_file_scope: false, page,
      });
      return NextResponse.json({
        error: 'No Google account connected or missing token.',
        hasDriveFileScope: false
      }, { status: 404 });
    }

    // Two things come from Google's tokeninfo, and both matter:
    //
    // 1. The ACTUAL scopes on this access token. Clerk's scope record is a
    //    cache of what was once approved — a later re-login through the base
    //    OAuth consent replaces the Google grant WITHOUT drive.file, and
    //    Clerk keeps claiming it. Trusting the cache means never re-asking
    //    for consent while every Drive/Sheets call fails with
    //    ACCESS_TOKEN_SCOPE_INSUFFICIENT. The token itself is the truth.
    //
    // 2. The Cloud PROJECT NUMBER (tokeninfo `aud` prefix) for Picker
    //    setAppId — without it, picked files are never registered to the
    //    app's drive.file grant and every later API call on them 404s.
    let appId: string | null = null;
    let actualScopes: string[] | null = null;
    try {
      const infoRes = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(googleToken)}`,
        { cache: 'no-store' },
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        const aud: string | undefined = info.aud || info.azp;
        const projectNumber = aud?.split('-')[0];
        if (projectNumber && /^\d+$/.test(projectNumber)) {
          appId = projectNumber;
        }
        if (typeof info.scope === 'string') {
          actualScopes = info.scope.split(' ');
        }
      }
    } catch (e) {
      console.error('tokeninfo lookup failed; falling back to Clerk scope record:', e);
    }

    const effectiveScopes = actualScopes ?? scopes;
    const hasDriveFileScope = effectiveScopes.some((s: string) =>
      s.includes('drive.file') || s.includes('drive')
    );

    // Server-side twin of the browser's picker funnel (see the no_token branch
    // above): one row per pick-button click, with what the gate decided —
    // `has_drive_file_scope: false` sends the browser into the reconnect leg.
    captureServerEvent(userId, 'picker_token_requested', {
      result: 'ok',
      has_drive_file_scope: hasDriveFileScope,
      scope_source: actualScopes ? 'google-tokeninfo' : 'clerk-cache',
      app_id_resolved: appId !== null,
      page,
    });

    return NextResponse.json({
      accessToken: googleToken,
      hasDriveFileScope,
      appId,
      scopes: effectiveScopes,
      scopeSource: actualScopes ? 'google-tokeninfo' : 'clerk-cache',
    });
  } catch (error) {
    console.error('Error fetching Google Picker token:', error);
    if (userId) {
      captureServerEvent(userId, 'picker_token_requested', {
        result: 'error', has_drive_file_scope: false, page,
        message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      });
    }
    return NextResponse.json({ error: 'Failed to retrieve Google token' }, { status: 500 });
  }
}
