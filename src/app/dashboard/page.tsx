import { users, proxyKeys, connectedEmails, keyEmailAccess, accessRules, keyRuleAssignments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { RuleControls } from './RuleControls';
import { DeleteRuleButton } from './DeleteRuleButton';
import { KeyControls } from './KeyControls';
import { SyncEmailsButton } from './SyncEmailsButton';

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

  // Fetch connected emails
  const userConnectedEmails = await db.select().from(connectedEmails).where(eq(connectedEmails.userId, dbUser.id));

  // Fetch proxy keys with their email access
  const userProxyKeys = await db.select().from(proxyKeys).where(eq(proxyKeys.userId, dbUser.id));
  const allKeyEmailAccess = await db.select().from(keyEmailAccess);

  const keysWithAccess = userProxyKeys.map(k => ({
    ...k,
    emailAccess: allKeyEmailAccess.filter(kea => kea.proxyKeyId === k.id).map(kea => kea.connectedEmailId),
  }));

  // Fetch access rules and their key assignments
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

          {/* ─── Connected Emails Section ──────────────────────────── */}
          <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium leading-6 text-gray-900">Connected Google Accounts</h2>
                <SyncEmailsButton />
              </div>
              {userConnectedEmails.length === 0 ? (
                <p className="text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-md p-4">
                  No Google accounts connected yet. Click &quot;Sync from Clerk&quot; after connecting Google accounts in your profile settings.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {userConnectedEmails.map((ce) => (
                    <div key={ce.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span className="text-sm font-medium text-slate-900">{ce.googleEmail}</span>
                      {ce.label && <span className="text-xs text-slate-500">({ce.label})</span>}
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
                connectedEmails={userConnectedEmails}
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
              connectedEmails={userConnectedEmails}
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
                            <DeleteRuleButton id={rule.id} />
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
