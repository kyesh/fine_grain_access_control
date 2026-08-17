'use client'

import { useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { usePostHog } from 'posthog-js/react'

/**
 * Ties PostHog persons to Clerk users: the PostHog distinct id for a signed-in
 * visitor is their Clerk user id, with email/name as person properties. This is
 * what lets dashboards separate QA/internal accounts from genuine traffic.
 * On sign-out the device is reset so the next visitor gets a fresh anonymous id.
 */
export default function PostHogIdentify() {
  const { isLoaded, isSignedIn, user } = useUser()
  const posthog = usePostHog()

  useEffect(() => {
    if (!isLoaded || !posthog) return
    if (isSignedIn && user) {
      if (posthog.get_distinct_id() !== user.id) {
        // signup_source: a FRESH account identifying on the website signed up
        // here; connector-flow accounts get 'claude_connector' stamped
        // server-side at their first MCP connection (usually seconds after
        // creation, before any dashboard visit). $set_once means first
        // touchpoint wins, and the freshness guard keeps pre-existing
        // accounts from being mislabeled on their next visit.
        const accountAgeMs = user.createdAt ? Date.now() - user.createdAt.getTime() : null
        posthog.identify(
          user.id,
          {
            email: user.primaryEmailAddress?.emailAddress,
            name: user.fullName ?? undefined,
          },
          accountAgeMs !== null && accountAgeMs < 600_000 ? { signup_source: 'website' } : undefined,
        )
      }
    } else if (posthog._isIdentified()) {
      posthog.reset()
    }
  }, [isLoaded, isSignedIn, user, posthog])

  return null
}
