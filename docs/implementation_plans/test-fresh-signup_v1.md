# Goal
Create a default agent profile (proxy key) for all new users upon account creation. This profile should be named "Default Profile" and automatically have access to their own email address, enabling it to "read all messages but send none" immediately.

## Proposed Changes

### 1. `src/db/userHelpers.ts` (NEW)
Create a new server-side helper file that encapsulates the logic for provisioning a new user in the database.
- Create `createDbUser(clerkUserId: string, email: string)`
- Insert the user into the `users` table.
- Generate an RSA keypair using `jose` (like we do in the dashboard).
- Insert a new `proxyKeys` row with `label: 'Default Profile'`.
- Insert a new `keyEmailAccess` row linking this new proxy key to the user's own email.

### 2. `src/app/dashboard/page.tsx`
Replace the direct `db.insert(users)` logic with the new `createDbUser` helper to ensure that when users sign up via the web UI, they get their default profile.

### 3. `src/app/api/mcp/route.ts`
Replace the direct `db.insert(users)` logic (that we just added earlier) with the new `createDbUser` helper to ensure that when users are auto-provisioned via the MCP connection flow, they also get the default profile.

## Verification
- Wiping the database for `[test_email]` again.
- Running the `claude mcp add` flow and ensuring that after authenticating, the dashboard shows "Default Profile" under the API Keys section, and the agent can immediately be assigned to it.
