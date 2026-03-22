# Handling Clerk Step-Up Authentication (V9)

## Goal Description
When attempting to connect or reconnect a Google account, Clerk often requires "Step-Up Authentication" (reverification) to ensure a malicious actor hasn't hijacked an active session to link their own external accounts. The programmatic `.createExternalAccount()` and `.destroy()` SDK methods do not bypass this; instead, they halt and throw a "You need to provide additional verification to perform this operation" error.

To robustly handle this, we will implement Clerk's native `useReverification()` hook. This hook acts as a wrapper around any sensitive async action: if the action throws a reverification error, the hook intercepts it, automatically pops up the beautiful native Clerk User Profile modal asking them to verify their password/passkey/email, and upon success, automatically re-executes our original connection logic!

## Proposed Changes

### 1. Robust Client-Side Connection and Hook Integration
#### [MODIFY] src/app/dashboard/ConnectGoogleWarning.tsx
- Import `useReverification` from `@clerk/nextjs`.
- Extract the core connection logic (destroying existing unverified accounts, creating new accounts, or reauthorizing existing verified accounts) into a distinct async `connectAction` function.
- Wrap `connectAction` with the hook: `const enhancedConnectAction = useReverification(connectAction);`
- Update the `handleConnect` onClick handler to simply `await enhancedConnectAction()`.

```tsx
// Example Logic:
const connectAction = async () => {
  /* ... destroy if unverified, reauthorize if verified, create if new ... */
}
const enhancedConnectAction = useReverification(connectAction);

const handleConnect = async () => {
  setIsLoading(true);
  try {
    await enhancedConnectAction();
  } catch (error) {
    setIsLoading(false);
  }
}
```

## Verification Plan
1. Let the browser subagent log in and navigate to the dashboard.
2. In the Clerk UI, disconnect the Google account to enter the "unverified" state.
3. Refresh the dashboard and click "Sign in with Google".
4. The Clerk Step-Up Authentication modal will pop up natively requesting a password or code.
5. Have the subagent complete the challenge.
6. Verify the browser instantly proceeds to the Google OAuth consent screen.
