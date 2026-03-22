# Handling Waitlist Invites Pending Google OAuth (v4)

## Goal Description
When waitlist users log in or when users sign in iteratively, they may completely bypass the Google OAuth consent screens, leaving them without the required Gmail scopes (`gmail.modify`).
We need a compliant way to surface the Google OAuth consent requirement to these users directly on the dashboard. Utilizing Clerk's native user profile UX ensures strict adherence to Google's branding guidelines while avoiding confusing terminology.

## Proposed Changes

### 1. Identify Existing Scopes

#### [MODIFY] src/app/dashboard/page.tsx
- In the React Server Component, check the `user.externalAccounts` array for the `oauth_google` account and its `approvedScopes`.
- Define the `REQUIRED_SCOPES`:
  - `https://www.googleapis.com/auth/gmail.modify`
- Pass a boolean flag `hasCompleteGoogleAccess` (true if the Google account exists AND all required scopes are present) down to the client components.

### 2. Update Dashboard UI to Enforce Compliant Connection

#### [NEW] src/app/dashboard/ConnectGoogleWarning.tsx
- Create a client component that leverages the Clerk `useClerk()` hook.
- When `hasCompleteGoogleAccess` is false, this component renders an Amber/Yellow warning banner.
- Banner text: "⚠️ Action Required: You have not granted FGAC access to your Gmail or you are missing required permissions."
- Banner action: Render a button saying "Open Account Settings". 
- When clicked, it calls `clerk.openUserProfile()`. This naturally opens Clerk's native, Google-compliant user profile modal where they can navigate to "Connected accounts" and click the compliant "Connect Google" button to initiate the correct OAuth flow.

#### [MODIFY] src/app/dashboard/page.tsx
- Embed the new `<ConnectGoogleWarning />` at the top of the main dashboard UI.
- Update the Accessible Emails list logic to format their `ownEmail` as disabled/amber if they are missing scopes, indicating why.

#### [MODIFY] src/app/dashboard/KeyControls.tsx
- Add `hasCompleteGoogleAccess?: boolean` to the `AccessibleEmail` interface.
- Disable the checkbox for their own email if `hasCompleteGoogleAccess` is false, avoiding the word "proxy" in the tooltip (e.g., "Google Account not securely linked. Open Account Settings to grant access.").

## Verification Plan
See `docs/QA_Acceptance_Test/08_missing_google_scopes.md`.
