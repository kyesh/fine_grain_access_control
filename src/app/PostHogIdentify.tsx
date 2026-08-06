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
        posthog.identify(user.id, {
          email: user.primaryEmailAddress?.emailAddress,
          name: user.fullName ?? undefined,
        })
      }
    } else if (posthog._isIdentified()) {
      posthog.reset()
    }
  }, [isLoaded, isSignedIn, user, posthog])

  return null
}
