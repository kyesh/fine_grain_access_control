# Feature: Support Multiple Gmail Accounts per User via Service Accounts

Users of the application need agents to access and manage multiple Gmail accounts (e.g., Personal, School, Work) under a single user account. Based on requirements to avoid storing sensitive refresh tokens and to use standard Agent CLI libraries effectively, we will utilize **Google Service Accounts with Domain-Wide Delegation (DWD)**.

This approach allows a **single Service Account** to impersonate any user within a Google Workspace domain, thus securely accessing multiple Gmail accounts without needing individual user consent or multiple service account keys per user.

## User Review Required

> [!IMPORTANT]
> - Domain-Wide Delegation **only works for Google Workspace (formerly G Suite) accounts**. It cannot be used to impersonate standard `@gmail.com` personal accounts.
> - If the user needs to connect personal `@gmail.com` accounts, they *must* use the standard OAuth flow (Clerk or custom) because Service Accounts cannot impersonate them.
> - Setting up DWD requires a Google Workspace Super Administrator to explicitly authorize the Service Account's Client ID and scopes in the Google Admin Console.

## Proposed Changes

### Google Cloud & Workspace Configuration (Manual Steps)
1. **Google Cloud Console**: Create a single Service Account for the application and generate a JSON key file. Enable the Gmail API for the project.
2. **Google Workspace Admin Console**: The Super Admin must enable Domain-Wide Delegation for the Service Account's Client ID, granting specific scopes (e.g., `https://www.googleapis.com/auth/gmail.readonly`).

### Application Configuration
- Store the Service Account JSON credentials securely in the environment (e.g., `GOOGLE_APPLICATION_CREDENTIALS` or a parsed JSON string). No database changes are required merely to store the keys, as one key serves the entire domain.
- The Agent CLI or backend needs to know *which* email addresses a Clerk user is authorized to manage.

### Backend / Agent CLI Integration
- Use the standard `google-auth-library` in Node.js.
- To access a specific Gmail account (e.g., `work@domain.com`), the Agent initializes the `GoogleAuth` client with the Service Account credentials and specifies the target user using the `subject` property.

#### [NEW] src/lib/google-agent-auth.ts
```typescript
import { auth, gmail_v1, google } from 'googleapis';

export async function getGmailClientForUser(userEmailToImpersonate: string): Promise<gmail_v1.Gmail> {
  const client = new auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject: userEmailToImpersonate, // This is the crucial part for DWD
  });

  // Client fetches short-lived access tokens automatically using the SA Key
  await client.authorize();

  return google.gmail({ version: 'v1', auth: client });
}
```

### UI / Front-End
- The UI handles specifying what accounts a Clerk user is trying to configure agents for. It could be a simple list of strings saved in the database or user metadata indicating "User X claims ownership of `work@domain.com`".
- Since DWD relies on organizational trust and Admin approval, the app must ensure a Clerk user has the right to request access to a specific domain email before calling `getGmailClientForUser(email)`.

## Verification Plan

### Manual Verification
1. Create a dummy Workspace Domain and Super Admin.
2. Configure the Service Account and DWD.
3. Write a test script passing `userA@domain.com` and `userB@domain.com` to `getGmailClientForUser`.
4. Verify the agent can successfully fetch the recent emails for both accounts using the single Service Account key.
