# QA Acceptance Test: 08 - Strict Light Mode Enforcement

## Overview
This acceptance test ensures that the application strictly enforces its Light Mode design system. The UI must remain identical and render with a light background and dark text, completely ignoring any OS-level or browser-level "Dark Mode" preferences. Our goal is to maintain design simplicity for AI code generation.

## Pre-requisites
* Application is running locally (`npm run dev`) or deployed to a preview/production environment.

## Test 1: Light Mode OS Preference
**Objective:** Verify standard behavior when the OS prefers light mode.

1. **Action:** Set your Operating System or Browser theme preference to **Light Mode**.
   - *Mac:* System Settings > Appearance > Light
   - *Windows:* Settings > Personalization > Colors > Choose your mode > Light
   - *Chrome DevTools:* Rendering Tab > Emulate CSS media feature prefers-color-scheme: light
2. **Action:** Navigate to the homepage root `/`.
3. **Verify:** The background is white/light gray (`bg-slate-50`). Text is dark (`text-gray-900` or similar).

## Test 2: Dark Mode OS Preference (The Core Test)
**Objective:** Verify that the application ignores dark mode preferences and continues to render the Light Mode UI.

1. **Action:** Set your Operating System or Browser theme preference to **Dark Mode**.
   - *Mac:* System Settings > Appearance > Dark
   - *Windows:* Settings > Personalization > Colors > Choose your mode > Dark
   - *Chrome DevTools:* Rendering Tab > Emulate CSS media feature prefers-color-scheme: dark
2. **Action:** Refresh the homepage `/`.
3. **Verify:** The background MUST REMAIN white/light gray. It should not turn black or dark gray (`#0a0a0a`).
4. **Verify:** The text MUST REMAIN dark. It should not turn white or light gray (`#ededed`).
5. **Verify:** Browser-native elements like scrollbars on the right side of the window also remain in a light mode appearance (not inverted to dark).

## Test 3: Waitlist and Setup Pages
**Objective:** Ensure the layout constraint applies globally.

1. **Action:** Keep the OS/Browser in **Dark Mode**.
2. **Action:** Navigate to `/waitlist`.
3. **Verify:** All forms, inputs, backgrounds, and text render in light mode. Text inside the inputs must be easily readable (dark text on white backgrounds).
4. **Action:** Navigate to `/setup`.
5. **Verify:** The setup guide text and backgrounds remain in light mode.
