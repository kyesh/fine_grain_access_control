# Goal Description

Implement Gmail Label-Based Access Control, allowing users to whitelist or blacklist specific Gmail labels. This fine-grained control ensures that API agents can only read or list emails that comply with the user's label restrictions. Blacklists will take precedence over whitelists.

## User Review Required

No breaking changes expected. This extends the existing `actionType` enumeration conceptually in the application logic.

## Proposed Changes

---
### Database & Schema
#### [MODIFY] src/db/schema.ts
Update comments/types for `actionType` to include `'label_whitelist'` and `'label_blacklist'`.

---
### Frontend Components
#### [MODIFY] src/app/dashboard/RuleControls.tsx
- Add `label_whitelist` and `label_blacklist` to the "Action Type" dropdown options.
- Conditionally render a label selection combobox/dropdown instead of a free-form "Regex Pattern" text input when a label rule type is selected. 

#### [MODIFY] src/app/dashboard/EditRuleButton.tsx
- Add `label_whitelist` and `label_blacklist` to the dropdown options.
- Support selecting/displaying labels when editing these specific rule types.

---
### Backend API & Proxy Logic
#### [NEW] src/app/api/gmail/labels/route.ts
- Create a new authenticated endpoint (using Clerk user tokens) that queries `GET https://www.googleapis.com/gmail/v1/users/me/labels` and returns the available labels so the frontend UI can populate the label dropdown.

#### [MODIFY] src/app/api/proxy/[...path]/route.ts
- **Read Requests (`/messages/{id}`)**: Parse the JSON response from Google, extract `labelIds`, and evaluate them against active `label_whitelist` and `label_blacklist` rules. Block access if a blacklist matches or a whitelist fails.
- **List Requests (`/messages`)**: When forwarding the list query to Google, dynamically append `-label:blacklisted_label_name` or `label:whitelisted_label_name` to the user's `q` parameter to ensure restricted emails are never returned in the list response.

## Verification Plan

### Automated Tests
- Run the web server and verify the new `/api/gmail/labels` endpoint successfully returns the user's Gmail labels.

### Manual Verification
Follow the steps outlined in `docs/QA_Acceptance_Test/05_gmail_label_based_access.md`:
1. **Label Search and Selection**: Verify the UI displays valid Gmail labels when creating a rule.
2. **Whitelist Enforcement**: Set a Label Whitelist and attempt to read an allowed vs. blocked email using a mock proxy script.
3. **Blacklist Enforcement**: Set a Label Blacklist and attempt to read an allowed vs. blocked email.
4. **Precedence**: Combine a whitelist and blacklist rule and verify the blacklist wins.
5. **List Filtering**: Query the `/messages` list proxy endpoint and verify blacklisted labels are omitted from the results.
