# Google OAuth Verification Prep

The application requires specific updates to pass the Google API Services verification process for restricted scopes (like Gmail).

## User Review Required
> [!IMPORTANT]
> - Please review the drafted text for the **Privacy Policy** and **Terms of Service**, especially the "Limited Use Policy" disclosure which is strictly required by Google.
> - The marketing copy on the Homepage explains *how* the app uses the scopes, which should match your exact scope requests in Clerk.
> - You will also need to manually record an **OAuth Consent Screen Demo Video** showing the login flow and how the Gmail data is used (via proxy) once these changes are made.

## Proposed Changes

### Legal & Compliance Pages

#### [NEW] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/privacy/page.tsx)
- Create a new privacy policy page at `/privacy`.
- Include the **Limited Use Policy** statement required by Google:
  *"SecureAgent's use and transfer to any other app of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements."*
- Detail that the application does *not* store email content, only proxies the requests based on user rules.

#### [NEW] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/terms/page.tsx)
- Create a new terms of service page at `/terms`.
- Include standard terms regarding the use of the proxy and API keys.

---
### Marketing & Branding (Scope Justification)

#### [MODIFY] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx)
- Add a dedicated section: **"How We Use Google Data"**.
- Explicitly list the requested scopes (e.g., `gmail.readonly`, `gmail.send`, `gmail.modify`) and justify their usage (to proxy requests and apply user-defined security constraints before reaching AI agents).

#### [MODIFY] [layout.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/layout.tsx)
- Inject a Site Footer displaying links to the "Privacy Policy" and "Terms of Service" so they are discoverable from the homepage, another strict Google requirement.

## Verification Plan

### Automated Tests
- `npm run build` to ensure the new pages and modifications compile correctly.

### Manual Verification
- We will use the browser tool to navigate to `http://localhost:3000/privacy` and `http://localhost:3000/terms` to verify they render correctly and contain the Limited Use snippet.
- We will visually confirm the homepage properly explains the Google data usage and displays the footer links.
