---
description: Analyze or test the UI in a browser — built-in browser tools by default, CDP-attached Chrome when a logged-in session is required
argument-hint: [url]
allowed-tools: Bash(curl:*), Bash(npx @playwright/cli:*), Read
---

# Browser Agent Workflow

Target URL: `$1` (if empty, ask the user what to open).

Two paths. **Default to Path A.** Path B is the backup, and exists only for tests that
need the signed-in Google/Clerk session.

**Decision rule:** does this flow require being signed in (anything behind `/dashboard`,
Google OAuth consent, Clerk sign-in)? No → Path A. Yes → Path B for those steps only —
run the unauthenticated parts of the same test (public pages, console/network checks,
theme/responsive) in Path A anyway; its instrumentation is strictly better.

---

## Path A — Built-in browser tools (default in Claude Code)

Use the `mcp__Claude_Browser__*` tools. No setup, no external process, and console/network
inspection is far better than screenshot-scraping.

1. **Open the pane** at the target URL:
   `preview_start` with `{url: "$1"}`

2. **Read the page.** Prefer text and the accessibility tree over screenshots — they are
   cheaper and more precise:
   - `get_page_text` — visible copy
   - `read_page` with `filter: "interactive"` — elements tagged `ref_N` for clicking
   - `computer` with `action: "screenshot"` — only when you need to judge *visual* layout

3. **Interact** via `computer` (`left_click`, `type`, `scroll`) using `ref` from `read_page`,
   or `form_input` for form fields.

4. **Check for runtime errors** — this is the highest-signal step for validating a deploy:
   - `read_console_messages` with `{onlyErrors: true}`
   - `read_network_requests` — confirm assets and API calls return expected status codes.
     Cancelled RSC prefetches show as `ERR_ABORTED` and are normal in Next.js.

5. **Verify responsive and theme behavior** with `resize_window` — presets
   `mobile` / `tablet` / `desktop`, and `colorScheme: "dark" | "light"` to emulate the OS
   theme preference (this is how capability 08, strict light mode, is tested without
   touching OS settings).

### Limits of Path A

This browser has **no Google or Clerk session**. Anything behind `/dashboard` redirects to
sign-in. Do NOT attempt to sign in — entering credentials is off-limits. You can still validate
a great deal without auth:

- Public pages render, and copy/layout is correct
- No console errors, all chunks load
- Auth gates actually gate (a redirect to Clerk is a *passing* result)
- API endpoints return sane codes unauthenticated — e.g. `/api/mcp` `tools/list` returning
  **401 rather than 500** proves new tool code loads without crashing the handler

---

## Path B — CDP-attached real Chrome (only when auth is required)

Needed only to exercise signed-in flows (dashboard, rules, Google Picker, per-file access).

> **Prerequisite that is easy to miss**: the profile directory must already exist *and* be
> signed in to Google. It is gitignored, so it does NOT travel with the repo — a fresh clone or
> a different machine has no profile and therefore no session. Creating it is a one-time
> interactive sign-in by the user.

1. **Check the debugging port**:
   ```bash
   curl -s http://localhost:9222/json/version
   ```
   Connection refused → STOP and ask the user to launch Chrome:

   macOS:
   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$CLAUDE_PROJECT_DIR/.playwright_user_data" --remote-debugging-port=9222
   ```
   Linux:
   ```bash
   google-chrome --user-data-dir="$CLAUDE_PROJECT_DIR/.playwright_user_data" --remote-debugging-port=9222
   ```

2. **Attach**:
   ```bash
   npx @playwright/cli attach --cdp=http://localhost:9222 -s=fgac_ui
   ```
   If attach fails, STOP and report — never silently fall back to a fresh browser, which
   would produce a green result against an unauthenticated session.

3. **Drive it**, filtering snapshots to keep context small:
   ```bash
   npx @playwright/cli -s=fgac_ui goto $1
   npx @playwright/cli -s=fgac_ui snapshot 2>&1 | grep -E "heading|button|link|Approve" | head -30
   npx @playwright/cli -s=fgac_ui click e15
   npx @playwright/cli -s=fgac_ui screenshot .playwright/qa_proof.png
   npx @playwright/cli -s=fgac_ui close
   ```

> **NEVER run `pkill chrome`** — it kills the user's real browser. To clean up only test
> instances: `pkill -f 'chrome.*playwright_user_data'`.

---

## Rules for both paths

- Never write ad-hoc Node.js Playwright scripts.
- Never make QA state changes by writing to the database — drive the UI as a real user would.
- Screenshots go to gitignored paths (`.playwright/`), never the project root.
- Report attach/navigation failures immediately rather than continuing with unverified state.
