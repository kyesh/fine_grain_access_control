---
description: Analyze or test the UI in a browser — built-in browser tools by default, CDP-attached Chrome when a logged-in session is required
argument-hint: [url]
allowed-tools: Bash(curl:*), Bash(npx @playwright/cli:*), Read
---

# Browser Agent Workflow

Target URL: `$1` (if empty, ask the user what to open).

Two paths. **Default to Path A for everything — including signed-in flows.** The
built-in browser keeps persistent cookies and both QA Google accounts (`USER_A`,
`USER_B`) are signed in there, so Clerk sign-in via the Google account chooser, OAuth
consent, and dashboard flows all work in Path A. Path B is the backup for when the
built-in session is missing or expired.

**Decision rule:** try Path A first, always. Fall back to Path B **by default, without
asking**, whenever Path A cannot drive the flow:

- a signed-in flow lands on a Google *password* prompt (session expired — never type a
  password), or the account chooser doesn't list the needed QA account (tell the user
  the built-in session needs re-establishing);
- Google Picker / `drive.file` consent flows — the embedded pane cannot complete them;
- unattended sessions (scheduled task / remote dispatch): `preview_start {name}` is
  blocked and a hidden pane reports 0×0 / black screenshots; DOM tools may still work,
  but gesture-driven flows need Path B;
- clicks are silently ignored in the embedded pane (surfaces requiring trusted gestures).

A QA pass that skips a flow because Path A couldn't drive it is incomplete — run it via
Path B and report which path each flow used.

**Hard stop overriding the fallback:** never push automation through a flow whose
failure/retry branch mutates shared auth state — e.g. `useGooglePicker`'s non-verified
branch destroys and recreates the Clerk Google external account on the shared dev Clerk
instance. Google's OAuth account chooser can also ignore synthetic/stale-transaction
clicks; retry ONCE with a fresh transaction (restart from the in-app button), then stop
and hand the single manual click to the user rather than looping.

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

### Signed-in flows in Path A

The pane's cookies persist across sessions, and both QA Google accounts stay signed in.
For Clerk sign-in: click through Clerk's Google OAuth → Google's account chooser lists
`USER_A` and `USER_B` → pick the one the test needs. Switching accounts this way is the
standing-approved routine step (CLAUDE.md Local Development note 5) — do it as often as
tests require without asking.

Hard limit unchanged: **never type a password.** A password/passkey/2FA prompt means the
session expired — stop, fall back to Path B, and tell the user the built-in session
needs re-establishing (a one-time manual sign-in by the user).

### What Path A validates without any auth

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

   The profile lives at the MAIN clone (not `$CLAUDE_PROJECT_DIR`, which in a worktree
   session points at a disposable directory) so one signed-in profile serves every
   worktree.

   macOS:
   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="/Users/kyesh/GitRepos/fine_grain_access_control/.playwright_user_data" --remote-debugging-port=9222
   ```
   Linux:
   ```bash
   google-chrome --user-data-dir="$HOME/GitRepos/fine_grain_access_control/.playwright_user_data" --remote-debugging-port=9222
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
