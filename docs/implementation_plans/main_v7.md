# Clean Up GCP Oauth Scopes

This plan removes all mentions and UI options for `drive` and `calendar` scopes to simplify the application for GCP OAuth security review. Since OAuth scopes are handled natively by Clerk and there is no direct OAuth configuration in the codebase, the changes are limited to the UI components, database schema comments, and documentation.

## User Review Required

> [!IMPORTANT]
> **Clerk Configuration**: Please verify in your Clerk Dashboard that your Google OAuth configuration only requests relevant `gmail` scopes (e.g., `https://www.googleapis.com/auth/gmail.modify` or `https://www.googleapis.com/auth/gmail.readonly`) and that `drive` and `calendar` scopes have been explicitly removed from the provider settings.

## Proposed Changes

### UI Components
The options for `drive` and `calendar` will be removed from the service selection dropdowns.

#### [MODIFY] [RuleControls.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/RuleControls.tsx)
Remove `<option value="drive">` and `<option value="calendar">`.

#### [MODIFY] [EditRuleButton.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/EditRuleButton.tsx)
Remove `<option value="drive">` and `<option value="calendar">`.

***
### Database Schema
Update comments referencing unused services.

#### [MODIFY] [schema.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/db/schema.ts)
Change `// 'gmail', 'drive', 'calendar'` to `// 'gmail'`.

***
### Documentation
Update documentation to remove mentions of Drive and Calendar scopes.

#### [MODIFY] [tech_stack.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/tech_stack.md)
Update the example scope from `https://www.googleapis.com/auth/drive` to a relevant Gmail scope and update language to reflect only Gmail.

#### [MODIFY] [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md)
Remove references to Drive and Calendar scopes in the problem statement and constraints. Update examples to focus strictly on Gmail API.

## Verification Plan

### Automated Tests
Run `npm run build` to ensure there are no TypeScript type errors or build failures after modifying the UI components and schema files.

### Manual Verification
1. Ask the developer to open the local application using `npm run dev` and navigate to the dashboard.
2. Click "Create Custom Rule" and verify that the "Service" dropdown only contains "Gmail".
3. Check the Clerk Dashboard to ensure only Gmail scopes are requested.
