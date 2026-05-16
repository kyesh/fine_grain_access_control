# Setup: Sign Up and Credential Workflow

## Prerequisites
- Dev server running at `http://localhost:3000` (or preview/production URL)
- Clerk integration configured and active
- `.qa_test_emails.json` populated (via `npm run qa:secrets`)
- Browser agent's Chrome profile is signed into the Google account for `USER_A_EMAIL`

## Dependencies
- This test must be run before all other QA tests. It establishes the baseline user and validates the core sign-up flow.

---

## Test 1: User Sign Up via Google SSO

**Objective**: Validate that a new user can sign up through the Web UI via Google OAuth.

**Steps (via `/browser-agent`):**
1. Navigate to `http://localhost:3000`.
2. Click the **"Get Started"** button (or **"Sign Up"** in the nav bar).
3. In the Clerk sign-up modal, click **"Sign in with Google Continue with Google"**.
4. On the Google account chooser, select the `USER_A_EMAIL` account.
5. If a Clerk OAuth consent screen appears (asking to access Fine-Grain-Access-Control on behalf of USER_A), click **"Allow"**.
6. Verify redirect back to the application — the nav bar should now show a user avatar and a **"Dashboard"** link.

**Expected Outcome**: User is signed in and the nav shows the authenticated state.

---

## Test 2: Connect Google Account for Gmail Access

**Objective**: Ensure the Google OAuth token has the required `gmail.modify` scope.

**Steps:**
1. Navigate to `http://localhost:3000/dashboard`.
2. Check for the yellow **"Action Required: Connect Google Account"** warning banner.
3. **If the banner IS visible**:
   - Click the **"Sign in with Google"** button inside the banner.
   - Select the `USER_A_EMAIL` Google account.
   - Approve the Gmail scopes on the Google consent screen.
   - After redirect, verify the banner is gone.
4. **If the banner is NOT visible**: Google access is already properly linked.
5. Verify the **"Accessible Gmail Accounts"** section shows `USER_A_EMAIL` with:
   - A green dot indicator (not gray)
   - A "You" badge
   - The email text is NOT struck through

**Expected Outcome**: `USER_A_EMAIL` appears as accessible with full Google access.

---

## Test 3: Create First API Key

**Objective**: Validate key creation and the credential display flow.

**Steps:**
1. In the dashboard, locate the **"API Keys"** section.
2. Click **"Create New Key"**.
3. In the modal:
   - **Key Label**: Enter `QA First Key`
   - **Email Access**: Check `USER_A_EMAIL` (should show green "You" badge)
   - Click **"Create Key"**
4. An alert will appear showing:
   - The proxy key value (`sk_proxy_...`)
   - The endpoint URL (`https://gmail.fgac.ai`)
   - Configuration instructions for Python, Node.js, and cURL
5. Dismiss the alert. A second confirmation may ask about downloading a Service Account JSON — dismiss it.
6. Verify the key now appears in the API Keys list with:
   - Label: "QA First Key"
   - Masked key: `sk_proxy_••••••••••••••••••••••••`
   - **"Reveal Key"** button (eye icon)
   - **"Copy to clipboard"** button
   - Email badge showing `USER_A_EMAIL`
   - **"Roll"** and **"Revoke"** buttons

**Expected Outcome**: API key created, masked by default, with reveal/copy controls and email access visible.

---

## Test 4: Verify Key Obfuscation

**Steps:**
1. Confirm the key displays as `sk_proxy_••••••••••••••••••••••••` (masked).
2. Click the **"Reveal Key"** button (eye icon).
3. Verify the full key is now visible (starts with `sk_proxy_`).
4. Click the eye icon again to re-hide.
5. Click the **"Copy to clipboard"** button.
6. Verify clipboard contains the full key (paste into a text field to confirm).

**Expected Outcome**: Key is obfuscated by default and can be toggled/copied.

---

## Test 5: Multi-Tenant Data Isolation

**Objective**: Validate that users can only see their own data.

**Steps:**
1. Note USER_A's key count and any rules they've created.
2. Sign out of the application (click user avatar → Sign Out).
3. Sign up as `USER_B_EMAIL` (via Google SSO, same flow as Test 1).
4. Navigate to the dashboard.
5. Verify:
   - The **API Keys** section shows no keys (or only USER_B's own keys).
   - The **Access Rules** table shows "You have no active proxy rules."
   - The **Accessible Gmail Accounts** shows only `USER_B_EMAIL`.
6. *(Optional API test)*: Use a tool like `curl` to hit `/api/rules` with USER_B's session, attempting to pass USER_A's identifiers → should return 403 or 404.

**Expected Outcome**: USER_B sees a clean slate. No cross-tenant data leakage.

---

## Verification

- [ ] USER_A signed up via Google SSO
- [ ] Google account connected (yellow banner resolved)
- [ ] API key created and masked by default
- [ ] Reveal/copy controls work
- [ ] Multi-tenant isolation verified (USER_B sees empty state)
- [ ] Screenshot saved as `qa_proof_setup_signup.png`
