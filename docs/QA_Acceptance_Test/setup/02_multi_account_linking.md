# Setup: Multi-Account Linking

> Extracted from `03_multi_email_multi_key.md` §1-2

## Prerequisites
- Setup test `01_signup_and_credential.md` passed
- Browser agent signed into both `USER_A_EMAIL` and `USER_B_EMAIL` Google accounts
- Read `.qa_test_emails.json` for the actual email addresses

## Test 1: Connect Second Google Account

**Steps (via `/browser-agent`):**
1. Log into the Web UI as the test user (USER_A_EMAIL via Google SSO).
2. Navigate to Clerk `<UserProfile />` (e.g., via the user avatar menu).
3. Under "Connected Accounts", verify USER_A_EMAIL is already connected.
4. Click "Connect Account" and authenticate with `USER_B_EMAIL`. The browser should already be signed into this Google account — select the existing session.
5. Return to the application dashboard.
6. Verify the "Connected Emails" section lists both `USER_A_EMAIL` and `USER_B_EMAIL`.

**Expected Outcome**: Both Google accounts visible in the dashboard with their email addresses.

---

## Test 2: Create Multiple API Keys with Email Scoping

**Steps:**
1. In the dashboard, navigate to the "API Keys" section.
2. Create key: label `QA-Agent-A`, select only `USER_A_EMAIL`.
3. Verify key is generated and masked by default (`sk_proxy_****`).
4. Create key: label `QA-Agent-B`, select only `USER_B_EMAIL`.
5. Verify a second, different key is displayed.
6. Create key: label `QA-Power-Agent`, select **both** `USER_A_EMAIL` and `USER_B_EMAIL`.
7. Verify a third key is displayed.

**Expected Outcome**: Three distinct proxy keys exist, each with different email access grants. The dashboard clearly indicates which emails each key can access.

---

## Test 3: Dashboard Shows Correct State

**Verification:**
- [ ] Two emails visible in Connected Emails section
- [ ] Three proxy keys visible with correct labels
- [ ] Each key shows its email mapping
- [ ] Screenshot saved as `qa_proof_setup_multi.png`
