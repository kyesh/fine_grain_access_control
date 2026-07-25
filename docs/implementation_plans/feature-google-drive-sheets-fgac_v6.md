# Fine-Grained Access Control (FGAC) Expansion: Google Sheets via Per-File Scope (`drive.file`) (v6)

Deep-dive implementation plan detailing the exact two-phase mechanics of **OAuth Scope Upgrade (Clerk Token Vault)** vs **Per-File Selection Permission Binding (Google Authorization Servers)**.

---

## 1. Deep Dive: Token & Scope Persistence Mechanics

To answer the core question of **where tokens and scopes are stored when selecting files**:

> **The Short Answer**:
> Your intuition is **100% correct!** We do **NOT** need to send a new token to Clerk after the user selects a file in Google Picker.
> 
> When a user selects a sheet in Google Picker, **Google's servers directly update the permission grant for the existing OAuth token in Google's database.** Clerk already holds the `drive.file` Refresh Token in its vault from the initial scope authorization step.

---

### The Two Distinct Phases of `drive.file` Access

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: OAuth Scope Authorization (Handled & Persisted by Clerk)                                │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘

1. User clicks "Add Google Sheet +" in FGAC Dashboard.
2. Frontend calls Clerk SDK: user.externalAccounts[0].reauthorize({ additionalScopes: ['drive.file'] })
3. User approves drive.file scope in Google's Consent Screen.
4. Google redirects authorization code to Clerk Callback Server (https://<clerk-domain>/v1/oauth/callback).
5. Clerk Backend exchanges code with Google for a Refresh Token containing `gmail.modify` + `drive.file`.
6. CLERK PERSISTS THIS REFRESH TOKEN IN CLERK'S ENCRYPTED TOKEN VAULT.

Result of Phase 1: Clerk holds an active Refresh Token authorized for `drive.file`.
At this exact moment, the token does NOT yet have access to any specific file.

┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Per-File Selection in Google Picker (Handled & Persisted by Google Servers)             │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘

1. Frontend opens Google Picker modal using a short-lived access token derived from Clerk.
2. User selects "Q3 Financials" (Spreadsheet ID: 1BxiMVs0...).
3. Google Picker (running inside Google's official iframe) notifies Google's Backend API:
   "User X has explicitly granted App Y (Client ID) access to File ID 1BxiMVs0..."
4. GOOGLE'S OAUTH AUTHORIZATION SERVERS BIND FILE ID 1BxiMVs0... TO THE APP'S SCOPE GRANT IN GOOGLE'S DATABASE.
5. NO NEW TOKEN OR SCOPE PAYLOAD IS SENT TO CLERK! Clerk's existing Refresh Token from Phase 1 is NOW
   capable of fetching access tokens that can read/write Spreadsheet 1BxiMVs0...
6. Frontend posts ONLY metadata ({ spreadsheetId: "1BxiMVs0...", name: "Q3 Financials" }) to FGAC backend
   to save in Neon Postgres access_rules table.

Result of Phase 2: Google's API Gateway will now accept API calls targeting 1BxiMVs0... when signed by
the user's access token fetched from Clerk!
```

---

### Detailed Comparison: What Gets Persisted Where?

| Component | Responsible Party | Where It Is Saved | Exact Data Saved |
| :--- | :--- | :--- | :--- |
| **OAuth Refresh Token & Scope** | Clerk Vault | Clerk Infrastructure (SOC2 Audited) | Encrypted Google Refresh Token granted with `gmail.modify` and `https://www.googleapis.com/auth/drive.file`. |
| **File-Level Access Binding** | Google Cloud OAuth Infrastructure | Google Authorization Database | Permission entry linking `(User ID, Client ID, File ID: 1BxiMVs0...)`. |
| **FGAC Policy & Key Rules** | FGAC Backend App | Neon Postgres Database (`access_rules`) | `spreadsheetId: "1BxiMVs0..."`, `resourceName: "Q3 Financials"`, `permission: "sheet_read"`, `proxyKeyId`. |

---

## 2. Complete Component Specifications

### A. Token Bridge Endpoint for Picker Initialization

#### [NEW] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/auth/google-picker-token/route.ts)
- Authenticated Next.js route (`auth()` via Clerk).
- Fetches the user's fresh Google OAuth access token from Clerk's Vault via `clerkClient.users.getUserOauthAccessToken(userId, 'oauth_google')`.
- Returns `{ accessToken, clientId }` to the frontend strictly for initializing `gapi.picker.PickerBuilder()`.

---

### B. Google Picker Hook & Step-by-step Flow

#### [NEW] [useGooglePicker.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/useGooglePicker.ts)
- React hook to orchestrate Phase 1 (Clerk Reauthorization) and Phase 2 (Google Picker Launch):
  1. **Check Scope**: Checks if the user's Clerk account has `drive.file` in its scopes.
  2. **Phase 1 Trigger**: If missing, triggers `externalAccount.reauthorize({ additionalScopes: ['https://www.googleapis.com/auth/drive.file'] })`. User grants scope -> Clerk receives & saves new token in Vault.
  3. **Phase 2 Trigger**: Once scope is present, hook fetches temporary token from `/api/auth/google-picker-token` and opens Google Picker modal.
  4. **File Selection**: User selects 1 or more Google Sheets. Google's servers register the file IDs automatically under the `drive.file` grant.
  5. **Rule Persistence**: Hook receives selected document metadata (`id`, `name`) and posts to FGAC backend route `/api/rules/grant-sheets-access`.

---

### C. FGAC Database Schema

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
- Add `targetResourceId` text column to `accessRules` to store `spreadsheetId`.
- Add `resourceName` text column to `accessRules` to store human-readable file title.
- Update supported action types: `'sheet_read'`, `'sheet_read_write'`, `'sheet_block'`.

---

### D. Per-File Dashboard Management UI

#### [NEW] [ExposedSheetsManager.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/ExposedSheetsManager.tsx)
- Renders **"Exposed Google Sheets"** manager in the dashboard.
- Displays table of all exposed spreadsheets:
  - File Title & Google Sheets Icon.
  - Truncated Spreadsheet ID with copy button.
  - **Permission Selector**:
    - `Read Only` (`sheet_read`): Read cells (`GET`), block mutating calls (403).
    - `Read & Write` (`sheet_read_write`): Read, update cells, and append rows.
    - `Blocked` (`sheet_block`): Block all access (403).
  - **Proxy Key Mapping**: Select which proxy keys can access this sheet.
  - **Remove / Revoke Access**: Deletes rule from FGAC.
- Includes **"Add Google Sheet +"** primary button to launch Google Picker.

---

### E. REST Proxy Enforcement Engine

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/proxy/[...path]/route.ts)
- Intercepts requests to `/v4/spreadsheets/{spreadsheetId}...`.
- Extracts `spreadsheetId`.
- Evaluates rules in `accessRules` for matching `targetResourceId`:
  - No rule found -> Return `403 Forbidden` ("Spreadsheet not exposed in FGAC").
  - Rule is `sheet_block` -> Return `403 Forbidden`.
  - Mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) with `sheet_read` rule -> Return `403 Forbidden`.
  - Allowed -> Fetch real token from Clerk Vault via `getUserOauthAccessToken()` and forward request to `https://sheets.googleapis.com`.

---

### F. MCP Server Integration

#### [MODIFY] [route.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/api/mcp/route.ts)
- Implement `sheetsFetch(token, path, method, body)`.
- Register Sheets MCP Tools: `sheets_get_spreadsheet`, `sheets_read_range`, `sheets_update_range`, `sheets_append_rows`.
- Enforce proxy key permissions and per-file rules before execution.

---

## 3. Verification & Testing Plan

### Automated Verification
1. `npm run build`: Type-check Next.js API routes and components.
2. DB Migration: Run `npm run db:branch` and `npm run db:push` on local dev branch.

### Manual Acceptance Flow
1. **Scope Reauthorization (Phase 1)**: Click "Add Google Sheet +" -> Verify Clerk reauthorize flow redirects to Google consent screen for `drive.file`. Verify Clerk updates stored token in vault.
2. **Google Picker Selection (Phase 2)**: Select 2 Google Sheets in Google Picker. Verify Google registers permission for those file IDs and FGAC creates `access_rules`.
3. **Per-File Rules UI**: Set Sheet 1 to `Read Only` and Sheet 2 to `Read & Write`.
4. **Proxy & MCP Enforcement**:
   - Call `sheets_read_range` on Sheet 1 -> Succeeds.
   - Call `sheets_update_range` on Sheet 1 -> Returns `403 Forbidden`.
   - Call `sheets_update_range` on Sheet 2 -> Succeeds.
