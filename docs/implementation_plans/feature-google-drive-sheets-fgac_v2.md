# Fine-Grained Access Control (FGAC) Expansion: Google Drive & Sheets (v2)

Expand the Fine-Grained Access Control (FGAC) paradigm to support **Google Drive** and **Google Sheets**, focusing on a **guarded, incremental opt-in flow for beta test users** and **single-spreadsheet document-level access control (Read vs Read/Write)** for V1.

---

## 1. Google OAuth Policies & Guarding Strategy

### Google OAuth Verification & 100 Test User Policy
- **Testing Status & Test Users**: In Google Cloud Console, any OAuth client in "Testing" mode allows up to **100 designated test user emails**.
- **Scope Expansion Behavior**: When adding new restricted/sensitive scopes (`spreadsheets`, `drive.readonly`) to an existing OAuth app:
  - Users listed on the **100 Test Users** list can grant the new scopes by acknowledging the standard Google "Unverified App" warning.
  - General users outside the test list will be blocked by Google until formal CASA Tier 2 / OAuth verification is completed.

### Feature Flagging & Selective Scope Requesting
To protect general users from seeing unverified scope prompts or breaking existing Gmail functionality:
1. **Default Scope Isolation**: General sign-up and login via Clerk will continue requesting **ONLY base Gmail scopes** (`gmail.modify`). No Drive or Sheets scopes are requested during standard user onboarding.
2. **Dashboard Beta Guard**: Introduce a **"Google Drive & Sheets Integration (Beta)"** toggle / section in the dashboard UI.
3. **Incremental Scope Upgrade Flow**: Only when an authorized user clicks **"Opt-in to Google Sheets Access"**, we trigger Clerk's incremental reauthorization flow:
   ```ts
   await existingGoogleAccount.reauthorize({
     additionalScopes: [
       'https://www.googleapis.com/auth/spreadsheets',
       'https://www.googleapis.com/auth/drive.readonly'
     ],
     redirectUrl: window.location.href,
     oidcPrompt: 'consent'
   });
   ```
4. **Backend Scope Detection**: Before executing Drive or Sheets proxy/MCP calls, the backend checks if the stored token contains the required scopes. If missing, it returns a clean prompt instructing the user to enable the beta integration in their dashboard.

---

## 2. Document Access Control Model: Single Sheet Exposure (V1)

### Comparison: Manual Spreadsheet ID Entry vs Google Picker API (`drive.file` scope)

| Metric / Dimension | Option A: Manual Entry of Spreadsheet ID / URL (Selected for V1) | Option B: Google Picker API with `drive.file` Scope |
| :--- | :--- | :--- |
| **How it Works** | User pastes Google Sheet URL or ID (e.g., `https://docs.google.com/spreadsheets/d/1BxiM.../edit`) into the FGAC rule creator. System extracts `spreadsheetId` (`1BxiM...`). | User clicks "Select Sheet", Google Picker iframe pops up in browser. User picks 1 file. Token gets `drive.file` scope. |
| **OAuth Scope Required** | Requires `spreadsheets` or `spreadsheets.readonly` scope on user's token. | Requires `https://www.googleapis.com/auth/drive.file` scope. |
| **Enforcement Mechanism** | **FGAC Proxy Enforcement**: Proxy inspects every API call and rejects requests if `spreadsheetId` != an authorized `spreadsheetId` in `access_rules`. | **Google OAuth + FGAC Proxy**: Dual enforcement at Google token level and FGAC proxy level. |
| **UX & Ergonomics** | Copy-paste Sheet URL/ID from browser bar (extremely simple and explicit). | Native file chooser popup modal. |
| **Clerk Integration** | **100% Native & Seamless**: Token fetched via standard `clerkClient.users.getUserOauthAccessToken()`. | Requires passing raw OAuth access token directly into frontend JS (`gapi.load('picker')`), requiring a custom endpoint to expose token to UI. |
| **Implementation Risk** | **Zero Risk**: Standard React text input + URL parser. | **Moderate**: External Google Picker SDK dependency and cross-origin iframe handling. |

> **Decision for V1**: Use **Option A (Manual Entry with URL Auto-Parsing)**. It integrates seamlessly with Clerk, provides complete auditability in FGAC, and eliminates frontend SDK dependencies.

---

## 3. Simplified V1 Rule Architecture (Read vs Read & Write)

Rather than implementing complex protected cells or range-level redaction in V1, the system will enforce **whole-document access control** per Google Spreadsheet ID:

### Supported Rule Action Types for Sheets (V1)
1. **`sheet_read`**: Allow **Read-Only** access (`GET` requests / read tools) to the specified Spreadsheet ID (`1BxiM...`). Block all `POST`, `PUT`, `PATCH`, `DELETE` operations.
2. **`sheet_read_write`**: Allow **Read & Write** access (`GET`, `POST`, `PUT`, `PATCH`) to the specified Spreadsheet ID.
3. **`sheet_block`**: Explicitly **Block All Access** to the specified Spreadsheet ID.

---

## Proposed Changes

### Database & Schema Layer

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Update `accessRules.service` type definitions to include `'sheets'` (and `'drive'`).
- Add V1 Sheets action types: `'sheet_read'`, `'sheet_read_write'`, `'sheet_block'`.
- Store the target `spreadsheetId` in `accessRules.regexPattern` (or `targetResourceId`).

---

### Dashboard & UI Layer

#### [NEW] [BetaFeatureToggle.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/BetaFeatureToggle.tsx)
- Component rendering the "Google Drive & Sheets Integration (Beta)" card for test users.
- Connects to Clerk's `account.reauthorize({ additionalScopes: [...] })` flow to request incremental scopes dynamically on user request.

#### [MODIFY] [RuleControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/RuleControls.tsx)
- Add "Google Sheets" option to service selector dropdown when beta feature is enabled.
- Add input field for Spreadsheet URL/ID with auto-extraction logic (e.g., parsing `https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit`).
- Radio toggle for rule type: **Read Only** vs **Read & Write** vs **Block Access**.

#### [MODIFY] [EditRuleButton.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/EditRuleButton.tsx)
- Support editing existing single-sheet access rules.

#### [MODIFY] [KeyControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/KeyControls.tsx)
- Update code snippet modal with example Google Sheets API proxy calls in Python and Node.js using `rootUrl: 'https://sheets.fgac.ai/'`.

---

### REST API Proxy Layer

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/proxy/[...path]/route.ts)
- Add route matcher for Google Sheets REST API endpoints (`/v4/spreadsheets/{spreadsheetId}/...`).
- Extract target `spreadsheetId` from API path.
- Evaluate proxy key rules for `service = 'sheets'`:
  - If no rule matches `spreadsheetId` -> Return `403 Forbidden` ("Spreadsheet not exposed via FGAC rules").
  - If rule is `sheet_block` -> Return `403 Forbidden`.
  - If request method is mutating (`POST`, `PUT`, `PATCH`, `DELETE`) and rule is `sheet_read` -> Return `403 Forbidden` ("Write access denied on this spreadsheet").
  - If rule is `sheet_read_write` -> Allow request and forward with Clerk Google OAuth token.

---

### MCP Server Layer

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/mcp/route.ts)
- Add `sheetsFetch(...)` helper function hitting `https://sheets.googleapis.com/v4/spreadsheets/...`.
- Implement initial Sheets MCP Tools:
  - **`sheets_get_spreadsheet`**: Get metadata and sheet/tab names for an allowed spreadsheet.
  - **`sheets_read_range`**: Read values from a specific range in an allowed spreadsheet.
  - **`sheets_update_range`**: Write/update values in a range (requires `sheet_read_write` rule).
  - **`sheets_append_rows`**: Append rows to a table (requires `sheet_read_write` rule).
- Wire all tools to enforce `sheet_read` vs `sheet_read_write` permissions prior to executing API calls.

---

## Verification Plan

### Automated Tests
1. **Build & Type Check**:
   - Run `npm run build` to verify no TypeScript compilation errors exist.
2. **Schema & Migration Safety**:
   - Run `npm run db:branch` and `npm run db:push` to test DB migration cleanly.

### Manual Verification
1. **Incremental Scope Upgrade Test**:
   - Sign in as a test user. Verify default login asks ONLY for Gmail scopes.
   - Click "Opt-in to Google Sheets Integration (Beta)" in dashboard. Verify Clerk triggers reauthorization modal for `spreadsheets` scope.
2. **Single Sheet Rule Creation**:
   - Paste a Google Sheet URL into the rule creator. Verify system auto-extracts `spreadsheetId`.
   - Create a `sheet_read` (Read Only) rule for Proxy Key A.
3. **MCP Tool Testing**:
   - Call `sheets_read_range` with Proxy Key A on the allowed spreadsheet -> Succeeds.
   - Call `sheets_update_range` with Proxy Key A on the allowed spreadsheet -> Fails with `403 Forbidden` (Read Only restriction enforced).
   - Call `sheets_read_range` on an unlisted spreadsheet -> Fails with `403 Forbidden` (Default Deny enforced).
