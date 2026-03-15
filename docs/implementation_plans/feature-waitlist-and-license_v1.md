# PostHog Analytics Integration

Integrate PostHog for high-level user metrics, session replays, and tracking user journey through the waitlist and pricing survey.

## User Review Required

- Please review and confirm you have your PostHog credentials ready (Host and Project API Key) to add to your local `.env.local` and Vercel environment variables once the code is in.

## Proposed Changes

### Dependencies
- Install `posthog-js` into the project.

### Environment variables
#### [MODIFY] [.env.example](file:///home/kyesh/GitRepos/fine_grain_access_control/.env.example)
Add placeholders for:
- `NEXT_PUBLIC_POSTHOG_KEY=`
- `NEXT_PUBLIC_POSTHOG_HOST=`

### Application Setup
#### [NEW] [providers.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/providers.tsx)
Create a client-side wrapper component (`"use client"`) that initializes `posthog` and returns the `<PostHogProvider>`.

#### [MODIFY] [layout.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/layout.tsx)
Import the new `PostHogProviderWrapper` and wrap the existing content (inside the `<body>` but outside, or alongside, the `ClerkProvider`) so all pages are tracked.
Wait, PostHogProvider should wrap the `<body>` children.

## Verification Plan

### Automated Tests
- Run `npm run build` to ensure the project still builds successfully with the new provider.

### Manual Verification
- Add the Next.js standard PostHog environment variables to your local `.env.local`.
- Start the server (`npm run dev`) and visit the homepage and waitlist points.
- Check the Network tab to see if `posthog` tracking payloads (`/e/` or `/decide/`) are being sent successfully to the PostHog host.
- Start the browser agent to click through the waitlist page to see if tracking is active.
