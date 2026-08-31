import { redirect } from 'next/navigation';
import { ConnectGoogleWarning } from './ConnectGoogleWarning';
import { AgentProfilesView } from './AgentProfilesView';
import { loadDashboardData, defaultProfileSlug } from './loadDashboard';

/**
 * /dashboard is the entry point, but every agent profile lives at its own
 * route (/dashboard/agents/[slug]) — so this page redirects to the default
 * (else first) active profile. It renders inline only when there is nothing
 * to redirect to: no active profiles yet (the empty state creates the first
 * one), or only legacy labels that produce no usable slug.
 */
export default async function DashboardPage() {
  const data = await loadDashboardData();
  if (!data) redirect('/');

  const slug = defaultProfileSlug(data.profiles);
  if (slug) redirect(`/dashboard/agents/${slug}`);

  return (
    <>
      {!data.hasCompleteGoogleAccess && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8">
          <ConnectGoogleWarning />
        </div>
      )}

      <AgentProfilesView
        profiles={data.profiles}
        rules={data.rules}
        accessibleEmails={data.accessibleEmails}
        mcpEndpoint={data.mcpEndpoint}
        hasCompleteGoogleAccess={data.hasCompleteGoogleAccess}
        activeId={data.profiles.find(p => !p.revokedAt)?.id ?? null}
      />
    </>
  );
}
