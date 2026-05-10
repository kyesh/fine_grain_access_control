

# Session Stability Rules

These rules prevent Antigravity session crashes. Root cause analysis found that the IDE's terminal host (ptyHost) dies under rapid-fire command execution, and workspace clutter (binary files, extra node_modules) destabilizes the IDE.

## Terminal Command Pacing (Prevents ptyHost Death)

The ptyHost manages all terminal sessions. It died after 13 minutes of rapid commands, causing a total session loss. To prevent this:

1. **NEVER fire parallel terminal commands during QA execution.** Always set `waitForPreviousTools: true` when running sequential test steps that depend on each other.
2. **Limit concurrent `command_status` polling.** Don't check multiple background commands simultaneously — check them one at a time.
3. **Prefer synchronous commands** over background + polling when the command will complete quickly (< 5 seconds). Set `WaitMsBeforeAsync` to 5000-10000ms instead of sending to background and polling.
4. **Batch related checks into single commands.** Instead of 5 separate `curl` commands, combine them:
   - **Bad**: 5 separate `run_command` calls for 5 curl checks
   - **Good**: One `run_command` with `curl ... && curl ... && curl ...`
5. **After browser automation steps**, wait 2-3 seconds before the next terminal command to give the ptyHost time to process.

## Workspace Hygiene (Prevents tsserver/IDE Crashes)

6. **NEVER leave binary files** (PNGs, PDFs) in the project root — they cause tsserver parse errors. Save QA screenshots to a gitignored directory or delete after use.
7. **NEVER create node_modules** outside the project root without adding to `.gitignore` — the IDE indexes everything not gitignored.
8. **Before starting a QA session**, verify the workspace is clean: `git status --short | grep '^??' | wc -l` should be under 20.

## Session Recovery

9. **After a crash, fully restart the IDE** before starting a new session. The IDE may start in a corrupted state otherwise (observed: `Expected lock to be held for topic uss-artifactReview`).
10. **Kill stale processes** from crashed sessions before restarting: `pkill -f 'chrome.*playwright_user_data'` and check for orphaned warp-terminal processes.
11. Use `/recover-session` to resume work from a crashed session — it reads only compact artifacts (~2K tokens) instead of the full conversation log.

## Context Efficiency

12. **Playwright snapshots**: ALWAYS pipe through `grep` to extract only relevant elements.
    - **Bad**: `npx @playwright/cli -s=foo snapshot`
    - **Good**: `npx @playwright/cli -s=foo snapshot 2>&1 | grep -E "heading|button|Agent|Approve" | head -10`
13. **Command outputs**: Use `OutputCharacterCount: 500` for `command_status` unless you need more.
14. **File reads**: Use `StartLine`/`EndLine` on `view_file` when you know which section you need.
15. At natural phase boundaries, write a walkthrough artifact and update task.md for cross-session continuity.

