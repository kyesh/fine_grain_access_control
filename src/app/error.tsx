'use client';

/**
 * Route-level error boundary.
 *
 * Before this existed, an uncaught server-action or render error produced
 * Next's bare "Application error" page, told the user nothing, and was recorded
 * nowhere — see the 2026-08-25 rule-save incident, where the only evidence was
 * a Vercel runtime log that would have expired within the hour.
 *
 * `digest` is the one identifier Next exposes for a server-side error (the
 * message itself is redacted in production), so it is both reported to PostHog
 * and shown to the user — it is the only handle support has to correlate a
 * report with a log line.
 */

import { useEffect } from 'react';
import posthog from 'posthog-js';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, {
      $exception_source: 'app/error.tsx',
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-20 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This page hit an unexpected error. It has been reported automatically.
        Trying again often works — the error may have been transient.
      </p>
      {error.digest && (
        <p className="text-xs text-subtle">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="flex gap-3 pt-2">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-sm bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-sm border border-border bg-card px-3 py-1.5 text-[13px] font-semibold text-foreground hover:bg-muted"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
