import { db } from '@/db';
import { users, proxyKeys, keyEmailAccess } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import * as jose from 'jose';

/**
 * Resolve the FGAC user row for a Clerk session, creating one only when this
 * person is genuinely new.
 *
 * `users` is keyed on `clerkUserId`, but Clerk can hand out a *new* user id for
 * the same email — session re-creation, re-signup, a dev-instance reset. Naively
 * inserting on every unseen `clerkUserId` produced duplicate rows per email, and
 * because `proxy_keys`, `access_rules`, `key_email_access` and `email_delegations`
 * all reference a specific `users.id`, the person silently lost their profiles,
 * rules and delegations — no error, just an apparently empty account.
 *
 * So: match on `clerkUserId` first; failing that, adopt an existing row with the
 * same email by repointing its `clerkUserId`. Only insert when neither matches.
 *
 * See docs/bug_reports/duplicate_user_rows_break_delegation.md.
 */
export async function resolveDbUser(clerkUserId: string, email: string) {
  const byClerkId = await db.select().from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1).then(res => res[0]);

  if (byClerkId) {
    // Keep the email in sync if it changed on Clerk's side.
    if (byClerkId.email !== email) {
      const [updated] = await db.update(users)
        .set({ email })
        .where(eq(users.id, byClerkId.id))
        .returning();
      return updated;
    }
    return byClerkId;
  }

  // No row for this Clerk id. Adopt the existing row for this email rather than
  // creating a second one — this is the case that used to orphan accounts.
  // Newest first, since historical data already contains duplicates.
  const byEmail = await db.select().from(users)
    .where(eq(users.email, email))
    .orderBy(desc(users.createdAt))
    .limit(1).then(res => res[0]);

  if (byEmail) {
    console.warn(
      `[resolveDbUser] Adopting existing row for ${email}: clerkUserId ${byEmail.clerkUserId} -> ${clerkUserId}`,
    );
    const [adopted] = await db.update(users)
      .set({ clerkUserId })
      .where(eq(users.id, byEmail.id))
      .returning();
    return adopted;
  }

  return createDbUser(clerkUserId, email);
}

/**
 * Provision a genuinely new user: the row, an RSA keypair, a default agent
 * profile, and access to their own mailbox.
 *
 * Prefer `resolveDbUser` at call sites — calling this directly on an existing
 * email creates a duplicate row.
 */
export async function createDbUser(clerkUserId: string, email: string) {
  // 1. Create User
  const [newUser] = await db.insert(users).values({
    clerkUserId,
    email,
  }).returning();

  // 2. Generate RSA Keypair for Service Account compatibility
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const publicKeyPem = await jose.exportSPKI(publicKey);

  // 3. Create the Default Agent Profile (Proxy Key)
  const proxyKeyString = `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`;
  const [newKey] = await db.insert(proxyKeys).values({
    userId: newUser.id,
    key: proxyKeyString,
    publicKey: publicKeyPem,
    label: 'Default Profile',
  }).returning();

  // 4. Grant this key access to the user's own email address
  await db.insert(keyEmailAccess).values({
    proxyKeyId: newKey.id,
    targetEmail: email,
  });

  return newUser;
}
