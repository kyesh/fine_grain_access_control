---
description: Instructions for how to test with the browser tool/playwright
---

# Browser Agent Workflow (/browser-agent)

This workflow drives the user's real Chrome browser via `@playwright/cli attach --cdp`, preserving all Google sign-in sessions and cookies.

**Trigger:** `/browser-agent [url]`

## Prerequisites

The user must have Chrome running with remote debugging enabled using the **project testing profile**:
```bash
google-chrome --user-data-dir=/home/kyesh/GitRepos/fine_grain_access_control/.playwright_user_data --remote-debugging-port=9222
```

> **CRITICAL**: Always use the exact `--user-data-dir` path above. This profile preserves Google sign-in sessions and cookies needed for testing. Do NOT launch Chrome without `--user-data-dir`, do NOT use a different profile path, and do NOT run `pkill chrome` — it will kill the user's real browser session. If Chrome isn't running on port 9222, ask the user to start it with the command above.

## Workflow Execution Steps

// turbo-all

1. **Check if Chrome debugging port is available**
   ```bash
   curl -s http://localhost:9222/json/version
   ```
   - If this succeeds (returns JSON), proceed to step 2.
   - If this fails (connection refused), STOP and ask the user to run:
     ```
     google-chrome --user-data-dir=/home/kyesh/GitRepos/fine_grain_access_control/.playwright_user_data --remote-debugging-port=9222
     ```

2. **Attach to the running browser**
   ```bash
   npx @playwright/cli attach --cdp=http://localhost:9222 -s=antigravity_ui
   ```
   This connects the CLI session to the user's real Chrome instance with all existing cookies and auth state intact.

3. **Navigate to the target URL**
   ```bash
   npx @playwright/cli -s=antigravity_ui goto [url]
   ```

4. **Take a snapshot to read the page structure**
   ```bash
   npx @playwright/cli -s=antigravity_ui snapshot
   ```
   Read the YAML output to identify element refs (e.g. `e15`, `e23`).

5. **Interact with elements using refs from the snapshot**
   Examples:
   - `npx @playwright/cli -s=antigravity_ui click e15`
   - `npx @playwright/cli -s=antigravity_ui fill e12 "some text"`
   - `npx @playwright/cli -s=antigravity_ui select e8 "option_value"`

6. **Capture proof screenshots**
   ```bash
   npx @playwright/cli -s=antigravity_ui screenshot qa_proof.png
   ```

7. **Close the session when done** (does NOT close the user's browser)
   ```bash
   npx @playwright/cli -s=antigravity_ui close
   ```
