/**
 * Resolve a Clerk user's canonical email address.
 *
 * `emailAddresses[0]` is NOT the primary address — Clerk's array order is
 * unstable, and connecting a Google account (or verifying any second address)
 * can put the new address at index 0. FGAC keys a user's identity
 * (`users.email`), their default key's own-mailbox access, and the
 * own-vs-delegated token branch on this value, so deriving it from array
 * order silently re-keys the account and breaks token lookups
 * (support case 2026-08-24; see
 * docs/bug_reports/identity_email_drift_breaks_token_lookup.md).
 *
 * Works for both the backend `User` (has `primaryEmailAddressId`) and the
 * client resource (has `primaryEmailAddress`). Falls back to index 0 only
 * when Clerk reports no primary at all.
 */
export function clerkPrimaryEmail(user: {
  primaryEmailAddressId?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
  emailAddresses: Array<{ id: string; emailAddress: string }>;
}): string | undefined {
  return (
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user.emailAddresses[0]?.emailAddress
  );
}
