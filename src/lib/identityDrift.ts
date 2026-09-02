/**
 * Whether `email` belongs to this Clerk user — a verified email address (the
 * primary counts; no secondary is required) or the connected Google external
 * account. Pure so scripts/test-identity-drift.ts can exercise it; the MCP
 * route wraps it with the Clerk fetch (`checkOwnClerkEmail`).
 *
 * Structural parameter types: satisfied by Clerk's backend `User` resource
 * without importing it.
 */
export function ownClerkEmailMatch(
  user: {
    emailAddresses: Array<{
      emailAddress: string;
      verification?: { status?: string | null } | null;
    }>;
    externalAccounts: Array<{
      provider: string;
      emailAddress?: string | null;
    }>;
  },
  email: string,
): boolean {
  const target = email.toLowerCase();
  const ownVerified = user.emailAddresses.some(
    e => e.emailAddress.toLowerCase() === target && e.verification?.status === 'verified',
  );
  const ownGoogle = user.externalAccounts.some(
    e => (e.provider === 'oauth_google' || e.provider === 'google') &&
      e.emailAddress?.toLowerCase() === target,
  );
  return ownVerified || ownGoogle;
}
