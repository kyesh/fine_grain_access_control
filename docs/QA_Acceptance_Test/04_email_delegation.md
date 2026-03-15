# QA Acceptance Test: Email Delegation & Cross-User Access

## Prerequisites
- A testing environment with the proxy active.
- **Two separate Google accounts** available (e.g., `user-a@gmail.com` and `user-b@gmail.com`).
- Both accounts have signed up via "Sign in with Google" and have separate Clerk users.
- Must pass `01_signup_and_credential_workflow.md` first.
- Must pass `02_gmail_fine_grain_control.md` first.
- Must pass `03_multi_email_multi_key.md` first.

---

## Test Cases

### 1. Own Email — Implicit Access (No Delegation Required)
**Objective**: Validate that a user's own email is always accessible without any delegation setup.

**Steps**:
1. Log in as `user-a@gmail.com`.
2. Navigate to the dashboard.
3. Verify `user-a@gmail.com` appears in the "Your Email" or "Connected Emails" section automatically.
4. Create an API key with label `My Agent`.
5. Grant the key access to `user-a@gmail.com`.
6. Use the key to make `GET /gmail/v1/users/user-a@gmail.com/messages`.
   - **Validation**: Successful response with message data.
7. Use the key with `GET /gmail/v1/users/me/messages` (the `me` alias).
   - **Validation**: Successful response — `me` resolves to `user-a@gmail.com`.

**Expected Outcome**: A user's own email works out of the box. No delegation, no sync, no extra steps.

---

### 2. Creating a Delegation (Owner Initiates)
**Objective**: Validate that a user can delegate API access to their email to another user.

**Steps**:
1. Log in as `user-a@gmail.com` (the **owner**).
2. Navigate to the dashboard.
3. Click "Delegate Access" (or similar button).
4. Enter the delegate's email: `user-b@gmail.com`.
5. Submit.
   - **Validation**: The delegation appears in the "Active Delegations" section with:
     - Delegate: `user-b@gmail.com`
     - Status: `active`
     - Created timestamp
6. Verify there is a "Revoke" button or link next to the delegation.

**Expected Outcome**: The delegation is created instantly (no approval required from the delegate). The owner sees who has access to their email.

---

### 3. Delegate Sees Delegated Email
**Objective**: Validate that the delegate can see and use the delegated email on their dashboard.

**Steps**:
1. Log in as `user-b@gmail.com` (the **delegate**).
2. Navigate to the dashboard.
3. Verify the "Connected Emails" section shows:
   - `user-b@gmail.com` — own email (always present)
   - `user-a@gmail.com` — delegated email (with a "delegated" badge/indicator)
4. Create a new API key with label `Multi-Account Agent`.
5. In the "Email Access" selector, verify both emails appear:
   - `user-b@gmail.com` (own)
   - `user-a@gmail.com` (delegated)
6. Grant access to **both** emails.
7. Save the key.

**Expected Outcome**: Delegated emails appear alongside own email. The delegate can create keys with access to delegated emails.

---

### 4. Proxy Access to Delegated Email
**Objective**: Validate that the proxy correctly fetches the **owner's** Google token when accessing a delegated email.

**Steps**:
1. Using the key created in Test 3 (`Multi-Account Agent`):
2. Make `GET /gmail/v1/users/user-b@gmail.com/messages`.
   - **Validation**: Successful response (uses `user-b`'s own Google token).
3. Make `GET /gmail/v1/users/user-a@gmail.com/messages`.
   - **Validation**: Successful response (proxy looks up the delegation, fetches `user-a`'s Google token from Clerk).
4. Verify the response contains actual message data from `user-a@gmail.com`'s inbox.

**Expected Outcome**: The proxy transparently resolves the correct Clerk user's token based on the delegation relationship. The delegate's key accesses both inboxes seamlessly.

---

### 5. Access Rules on Delegated Emails
**Objective**: Validate that the delegate's access rules apply correctly to delegated emails.

**Steps**:
1. As `user-b@gmail.com`, create an access rule:
   - Rule Name: `Block Sensitive on Delegated`
   - Service: `gmail`
   - Action Type: `read_blacklist`
   - Regex Pattern: `CONFIDENTIAL`
   - Target Email: `user-a@gmail.com`
2. Send an email containing "CONFIDENTIAL" to `user-a@gmail.com`.
3. Using the `Multi-Account Agent` key, attempt to read the email from `user-a@gmail.com`.
   - **Validation**: Blocked by the read_blacklist rule.
4. Using the same key, read emails from `user-b@gmail.com` containing "CONFIDENTIAL".
   - **Validation**: Allowed (rule targets `user-a@gmail.com` only).

**Expected Outcome**: Access rules scoped to a delegated email work correctly. Rules for one email don't affect the other.

---

### 6. Revoking a Delegation (Owner Revokes)
**Objective**: Validate that the owner can revoke a delegation and that access is immediately cut off.

**Steps**:
1. Log in as `user-a@gmail.com` (the **owner**).
2. Navigate to the dashboard.
3. Find the active delegation to `user-b@gmail.com`.
4. Click "Revoke".
5. Confirm the revocation action.
   - **Validation**: 
     - The delegation status changes to `revoked` with a revocation timestamp.
     - OR the delegation is removed from the active list.
6. Log in as `user-b@gmail.com`.
7. Navigate to the dashboard.
   - **Validation**: `user-a@gmail.com` no longer appears in the "Connected Emails" section.
8. Using the `Multi-Account Agent` key, attempt `GET /gmail/v1/users/user-a@gmail.com/messages`.
   - **Validation**: `403 Forbidden` — delegation is revoked, access denied.
9. Verify that `user-b@gmail.com`'s own email still works with the same key.
   - **Validation**: `GET /gmail/v1/users/user-b@gmail.com/messages` returns success.

**Expected Outcome**: Revoking a delegation immediately cuts off the delegate's access to the owner's email. The delegate's own email access is unaffected. Previously granted key-email-access entries for the revoked delegation are effectively disabled.

---

### 7. Delegation Does Not Grant Dashboard Access
**Objective**: Validate that delegation only grants API/proxy access, not access to manage the owner's dashboard settings.

**Steps**:
1. Log in as `user-b@gmail.com` (the **delegate**).
2. Verify `user-b` **cannot**:
   - See `user-a`'s API keys
   - See `user-a`'s access rules (other than their own rules scoped to `user-a`'s email)
   - Revoke `user-a`'s delegations to other users
   - Modify `user-a`'s account in any way

**Expected Outcome**: Delegation is a data-plane permission only. It does not grant any control-plane (dashboard) access to the owner's settings.

---

### 8. Re-Delegation After Revocation
**Objective**: Validate that an owner can re-delegate to the same user after revoking.

**Steps**:
1. After Test 6 (delegation revoked), log in as `user-a@gmail.com`.
2. Click "Delegate Access" again.
3. Enter `user-b@gmail.com` as the delegate and submit.
   - **Validation**: New delegation created with `active` status.
4. Log in as `user-b@gmail.com`.
   - **Validation**: `user-a@gmail.com` reappears in their Connected Emails section.
5. Re-grant key access to `user-a@gmail.com` on an existing or new key.
6. Verify proxy access works again.

**Expected Outcome**: Re-delegation works cleanly. No orphaned state from the previous revocation.

---

### 9. Multiple Delegations
**Objective**: Validate that a single owner can delegate to multiple users, and a single delegate can receive delegations from multiple owners.

**Steps**:
1. Create a third user: `user-c@gmail.com`.
2. As `user-a@gmail.com`, delegate to both `user-b@gmail.com` and `user-c@gmail.com`.
3. As `user-b@gmail.com`, verify `user-a@gmail.com` appears as delegated.
4. As `user-c@gmail.com`, verify `user-a@gmail.com` appears as delegated.
5. As `user-b@gmail.com`, also have `user-c@gmail.com` delegate to them.
6. Verify `user-b@gmail.com`'s dashboard shows:
   - Own: `user-b@gmail.com`
   - Delegated: `user-a@gmail.com`, `user-c@gmail.com`

**Expected Outcome**: The delegation model supports many-to-many relationships. One owner can delegate to multiple delegates, and one delegate can receive access from multiple owners.

---

### 10. Invalid Delegation Attempts
**Objective**: Validate edge cases in the delegation flow.

**Steps**:
1. As `user-a@gmail.com`, attempt to delegate to themselves (`user-a@gmail.com`).
   - **Validation**: Error — self-delegation is unnecessary (own email access is implicit).
2. As `user-a@gmail.com`, attempt to delegate to a non-existent user email.
   - **Validation**: Error — the delegate must have a Clerk account in our system.
3. As `user-a@gmail.com`, attempt to create a duplicate delegation to `user-b@gmail.com` (already active).
   - **Validation**: Error or no-op — prevent duplicate active delegations.

**Expected Outcome**: The system handles edge cases gracefully with clear error messages.
