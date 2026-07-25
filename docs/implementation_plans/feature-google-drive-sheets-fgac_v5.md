# Fine-Grained Access Control (FGAC) Expansion: Google Sheets via Per-File Scope (`drive.file`) (v5)

Fully flushed-out implementation plan to expand FGAC to **Google Sheets** using Google's **Per-File Access Scope (`https://www.googleapis.com/auth/drive.file`)**, **Google Picker API**, and **Clerk Token Vault**.

---

## 1. Token Vault Architecture & Persistence Mechanics

### Where are Access Tokens & Scopes Persisted?
**Zero Token Liability**: The FGAC application and Neon Postgres database **NEVER** store raw Google OAuth Access Tokens or Refresh Tokens. All OAuth credentials and granted scopes are persisted exclusively in **Clerk's SOC2-compliant Token Vault**.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Token Storage & Refresh Flow                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────┘

1. Scope Reauthorization Prompt
   Frontend triggers: externalAccount.reauthorize({ additionalScopes: ['drive.file'] })
      │
      ▼
2. Google OAuth 2.0 Authorization Endpoint
   User grants drive.file scope in Google's Consent Screen
      │
      ▼
3. Clerk OAuth Callback Server (https://<clerk-domain>/v1/oauth/callback)
   Google redirects authorization code to Clerk.
   Clerk's backend server exchanges code with Google for new Access Token & Refresh Token.
      │
      ▼
4. Clerk Encrypted Token Vault (SOC2 Audited Infrastructure)
   Clerk automatically updates the user's external_account record.
   The new Refresh Token (containing gmail.modify + drive.file scopes) is persisted in Clerk.
   Browser receives redirect back to FGAC Dashboard.
      │
      ▼
5. File Selection in Google Picker
   User selects Spreadsheet 1BxiM... in Google Picker.
   Google's OAuth Servers register 1BxiM... under the user's drive.file grant.
   FGAC saves ONLY metadata (spreadsheetId, name, permission level) in Neon Postgres access_rules.
      │
      ▼
6. Proxy Request Execution
   Agent calls FGAC REST Proxy / MCP Server -> FGAC validates proxy key.
   FGAC queries Clerk Backend SDK: clerkClient.users.getUserOauthAccessToken(userId, 'oauth_google')
   Clerk retrieves fresh token from Vault -> FGAC forwards to https://sheets.googleapis.com.
```

### Detailed Token Lifecycle Summary

| Lifecycle Phase | Handled By | Storage Location | Data Stored |
| :--- | :--- | :--- | :--- |
| **OAuth Scope Upgrade** | Clerk OAuth Redirect Handler | Clerk Token Vault | Google Refresh Token with `gmail.modify` + `drive.file` scopes |
| **Token Expiration / Refresh**| Clerk Backend SDK | Clerk Infrastructure | Automatic token exchange with `oauth2.googleapis.com/token` |
| **File Selection Grant** | Google OAuth Servers | Google Authorization Server | File ID permission binding (`1BxiM...`) |
| **FGAC Access Rules** | FGAC Backend API | Neon Postgres DB (`access_rules`) | `spreadsheetId`, `resourceName`, `permission` (`sheet_read` / `sheet_read_write`), `proxyKeyId` |

---

## 2. Complete Integration Architecture

### A. Intentional Scope Upgrade Flow

#### [NEW] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/auth/google-picker-token/route.ts)
- Authenticated Next.js route (`auth()` via Clerk).
- Fetches the user's fresh Google OAuth access token from Clerk's Vault using `clerkClient.users.getUserOauthAccessToken(userId, 'oauth_google')`.
- Returns `{ accessToken, clientId }` back to the frontend to initialize the Google Picker modal.

#### [NEW] [useGooglePicker.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/useGooglePicker.ts)
- Custom React hook managing Google Picker initialization and scope checking.
- Step 1: Checks if user's Clerk account has granted `drive.file` scope.
- Step 2: If missing, calls `existingGoogleAccount.reauthorize({ additionalScopes: ['https://www.googleapis.com/auth/drive.file'] })`.
- Step 3: Once Clerk completes reauthorization and returns to the dashboard, hook fetches temporary token from `/api/auth/google-picker-token` and launches `google.picker.PickerBuilder()`.
- Step 4: User selects 1 or more Google Sheets in Picker.
- Step 5: Hook posts selected spreadsheet metadata (`id`, `name`) to FGAC backend route `/api/rules/grant-sheets-access`.

---

### B. FGAC Database Schema Updates

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Add `targetResourceId` text column to `accessRules` for storing Google `spreadsheetId`.
- Add `resourceName` text column to `accessRules` for storing human-readable document titles (e.g., "Q3 Financials").
- Update supported action types: `'sheet_read'`, `'sheet_read_write'`, `'sheet_block'`.

---

### C. Per-File Dashboard Management UI

#### [NEW] [ExposedSheetsManager.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/ExposedSheetsManager.tsx)
- Dashboard component rendering the **"Exposed Google Sheets"** manager.
- Displays table of all exposed spreadsheets:
  - Document Title & Google Sheets Icon.
  - Spreadsheet ID (truncated).
  - **Permission Selector**:
    - `Read Only` (`sheet_read`): Read cells (`GET`), block mutating calls (403).
    - `Read & Write` (`sheet_read_write`): Read, update cells, and append rows.
    - `Blocked` (`sheet_block`): Block all access (403).
  - **Proxy Key Mapping**: Select which proxy keys can access this sheet.
  - **Remove / Revoke Access**: Deletes rule from FGAC.
- Includes **"Add Google Sheet +"** primary button to launch Google Picker.

---

### D. REST Proxy Enforcement Engine

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/proxy/[...path]/route.ts)
- Intercepts requests to `/v4/spreadsheets/{spreadsheetId}...`.
- Extracts `spreadsheetId`.
- Evaluates rules in `accessRules` for matching `targetResourceId`:
  - No rule found -> Return `403 Forbidden` ("Spreadsheet not exposed in FGAC").
  - Rule is `sheet_block` -> Return `403 Forbidden`.
  - Mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) with `sheet_read` rule -> Return `403 Forbidden`.
  - Allowed -> Fetch real token from Clerk Vault via `getUserOauthAccessToken()` and forward request to `https://sheets.googleapis.com`.

---

### E. MCP Server Integration

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/mcp/route.ts)
- Implement `sheetsFetch(token, path, method, body)`.
- Register Sheets MCP Tools:
  - **`sheets_get_spreadsheet`**: Get tab names and structure.
  - **`sheets_read_range`**: Read values from range.
  - **`sheets_update_range`**: Update values in range (requires `sheet_read_write`).
  - **`sheets_append_rows`**: Append rows (requires `sheet_read_write`).
- Enforce proxy key permissions and per-file rules before execution.

---

## 3. Verification & Testing Plan

### Automated Verification
1. `npm run build`: Type-check Next.js API routes and components.
2. DB Migration: Run `npm run db:branch` and `npm run db:push` on local dev branch.

### Manual Acceptance Flow
1. **Scope Reauthorization**: Click "Add Google Sheet +" -> Verify Clerk reauthorize flow redirects to Google consent screen for `drive.file`.
2. **Token Vault Storage**: Verify Google returns to Clerk callback, and Clerk updates stored tokens in vault.
3. **Google Picker Selection**: Select 2 Google Sheets. Verify FGAC creates `access_rules` with spreadsheet IDs and titles.
4. **Per-File Rules UI**: Set Sheet 1 to `Read Only` and Sheet 2 to `Read & Write`.
5. **Proxy & MCP Enforcement**:
   - Call `sheets_read_range` on Sheet 1 -> Succeeds.
   - Call `sheets_update_range` on Sheet 1 -> Returns `403 Forbidden`.
   - Call `sheets_update_range` on Sheet 2 -> Succeeds.
