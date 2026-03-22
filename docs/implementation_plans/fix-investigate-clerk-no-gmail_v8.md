# Fixing the Google Connect Button Logic (V8)

## Goal Description
The Google Connect button fails when clicked by a user whose Google account is in an `unverified` (disconnected) state. This happens because the component attempts to call `.reauthorize()` on the existing but disconnected `ExternalAccountResource`. The `.reauthorize()` method expects the account to be fully verified and is strictly meant for stepping up scopes. For unverified or disconnected accounts, it fails silently or throws.

We need to update the client component so that it only calls `.reauthorize()` if the account is actively verified, and falls back to `.createExternalAccount()` for unverified/disconnected accounts.

## Proposed Changes

### 1. Update Connection Logic
#### [MODIFY] src/app/dashboard/ConnectGoogleWarning.tsx
- Change the `handleConnect` conditional logic:
```tsx
  const existingGoogleAccount = user.externalAccounts.find(acc => 
    acc.provider === 'google' || (acc.provider as any) === 'oauth_google'
  );
  
  let verificationUrl: string | undefined;

  if (existingGoogleAccount && existingGoogleAccount.verification?.status === 'verified') {
    // If they have an active account but missing scopes, FORCE reauthorization
    const response = await existingGoogleAccount.reauthorize({ 
      additionalScopes: ['https://www.googleapis.com/auth/gmail.modify'],
      redirectUrl: window.location.href 
    });
    verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
  } else {
    // If they never linked Google OR if it was disconnected (unverified)
    const response = await user.createExternalAccount({
      strategy: "oauth_google",
      redirectUrl: window.location.href,
    });
    verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
  }
```

## Verification Plan
Manual Testing:
1. Ensure the user's dashboard is yellow with a missing Google connection alert.
2. Click the 'Sign in with Google' button.
3. Verify that the browser is successfully redirected to Google's OAuth consent screen instead of hanging.
