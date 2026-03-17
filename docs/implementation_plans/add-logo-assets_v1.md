# Add Logo Assets

The goal is to process the three raw images generated via "nano banana," format them with a transparent background, crop them, and place them into the Next.js `public` folder. We will also update the favicon to use the most suitable square lock logo.

## User Review Required

Please review the asset naming and selection:
- The wide logo with the full "FGAC.ai" text will be saved as `public/logo.png`.
- The square logo with both the lock/key and text will be saved as `public/logo-square.png`.
- The square logo containing *only* the lock/key icon (no text) will be processed into `app/favicon.ico` (which serves as the main favicon for Next.js).

If you have different name preferences or require a different image for the favicon, please clarify!

## Proposed Changes

### Assets
#### [NEW] public/logo.png
#### [NEW] public/logo-square.png
#### [NEW] src/app/favicon.ico (or public/favicon.ico)

### Application Configuration
#### [MODIFY] src/app/layout.tsx
- Update the metadata block (if necessary) to ensure it points to the correct new favicon/icons, or rely on Next.js standard file-based routing by removing the old `favicon.ico` and inserting the new one into `src/app/`.

## Verification Plan

### Automated Tests
- Run `npm run dev` to ensure the application starts correctly.
- Ensure the Next.js build (`npm run build`) respects the new assets.

### Manual Verification
- We will visually inspect the cropped, transparent logotypes inside a test HTML file or local server.
- The user can verify the change locally by navigating to `http://localhost:3000` and observing the browser's tab for the newly selected favicon.
