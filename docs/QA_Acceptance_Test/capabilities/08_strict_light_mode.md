# Capability: Strict Light Mode Enforcement

## Overview
This acceptance test ensures that the application strictly enforces its Light Mode design system. The UI must remain identical and render with a light background and dark text, completely ignoring any OS-level or browser-level "Dark Mode" preferences. Our goal is to maintain design simplicity for AI code generation.

## Pre-requisites
* Application is running locally (`npm run dev`) or deployed to a preview/production environment.

## Assertions

### A1: Light Mode OS preference renders light UI
- Set the OS or browser theme preference to **Light Mode**.
  - *Mac:* System Settings > Appearance > Light
  - *Windows:* Settings > Personalization > Colors > Choose your mode > Light
  - *Chrome DevTools:* Rendering Tab > Emulate CSS media feature prefers-color-scheme: light
- Navigate to the homepage root `/`.
- **Expected**: The background is white/light gray (`bg-slate-50`). Text is dark (`text-gray-900` or similar).

### A2: Dark Mode OS preference is ignored (the core test)
- Set the OS or browser theme preference to **Dark Mode**.
  - *Mac:* System Settings > Appearance > Dark
  - *Windows:* Settings > Personalization > Colors > Choose your mode > Dark
  - *Chrome DevTools:* Rendering Tab > Emulate CSS media feature prefers-color-scheme: dark
- Refresh the homepage `/`.
- **Expected**: The background MUST REMAIN white/light gray — not black or dark gray (`#0a0a0a`). The text MUST REMAIN dark — not white or light gray (`#ededed`). Browser-native elements like scrollbars also remain light (not inverted to dark).

### A3: Waitlist and setup pages stay light in Dark Mode
- Keep the OS/browser in **Dark Mode**.
- Navigate to `/waitlist`: all forms, inputs, backgrounds, and text render in light mode; text inside inputs is easily readable (dark text on white backgrounds).
- Navigate to `/setup`.
- **Expected**: The setup guide text and backgrounds remain in light mode on both pages.
