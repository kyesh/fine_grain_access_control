import { PostHog } from 'posthog-node';
import { after } from 'next/server';

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  client = key && host ? new PostHog(key, { host, flushAt: 1, flushInterval: 0 }) : null;
  return client;
}

/**
 * Fire-and-forget server-side PostHog capture. Pass the Clerk user id as
 * distinctId whenever one is known — the dashboard identifies with the same id,
 * so server events merge into the same PostHog person. No-ops when PostHog is
 * not configured (e.g. CI).
 */
export function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
): void {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId,
    event,
    properties: {
      environment: process.env.VERCEL_ENV ?? 'development',
      ...properties,
    },
  });
  try {
    after(() => ph.flush().catch(() => {}));
  } catch {
    // No request scope (scripts, build) — flush best-effort instead.
    void ph.flush().catch(() => {});
  }
}
