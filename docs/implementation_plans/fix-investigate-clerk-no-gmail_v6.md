# Handling Waitlist Invites Pending Google OAuth (v6)

## Goal Description
The previous version implemented a custom button that triggered `user.createExternalAccount`. However, this was flawed in two key ways:
1. **Google Branding:** The button was rendered with Amber/Yellow styling. Google strictly enforces that "Sign in with Google" buttons use their official styling (white/blue background, standard Google "G" SVG logo, specific borders/fonts). Failing to conform to this will cause the application to fail Google OAuth App Verification.
2. **Logic Bug ("Nothing Happens"):** If a user *already* had a Google account linked but was simply missing the `gmail.modify` scope, calling `user.createExternalAccount({ strategy: 'oauth_google' })` quietly returns the existing connected account instead of a new verification flow. Because there is no new verification, `externalVerificationRedirectURL` is null, causing the button to hang on "Connecting..." indefinitely.

## Proposed Changes

### 1. Fix Google Authentication Logic

#### [MODIFY] src/app/dashboard/ConnectGoogleWarning.tsx
- Update `handleConnect` to intelligently route between creation and reauthorization:
```typescript
  const existingGoogleAccount = user.externalAccounts.find(acc => acc.provider === 'oauth_google');
  
  let verificationUrl = null;
  
  if (existingGoogleAccount) {
    // If they have an account but missing scopes, FORCE reauthorization
    const response = await existingGoogleAccount.reauthorize({ redirectUrl: window.location.href });
    verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
  } else {
    // If they never linked Google, create a new connection
    const response = await user.createExternalAccount({
      strategy: "oauth_google",
      redirectUrl: window.location.href,
    });
    verificationUrl = response.verification?.externalVerificationRedirectURL?.href;
  }

  if (verificationUrl) {
    window.location.href = verificationUrl;
  } else {
    setIsLoading(false); // Fix the infinite loading state
  }
```

### 2. Fix Google Branding Guidelines

#### [MODIFY] src/app/dashboard/ConnectGoogleWarning.tsx
- Replace the primitive amber text button with a compliant Google Auth Button design.
- **Background:** White (`bg-white`)
- **Border:** Light Gray (`border border-[#dadce0]`)
- **Logo:** Embed the standard Google "G" logo SVG on the left.
- **Text:** "Sign in with Google" using standard dark gray (`text-[#3c4043]`).
- **Hover State:** Slight gray (`hover:bg-[#f8f9fa]`).
- Maintain the Amber warning banner housing it, but ensure the *button itself* is distinct and compliant.

## Verification Plan
See `docs/QA_Acceptance_Test/08_missing_google_scopes.md`.
1. User with no Google account -> Button creates external account and redirects.
2. User with Google account missing scopes -> Button triggers reauthorize and redirects.
3. Button is visually compliant with Google guidelines.
