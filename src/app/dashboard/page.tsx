import { users, proxyKeys, emailDelegations, keyEmailAccess, accessRules, keyRuleAssignments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { currentUser, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { RuleControls } from './RuleControls';
import { DeleteRuleButton } from './DeleteRuleButton';
import { EditRuleButton } from './EditRuleButton';
import { KeyControls } from './KeyControls';
import { DelegateAccessButton } from './DelegateAccessButton';
import { RevokeDelegationButton } from './RevokeDelegationButton';
import { ConnectGoogleWarning } from './ConnectGoogleWarning';

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect('/');
  }

  // Ensure user exists in our DB
  let dbUser = await db.select().from(users).where(eq(users.clerkUserId, user.id)).limit(1).then(res => res[0]);

  if (!dbUser) {
    const rawKeys = await db.insert(users).values({
      clerkUserId: user.id,
      email: user.emailAddresses[0]?.emailAddress ?? 'unknown',
    }).returning();
    dbUser = rawKeys[0];
  }

  // ─── Fetch emails the user can access ─────────────────────────────────────
  // 1. Own email (always implicit)
  const ownEmail = dbUser.email;

  // 2. Emails delegated TO this user (they are the delegate)
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

  // 3. Delegations FROM this user to others (they are the owner)
  const delegationsFromMe = await db.select({
    delegation: emailDelegations,
    delegateEmail: users.email,
  })
    .from(emailDelegations)
    .innerJoin(users, eq(users.id, emailDelegations.delegateUserId))
    .where(eq(emailDelegations.ownerUserId, dbUser.id));

  // Build the list of accessible emails for key creation
  const accessibleEmails = [
    { email: ownEmail, type: 'own' as const },
    ...delegationsToMe.map(d => ({
      email: d.ownerEmail,
      type: 'delegated' as const,
      delegationId: d.delegation.id,
    })),
  ];

  // ─── Determine if User has required Google Scopes ────────────────────────
  const googleAccount = user.externalAccounts.find(acc => 
    (acc.provider === 'oauth_google' || acc.provider === 'google') &&
    acc.verification?.status === 'verified'
  );
  const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
  let hasCompleteGoogleAccess = false;

  if (googleAccount) {
    try {
      const clerk = await clerkClient();
      const oauthTokens = await clerk.users.getUserOauthAccessToken(user.id, 'oauth_google');
      
      if (oauthTokens.data.length > 0) {
        const tokenInfo = oauthTokens.data[0];
        const hasScopesInClerk = tokenInfo.scopes?.includes(REQUIRED_SCOPE) ?? false;
        
        if (hasScopesInClerk && tokenInfo.token) {
          // Clerk's token cache might be in a 'limbo' state (e.g. revoked by Google but still sitting in Clerk's DB).
          // To absolutely guarantee it's healthy AND has the exact scopes, we actively ping the Google OAuth TokenInfo API.
          const ping = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${tokenInfo.token}`);
          
          if (ping.ok) {
            const tokenData = await ping.json();
            if (tokenData.scope?.includes(REQUIRED_SCOPE)) {
              hasCompleteGoogleAccess = true;
            }
          } else {
            console.error("Token rejected by Google (likely revoked or expired in limbo state).", ping.status);
          }
        }
      }
    } catch (error) {
      console.error("Failed to validate Google OAuth token. Account is likely disconnected in Clerk.", error);
    }
  }

  // We explicitly override the 'own' email access state
  const accessibleEmailsWithGoogleStatus = accessibleEmails.map(ae => 
    ae.type === 'own' ? { ...ae, hasCompleteGoogleAccess } : ae
  );

  // ─── Fetch proxy keys and their email access ─────────────────────────────
  const userProxyKeys = await db.select().from(proxyKeys).where(eq(proxyKeys.userId, dbUser.id));
  const allKeyEmailAccess = await db.select().from(keyEmailAccess);

  const keysWithAccess = userProxyKeys.map(k => ({
    ...k,
    emailAccess: allKeyEmailAccess
      .filter(kea => kea.proxyKeyId === k.id)
      .map(kea => kea.targetEmail),
  }));

  // ─── Fetch access rules and assignments ───────────────────────────────────
  const userRules = await db.select().from(accessRules).where(eq(accessRules.userId, dbUser.id));
  const allKeyRuleAssignments = await db.select().from(keyRuleAssignments);

  const rulesWithAssignments = userRules.map(rule => ({
    ...rule,
    assignedKeyIds: allKeyRuleAssignments
      .filter(kra => kra.accessRuleId === rule.id)
      .map(kra => kra.proxyKeyId),
  }));

  const activeKeys = userProxyKeys.filter(k => !k.revokedAt);

  return (
    <div className="py-10">
      <header>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Access Control Dashboard</h1>
        </div>
      </header>

      <main>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-8 space-y-8">
          
          {!hasCompleteGoogleAccess && <ConnectGoogleWarning />}

          {/* ─── Your Email & Delegated Emails ─────────────────────── */}
          <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-lg font-medium leading-6 text-gray-900 mb-1">Accessible Gmail Accounts</h2>
              <p className="text-sm text-gray-500 mb-4">
                Your own email is always accessible. Other users can delegate their email access to you.
              </p>

              <div className="flex flex-wrap gap-3">
                {/* Own email — always present */}
                <div className={`flex items-center gap-2 border rounded-md px-3 py-2 ${hasCompleteGoogleAccess ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className={`w-2 h-2 rounded-full ${hasCompleteGoogleAccess ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                  <span className={`text-sm font-medium ${hasCompleteGoogleAccess ? 'text-green-900' : 'text-gray-600 line-through'}`}>{ownEmail}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${hasCompleteGoogleAccess ? 'text-green-600 bg-green-100' : 'text-gray-500 bg-gray-200'}`}>You</span>
                </div>

                {/* Delegated emails */}
                {delegationsToMe.map(d => (
                  <div key={d.delegation.id} className="flex items-center gap-2 bg-brand-teal/5 border border-brand-teal/20 rounded-md px-3 py-2">
                    <div className="w-2 h-2 rounded-full bg-brand-teal"></div>
                    <span className="text-sm font-medium text-brand-teal">{d.ownerEmail}</span>
                    <span className="text-xs text-brand-teal bg-brand-teal/10 px-1.5 py-0.5 rounded">Delegated</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Manage Delegations (Owner View) ──────────────────── */}
          <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-lg font-medium leading-6 text-gray-900">Delegation Management</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Grant other users permission to create API keys for your Gmail ({ownEmail}).
                  </p>
                </div>
                <DelegateAccessButton />
              </div>

              {delegationsFromMe.length === 0 ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-600">
                    No active delegations. Click <strong>&quot;Delegate Access&quot;</strong> to let another user create API keys for your email.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {delegationsFromMe.map(d => (
                    <div key={d.delegation.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-slate-900">{d.delegateEmail}</span>
                        {d.delegation.status === 'active' ? (
                          <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Active</span>
                        ) : (
                          <span className="text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">Revoked</span>
                        )}
                        <span className="text-xs text-slate-400">
                          since {d.delegation.createdAt.toLocaleDateString()}
                        </span>
                      </div>
                      {d.delegation.status === 'active' && (
                        <RevokeDelegationButton delegationId={d.delegation.id} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── API Keys Section ─────────────────────────────────── */}
          <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200">
            <div className="px-4 py-5 sm:p-6">
              <KeyControls
                accessibleEmails={accessibleEmailsWithGoogleStatus}
                existingKeys={keysWithAccess}
              />
              <p className="mt-3 text-sm text-gray-800">
                Use these keys as Bearer tokens when communicating with the proxy endpoint.
                Each key has access only to the specific email accounts you select.
              </p>
            </div>
          </div>

          {/* ─── Access Rules Section ─────────────────────────────── */}
          <div className="mt-8 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">Access Rules</h2>
            <RuleControls
              accessibleEmails={accessibleEmailsWithGoogleStatus.map(e => e.email)}
              activeKeys={activeKeys.map(k => ({ id: k.id, label: k.label }))}
            />
          </div>

          <div className="mt-4 flex flex-col">
            <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
                <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                  <table className="min-w-full divide-y divide-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Rule Name</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Service</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Type</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Pattern</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Scope</th>
                        <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                          <span className="sr-only">Edit</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {rulesWithAssignments.map((rule) => (
                        <tr key={rule.id}>
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                            {rule.ruleName}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-800">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                              {rule.service}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-800">
                            {rule.actionType === 'read_blacklist' ? (
                              <span className="text-red-600 font-medium">Read Blacklist</span>
                            ) : rule.actionType === 'send_whitelist' ? (
                              <span className="text-green-600 font-medium">Send Whitelist</span>
                            ) : rule.actionType}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-800 font-mono bg-slate-50 border rounded-sm ml-2 px-2">
                            {rule.regexPattern}
                          </td>
                          <td className="px-3 py-4 text-sm text-gray-800">
                            <div className="flex flex-col gap-1">
                              {rule.targetEmail ? (
                                <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
                                  📧 {rule.targetEmail}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-500">All emails</span>
                              )}
                              {rule.assignedKeyIds.length > 0 ? (
                                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-700/10">
                                  🔑 {rule.assignedKeyIds.length} key{rule.assignedKeyIds.length > 1 ? 's' : ''}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-500">Global (all keys)</span>
                              )}
                            </div>
                          </td>
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                            <div className="flex items-center justify-end gap-3">
                              <EditRuleButton
                                rule={rule}
                                accessibleEmails={accessibleEmailsWithGoogleStatus.map(e => e.email)}
                                activeKeys={activeKeys.map(k => ({ id: k.id, label: k.label }))}
                              />
                              <DeleteRuleButton id={rule.id} />
                            </div>
                          </td>
                        </tr>
                      ))}
                      {userRules.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-sm text-gray-800">
                            You have no active proxy rules. Default access to all Google Scopes is DENIED.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
