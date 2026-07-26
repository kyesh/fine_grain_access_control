# Fine-Grained Access Control (FGAC) Expansion: Google Sheets (v3)

Expand the Fine-Grained Access Control (FGAC) paradigm to support **Google Sheets**, focusing on backend-controlled user permissions, single-spreadsheet document-level access control (Read vs Read/Write), and clear scope approval pathways.

> [!NOTE]
> Google Drive support has been explicitly removed from this scope to focus purely on Google Sheets.

---

## 1. Google OAuth Policies for Published Apps

### Published App Behavior for New Unapproved Scopes
When an existing **Published App** (already live in production with verified Gmail scopes) requests new, unapproved Google OAuth scopes (such as `spreadsheets` or `drive.file`):

1. **Existing Capabilities Retained**: The app remains fully published and operational for all previously verified scopes (e.g., Gmail). Existing users are not broken or logged out.
2. **Unverified App Warning**: When requesting the new unapproved scope, users will see Google's **"Google hasn't verified this app"** warning screen.
3. **100 Unverified User Cap**: Google enforces a hard cap of **100 total unverified users** for the new scope. Any user (up to 100) can click *"Advanced -> Go to App Name (unsafe)"* to authorize the new scope during beta testing. Once 100 users have authorized the unapproved scope, Google blocks subsequent authorization requests until verification is complete.

---

## 2. Google Verification & Approval Process Comparison

Google categorizes scopes into **Restricted**, **Sensitive**, and **Non-Sensitive**. Below is the exact approval breakdown for the two architecture options:

```
                  ┌─────────────────────────────────────────┐
                  │          Google OAuth Scopes            │
                  └────────────────────┬────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
Option A: Restricted Scope                             Option B: Per-File Scope
https://www.googleapis.com/auth/spreadsheets           https://www.googleapis.com/auth/drive.file
  • CASA Tier 2 Audit ($500-$3,000+)                     • No CASA Audit ($0)
  • 4 to 8 Weeks Verification                            • 3 to 7 Days Verification
  • Access to all Sheets (FGAC filters)                  • Access only to selected Sheet
```

### Detailed Comparison Matrix

| Metric / Requirement | Option A: Full Sheets Scope (`spreadsheets`) | Option B: Per-File Scope (`drive.file`) |
| :--- | :--- | :--- |
| **Google Scope Category** | **Restricted Scope** | **Recommended / Sensitive Scope** |
| **Security Audit (CASA)** | **Required** (CASA Tier 2 independent security lab audit) | **NOT Required** |
| **Verification Timeline** | **4 to 8 Weeks** | **3 to 7 Business Days** |
| **Verification Cost** | **$500 – $3,000+** | **$0** |
| **Unverified Limit** | 100 users total | 100 users total |
| **File Management** | Grants access to all user spreadsheets; **FGAC Proxy** enforces which single `spreadsheetId` an agent can access. | Google OAuth grants access **only to the file(s) selected by the user** in the Google Picker modal. |
| **Read & Write Ability** | **Full Read & Write** across spreadsheets. | **Full Read & Write** on the specific selected file(s). |
| **Clerk Integration** | **Seamless**: Standard `clerkClient.users.getUserOauthAccessToken()` works out of the box. | Requires a backend API endpoint to pass a short-lived token to `gapi.picker.PickerBuilder()`. |
| **User Experience** | User pastes Google Sheet URL/ID into FGAC. | User clicks "Select Sheet" and picks file via Google Picker UI. |

> **Recommendation**:
> - **V1 Alpha / Immediate Testing**: Use **Option A** with manual URL entry for backend-approved test users (up to 100 users under Google's unverified app cap).
> - **Production Scale**: Migrate to **Option B (`drive.file`)** or submit Option A for CASA Tier 2 verification before expanding past 100 users.

---

## 3. Backend User Guarding & Scope Upgrade Mechanics

### Backend Data Guard (No Dashboard UI Needed)
- No user-facing frontend beta toggles or public UI switches will be created.
- Access to the Google Sheets integration is controlled strictly by backend database flags (e.g. `users.can_access_sheets_beta = true` or a backend whitelist).

### Clerk Token Vault & Incremental Scope Upgrades
- **Default Sign-up**: Standard user signup continues requesting **ONLY base Gmail scopes** (`gmail.modify`).
- **Incremental Scope Upgrade**: For backend-enabled test users, when they connect Google Sheets capability, we call Clerk's `account.reauthorize({ additionalScopes: ['https://www.googleapis.com/auth/spreadsheets'] })`.
- **Clerk Architecture**:
  1. Clerk handles the OAuth 2.0 incremental authorization (`include_granted_scopes=true`).
  2. Clerk stores the resulting refresh token in its SOC2-compliant vault.
  3. When an agent calls the FGAC Proxy or MCP server, the backend calls `clerkClient.users.getUserOauthAccessToken(userId, 'oauth_google')` to fetch the valid access token.

---

## 4. Single-Sheet Access Control Model (V1)

For V1, access control is enforced at the **whole spreadsheet level** (by `spreadsheetId`):

### Supported Action Types
1. **`sheet_read`**: Grants **Read-Only** access (`GET /v4/spreadsheets/{spreadsheetId}...`). Mutating calls (`POST`, `PUT`, `PATCH`, `DELETE`) are blocked with `403 Forbidden`.
2. **`sheet_read_write`**: Grants **Read & Write** access (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) to the specified spreadsheet.
3. **`sheet_block`**: Explicitly **Blocks All Access** to the specified spreadsheet.

---

## Proposed Technical Changes

### Database & Schema Layer

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Update `accessRules.service` comments to include `'sheets'`.
- Add Sheets V1 action types: `'sheet_read'`, `'sheet_read_write'`, `'sheet_block'`.
- Target `spreadsheetId` stored in `accessRules.regexPattern`.

---

### REST API Proxy Layer

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/proxy/[...path]/route.ts)
- Add route handler for `/v4/spreadsheets/{spreadsheetId}/...`.
- Extract target `spreadsheetId` from incoming API path.
- Evaluate proxy key rules for `service = 'sheets'`:
  - If no rule matches `spreadsheetId` -> Return `403 Forbidden` ("Spreadsheet not permitted").
  - If rule is `sheet_block` -> Return `403 Forbidden`.
  - If request is mutating (`POST`, `PUT`, `PATCH`, `DELETE`) and rule is `sheet_read` -> Return `403 Forbidden` ("Write access denied").
  - If rule is `sheet_read_write` -> Forward request to `https://sheets.googleapis.com` using Clerk OAuth token.

---

### MCP Server Layer

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/mcp/route.ts)
- Add helper `sheetsFetch(token, path, method, body)`.
- Register Sheets MCP Tools:
  - **`sheets_get_spreadsheet`**: Get metadata and sheet/tab names for an allowed spreadsheet.
  - **`sheets_read_range`**: Read cell values from an allowed spreadsheet.
  - **`sheets_update_range`**: Write/update cell values (requires `sheet_read_write` rule).
  - **`sheets_append_rows`**: Append data rows (requires `sheet_read_write` rule).
- Wire all tools to enforce proxy key permission validation before calling Sheets API.

---

### Documentation Layer

#### [MODIFY] [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md)
- Update strategy documentation to detail Gmail + Google Sheets fine-grained proxying.

---

## Verification Plan

### Automated Tests
1. **Build & Type Check**:
   - Run `npm run build` to verify clean TypeScript compilation.
2. **Database Verification**:
   - Verify schema updates against dev database.

### Manual Verification
1. **Backend User Permission Check**:
   - Enable `can_access_sheets_beta` for a test user in DB.
2. **Single Sheet Rule Validation**:
   - Create a `sheet_read` rule for Proxy Key A on spreadsheet ID `1BxiM...`.
   - Execute `sheets_read_range` via MCP tool -> Verify Success.
   - Execute `sheets_update_range` via MCP tool -> Verify `403 Forbidden` (Read Only restriction enforced).
   - Execute `sheets_read_range` on an unlisted spreadsheet -> Verify `403 Forbidden` (Default Deny enforced).
