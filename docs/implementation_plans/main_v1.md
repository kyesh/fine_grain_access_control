# Feature: Support Multiple Gmail Accounts per User

Provide a brief description of the problem, any background context, and what the change accomplishes:
Users of the application need the ability to connect and manage multiple Gmail accounts (e.g., Personal, School, Work) under a single Clerk user account. Clerk's built-in OAuth primarily serves as the main identity provider and typically stores only one connection per provider type. To support multiple Google identities for API access (agents), we must implement a supplementary OAuth flow using standard libraries and store the resulting refresh tokens in the application database.

## User Review Required

> [!IMPORTANT]
> The approach requires adding a new database table and managing separate OAuth credentials (a custom Google Cloud OAuth client). Please review whether reusing the existing Clerk Google OAuth client credentials or creating a separate, dedicated Google Cloud Project OAuth Client for the application's agents is preferred.

## Proposed Changes

### Database Changes (Drizzle)

#### [MODIFY] src/db/schema.ts
- Add a new table `connected_google_accounts` to store OAuth tokens associated with the user.
- Columns required:
  - `id` (uuid, primary key)
  - `userId` (uuid, references `users.id`)
  - `googleEmail` (text, not null)
  - `accessToken` (text)
  - `refreshToken` (text, not null)
  - `expiresAt` (timestamp)
  - `scopes` (text)
- Add a relation between `users` and `connected_google_accounts`.

### API Routes for OAuth Flow

#### [NEW] src/app/api/auth/google/connect/route.ts
- Create an endpoint that initializes the Google OAuth flow.
- Uses standard library `google-auth-library`.
- Generates an authorization URL requesting `offline` access and `consent` prompt to guarantee highly-privileged refresh tokens.
- Redirects the user to the Google consent screen.

#### [NEW] src/app/api/auth/google/callback/route.ts
- Handles the OAuth redirect callback with the `code`.
- Exchanges the `code` for `access_token` and `refresh_token` using `google-apis`.
- Fetches the user's Google Profile to get their email address.
- Upserts the token data into the new `connected_google_accounts` table linked to the currently authenticated Clerk `userId`.

### Agent / Library Integration

#### [NEW] src/lib/google-clients.ts (or similar utility)
- A utility file demonstrating how to instantiate a `google.auth.OAuth2` client dynamically.
- Given a `userId` and a specific `googleEmail`, fetch the `refreshToken` from the database.
- Initialize the Google API client, allowing agents to perform operations on that specific Gmail account.

## Verification Plan

### Automated Tests
- No existing robust unit test framework apparent in `src/`. We will verify by creating a test API route or server action that lists the connected accounts and their status.

### Manual Verification
1. Log in to the application via Clerk.
2. Navigate to a new "Connected Accounts" settings page (to be built / mocked).
3. Click "Connect another Gmail Account".
4. Go through the Google consent screen with a secondary account.
5. Verify that `connected_google_accounts` table contains the new `refresh_token`.
6. Use a test script (or UI button) to perform an API call (e.g., fetch last 5 emails) using the stored tokens to prove agent access is working.
