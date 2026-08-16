---
description: Push the branch to a PR, wait for the Vercel Preview build, validate the live UI with the browser agent, and return both URLs
allowed-tools: Task, Bash(git:*), Bash(gh:*), Bash(npm run db:generate), Bash(ls:*), Bash(npx vercel ls:*), Bash(npx vercel inspect:*), Bash(curl:*), Bash(jq:*), Read
---

# Deploy PR Preview

Current branch: !`git branch --show-current`

1. **Merge latest main** so the preview is up to date:

   ```bash
   git fetch origin main && git merge origin/main
   ```

2. **If you made schema/data model changes**, generate the migration file *before* pushing.
   `migrate.ts` dynamically loads all `.sql` files from `src/db/migrations/` — verify your new
   file exists there and follows the `NNNN_*.sql` naming convention.

   ```bash
   npm run db:generate && ls -la src/db/migrations/
   ```

3. **Push the branch**:

   ```bash
   git push origin HEAD
   ```

4. **Ensure a PR exists**:

   ```bash
   gh pr view || gh pr create --fill
   ```

5. **Cancel stale builds** for older commits on this branch, so you don't wait on outdated
   builds. Identify deployments in `Building` or `Queued` state older than your push:

   ```bash
   npx vercel ls fine-grain-access-control
   ```
   Then cancel each (this modifies state — confirm with the user if it isn't obviously yours):
   ```bash
   npx vercel cancel <deployment-url>
   ```

6. **Dispatch the `deploy-watcher` subagent** (background) with the branch name and pushed
   commit SHA. It polls until the deployment is `Ready` or `Error`; on error it fetches the
   build logs and returns a classified failure. Keep working (or wait) — do NOT poll
   `vercel ls` in this session.

7. **Deploy-watch loop** (max 3 rounds). On the watcher's result:

   - `READY <url>` → continue to step 8.
   - `ERROR <classification>` → apply the matching fix **after reading the quoted log lines**:
     - `MIGRATION_SQL` — fix the migration file or the `splitStatements` parser in `migrate.ts`.
     - `NEON_BRANCH_LIMIT` — only THEN run `npx tsx scripts/cleanup-neon-branches.ts` (ask-gated).
     - `BUILD_ERROR` — fix the code.
     - `ENV_MISSING` — check Vercel project settings; env-var changes are ask-gated.
     - `OTHER` — diagnose from the quoted logs before touching anything.

     Then push and dispatch a fresh watcher. After 3 failed rounds, stop and hand the
     classified failure to the user.
   - `TIMEOUT` → check `npx vercel ls` once yourself; if the build is genuinely stuck,
     surface it to the user rather than re-dispatching blindly.

   > **CRITICAL**: Never delete Neon branches as a first response to a build error. The
   > watcher classifies from the logs; deleting branches is destructive and only appropriate
   > on an explicit `NEON_BRANCH_LIMIT` classification.

8. **Validate the frontend yourself** once the Preview URL is `Ready`, by running the
   `/browser-agent` workflow:
   - Attach to Chrome and navigate to the specific Vercel Preview URL.
   - Log in with a test user context if necessary.
   - Wait for full load, then snapshot/screenshot to confirm the features you built are
     visible and functional.

9. **Only AFTER browser validation succeeds**, report to the user:
   - If you hit errors accessing the URL or interacting with the page, STOP and say so immediately.
   - Fetch the PR URL explicitly so you have it in context:
     ```bash
     gh pr view --json url -q .url
     ```
   - Give the user BOTH the **GitHub PR URL** and the **Vercel Preview URL**.
   - Summarize the validation you performed.
   - Ask the user to manually verify the application state using the Preview URL.

> **Failure Reflection**: Past runs failed by giving only the Vercel URL and hiding the PR URL,
> and by skipping `/browser-agent` entirely or ignoring Playwright CLI attach errors, producing
> a silent failure. Always verify you attached, loaded the page, and captured visual proof —
> and always provide both URLs.

> **CRITICAL RULE**: Do not invoke `/deploy-prod` at the end of this workflow. Only the user
> merges to production, after they are satisfied with the Preview URL.
