'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false, // Disable automatic pageview capture, as we capture manually
    // Error Tracking. Until this was enabled the project had never received a
    // single `$exception`, so a server action could 500 in production and the
    // only trace was Vercel's ~1h runtime log buffer.
    capture_exceptions: true,
  })

  // All three Vercel environments report into the same PostHog project, so every
  // event is tagged with its deployment tier — dashboards filter on
  // environment = production to exclude local/preview QA traffic.
  const hostname = window.location.hostname
  posthog.register({
    environment:
      hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'development'
        : hostname.endsWith('.vercel.app')
          ? 'preview'
          : 'production',
  })
}

export function PostHogProviderWrapper({ children }: { children: React.ReactNode }) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
