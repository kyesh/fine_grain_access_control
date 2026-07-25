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

    return NextResponse.json({
      accessToken: googleToken,
      hasDriveFileScope,
      scopes
    });
  } catch (error) {
    console.error('Error fetching Google Picker token:', error);
    return NextResponse.json({ error: 'Failed to retrieve Google token' }, { status: 500 });
  }
}
