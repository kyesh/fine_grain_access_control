# QA Acceptance Test: Sign Up and Credential Workflow

## Prerequisites
- A testing environment with the Vercel edge proxy and Neon Postgres database running.
- Clerk integration configured and active for the testing environment.
- No prior user accounts exist for the test user email.

## Dependencies
- This test must be run before any specific API functionality tests (e.g., `02_gmail_fine_grain_control.md`), as it establishes the baseline credentials required to run them.

---

## Test Cases

### 1. User Sign Up and Credential Generation
**Objective**: Validate that a new user can successfully sign up through the Web UI, authorize Google OAuth scopes, and receive the necessary proxy credentials and setup instructions.

**Steps**:
1. Navigate to the landing page in the testing environment.
2. Click the "Sign Up" or "Get Started" button.
3. Complete the Clerk sign-up flow using a test Google Account (e.g., `test-user-1@gmail.com`).
4. During the Google OAuth consent screen, approve all requested scopes (e.g., Drive, Gmail, Calendar).
5. Upon redirect back to the application dashboard, verify that a clear "Welcome" or onboarding state is shown.
6. Locate the "Generate API Credentials" or "Proxy Setup" section.
7. Click "Generate Credential".
8. Verify that a `.json` credential file (or API Key string, depending on implementation) is provided for download/copying.
9. Verify that clear, copy-pasteable instructions are displayed detailing how to use this credential with a standard Google SDK (e.g., Python or Node.js snippets showing the `api_endpoint: 'https://proxy.ourdomain.com'` override).

**Expected Outcome**: The user successfully receives functional proxy credentials and clear instructions on how to point their agent traffic to the proxy.

### 2. Multi-Tenant Data Isolation (General Admin UX)
**Objective**: Validate that users can only see and modify their *own* fine-grained access control rules, and cannot access the rules or credentials of other users.

**Steps**:
1. Ensure the user from Test Case 1 (`test-user-1@gmail.com`) has created at least one mock access control rule in their dashboard.
2. Log out of the application.
3. Sign up/Log in as a completely different test user (`test-user-2@gmail.com`).
4. Navigate to the dashboard and access control settings.
5. Verify that the rules and credentials list is completely empty for `test-user-2@gmail.com`.
6. Attempt to hit the internal API endpoints directly (e.g., `GET /api/rules`) using `test-user-2`'s session token while passing `test-user-1`'s `user_id` or `rule_id` in the payload or URL.

**Expected Outcome**: User 2 sees a clean slate. Any programmatic attempts by User 2 to access User 1's rules or credentials result in a `403 Forbidden` or `404 Not Found` response. The multi-tenant barrier is structurally sound.
