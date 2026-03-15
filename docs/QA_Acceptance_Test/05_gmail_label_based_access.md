# QA Acceptance Test: Gmail Label-Based Access Control

## Prerequisites
- A testing environment with the proxy active.
- A test user account successfully created, with Google OAuth Gmail scopes granted.
- The user has obtained their proxy credentials.
- A mock AI agent script (e.g., a simple Python or Node script) configured to make calls using the user's proxy credentials.
- Several emails in the user's Gmail inbox with specific labels (e.g., "AI-Allowed", "Highly-Confidential").

## Dependencies
- Must pass `01_signup_and_credential_workflow.md` first to ensure credentials and the Web UI are functioning.

---

## Test Cases

### 1. Whitelisting Labels (Read Access)
**Objective**: Validate that if specific labels are whitelisted, the agent can only read emails that possess those labels.

**Steps**:
1. In the Web UI, navigate to Gmail Access Controls -> Reading Permissions.
2. Add a **Label Whitelist** rule for the label `AI-Allowed`.
3. Run the AI agent script to query/read an email that has the `AI-Allowed` label.
   - **Validation**: Ensure the proxy passes the request and the email is read successfully.
4. Run the AI agent script to query/read an email that does NOT have the `AI-Allowed` label (e.g., no labels, or a different label like `Personal`).
   - **Validation**: Ensure the proxy intercepts and blocks the request.
   - **Validation**: Ensure the API returns a clear error message specifically stating: *"Access restricted: Email lacks the required whitelisted label 'AI-Allowed'."* (or similarly worded error).

### 2. Blacklisting Labels (Read Access)
**Objective**: Validate that if specific labels are blacklisted, the agent is strictly prevented from reading emails with those labels, even if no whitelist is active.

**Steps**:
1. In the Web UI, navigate to Gmail Access Controls -> Reading Permissions.
2. Ensure there are no active Label Whitelist rules.
3. Add a **Label Blacklist** rule for the label `Highly-Confidential`.
4. Run the AI agent script to query/read an email that has the `Highly-Confidential` label.
   - **Validation**: The proxy blocks the request and returns an error clearly stating the rejection reason (e.g., *"Access restricted: Email contains blacklisted label 'Highly-Confidential'."*).
5. Run the AI agent script to read an email that does NOT have the `Highly-Confidential` label.
   - **Validation**: The proxy allows the request to pass to Google, successfully reading the email.

### 3. Conflict Resolution (Whitelist vs. Blacklist)
**Objective**: Validate the behavior when an email contains both a whitelisted label and a blacklisted label. The system should prioritize blacklists and block access.

**Steps**:
1. In the Web UI, navigate to Gmail Access Controls -> Reading Permissions.
2. Add a **Label Whitelist** rule for `AI-Allowed`.
3. Add a **Label Blacklist** rule for `Highly-Confidential`.
4. Ensure the user's inbox contains an email that has BOTH the `AI-Allowed` and `Highly-Confidential` labels.
5. Run the AI agent script and attempt to read this particular email.
   - **Validation**: The proxy intercepts and blocks the request.
   - **Validation**: The returned error should reference the blacklist rule taking precedence (e.g., *"Access restricted: Email contains blacklisted label 'Highly-Confidential'."*).

### 4. Label Filtering in List Responses
**Objective**: Validate that when list queries (e.g., listing the inbox) are made, emails with blacklisted labels are omitted from the results or the user is warned. If filtering is applied at the query level, ensure only permissible emails are returned.

**Steps**:
1. In the Web UI, configure a **Label Blacklist** rule for `Highly-Confidential`.
2. Run the AI agent script to fetch a list of recent emails (e.g., `maxResults=10`).
3. **Validation**: Inspect the returned list of message IDs/snippets. Ensure that no emails with the `Highly-Confidential` label are included in the agent's view, or that attempts to read them subsequently fail correctly. 
