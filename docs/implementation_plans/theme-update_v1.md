# Theme Update Implementation Plan

The goal of this update is to align the website's color scheme with the newly integrated logo and favicon. We extracted the prominent colors directly from the logo generation files.

## Identified Brand Colors
- **Brand Blue**: `#0A468C` (The deep blue from the "F" and left side of the keyhole).
- **Brand Orange**: `#E66E00` (The vibrant orange from the right side of the keyhole and the "C").

## User Review Required

Please review the proposed approach for integrating these colors into the application. 
- We will define these as custom Tailwind classes (`brand-blue` and `brand-orange`) to make them globally accessible.
- We will replace the current default `blue-600` and `indigo-600` classes across the application (such as the main headings, buttons, gradients, and dashboard borders) with our new brand colors.
- For gradients (e.g., the `FGAC.ai` text on the landing page), we will transition from `brand-blue` to `brand-orange` to mirror the split-color design of the logo itself!

If you prefer keeping the orange strictly as an accent color (e.g., only for buttons) rather than in gradients, please let me know!

## Proposed Changes

### Configuration
#### [MODIFY] src/app/globals.css
- Inject Tailwind v4 `@theme` variables:
  - `--color-brand-blue: #0a468c;`
  - `--color-brand-orange: #e66e00;`

### Components & Pages
#### [MODIFY] src/app/page.tsx
- Update the hero gradient text to flow from `brand-blue` to `brand-orange`.
- Change primary buttons to use background `brand-blue` and hover states to a slightly adjusted opacity or defined variant.
- Update informational blocks (currently `bg-blue-50` and `border-blue-100`) to utilize an opacity-adjusted `brand-blue/10` or similar.

#### [MODIFY] src/app/layout.tsx
- Update navigation links and hover states to utilize `brand-blue`.

#### [MODIFY] src/app/dashboard/page.tsx
- Update the access control tags and generic indigo/blue badges to use the brand colors. Active elements can remain green for semantic clarity (success states), but primary layout elements will shift to brand colors.

## Verification Plan

### Automated Tests
- N/A - Visual UI changes only.

### Manual Verification
- A PR will be created and we will run the `deploy-pr-preview` workflow.
- A browser subagent will visit the Vercel Preview URL to visually confirm the colors applied to the landing page and navigation bar.
