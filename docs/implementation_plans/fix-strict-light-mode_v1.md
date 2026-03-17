# Fix Dark Mode Bug on Setup Page

The issue stems from `src/app/setup/page.tsx` being hard-coded with a dark mode design (`bg-[#0a0a0a]`, `text-white`, `bg-black/40`, etc.), which conflicts with the strict light mode enforced globally in `globals.css` and `layout.tsx`.

## Proposed Changes

### Setup Page Refactor

#### [MODIFY] src/app/setup/page.tsx
We will rewrite the Tailwind CSS classes in this file to match the premium light mode aesthetic used in the rest of the app (`page.tsx` and `dashboard/page.tsx`).
Specifically, we will:
- Replace `bg-[#0a0a0a]` with `bg-slate-50` or `bg-white`.
- Replace `text-white` and `text-slate-300` with `text-gray-900` and `text-gray-600`.
- Replace dark overlays (`bg-black/40`, `bg-white/5`) with light mode equivalents (`bg-white/80`, `bg-white`, `shadow-sm`, `border-gray-200`).
- Update icon wrapper colors (`bg-indigo-500/10`, etc.) to look premium against a light background.
- Update code blocks to have a light theme background (e.g. `bg-slate-50` or `bg-gray-100`) instead of `bg-black/60`.

## Verification Plan

### Automated Tests
- Run `npm run build` to ensure there are no compilation errors.

### Manual Verification
- Start the dev server (`npm run dev`).
- Open `http://localhost:3000/setup` in the browser via `browser_subagent`.
- Verify the page displays correctly in light mode, with readable text, visible borders, and a premium aesthetic that matches the landing page.
