import { users, proxyKeys } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getDelegationsToEmail, getDelegationsFromEmail } from '@/db/delegationQueries';
import { resolveDbUser } from '@/db/userHelpers';
import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { Card, CardHeader, Badge, EmptyState, buttonSecondary } from '@/components/ui';
import { DelegateAccessButton } from '../DelegateAccessButton';
import { RevokeDelegationButton } from '../RevokeDelegationButton';
import { ExposedFilesManager } from '../ExposedFilesManager';
import { AddDelegatedAccountButton } from './AddDelegatedAccountButton';
import { ReconnectGoogleButton } from './ReconnectGoogleButton';
import { checkGoogleAccess } from '../googleAccess';

export default async function AccountsPage() {
  const user = await currentUser();

  if (!user) {
    redirect('/');
  }

  const currentEmail = user.emailAddresses[0]?.emailAddress ?? 'unknown';
  const dbUser = await resolveDbUser(user.id, currentEmail);

  const hasCompleteGoogleAccess = await checkGoogleAccess(user);

  // Resolved by email, not by user row id — duplicate `users` rows for the same
  // email would otherwise hide existing delegations. See delegationQueries.ts.
  const delegationsToMe = await getDelegationsToEmail(dbUser.email);
  const delegationsFromMe = await getDelegationsFromEmail(dbUser.email);

  const userProxyKeys = await db.select().from(proxyKeys).where(eq(proxyKeys.userId, dbUser.id));
  const activeKeys = userProxyKeys.filter(k => !k.revokedAt).map(k => ({ id: k.id, label: k.label }));

  const activeDelegationsToMe = delegationsToMe.filter(d => d.status === 'active');

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground">Accounts</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage the Google accounts FGAC can access, and who else is allowed to build
          agent profiles on top of them.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {/* ─── Connected Google Account ─────────────────────────────── */}
          <Card>
            <CardHeader
              title="Connected Google Account"
              subtitle="FGAC uses this account's OAuth grant to act on your behalf."
              action={<ReconnectGoogleButton prominent={!hasCompleteGoogleAccess} />}
            />
            <div className="px-5 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary bg-primary-muted text-[13px] font-bold text-primary">
                    {dbUser.email.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-foreground">{dbUser.email}</p>
                    <p className="text-[11px] text-muted-foreground">Connected via Google OAuth</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {hasCompleteGoogleAccess ? (
                    <>
                      <Badge tone="success">gmail.modify</Badge>
                      <Badge tone="sheets">drive.file</Badge>
                    </>
                  ) : (
                    <Badge tone="error">Scopes missing or revoked</Badge>
                  )}
                </div>
              </div>

              {!hasCompleteGoogleAccess && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Click &quot;Reconnect Google&quot; above and approve Google&apos;s consent
                  screens to restore access. Until then, every rule that touches mail
                  or sheets is inert.
                </p>
              )}
            </div>
          </Card>

          {/* ─── Accessible Gmail accounts ────────────────────────────── */}
          <Card>
            <CardHeader
              title="Accessible Gmail Accounts"
              subtitle="Mailboxes you can scope agent profiles against."
              action={<AddDelegatedAccountButton />}
            />
            <div className="px-5 pb-5 space-y-2">
              <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-card px-4 py-3">
                <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                  {dbUser.email}
                </span>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">You</Badge>
                  {hasCompleteGoogleAccess
                    ? <Badge tone="success">Active</Badge>
                    : <Badge tone="error">Reconnect</Badge>}
                </div>
              </div>

              {activeDelegationsToMe.map(d => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-sm border border-border bg-card px-4 py-3"
                >
                  <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                    {d.counterpartEmail}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone="primary">Delegated to you</Badge>
                    <span className="text-[11px] text-subtle whitespace-nowrap">
                      since {d.createdAt.toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ─── Delegations granted ──────────────────────────────────── */}
          <Card>
            <CardHeader
              title="Delegations You've Granted"
              subtitle={`Let another FGAC user build agent profiles against ${dbUser.email}.`}
              action={<DelegateAccessButton />}
            />
            <div className="px-5 pb-5 space-y-2">
              {delegationsFromMe.length === 0 ? (
                <EmptyState>
                  You haven&apos;t delegated your mailbox to anyone.
                </EmptyState>
              ) : (
                delegationsFromMe.map(d => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-card px-4 py-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                        {d.counterpartEmail}
                      </span>
                      {d.status === 'active'
                        ? <Badge tone="success">Active</Badge>
                        : <Badge tone="error">Revoked</Badge>}
                      <span className="text-[11px] text-subtle whitespace-nowrap">
                        since {d.createdAt.toLocaleDateString()}
                      </span>
                    </div>
                    {d.status === 'active' && (
                      <RevokeDelegationButton delegationId={d.id} />
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Renders its own card chrome and header, and its horizontal
              header layout needs the full-width column — nesting it in the
              narrow side column wrapped the heading one word per line. */}
          <ExposedFilesManager kind="sheet" activeKeys={activeKeys} />
          <ExposedFilesManager kind="doc" activeKeys={activeKeys} />
        </div>

        {/* ─── Side column ────────────────────────────────────────────── */}
        <div className="space-y-6 min-w-0">
          <Card tone="primary" className="px-5 py-4">
            <h2 className="text-[13px] font-bold text-foreground">Your credentials stay with you</h2>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              FGAC never stores your Google password, and agents never see your OAuth
              token. Every request is brokered through the proxy and checked against the
              rules on the profile that made it.
            </p>
            <a href="/privacy" className={`${buttonSecondary} mt-3`}>
              How this works
            </a>
          </Card>
        </div>
      </div>
    </div>
  );
}
