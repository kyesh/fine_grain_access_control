# Fine-Grained Access Control (FGAC) Expansion: Google Drive & Google Sheets

Expand the Fine-Grained Access Control (FGAC) paradigm beyond Gmail to natively support **Google Drive** and **Google Sheets** APIs. This includes adding new OAuth scope configurations, extending database schemas and rule action types, adding REST proxy endpoint handlers, creating MCP tools for Drive & Sheets, and updating the dashboard UI and developer documentation.

---

## Architecture & Data Flow Overview

```
Agent (Claude / Custom SDK / REST / MCP)
         │
         ▼
┌────────────────────────────────────────────────────────┐
│               FGAC Proxy / MCP Server                  │
│                                                        │
│  1. Authenticate Proxy Key                             │
│  2. Map target user & email                            │
│  3. Evaluate Access Rules (Gmail | Drive | Sheets)     │
│  4. Retrieve Real OAuth Token via Clerk                │
└────────────────────────┬───────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Gmail API         Drive API        Sheets API
 (gmail.v1.users) (drive.v3.files) (v4.spreadsheets)
```

---

## User Review Required

> [!IMPORTANT]
> **Google OAuth Scope Requirements**:
> Expanding to Drive and Sheets requires adding the following OAuth scopes to your Clerk Dashboard Google Connection settings:
> - **Google Drive**: `https://www.googleapis.com/auth/drive.readonly` and/or `https://www.googleapis.com/auth/drive.file` (or `https://www.googleapis.com/auth/drive`)
> - **Google Sheets**: `https://www.googleapis.com/auth/spreadsheets.readonly` and/or `https://www.googleapis.com/auth/spreadsheets`
> 
> *Note:* Adding restricted scopes will require updating your Google Cloud OAuth consent screen settings and may trigger a Google CASA security re-review if moving to production.

---

## Open Questions

> [!QUESTION]
> **1. Scope Granularities**: Should default OAuth scope requests in Clerk request full Drive/Sheets access (`drive`, `spreadsheets`) or read-only/file-scoped access (`drive.readonly`, `spreadsheets.readonly`)?
>
> **2. Folder Path Resolution**: For Drive rules filtering by folder hierarchy (e.g. "Only allow files in Folder X"), should we resolve folder parent lineages dynamically via Drive API metadata calls on each request, or rely on explicit target folder IDs / file ID patterns?
>
> **3. Sheet Cell Content Redaction vs Block**: For Sheets access rules, should blocked read access reject the whole API call (403 Forbidden), or mask/redact sensitive columns/cells in the returned JSON? (Rejecting with 403 matches the current Gmail payload blocking pattern).

---

## Proposed Changes

### Database & Schema Layer

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Update `accessRules.service` type comments and validator to include `'drive'` and `'sheets'`.
- Expand supported `actionType` values:
  - **Gmail**: `send_whitelist`, `read_blacklist`, `label_whitelist`, `label_blacklist`, `delete_whitelist`
  - **Drive**: `drive_read_blacklist`, `drive_read_whitelist`, `drive_write_blacklist`, `drive_delete_blacklist`, `drive_share_blacklist`, `drive_folder_scope`
  - **Sheets**: `sheets_read_blacklist`, `sheets_read_whitelist`, `sheets_edit_blacklist`, `sheets_export_blacklist`

---

### REST API Proxy Layer

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/proxy/[...path]/route.ts)
- Extend `handleProxyRequest` to handle non-Gmail paths:
  - Match Google Drive paths: `drive/v3/files/...`, `drive/v2/files/...`, `upload/drive/v3/files/...`
  - Match Google Sheets paths: `v4/spreadsheets/...`
- Implement rule evaluation logic for Drive:
  - **Delete blocking**: Intercept `DELETE` requests to `drive/v3/files/{fileId}` or `POST` requests to `files/{fileId}/trash`.
  - **Folder/File Whitelisting & Blacklisting**: Validate target `fileId` or file name regex against active `drive_read_blacklist` / `drive_read_whitelist` rules.
  - **Share Blocking**: Block `POST` requests to `files/{fileId}/permissions` if `drive_share_blacklist` rules apply.
- Implement rule evaluation logic for Sheets:
  - **Spreadsheet/Tab Blacklisting**: Inspect URL parameters and body for `spreadsheetId` and sheet tab names (e.g., `'Salary'!A1:D10`), evaluating against `sheets_read_blacklist` and `sheets_edit_blacklist`.

---

### MCP Server Layer

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/mcp/route.ts)
- Add new helper functions for Google Drive & Sheets APIs: `driveFetch(...)`, `sheetsFetch(...)`.
- Implement new MCP Tools in the tool registry:
  - **Drive Tools**:
    - `drive_list_files`: Search & list Drive files with optional folder filtering.
    - `drive_read_file`: Get file metadata and read text/document contents.
    - `drive_create_file`: Upload/create a document or file in Drive.
    - `drive_delete_file`: Delete or trash a file in Drive.
    - `drive_share_file`: Manage file sharing permissions.
  - **Sheets Tools**:
    - `sheets_get_spreadsheet`: Fetch spreadsheet structure and tab metadata.
    - `sheets_read_range`: Read cell values from a specified tab and range.
    - `sheets_update_range`: Write/update cell values in a range.
    - `sheets_append_rows`: Append data rows to an existing spreadsheet tab.
    - `sheets_create`: Create a new Google Spreadsheet.
- Wire all tools to enforce proxy key permission validation and apply service-specific rules (`drive` and `sheets`) prior to execution.

---

### Dashboard & UI Layer

#### [MODIFY] [RuleControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/RuleControls.tsx)
- Add `<option value="drive">Google Drive</option>` and `<option value="sheets">Google Sheets</option>` to the service selection dropdown.
- Render dynamic rule action types and contextual help text based on the selected service (e.g., Regex for File/Folder ID or Sheet Tab Name).

#### [MODIFY] [EditRuleButton.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/EditRuleButton.tsx)
- Include `drive` and `sheets` options and form fields for rule editing.

#### [MODIFY] [KeyControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/KeyControls.tsx)
- Update code snippet modal and instructions to provide example SDK setup code for Google Drive and Google Sheets in Python (`api_endpoint`) and Node.js (`rootUrl`).

#### [MODIFY] [ConnectGoogleWarning.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/ConnectGoogleWarning.tsx)
- Update scope guidance and warnings to notify users when connecting accounts for Drive and Sheets functionality.

---

### Documentation Layer

#### [MODIFY] [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md)
- Document the expanded multi-service architecture (Gmail, Google Drive, Google Sheets).

#### [MODIFY] [tech_stack.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/tech_stack.md)
- Update technical scope references and token vault examples to cover Drive and Sheets.

#### [MODIFY] [user_guide.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/user_guide.md)
- Add end-user guides on setting up fine-grained rules for Google Drive folders and Google Sheets ranges.

---

## Verification Plan

### Automated Tests
1. **Type Checking & Build Validation**:
   - Run `npm run build` to verify no TypeScript compilation errors exist across new routes, schemas, and components.
2. **Migration & DB Verification**:
   - Validate schema updates and run `npm run db:push` / `npm run db:migrate` against local dev branch.
3. **MCP & Proxy Route Testing**:
   - Run unit and API route tests for proxy routing and rule evaluation on Gmail, Drive, and Sheets endpoints.

### Manual Verification
1. **Dashboard Rule Creation**:
   - Create access rules for Drive (`drive_read_blacklist` for confidential folder IDs) and Sheets (`sheets_edit_blacklist` for Sensitive tab names).
2. **MCP Tool Testing**:
   - Connect MCP client (e.g. Claude Code or OpenClaw) and execute `drive_list_files`, `drive_read_file`, `sheets_read_range`, and `sheets_update_range`.
   - Verify that blocked requests fail with clean `403 Forbidden` errors containing the rule violation explanation.
3. **REST Proxy SDK Integration**:
   - Test standard Google Python SDK (`google-api-python-client`) with `api_endpoint` set to proxy route for Drive (`/drive/v3`) and Sheets (`/v4/spreadsheets`).
