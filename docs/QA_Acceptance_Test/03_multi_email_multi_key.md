# QA Acceptance Test: Multi-Email & Multi-Key Agent Access

## Prerequisites
- A testing environment with the proxy active.
- A test user account (using `USER_A_EMAIL` from `.qa_test_emails.json`) successfully created with Google OAuth Gmail scopes granted.
- **Two separate Google accounts** available for testing (i.e. `USER_A_EMAIL` and `USER_B_EMAIL`).
- Both Google accounts connected to the first Clerk profile via the `<UserProfile />` Connected Accounts section.
- A mock AI agent script configured to make calls using proxy credentials with the endpoint override.

## Dependencies
- Must pass `01_signup_and_credential_workflow.md` first.
- Must pass `02_gmail_fine_grain_control.md` first (confirms baseline proxy rule enforcement).

---

## 🔒 Vercel Preview Automation Bypass
When executing the mock AI agent scripts against a **Vercel Preview URL**, Vercel's SSO Protection shields the API endpoints.

> **CRITICAL WARNING:** This bypass token is ONLY for automated scripts. Do NOT append `?x-vercel-protection-bypass=YOUR_SECRET` to the URL when testing in the browser manually or via the Browser Agent. Applying the bypass token to browser URLs will fail to authenticate sub-resources (like CSS and Fonts) and break the page rendering.

**To test the API programmatically on a Preview Branch:**
1. In the Vercel Dashboard, navigate to **Settings -> Deployment Protection**.
2. Enable **Protection Bypass for Automation** and copy the generated secret token.
3. Save this token as `VERCEL_AUTOMATION_BYPASS_SECRET` in your `.env.preview` file.
4. Update your testing scripts (e.g. `scripts/test-preview-api.ts`) to include the `x-vercel-protection-bypass: YOUR_SECRET` HTTP header on all proxy requests. This securely tunnels the request directly to the Next.js API.

---

## Test Cases

### 1. Connecting Multiple Google Accounts
**Objective**: Validate that a user can connect multiple Google accounts to their single Clerk user and that they appear in the dashboard.

**Steps**:
1. Log into the Web UI as the test user.
2. Navigate to Clerk `<UserProfile />` (e.g., via the user avatar menu).
3. Under "Connected Accounts", click "Connect Account" and authenticate with `USER_A_EMAIL`. **NOTE for Browser Agents/QA**: The browser should already be signed into this Google account. Simply click the existing profile instead of typing a password.
4. Repeat step 3 with `USER_B_EMAIL`, also selecting the pre-authenticated session.
5. Return to the application dashboard.
6. Verify that the "Connected Emails" section lists both `USER_A_EMAIL` and `USER_B_EMAIL`.

**Expected Outcome**: Both Google accounts are visible in the dashboard with their email addresses and optional labels.

---

### 2. Creating Multiple API Keys
**Objective**: Validate that a user can create multiple proxy keys, each with a label and specific email access grants.

**Steps**:
1. In the dashboard, navigate to the "API Keys" section.
2. Click "Create New Key".
3. Enter label: `Personal Assistant Agent`.
4. Under "Email Access", select only `USER_A_EMAIL`.
5. Save. Verify a new key value is generated.
6. Verify that the key is hidden/obfuscated by default (e.g., `sk_proxy_****************`) to prevent accidental screen recording leaks, but can be revealed or copied to clipboard securely.
7. Create a second key with label: `Work Automation Bot`.
8. Under "Email Access", select only `USER_B_EMAIL`.
9. Save. Verify a second, different key is displayed and behaves with the same secure masking parameters.
10. Create a third key with label: `Power Agent`.
11. Under "Email Access", select **both** `USER_A_EMAIL` and `USER_B_EMAIL`.
12. Save. Verify a third key is displayed.

**Expected Outcome**: Three distinct proxy keys exist, each with different email access grants. The dashboard clearly indicates which emails each key can access.

---

### 3. Key-to-Email Access Enforcement
**Objective**: Validate that the proxy enforces per-key email access. A key can only reach inboxes it was granted access to.

**Steps**:
1. Configure the agent script with **Key A** (`Personal Assistant Agent`).
2. Make a Gmail API call: `GET /gmail/v1/users/USER_A_EMAIL/messages`.
   - **Validation**: The proxy returns a successful response with message list data.
3. Make a Gmail API call: `GET /gmail/v1/users/USER_B_EMAIL/messages` (using the same Key A).
   - **Validation**: The proxy returns `403 Forbidden` with a clear message: e.g., *"This API key does not have access to 'USER_B_EMAIL'."*
4. Switch to **Key B** (`Work Automation Bot`).
5. Make a Gmail API call: `GET /gmail/v1/users/USER_B_EMAIL/messages`.
   - **Validation**: Successful response.
6. Make a Gmail API call: `GET /gmail/v1/users/USER_A_EMAIL/messages`.
   - **Validation**: `403 Forbidden`.
7. Switch to **Key C** (`Power Agent`).
8. Make a Gmail API call to both `USER_A_EMAIL` and `USER_B_EMAIL`.
   - **Validation**: Both return successful responses.

**Expected Outcome**: Each key can only access the emails it was explicitly granted. No cross-email leakage.

---

### 4. Global Access Rules (Apply to All Keys)
**Objective**: Validate that an access rule with no key assignment applies universally to all of the user's keys.

**Steps**:
1. In the dashboard, create a new access rule:
   - Rule Name: `Block 2FA Codes`
   - Service: `gmail`
   - Action Type: `read_blacklist`
   - Regex Pattern: `2FA Code`
   - Target Email: *(leave blank — applies to all emails)*
   - Key Assignment: *(leave blank — global rule)*
2. Send a test email containing "Your 2FA Code is 991234" to both `USER_A_EMAIL` and `USER_B_EMAIL`.
3. Using **Key A**, attempt to read the 2FA email from `USER_A_EMAIL`.
   - **Validation**: Proxy blocks with *"Access restricted: Email content blocked by rule 'Block 2FA Codes'."*
4. Using **Key B**, attempt to read the 2FA email from `USER_B_EMAIL`.
   - **Validation**: Same block — the global rule applies to this key too.
5. Using **Key C**, attempt to read the 2FA email from either inbox.
   - **Validation**: Same block — global rule applies to all keys.

**Expected Outcome**: A global rule blocks the content regardless of which key or which email is used.

---

### 5. Key-Specific Access Rules
**Objective**: Validate that a rule assigned to a specific key only applies to that key, not others.

**Steps**:
1. Create a new access rule:
   - Rule Name: `Block Competitor Emails`
   - Service: `gmail`
   - Action Type: `read_blacklist`
   - Regex Pattern: `*@competitor.com`
   - Target Email: *(blank — all emails)*
   - Key Assignment: **Key B** (`Work Automation Bot`) only
2. Send a test email from `sales@competitor.com` to `USER_B_EMAIL`.
3. Using **Key B**, attempt to read the email.
   - **Validation**: Proxy blocks with *"Access restricted: Email content blocked by rule 'Block Competitor Emails'."*
4. Using **Key C** (which also has access to `USER_B_EMAIL`), attempt to read the same email.
   - **Validation**: Proxy **allows** the read — the rule was only assigned to Key B.

**Expected Outcome**: Key-specific rules are enforced only on the assigned key. Other keys with access to the same email are unaffected.

---

### 6. Email-Scoped Rules (targetEmail)
**Objective**: Validate that a rule scoped to a specific email only applies when accessing that email, regardless of key.

**Steps**:
1. Create a new access rule:
   - Rule Name: `Block Password Resets on Personal`
   - Service: `gmail`
   - Action Type: `read_blacklist`
   - Regex Pattern: `Password Reset`
   - Target Email: `USER_A_EMAIL`
   - Key Assignment: *(blank — global)*
2. Send a "Password Reset" email to both `USER_A_EMAIL` and `USER_B_EMAIL`.
3. Using **Key C**, attempt to read the password reset email from `USER_A_EMAIL`.
   - **Validation**: Proxy blocks — rule targets this email.
4. Using **Key C**, attempt to read the password reset email from `USER_B_EMAIL`.
   - **Validation**: Proxy **allows** — rule does not target this email.

**Expected Outcome**: `targetEmail`-scoped rules only fire for the specified email, even when using a key that has access to multiple emails.

---

### 7. Key Revocation
**Objective**: Validate that a revoked key is immediately and permanently rejected.

**Steps**:
1. In the dashboard, locate **Key A** (`Personal Assistant Agent`).
2. Click "Revoke Key". Confirm the action.
3. Verify the dashboard marks Key A as "Revoked" with a timestamp.
4. Using the revoked Key A, attempt any Gmail API call.
   - **Validation**: Proxy returns `401 Unauthorized`.
5. Verify **Key B** and **Key C** still function normally.

**Expected Outcome**: Revoked keys are immediately rejected. Other keys are unaffected. The revoked key still appears in the dashboard with its revocation timestamp for auditing.

---

### 8. Key Rolling
**Objective**: Validate that key rolling generates a new key and atomically revokes the old one.

**Steps**:
1. Note Key B's current value (e.g., `sk_proxy_old_xxx`).
2. In the dashboard, click "Roll Key" on **Key B**.
3. Verify a new key value is generated (e.g., `sk_proxy_new_yyy`).
4. Verify the dashboard shows the old key value as "Revoked".
5. Using the **old** Key B value, attempt a Gmail API call.
   - **Validation**: `401 Unauthorized`.
6. Using the **new** Key B value, attempt the same Gmail API call.
   - **Validation**: Successful response.
7. Verify all of Key B's email access grants and rule assignments transferred to the new key.

**Expected Outcome**: Rolling is atomic — old key immediately stops working, new key inherits all permissions and rules.

---

### 9. Cross-User Isolation
**Objective**: Validate that one user's keys, emails, and rules are completely invisible and inaccessible to another user.

**Steps**:
1. Log out of `test-user-1`.
2. Log in as an alternate Clerk account not tied to USER_A or USER_B.
3. Navigate to the dashboard.
4. Verify that this second user sees no connected emails, no keys, and no rules from the first user profile.
5. If the second user obtains or guesses one of the first user's proxy key values, attempt a Gmail API call.
   - **Validation**: The proxy authenticates the key but it belongs to the first user — the request proceeds under the first user's permissions. This confirms keys are opaque bearer tokens tied to the issuing user, as designed.

**Expected Outcome**: Complete tenant isolation. A user cannot see or modify another user's configuration. Keys are cryptographically opaque — knowing a key does not grant access to modify the associated rules.
