# QA Acceptance Test: Sign Up and Credential Workflow

## Prerequisites
- A testing environment with the Vercel edge proxy and Neon Postgres database running.
- Clerk integration configured and active for the testing environment.
- Access to the `.qa_test_emails.json` file in the root directory, which contains the dedicated unaliased Google accounts for testing (e.g., `USER_A_EMAIL` and `USER_B_EMAIL`).
- No prior user accounts exist for the test user email being used.

## Dependencies
- This test must be run before any specific API functionality tests (e.g., `02_gmail_fine_grain_control.md`), as it establishes the baseline credentials required to run them.

---

## Test Cases

### 1. User Sign Up and Credential Generation
**Objective**: Validate that a new user can successfully sign up through the Web UI, authorize Google OAuth scopes, and receive the necessary proxy credentials and setup instructions.

**Steps**:
1. Navigate to the landing page in the testing environment.
2. Click the "Sign Up" or "Get Started" button.
3. Complete the Clerk sign-up flow. **NOTE for Browser Agents/QA**: Ensure the browser environment is already signed into the Google account defined as `USER_A_EMAIL` in `.qa_test_emails.json`. Select "Continue with Google" and pick the active session to bypass password/2FA prompts.
4. During the Google OAuth consent screen, approve all requested scopes (e.g., Drive, Gmail, Calendar).
5. Upon redirect back to the application dashboard, verify that a clear "Welcome" or onboarding state is shown.
6. Locate the "Generate API Credentials" or "Proxy Setup" section.
7. Click "Generate Credential".
8. Verify that a `.json` credential file (or API Key string, depending on implementation) is provided for download/copying.
9. Verify that the API Key string is hidden/obfuscated by default (e.g., `sk_proxy_****************`) in the UI to prevent accidental exposure during screen recordings.
10. Verify there is a clear option/button to temporarily reveal the key or copy it directly to the clipboard without revealing it.
11. Verify that clear, copy-pasteable instructions are displayed detailing how to use this credential with a standard Google SDK (e.g., Python or Node.js snippets showing the `api_endpoint: 'https://fgac.ai/api/proxy'` override).

**Expected Outcome**: The user successfully receives functional proxy credentials and clear instructions on how to point their agent traffic to the proxy.

3. Multi-Tenant Data Isolation (General Admin UX)
**Objective**: Validate that users can only see and modify their *own* fine-grained access control rules, and cannot access the rules or credentials of other users.

**Steps**:
1. Ensure the user from Test Case 1 (`USER_A_EMAIL`) has created at least one mock access control rule in their dashboard.
2. Log out of the application.
3. Sign up/Log in as the completely different test user defined as `USER_B_EMAIL` in `.qa_test_emails.json`.
4. Navigate to the dashboard and access control settings.
5. Verify that the rules and credentials list is completely empty for `USER_B_EMAIL`.
6. Attempt to hit the internal API endpoints directly (e.g., `GET /api/rules`) using User B's session token while passing User A's `user_id` or `rule_id` in the payload or URL.

**Expected Outcome**: User B sees a clean slate. Any programmatic attempts by User B to access User A's rules or credentials result in a `403 Forbidden` or `404 Not Found` response. The multi-tenant barrier is structurally sound.
