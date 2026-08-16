/**
 * `npx tsx scripts/qa-posthog-events.ts` — read-only PostHog event probe for QA.
 *
 * Queries the PostHog HogQL API for recent events so QA capability 16
 * (docs/QA_Acceptance_Test/capabilities/16_analytics_events.md) can assert that
 * analytics actually arrive with the canonical schema. Read-only: uses the
 * Query API, never captures events.
 *
 * Usage:
 *   npx tsx scripts/qa-posthog-events.ts [--event '$mcp_tool_call'] \
 *     [--since 30] [--environment development|preview|production]
 *
 *   --event         event name to fetch (default: $mcp_tool_call)
 *   --since         lookback window in minutes (default: 30)
 *   --environment   filter on the `environment` event property (optional)
 *
 * Required environment (add to Vercel dev env, then `vercel env pull`):
 *   POSTHOG_PERSONAL_API_KEY  personal API key (phx_…) with Query:Read scope
 *   POSTHOG_PROJECT_ID        numeric project id (PostHog → Settings → Project)
 *   NEXT_PUBLIC_POSTHOG_HOST  ingestion host; the query host is derived from it
 *                             (us.i.posthog.com → us.posthog.com), or set
 *                             POSTHOG_API_HOST explicitly.
 *
 * Output masks distinct ids (Clerk user ids) — safe to summarize in
 * qa-results.json evidence, but never paste full ids anywhere public.
 * Note: PostHog ingestion can lag ~30-60s; re-run before calling a miss a fail.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const event = arg('event', '$mcp_tool_call')!;
const sinceMin = Number(arg('since', '30'));
const environment = arg('environment');

if (!/^[A-Za-z0-9_$]+$/.test(event)) {
  console.error(`Invalid event name: ${event}`);
  process.exit(2);
}
if (!Number.isFinite(sinceMin) || sinceMin <= 0 || sinceMin > 10080) {
  console.error('--since must be minutes in (0, 10080]');
  process.exit(2);
}
if (environment && !['development', 'preview', 'production'].includes(environment)) {
  console.error('--environment must be development | preview | production');
  process.exit(2);
}

const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const apiHost =
  process.env.POSTHOG_API_HOST ??
  process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(/^https:\/\/(us|eu)\.i\./, 'https://$1.');

if (!apiKey || !projectId || !apiHost) {
  console.error(
    'Missing POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, or a PostHog host.\n' +
    'See the header of this script for how to provision them.',
  );
  process.exit(2);
}

function mask(distinctId: string): string {
  if (distinctId.startsWith('anonymous')) return distinctId;
  return distinctId.length <= 10 ? distinctId : `${distinctId.slice(0, 10)}…`;
}

async function main() {
  const envFilter = environment ? `and properties.environment = '${environment}'` : '';
  const query = `
    select
      timestamp,
      distinct_id,
      coalesce(properties.$mcp_tool_name, properties.tool, '') as tool,
      coalesce(properties.outcome, '') as outcome,
      coalesce(properties.environment, '') as environment,
      coalesce(properties.client_id, '') as client_id,
      coalesce(properties.cta_location, '') as cta_location
    from events
    where event = '${event}'
      and timestamp > now() - interval ${Math.ceil(sinceMin)} minute
      ${envFilter}
    order by timestamp desc
    limit 200`;

  const res = await fetch(`${apiHost}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) {
    console.error(`PostHog query failed: HTTP ${res.status}\n${(await res.text()).slice(0, 500)}`);
    process.exit(1);
  }
  const data = (await res.json()) as { results?: unknown[][] };
  const rows = (data.results ?? []).map((r) => ({
    timestamp: String(r[0]),
    distinct_id: mask(String(r[1])),
    tool: String(r[2]),
    outcome: String(r[3]),
    environment: String(r[4]),
    client_id: String(r[5]),
    cta_location: String(r[6]),
  }));

  const byOutcome: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  let missingToolName = 0;
  for (const r of rows) {
    byOutcome[r.outcome || '(none)'] = (byOutcome[r.outcome || '(none)'] ?? 0) + 1;
    byTool[r.tool || '(none)'] = (byTool[r.tool || '(none)'] ?? 0) + 1;
    if (!r.tool) missingToolName++;
  }

  console.log(JSON.stringify({
    event,
    window_minutes: sinceMin,
    environment_filter: environment ?? null,
    row_count: rows.length,
    missing_tool_name: missingToolName,
    by_tool: byTool,
    by_outcome: byOutcome,
    rows: rows.slice(0, 25),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
