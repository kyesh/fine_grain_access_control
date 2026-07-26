---
description: Drive the user's real Chrome via Playwright CLI over CDP, preserving Google sign-in sessions
argument-hint: [url]
allowed-tools: Bash(curl:*), Bash(npx @playwright/cli:*), Bash(playwright-cli:*), Read
---

# Browser Agent Workflow

Drives the user's real Chrome browser via `@playwright/cli attach --cdp`, preserving all
Google sign-in sessions and cookies. Target URL: `$1` (if empty, ask the user what to open).

See `.claude/skills/playwright-cli/SKILL.md` for the full CLI command reference.

## Prerequisites

Chrome must be running with remote debugging enabled using the **project testing profile**:

macOS:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$CLAUDE_PROJECT_DIR/.playwright_user_data" --remote-debugging-port=9222
```

Linux:
```bash
google-chrome --user-data-dir="$CLAUDE_PROJECT_DIR/.playwright_user_data" --remote-debugging-port=9222
```

> **CRITICAL**: Always use the project `.playwright_user_data` profile — it holds the Google
> sign-in sessions and cookies the tests need. Do NOT launch Chrome without `--user-data-dir`,
> do NOT use a different profile path, and do NOT run `pkill chrome` (that kills the user's
> real browser session). To clean up only test Chrome instances, use
> `pkill -f 'chrome.*playwright_user_data'`. If Chrome isn't listening on 9222, STOP and ask
> the user to start it with the command above.

## Execution Steps

1. **Check the Chrome debugging port**

   ```bash
   curl -s http://localhost:9222/json/version
   ```
   - Returns JSON → proceed to step 2.
   - Connection refused → STOP and ask the user to launch Chrome with the command above.

2. **Attach to the running browser**

   ```bash
   npx @playwright/cli attach --cdp=http://localhost:9222 -s=fgac_ui
   ```
   This connects the CLI session to the user's real Chrome with cookies and auth state intact.
   If the attach fails, STOP and report it — do not silently fall back to a fresh browser.

3. **Navigate to the target URL**

   ```bash
   npx @playwright/cli -s=fgac_ui goto $1
   ```

4. **Snapshot the page structure**, filtered to keep context small:

   ```bash
   npx @playwright/cli -s=fgac_ui snapshot 2>&1 | grep -E "heading|button|link|textbox|Agent|Approve" | head -30
   ```
   Read the YAML output to identify element refs (e.g. `e15`, `e23`). Widen the grep only if
   you can't find the element you need.

5. **Interact using refs from the snapshot**

   ```bash
   npx @playwright/cli -s=fgac_ui click e15
   npx @playwright/cli -s=fgac_ui fill e12 "some text"
   npx @playwright/cli -s=fgac_ui select e8 "option_value"
   ```

6. **Capture proof screenshots** into the gitignored QA directory, never the project root:

   ```bash
   npx @playwright/cli -s=fgac_ui screenshot .playwright/qa_proof.png
   ```

7. **Close the session when done** (does NOT close the user's browser)

   ```bash
   npx @playwright/cli -s=fgac_ui close
   ```

## Rules

- Never write ad-hoc Node.js Playwright scripts — use this CLI flow.
- Never perform QA state changes by writing to the database. Drive the UI as a real user would.
- Report attach/navigation failures immediately instead of continuing with unverified state.
