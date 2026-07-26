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

    const hasDriveFileScope = scopes.some((s: string) =>
      s.includes('drive.file') || s.includes('drive')
    );

    // The Picker needs the Google Cloud PROJECT NUMBER (setAppId) or picked
    // files are never registered to the app's drive.file grant — every later
    // API call on them 404s. The project number is the prefix of the OAuth
    // client id, which tokeninfo reports as `aud`; deriving it here works in
    // every environment without a per-env config value.
    let appId: string | null = null;
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
      }
    } catch (e) {
      console.error('tokeninfo lookup failed; Picker will run without appId:', e);
    }

    return NextResponse.json({
      accessToken: googleToken,
      hasDriveFileScope,
      appId,
      scopes
    });
  } catch (error) {
    console.error('Error fetching Google Picker token:', error);
    return NextResponse.json({ error: 'Failed to retrieve Google token' }, { status: 500 });
  }
}
