import { currentUser, clerkClient } from '@clerk/nextjs/server';

const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

type ClerkUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/**
 * Whether the signed-in user's Google connection is actually usable right now.
 *
 * Clerk's cached token can sit in a "limbo" state — still present in Clerk's DB
 * after the user revoked it on Google's side — so a scope check against Clerk
 * alone is not enough. We ping Google's tokeninfo endpoint to confirm the token
 * is both live and carries the scope we need.
 *
 * Shared by the Agent Profiles and Accounts pages so the two never disagree
 * about connection health.
 */
export async function checkGoogleAccess(user: ClerkUser): Promise<boolean> {
  const googleAccount = user.externalAccounts.find(acc =>
    (acc.provider === 'oauth_google' || acc.provider === 'google') &&
    acc.verification?.status === 'verified'
  );

  if (!googleAccount) return false;

  try {
    const clerk = await clerkClient();
    // Provider takes no `oauth_` prefix — the prefixed form is deprecated and
    // removed in Clerk's next major.
    const oauthTokens = await clerk.users.getUserOauthAccessToken(user.id, 'google');
    if (oauthTokens.data.length === 0) return false;

    const tokenInfo = oauthTokens.data[0];
    const hasScopesInClerk = tokenInfo.scopes?.includes(REQUIRED_SCOPE) ?? false;
    if (!hasScopesInClerk || !tokenInfo.token) return false;

    const ping = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${tokenInfo.token}`);
    if (!ping.ok) {
      console.error('Token rejected by Google (likely revoked or expired in limbo state).', ping.status);
      return false;
    }

    const tokenData = await ping.json();
    return tokenData.scope?.includes(REQUIRED_SCOPE) ?? false;
  } catch (error) {
    console.error('Failed to validate Google OAuth token. Account is likely disconnected in Clerk.', error);
    return false;
  }
}
