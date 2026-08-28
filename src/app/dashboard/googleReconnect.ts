/**
 * Shared client-side Google reconnect leg.
 *
 * One flow, two entry points: the Google Picker (adds drive.file before a
 * pick) and the Accounts page's explicit "Reconnect Google" button (repairs a
 * broken/expired grant). A verified account is reauthorized in place with the
 * extra scopes; anything else (expired/unverified — e.g. an abandoned consent
 * attempt) is destroyed and recreated, which is Clerk's designed recovery.
 * Returns the Google URL to send the user to; throws with a real message when
 * Clerk gives us nowhere to go — callers surface it, never swallow it.
 */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

type ExternalAccountLike = {
  provider: string;
  verification?: { status?: string | null } | null;
  reauthorize: (opts: {
    additionalScopes: string[];
    redirectUrl: string;
    oidcPrompt?: string;
  }) => Promise<{ verification?: { externalVerificationRedirectURL?: { href?: string } | null } | null }>;
  destroy: () => Promise<unknown>;
};

export type ClerkUserLike = {
  externalAccounts: ExternalAccountLike[];
  createExternalAccount: (opts: {
    strategy: 'oauth_google';
    redirectUrl?: string;
  }) => Promise<{ verification?: { externalVerificationRedirectURL?: { href?: string } | null } | null }>;
};

export async function startGoogleReconnect(
  user: ClerkUserLike,
  redirectUrl: string,
  additionalScopes: string[] = [DRIVE_FILE_SCOPE],
): Promise<string> {
  const existing = user.externalAccounts.find(
    acc => acc.provider === 'google' || acc.provider === 'oauth_google',
  );

  let verificationUrl: string | undefined;
  if (existing && existing.verification?.status === 'verified') {
    const response = await existing.reauthorize({
      additionalScopes,
      redirectUrl,
      oidcPrompt: 'consent',
    });
    verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
  } else {
    if (existing) {
      await existing.destroy();
    }
    const response = await user.createExternalAccount({
      strategy: 'oauth_google',
      redirectUrl,
    });
    verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
  }

  if (!verificationUrl) {
    throw new Error('Clerk returned no verification redirect URL for the Google reconnect.');
  }
  return verificationUrl;
}
