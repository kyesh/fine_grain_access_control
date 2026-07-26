import { users, proxyKeys, emailDelegations, keyEmailAccess, accessRules, keyRuleAssignments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { createDbUser } from '@/db/userHelpers';
import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { ConnectGoogleWarning } from './ConnectGoogleWarning';
import { AgentProfilesView } from './AgentProfilesView';
import { checkGoogleAccess } from './googleAccess';

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect('/');
  }

  // Ensure user exists in our DB
  let dbUser = await db.select().from(users).where(eq(users.clerkUserId, user.id)).limit(1).then(res => res[0]);

  const currentEmail = user.emailAddresses[0]?.emailAddress ?? 'unknown';

  if (!dbUser) {
    dbUser = await createDbUser(user.id, currentEmail);
  } else if (dbUser.email !== currentEmail) {
    // Sync email if Clerk's email has changed since first signup
    const updated = await db.update(users)
      .set({ email: currentEmail })
      .where(eq(users.id, dbUser.id))
      .returning();
    dbUser = updated[0];
  }

  const hasCompleteGoogleAccess = await checkGoogleAccess(user);

  // ─── Emails this user can build profiles against ─────────────────────────
  const delegationsToMe = await db.select({
    delegation: emailDelegations,
    ownerEmail: users.email,
  })
    .from(emailDelegations)
    .innerJoin(users, eq(users.id, emailDelegations.ownerUserId))
    .where(and(
      eq(emailDelegations.delegateUserId, dbUser.id),
      eq(emailDelegations.status, 'active'),
    ));

  const accessibleEmails = [
    { email: dbUser.email, type: 'own' as const, hasCompleteGoogleAccess },
    ...delegationsToMe.map(d => ({
      email: d.ownerEmail,
      type: 'delegated' as const,
      delegationId: d.delegation.id,
    })),
  ];

  // ─── Agent profiles (proxy keys) and what each can reach ─────────────────
  const userProxyKeys = await db.select().from(proxyKeys).where(eq(proxyKeys.userId, dbUser.id));
  const allKeyEmailAccess = await db.select().from(keyEmailAccess);

  const profiles = userProxyKeys.map(k => ({
    id: k.id,
    key: k.key,
    label: k.label,
    createdAt: k.createdAt.toISOString(),
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    emailAccess: allKeyEmailAccess
      .filter(kea => kea.proxyKeyId === k.id)
      .map(kea => kea.targetEmail),
  }));

  // ─── Rules and their per-profile assignments ─────────────────────────────
  const userRules = await db.select().from(accessRules).where(eq(accessRules.userId, dbUser.id));
  const allKeyRuleAssignments = await db.select().from(keyRuleAssignments);

  const rules = userRules.map(rule => ({
    id: rule.id,
    ruleName: rule.ruleName,
    service: rule.service,
    actionType: rule.actionType,
    regexPattern: rule.regexPattern,
    targetResourceId: rule.targetResourceId,
    resourceName: rule.resourceName,
    targetEmail: rule.targetEmail,
    assignedKeyIds: allKeyRuleAssignments
      .filter(kra => kra.accessRuleId === rule.id)
      .map(kra => kra.proxyKeyId),
  }));

  // Trim and strip a trailing slash — the pulled env value carries stray
  // whitespace, which rendered as "http://localhost:3000 /api/mcp".
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://fgac.ai').trim().replace(/\/+$/, '');
  const mcpEndpoint = `${appUrl}/api/mcp`;

  return (
    <>
      {!hasCompleteGoogleAccess && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8">
          <ConnectGoogleWarning />
        </div>
      )}

      <AgentProfilesView
        profiles={profiles}
        rules={rules}
        accessibleEmails={accessibleEmails}
        mcpEndpoint={mcpEndpoint}
        hasCompleteGoogleAccess={hasCompleteGoogleAccess}
      />
    </>
  );
}
