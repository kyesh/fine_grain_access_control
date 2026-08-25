'use client';

/**
 * Root error boundary — the last line of defence. `app/error.tsx` cannot catch
 * failures in the root layout itself (ClerkProvider, PostHogProvider, fonts),
 * so this one replaces the whole document when those break.
 *
 * It must render its own <html>/<body>, and must not depend on anything the
 * root layout provides. That includes the theme tokens defined in globals.css:
 * if the layout failed, those may never have loaded, so the styling here is
 * deliberately inline and self-contained.
 */

import { useEffect } from 'react';
import posthog from 'posthog-js';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    posthog.captureException(error, {
      $exception_source: 'app/global-error.tsx',
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          color: '#0f172a',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: '#475569', margin: '0 0 1rem' }}>
            FGAC.ai hit an unexpected error and could not finish loading. It has
            been reported automatically.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 1.25rem' }}>
              Reference: <code style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</code>
            </p>
          )}
          <button
            onClick={reset}
            style={{
              border: 0,
              borderRadius: '0.25rem',
              background: '#0f172a',
              color: '#ffffff',
              padding: '0.5rem 0.85rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
