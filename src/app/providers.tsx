'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'

export function PostHogProviderWrapper({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Check that we have the required environment variables
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
        capture_pageview: false, // Disable automatic pageview capture, as we capture manually in Next.js/App Router if needed, or via posthog-js automatically based on setup. Wait, actually capture_pageview is fine to leave as default, let's let PostHog handle it or follow Next.js app router recommendations.
        // For Next.js App Router, we usually leave capture_pageview: false and trigger it manually, but posthog-js default is fine for basic usage. Let's just use default.
      })
    }
  }, [])

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
