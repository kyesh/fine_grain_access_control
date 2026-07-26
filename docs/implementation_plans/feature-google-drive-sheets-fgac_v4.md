# Fine-Grained Access Control (FGAC) Expansion: Google Sheets via Per-File Scope (`drive.file`) (v4)

Fully flushed-out implementation plan to expand FGAC to **Google Sheets** using Google's **Per-File Access Scope (`https://www.googleapis.com/auth/drive.file`)** and **Google Picker API**. 

This design eliminates the need for expensive CASA Tier 2 security audits ($0 cost, 3-7 day verification), avoids unverified user caps or feature flag restrictions, and provides an **intentional user upgrade flow** with **per-file granular permission management (Read, Read/Write, Block)** directly in the FGAC dashboard.

---

## 1. Architecture & Security Flow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 1. Intentional Upgrade                                 │
│ User clicks "Add Google Sheets" in FGAC Dashboard                                      │
│   │                                                                                    │
│   ▼                                                                                    │
│ Clerk Incremental OAuth: reauthorize({ additionalScopes: ['drive.file'] })            │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               2. Google Picker Modal                                   │
│ Frontend fetches temp picker token from /api/auth/google-picker-token                  │
│ Native Google Picker UI opens -> User picks 1 or more Google Sheets                    │
│   │                                                                                    │
│   ▼                                                                                    │
│ Google grants drive.file scope access ONLY to selected spreadsheet IDs                 │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          3. Per-File Rules & Management                                │
│ FGAC stores access_rules per spreadsheet ID with user-configured permission:           │
│   • Read Only (sheet_read)                                                             │
│   • Read & Write (sheet_read_write)                                                    │
│   • Blocked (sheet_block)                                                              │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         4. Agent Proxy & MCP Execution                                 │
│ Agent calls Proxy/MCP -> FGAC validates proxy key & per-file permission                │
│ FGAC fetches OAuth token from Clerk Vault -> Forwards call to Google Sheets API        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Why Per-File Scope (`drive.file`) is Superior

1. **No CASA Tier 2 Security Audit**: `drive.file` is a Google-recommended narrow scope. It requires standard verification (3–7 days, $0 fee) vs full CASA Tier 2 audit (4–8 weeks, $500–$3,000+).
2. **No Feature Flag or User Cap Needed**: Because `drive.file` is non-restricted, it works smoothly for all production users without unverified app warnings or 100-user caps.
3. **Double-Layer Least Privilege**:
   - **Google OAuth Level**: Google's API *physically restricts* the OAuth token from reading/writing any file the user did not explicitly select in Google Picker.
   - **FGAC Proxy Level**: FGAC Proxy enforces fine-grained Read vs Read/Write vs Block rules per selected file per Proxy Key.

---

## 3. Detailed Component Architecture

### A. Clerk & Google Picker Token Bridge

Because Clerk intentionally keeps raw OAuth access tokens on the backend server for security, we build a lightweight, authenticated bridge for Google Picker:

#### [NEW] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/auth/google-picker-token/route.ts)
- Authenticated Next.js route (`auth()` via Clerk).
- Fetches user's Google OAuth access token via `clerkClient.users.getUserOauthAccessToken(userId, 'oauth_google')`.
- Returns `{ accessToken, clientId }` back to the authenticated dashboard frontend to initialize Google Picker.

---

### B. Google Picker Component & Intentional Upgrade Flow

#### [NEW] [useGooglePicker.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/useGooglePicker.ts)
- React hook to dynamically load Google Picker JS SDK (`https://apis.google.com/js/api.js`).
- Handles checking if user has granted `drive.file` scope via Clerk:
  - If missing: Triggers `user.externalAccounts[0].reauthorize({ additionalScopes: ['https://www.googleapis.com/auth/drive.file'] })`.
  - Once scope is granted: Launches `google.picker.PickerBuilder()` configured for Google Spreadsheets (`google.picker.ViewId.SPREADSHEETS`).
- Supports **Multi-File Selection**: User can select multiple spreadsheets in a single picker session or reopen picker anytime to add more files.
- On file selection (`ACTION_PICKED`), receives document objects:
  ```json
  [
    { "id": "1BxiMVs0...", "name": "Q3 Financials", "mimeType": "application/vnd.google-apps.spreadsheet" }
  ]
  ```
- Submits selected files to FGAC backend route `/api/rules/grant-sheets-access`.

---

### C. Per-File Dashboard Management UI

#### [NEW] [ExposedSheetsManager.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/ExposedSheetsManager.tsx)
- Renders an **"Exposed Google Sheets"** card in the dashboard.
- Displays a table of all spreadsheets added by the user:
  - **File Name & Icon**: e.g., `Q3 Financials` (with Google Sheets icon).
  - **Spreadsheet ID**: Truncated ID with copy button.
  - **Permission Selector (Per File)**:
    - `<select>` dropdown with options:
      - `Read Only` (`sheet_read`): Agent can read cells and metadata. Mutating calls are blocked (403).
      - `Read & Write` (`sheet_read_write`): Agent can read, update, and append rows.
      - `Blocked` (`sheet_block`): Agent access is explicitly denied (403).
  - **Proxy Key Scoping**: Select which proxy keys (e.g. "Claude Agent", "Work Bot") can access this file.
  - **Action**: "Remove / Revoke Access" button (deletes rule).
- Includes **"Add Google Sheet +"** primary button to launch Google Picker.

---

### D. REST Proxy Enforcement

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/proxy/[...path]/route.ts)
- Intercepts paths matching `/v4/spreadsheets/{spreadsheetId}...`.
- Extracts `spreadsheetId`.
- Queries `accessRules` for `service = 'sheets'` and `targetResourceId = spreadsheetId`.
- **Enforcement Rules**:
  - No matching rule -> Return `403 Forbidden` ("Spreadsheet not exposed in FGAC").
  - Rule is `sheet_block` -> Return `403 Forbidden` ("Access to this sheet is blocked").
  - Mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) and rule is `sheet_read` -> Return `403 Forbidden` ("Write permission denied on this spreadsheet").
  - Rule is `sheet_read_write` (or `sheet_read` for `GET`) -> Retrieve Google token from Clerk & proxy request to `https://sheets.googleapis.com`.

---

### E. MCP Server Tools

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/mcp/route.ts)
- Add `sheetsFetch(...)` helper for Sheets REST API.
- Implement Sheets MCP Tools:
  - **`sheets_get_spreadsheet`**: Get sheet names/tabs and structural metadata.
  - **`sheets_read_range`**: Read values from range (e.g. `'Sheet1'!A1:C10`). Allowed for `sheet_read` and `sheet_read_write`.
  - **`sheets_update_range`**: Update values in range. Requires `sheet_read_write`.
  - **`sheets_append_rows`**: Append new data rows. Requires `sheet_read_write`.
- All tools validate proxy key assignment and per-file rules before calling Google API.

---

### F. Database Schema

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Add `targetResourceId` text column to `accessRules` (or utilize `regexPattern` for `spreadsheetId`).
- Add resource metadata columns: `resourceName` (e.g. "Q3 Financials").
- Update supported action types: `'sheet_read'`, `'sheet_read_write'`, `'sheet_block'`.

---

## 4. Verification & Testing Plan

### Automated Verification
1. `npm run build`: Verify TypeScript compilation across new routes, picker hooks, and components.
2. DB Migration: `npm run db:branch` and `npm run db:push` to verify schema updates.

### Manual Acceptance Flow
1. **Scope Upgrade**: Click "Add Google Sheet +" in FGAC dashboard. Verify Clerk triggers scope consent for `https://www.googleapis.com/auth/drive.file`.
2. **Google Picker**: Verify Google Picker modal launches and displays user's Google Sheets. Select 2 spreadsheets.
3. **Per-File Rules UI**:
   - Set Sheet 1 to `Read Only`.
   - Set Sheet 2 to `Read & Write`.
4. **Proxy & MCP Verification**:
   - Call `sheets_read_range` on Sheet 1 -> Succeeds.
   - Call `sheets_update_range` on Sheet 1 -> Fails with `403 Forbidden`.
   - Call `sheets_update_range` on Sheet 2 -> Succeeds.
   - Change Sheet 1 to `Blocked` in dashboard -> Calling `sheets_read_range` on Sheet 1 immediately returns `403 Forbidden`.
