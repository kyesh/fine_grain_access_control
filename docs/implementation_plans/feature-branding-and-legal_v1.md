# Implementation Plan: Branding, Legal, and Licensing Refactor

## Goal Description
The objective is to overhaul the application to align perfectly with the "FGAC.ai" (Fine Grain Access Control) brand, enforce a consistent single-mode design (Light Mode) for simplicity, strengthen the legal Terms of Service to fiercely limit liability, establish a custom Personal-Use-Only License, and update the GitHub README to reflect the actual project rather than the default Next.js boilerplate. 

All of this must maintain our primary goal: **passing the Google Verification process for restricted scopes**.

## User Review Required
> [!IMPORTANT]
> - **Brand Identity**: We are shifting all references of generic "SecureAgent" to **FGAC.ai** (Fine Grain Access Control). 
> - **Design Strategy**: We will enforce a strict, premium **Light Mode** design system. By not supporting Dark Mode, our AI-generated code will remain simpler and more consistent, reducing UI bugs.
> - **Legal Document Updates**: We are severely restricting liability in the Terms of Service, adding explicit indemnification, and stating the software is provided strictly "as-is".
> - **Custom Licensing**: We are introducing a highly restrictive custom license targeting individual users only.
> - **Custom Favicon**: We will generate a logo/favicon design concept.

## Proposed Changes

### 1. Branding and UI Refactor
---
#### [MODIFY] [layout.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/layout.tsx)
- Replace "SecureAgent" references with "FGAC.ai".
- Hardcode light mode text/background colors to ensure no dark-mode bleed from OS settings (e.g., ensure `text-slate-900` and `bg-slate-50` exist on the `body` tag and remove any implicit dark-mode tailwind classes).

#### [MODIFY] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/page.tsx)
- Update copy to reference "FGAC.ai" and "Fine Grain Access Control".

#### [MODIFY] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/terms/page.tsx)
#### [MODIFY] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/privacy/page.tsx)
- Update "SecureAgent" to "FGAC.ai" in both policies.

### 2. Legal Protections (Terms of Service)
---
#### [MODIFY] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/terms/page.tsx)
- **Strengthen Limitation of Liability**: Explicitly state that under no circumstances is FGAC.ai liable for damages, data loss, API quota overages, or unauthorized agent actions.
- **Add Indemnification Clause**: Users agree to defend, indemnify, and hold harmless FGAC.ai against any claims or legal actions resulting from their AI agents violating any terms or laws.
- **Maintain Google Verification**: Ensure the "Limited Use" policy references are maintained.

### 3. Open Source Licensing
---
#### [NEW] [docs/LICENSE.md](file:///home/kyesh/GitRepos/fine_grain_access_control/LICENSE)
- Create a custom license file.
- **Permitted Use**: Independent individuals managing their own personal Gmail accounts.
- **Restricted Use**: Explicitly prohibit usage by corporations, corporate employees acting on company behalf, or universities/students. Require reaching out for Enterprise/Education licenses.
- State absolutely no warranty or liability.

### 4. GitHub Repository Alignment
---
#### [MODIFY] [README.md](file:///home/kyesh/GitRepos/fine_grain_access_control/README.md)
- Completely replace Next.js boilerplate.
- Add FGAC.ai branding, description, features, setup instructions, and summarize the Custom License logic.
- Ensure narrative continuity between `README.md` and the public website layout.

### 5. Generate Imagery
---
- Use the `generate_image` tool to visualize a brand favicon/logo for FGAC.ai.

## Verification Plan

### Automated Tests
- Run `npm run build` to verify there are no compilation errors.

### Manual Verification
- Review the generated Favicon/Logo visually in the artifacts folder.
- Spin up `npm run dev` and navigate to `http://localhost:3000/`, `/terms`, `/privacy`, and `/setup`.
- Verify the copy properly reads as "FGAC.ai".
- Verify the strict Light Mode aesthetic looks premium and flawless.
