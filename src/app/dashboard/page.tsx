import { redirect } from 'next/navigation';
import { ConnectGoogleWarning } from './ConnectGoogleWarning';
import { SignInTelemetry } from './SignInTelemetry';
import { AgentProfilesView } from './AgentProfilesView';
import { loadDashboardData, defaultProfileSlug } from './loadDashboard';

/**
 * /dashboard is the entry point, but every agent profile lives at its own
 * route (/dashboard/agents/[slug]) — so this page redirects to the default
 * (else first) active profile. It renders inline only when there is nothing
 * to redirect to: no active profiles yet (the empty state creates the first
 * one), or only legacy labels that produce no usable slug.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data = await loadDashboardData();
  if (!data) redirect('/');

  const slug = defaultProfileSlug(data.profiles);
  if (slug) {
    // Forward the query string — pre-existing deep links (?autoOpenPicker=1,
    // OAuth return legs minted before the slug routes shipped) target
    // /dashboard and must keep working after the redirect.
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const v of Array.isArray(value) ? value : value !== undefined ? [value] : []) {
        params.append(key, v);
      }
    }
    const query = params.toString();
    redirect(`/dashboard/agents/${slug}${query ? `?${query}` : ''}`);
  }

  return (
    <>
      <SignInTelemetry
        lastSignInAt={data.lastSignInAt}
        access={data.googleAccess}
        needsDriveFile={data.needsDriveFile}
      />
      {!data.hasCompleteGoogleAccess && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8">
          <ConnectGoogleWarning
            access={data.googleAccess}
            needsDriveFile={data.needsDriveFile}
            lastSignInAt={data.lastSignInAt}
          />
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
