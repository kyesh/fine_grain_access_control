import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clerkClient();
    const tokenResponse = await client.users.getUserOauthAccessToken(userId, 'oauth_google');
    const googleToken = tokenResponse.data?.[0]?.token;
    const scopes = tokenResponse.data?.[0]?.scopes || [];

    if (!googleToken) {
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

    return NextResponse.json({
      accessToken: googleToken,
      hasDriveFileScope,
      appId,
      scopes: effectiveScopes,
      scopeSource: actualScopes ? 'google-tokeninfo' : 'clerk-cache',
    });
  } catch (error) {
    console.error('Error fetching Google Picker token:', error);
    return NextResponse.json({ error: 'Failed to retrieve Google token' }, { status: 500 });
  }
}
