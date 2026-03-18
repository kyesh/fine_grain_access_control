# QA Acceptance Test: Gmail Fine Grain Control

## Prerequisites
- A testing environment with the proxy active.
- A test user account successfully created, with Google OAuth Gmail scopes granted.
- The user has obtained their proxy credentials. 
- A mock AI agent script (e.g., a simple Python or Node script) configured to make calls using the user's proxy credentials.

## Dependencies
- Must pass `01_signup_and_credential_workflow.md` first to ensure credentials and the Web UI are functioning.

---

## 🔒 Vercel Preview Automation Bypass
When executing the mock AI agent scripts against a **Vercel Preview URL**, Vercel's SSO Protection shields the API endpoints, causing scripts to receive a `401 Unauthorized` HTML dump instead of hitting the proxy.

> **CRITICAL WARNING:** This bypass token is ONLY for automated scripts. Do NOT append `?x-vercel-protection-bypass=YOUR_SECRET` to the URL when testing in the browser manually or via the Browser Agent. Applying the bypass token to browser URLs will fail to authenticate sub-resources (like CSS and Fonts) and break the page rendering.

**To test the API programmatically on a Preview Branch:**
1. In the Vercel Dashboard, navigate to **Settings -> Deployment Protection**.
2. Enable **Protection Bypass for Automation** and copy the generated secret token.
3. Save this token as `VERCEL_AUTOMATION_BYPASS_SECRET` in your `.env.preview` file.
4. Update your testing scripts (e.g. `scripts/test-preview-api.ts`) to include the `x-vercel-protection-bypass: YOUR_SECRET` HTTP header on all proxy requests. This securely tunnels the request directly to the Next.js API.

---

## Test Cases

### 1. Whitelisting Outbound Emails
**Objective**: Validate that an agent can only send emails to explicitly whitelisted addresses or domains, and fails gracefully with actionable error messages otherwise.

**Steps**:
1. Log into the Web UI as the test user.
2. Navigate to Gmail Access Controls -> Sending Permissions.
3. Add a specific email (e.g., `allowed@example.com`) and a domain regex (e.g., `*@trusted-domain.com`) to the **Send Whitelist**.
4. Run the AI agent script and attempt to send an email to `allowed@example.com`.
   - **Validation**: Ensure the proxy passes the request and the email is sent successfully.
5. Run the AI agent script and attempt to send an email to `blocked@untrusted.com`.
   - **Validation**: Ensure the proxy intercepts and blocks the request.
   - **Validation**: Ensure the API returns a clear error message specifically stating: *"Unauthorized email address. Please ask your user to add 'blocked@untrusted.com' to the sending whitelist."*

### 2. Blacklisting Inbound Emails (Read Access)
**Objective**: Validate that a user can block their agent from reading emails from specific senders, domains, or containing specific content patterns, and that the proxy returns clear rejection reasoning.

**Steps**:
1. In the Web UI, navigate to Gmail Access Controls -> Reading Permissions.
2. Add a **Read Blacklist** rule for the domain `*@competitor.com`.
3. Add a **Read Blacklist** regex rule for emails whose body content matches `CONFIDENTIAL_PROJECT_X` and name this rule "Block Project X".
4. Run the AI agent script to query/read an email from `sales@competitor.com`.
   - **Validation**: The proxy blocks the request and returns an error clearly stating the rejection reason (e.g., *"Access restricted: Sender domain '*@competitor.com' is blacklisted."*).
5. Run the AI agent script to read an email containing the text "CONFIDENTIAL_PROJECT_X".
   - **Validation**: The proxy blocks the request and returns an error clearly stating the rejection reason and the rule name (e.g., *"Access restricted: Email content blocked by rule 'Block Project X'."*).

### 3. Recommended "Quick Add" Rules
**Objective**: Validate that users can apply pre-built security templates with a single click, and that these templates successfully protect highly sensitive account lifecycle emails.

**Steps**:
1. In the Web UI, locate the "Recommended Security Rules" section.
2. Click to apply the "Block Account Security Emails" template. (This should auto-populate rules blacklisting emails containing "2FA Code", "Password Reset", "Sign In", "Verification Code", etc.).
3. Send a test email to the user's inbox containing the phrase "Your password reset link is here".
4. Send a test email containing "Your 2FA verification code is 123456".
5. Run the AI agent script and attempt to read or list those specific emails.
6. **Validation**: The proxy successfully intercepts and blocks the agent from reading the email bodies, but returns a structured error to the agent (e.g., *"Access restricted: A message was received but blocked by the 'Block Account Security Emails' rule. You may notify the user they received a 2FA/Password Reset email, but you cannot view the content."*).

### 4. Granular Deletion Controls
**Objective**: Validate that agents are explicitly prevented from aggressively wiping an inbox, and that deletion is restricted to allowed domains.

**Steps**:
1. In the Web UI, navigate to Gmail Access Controls -> Deletion Permissions.
2. Ensure the global safeguard "Prevent permanent deletion of all emails (Empty Trash)" is enabled by default.
3. Configure the **Deletion Whitelist** to only allow deleting emails from `*@spam-newsletter.com`.
4. Run the AI agent script and attempt to issue a batch delete or empty trash command.
   - **Validation**: The proxy intercepts and strictly denies the bulk action.
5. Run the AI agent script to delete an email from `boss@company.com`.
   - **Validation**: The proxy intercepts and blocks the deletion because it is not on the whitelist.
6. Run the AI agent script to delete an email from `daily@spam-newsletter.com`.
   - **Validation**: The proxy allows the request to pass to Google, successfully deleting the whitelisted email.
