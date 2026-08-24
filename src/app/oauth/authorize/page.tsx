/**
 * Partner Handoff Consent Interstitial — the ONLY consent screen a partner-app
 * user sees (the partner's Clerk OAuth application is registered with
 * consent_screen_enabled=false).
 *
 * Flow: partner redirects here with standard authorize params → user approves →
 * /api/partner/consent provisions key/rules/connection → 303 into Clerk's
 * /oauth/authorize (which silently issues the code) → partner callback.
 *
 * Everything rendered comes from the partner_apps REGISTRY — request params are
 * validated against it and never echoed into the page.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { partnerApps, emailDelegations, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveDbUser } from '@/db/userHelpers';
import { parseManifest, describeManifest } from '@/lib/partner/manifest';
import { clerkPrimaryEmail } from '@/lib/clerkPrimaryEmail';

export const dynamic = 'force-dynamic';

interface AuthorizeParams {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  scope?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

function ErrorCard({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl border border-red-300 dark:border-red-800 p-6 text-center">
        <h1 className="text-lg font-semibold mb-2">{title}</h1>
        <p className="text-sm opacity-80">{detail}</p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<AuthorizeParams>;
}) {
  const params = await searchParams;
  const { userId, redirectToSignIn } = await auth();

  if (!userId) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => typeof v === 'string') as [string, string][],
    );
    return redirectToSignIn({ returnBackUrl: `/oauth/authorize?${qs}` });
  }

  if (!params.client_id || !params.redirect_uri) {
    return <ErrorCard title="Invalid request" detail="Missing client_id or redirect_uri." />;
  }

  const partner = await db.query.partnerApps.findFirst({
    where: eq(partnerApps.clientId, params.client_id),
  });
  if (!partner || partner.status !== 'active') {
    return <ErrorCard title="Unknown application" detail="This application is not registered with FGAC. Nothing has been shared." />;
  }

  const registeredUris = (partner.redirectUris as string[]) ?? [];
  if (!registeredUris.includes(params.redirect_uri)) {
    return <ErrorCard title="Invalid redirect URI" detail="The redirect URI does not match this application's registration. Nothing has been shared." />;
  }

  const manifest = parseManifest(partner.manifest);
  if (!manifest) {
    return <ErrorCard title="Configuration error" detail="This application's permission manifest is invalid. Contact support." />;
  }

  const clerkUser = await currentUser();
  const email = clerkUser ? clerkPrimaryEmail(clerkUser) : undefined;
  if (!email) return <ErrorCard title="Account error" detail="Your account has no email address." />;
  const dbUser = await resolveDbUser(userId, email);
  if (!dbUser) redirect('/dashboard');

  // Own mailbox + any actively delegated to this user.
  const delegated = await db.select({ ownerEmail: users.email })
    .from(emailDelegations)
    .innerJoin(users, eq(emailDelegations.ownerUserId, users.id))
    .where(and(
      eq(emailDelegations.delegateUserId, dbUser.id),
      eq(emailDelegations.status, 'active'),
    ));
  const availableEmails = [dbUser.email, ...delegated.map(d => d.ownerEmail)];

  const permissionLines = describeManifest(manifest);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 shadow-sm">
        <div className="text-center mb-5">
          {partner.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={partner.logoUrl} alt="" className="h-12 w-12 mx-auto mb-3 rounded" />
          )}
          <h1 className="text-xl font-semibold">{partner.name}</h1>
          <p className="text-sm opacity-70 mt-1">
            wants to connect to your FGAC-protected account
          </p>
        </div>

        <div className="rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4 mb-5">
          <p className="text-sm font-medium mb-2">This will allow {partner.name} to:</p>
          <ul className="text-sm space-y-1.5">
            {permissionLines.map(line => (
              <li key={line} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <form method="POST" action="/api/partner/consent" className="space-y-4">
          {(['client_id', 'redirect_uri', 'state', 'scope', 'response_type', 'code_challenge', 'code_challenge_method'] as const)
            .filter(k => params[k])
            .map(k => <input key={k} type="hidden" name={k} value={params[k]} />)}

          <label className="block text-sm">
            <span className="font-medium">Mailbox to share</span>
            <select
              name="email"
              defaultValue={dbUser.email}
              className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent p-2 text-sm"
            >
              {availableEmails.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>

          <div className="flex gap-3">
            <button
              type="submit" name="decision" value="deny"
              className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-700 py-2 text-sm"
            >
              Deny
            </button>
            <button
              type="submit" name="decision" value="approve"
              className="flex-1 rounded-md bg-indigo-600 text-white py-2 text-sm font-medium"
            >
              Approve
            </button>
          </div>
        </form>

        <p className="text-xs opacity-60 mt-4 text-center">
          Signed in as {dbUser.email}. You can revoke this connection at any time
          from your FGAC dashboard — {partner.name} never sees your Google credentials.
        </p>
      </div>
    </main>
  );
}
