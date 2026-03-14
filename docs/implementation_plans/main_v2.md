# Feature: Support Multiple Gmail Accounts per User (Clerk Native)

Provide a brief description of the problem, any background context, and what the change accomplishes:
Users of the application need the ability to connect and manage multiple Gmail accounts (e.g., Personal, School, Work) under a single Clerk user account. Previously, we considered building a custom OAuth flow and storing refresh tokens in the database. However, this revised plan leverages Clerk's native support for multiple social connections to handle token management entirely, removing the need to store sensitive tokens ourselves. Clerk's backend SDK handles both retrieving and refreshing the access tokens.

## User Review Required

> [!NOTE]
> This approach requires that users manage their connected accounts using the standard `<UserProfile />` provided by Clerk, or through a custom UI that calls Clerk's account-linking methods. It also assumes Clerk's automatic token refresh functionality meets the agent's latency requirements.
> No database changes are necessary with this approach.

## Proposed Changes

### No Database Changes Required
- Tokens will not be stored in our Neon database. Clerk manages the OAuth connections and refresh tokens securely on their end.

### UI / Front-End
- Utilize the Clerk `<UserProfile />` component to allow users to link additional Google accounts under "Connected Accounts".
- (Optional) If a custom UI is desired, implement Clerk's `useUser()` hook to trigger connecting an additional `oauth_google` account programmatically.

### API Routes for Agents

#### [NEW] src/app/api/agents/get-google-token/route.ts
- Create a dedicated endpoint for your Agent CLI (authenticated via the existing `proxyKey` mechanism or similar).
- This endpoint will take the `clerkUserId` and a specific `googleEmail` (e.g. `work@gmail.com`) as input parameters.
- Call `clerkClient.users.getUserOauthAccessToken(clerkUserId, 'oauth_google')`.
- This Clerk SDK method returns an array of `OauthAccessToken` objects for all Google accounts connected by the user.
- Filter the array where the `label` property matches the requested `googleEmail`.
- Return the matching `token` (the fresh access token) to the agent. Clerk automatically handles refreshing this token if it has expired under the hood when this method is called.

### Agent / Library Integration
- On the Agent CLI side, use standard libraries like `google-auth-library`.
- Before performing Gmail API actions, the Agent calls our new Next.js API endpoint to get a fresh access token for the specific email address it needs to operate on.
- The Agent initializes the Google OAuth2 client:
  ```typescript
  import { OAuth2Client } from 'google-auth-library';
  
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: freshAccessTokenFromOurApi });
  
  // Now oauth2Client can be used with any googleapis method
  ```

## Verification Plan

### Automated Tests
- Create a test script or simple API route to verify the array of tokens returned by `getUserOauthAccessToken` accurately reflects newly connected Google accounts.

### Manual Verification
1. Log in to the application.
2. Go to the User Profile and link a second Google account.
3. Once linked, use a test script specifying your second account's email address.
4. Verify the script successfully requests the token from our API and makes a successful Gmail API call using the standard `googleapis` library.
