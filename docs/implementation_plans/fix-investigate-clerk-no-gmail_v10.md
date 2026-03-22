# Dashboard Connection Sync Fix (V10)

## Goal Description
The user reported that the Clerk Account Management page accurately shows "This account has been disconnected" in Production due to token expiration/revocation, but our custom Dashboard still erroneously displays the green "Okay" state. This happens because `verification.status` inside the raw `user.externalAccounts` array remains statically "verified" as long as the user's email was successfully verified during the initial link, even if the underlying Google OAuth refresh token dies later.

To ensure pristine accuracy and perfectly sync our Dashboard with Clerk's strict internal state, we will query Clerk's backend explicitly for an active `OAuthAccessToken` for the user. If the token request fails or returns empty, we will explicitly mark the account as disconnected and flip the UI to the warning state.

## Proposed Changes

### 1. Enforce Server-Side Token Validation
#### [MODIFY] src/app/dashboard/page.tsx
- import `clerkClient` from `@clerk/nextjs/server`.
- Modify the `hasCompleteGoogleAccess` boolean logic to rely strictly on the existence of an active OAuth token:
```tsx
  const googleAccount = user.externalAccounts.find(acc => 
    (acc.provider === 'oauth_google' || acc.provider === 'google') &&
    acc.verification?.status === 'verified'
  );
  
  let hasCompleteGoogleAccess = false;
  const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

  if (googleAccount) {
    try {
      const clerk = await clerkClient();
      const oauthTokens = await clerk.users.getUserOauthAccessToken(dbUser.clerkId, 'oauth_google');
      
      if (oauthTokens.data.length > 0) {
        hasCompleteGoogleAccess = oauthTokens.data[0].scopes?.includes(REQUIRED_SCOPE) ?? false;
      }
    } catch (error) {
      console.error("Failed to validate Google OAuth token. Account is likely disconnected in Clerk.", error);
    }
  }

  // We explicitly override the 'own' email access state
  const accessibleEmailsWithGoogleStatus = accessibleEmails.map(ae => 
    ae.type === 'own' ? { ...ae, hasCompleteGoogleAccess } : ae
  );
```

## Verification Plan
Manual test in Development:
1. Log in via Google to grant `gmail.modify` access.
2. Dashboard should display green.
3. To simulate token death, use the Clerk UI to disconnect the account.
4. Refresh `/dashboard`. Because the `getUserOauthAccessToken` call will return empty (or throw), the dashboard will safely evaluate to `hasCompleteGoogleAccess = false` and properly display the yellow warning banner matching the Clerk UI's disconnected state.
