import { users, accessRules } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { RuleControls } from './RuleControls';
import { DeleteRuleButton } from './DeleteRuleButton';

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect('/');
  }

  // Ensure user exists in our DB, since we aren't using Clerk webhooks yet
  let dbUser = await db.select().from(users).where(eq(users.clerkUserId, user.id)).limit(1).then(res => res[0]);

  if (!dbUser) {
    const rawKeys = await db.insert(users).values({
      clerkUserId: user.id,
      email: user.emailAddresses[0]?.emailAddress ?? 'unknown',
      proxyKey: `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`,
    }).returning();
    dbUser = rawKeys[0];
  }

  // Fetch real rules
  const userRules = await db.select().from(accessRules).where(eq(accessRules.userId, dbUser.id));

  return (
    <div className="py-10">
      <header>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Access Control Dashboard</h1>
        </div>
      </header>

      <main>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 mt-8">
          
          <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200">
            <div className="px-4 py-5 sm:p-6">
              <h2 className="text-lg font-medium leading-6 text-gray-900 mb-4">Your Proxy Credentials</h2>
              <div className="bg-slate-50 border border-slate-200 rounded-md p-4 flex justify-between items-center">
                <div>
                  <p className="text-sm text-slate-800">API Key</p>
                  <code className="text-slate-900 font-mono">{dbUser.proxyKey}</code>
                </div>
                <button className="bg-white border inset-ring inset-ring-gray-300 text-sm font-medium px-3 py-1.5 rounded-md hover:bg-gray-50 text-gray-700">
                  Roll Key (Coming Soon)
                </button>
              </div>
              <p className="mt-3 text-sm text-gray-800">
                Use this key as a Bearer token when communicating with the proxy endpoint.
              </p>
            </div>
          </div>

          <div className="mt-8 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900">Active Rules</h2>
            <RuleControls />
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
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Regex Pattern</th>
                        <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                          <span className="sr-only">Edit</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {userRules.map((rule) => (
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
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                            <DeleteRuleButton id={rule.id} />
                          </td>
                        </tr>
                      ))}
                      {userRules.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-sm text-gray-800">
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
