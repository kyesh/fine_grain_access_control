

# Context Window Management

Antigravity DOES have built-in context compaction (verified via ls-main.log showing message count resets: 147→90, 207→169, 259→198). However, compaction has limits and long sessions still degrade quality. Additionally, quota exhaustion (RESOURCE_EXHAUSTED 429) and TS server OOM (SIGABRT with `--max-old-space-size=3072`) have caused real crashes. Follow these rules to prevent session loss:

## Hard Limits

1. **NEVER read a full `overview.txt`** from a prior conversation. Use the `/recover-session` workflow instead, which reads only the compact artifacts (task.md, walkthrough.md, last 3 log lines).
2. **NEVER run more than ~200 tool calls in a single session.** If you're approaching this limit, write a walkthrough artifact, commit your work, and tell the user to continue in a new conversation.
3. **NEVER combine building + full QA testing in one session.** Use the `/qa-runner` workflow in a dedicated session, then `/qa-fix` in a separate session.

## Context-Efficient Practices

4. **Playwright snapshots**: ALWAYS pipe through `grep` to extract only relevant elements. Full accessibility tree dumps consume 10,000-15,000 tokens each.
   - **Bad**: `npx @playwright/cli -s=foo snapshot`
   - **Good**: `npx @playwright/cli -s=foo snapshot 2>&1 | grep -E "heading|button|Agent|Approve" | head -10`
5. **Command outputs**: Use `OutputCharacterCount: 500` for `command_status` unless you specifically need more.
6. **File reads**: Use `StartLine`/`EndLine` on `view_file` when you know which section you need. Don't read entire files just to find one function.
7. **QA results**: Write test results to `docs/QA_Acceptance_Test/qa-results.json` on disk, not as in-context summaries.

## Phase Boundaries

8. At natural phase boundaries (completing a feature, finishing a spike, merging a PR), write a walkthrough artifact summarizing what was done. This enables the next session to pick up cheaply.
9. Update the task.md artifact as you work — this is the primary cross-session state transfer mechanism.
10. Commit frequently so that `git log` serves as a ground-truth record of completed work.

