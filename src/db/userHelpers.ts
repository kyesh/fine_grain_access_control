import { db } from '@/db';
import { users, proxyKeys, keyEmailAccess } from '@/db/schema';
import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import * as jose from 'jose';
import { syncDefaultProfileDelegatedAccess } from '@/db/defaultProfile';

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
      console.warn(
        `[resolveDbUser] Primary email changed for ${clerkUserId}: ${byClerkId.email} -> ${email}`,
      );
      const [updated] = await db.update(users)
        .set({ email })
        .where(eq(users.id, byClerkId.id))
        .returning();
      // The user's own-mailbox access rows (delegation_id NULL) are keyed by
      // this same address — re-point them so identity and key access can't
      // drift apart. Delegated rows (delegation_id set) belong to *other*
      // people's mailboxes and must not be touched. Without this, the MCP
      // own-vs-delegated token branch misroutes the user's own mailbox into
      // the delegation path and every call fails (support case 2026-08-24).
      const ownKeys = await db.select({ id: proxyKeys.id }).from(proxyKeys)
        .where(eq(proxyKeys.userId, byClerkId.id));
      if (ownKeys.length > 0) {
        await db.update(keyEmailAccess)
          .set({ targetEmail: email })
          .where(and(
            inArray(keyEmailAccess.proxyKeyId, ownKeys.map(k => k.id)),
            eq(keyEmailAccess.targetEmail, byClerkId.email),
            isNull(keyEmailAccess.delegationId),
          ));
      }
      return updated;
    }
    return byClerkId;
  }

  // No row for this Clerk id. There are two very different reasons for that,
  // and they must not be treated the same:
  //
  //   1. The previous Clerk account was DELETED and someone signed up again
  //      with the same address. That is a NEW account. Inheriting the old row's
  //      proxy keys, rules and delegations would resurrect a deleted identity's
  //      access — and if the address were ever reassigned, hand it to someone
  //      else entirely. Tombstoned rows are therefore skipped.
  //
  //   2. Clerk reissued an id while the account is still live. Same person,
  //      same account: adopt the row so their profiles and the delegations
  //      pointing at them keep working.
  //
  // Only live (non-tombstoned) rows are adoptable. Newest first, because
  // historical data already contains duplicates.
  const adoptable = await db.select().from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .orderBy(desc(users.createdAt))
    .limit(1).then(res => res[0]);

  if (adoptable) {
    console.warn(
      `[resolveDbUser] Adopting live row for ${email}: clerkUserId ${adoptable.clerkUserId} -> ${clerkUserId}`,
    );
    const [adopted] = await db.update(users)
      .set({ clerkUserId })
      .where(eq(users.id, adoptable.id))
      .returning();
    return adopted;
  }

  // Either no row at all, or only tombstoned ones — start fresh.
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
  // isDefault from birth: ensureDefaultProfile's legacy-adoption branch exists
  // only for pre-instant-start rows, and delegation sync (defaultProfile.ts)
  // finds default keys by the flag, not the label.
  const [newKey] = await db.insert(proxyKeys).values({
    userId: newUser.id,
    key: proxyKeyString,
    publicKey: publicKeyPem,
    label: 'Default Profile',
    isDefault: true,
  }).returning();

  // 4. Grant this key access to the user's own email address
  await db.insert(keyEmailAccess).values({
    proxyKeyId: newKey.id,
    targetEmail: email,
  });

  // 5. Materialize any active delegations to this address. A genuine first
  // signup has none (delegation requires an existing account), but Clerk can
  // mint a new user id for a known email — the fresh default key must still
  // reach mailboxes delegated to the older row.
  await syncDefaultProfileDelegatedAccess(email);

  return newUser;
}
