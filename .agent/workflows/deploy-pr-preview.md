---
description: Deploys changes to a new PR, waits for the Vercel Preview to build, validates the live UI using a browser agent, and returns the Preview URL to the user.
---

1.  Pull the latest changes from main into your current branch to ensure the preview is up to date:

    ```bash
    git fetch origin main && git merge origin/main
    ```

2.  If you made any schema/data model changes during this task, ensure you have generated a migration file *before* pushing. `migrate.ts` dynamically loads all `.sql` files from `src/db/migrations/` — verify your new file exists there and follows the `NNNN_*.sql` naming convention.
    
    ```bash
    npm run db:generate
    # Verify the new .sql file exists in src/db/migrations/
    ls -la src/db/migrations/
    ```

3.  Push your current changes to the branch:

    ```bash
    git push origin HEAD
    ```

3.  Check if a PR exists for the current branch. If not, create one:

    ```bash
    gh pr view || gh pr create --fill
    ```

4.  Clean up any pending or hanging builds in the queue for older commits on your branch. This ensures you don't wait for outdated builds to complete before your actual build can start.
    Use `npx vercel ls googleapis-fine-grain-access-control` to identify any deployments in the `Building` or `Queued` state that are older than your current push.
    Cancel them using the Vercel CLI:
    
    ```bash
    npx vercel cancel <deployment-url>
    ```

5.  Wait for the Vercel Preview Deployment to build and extract the live alias URL. Use the Vercel CLI to find the specific Preview deployment associated with your branch. Wait for its status to change to `Ready`:

    ```bash
    # Tip: Pipe the output to bypass interactive pagination prompts
    npx vercel ls googleapis-fine-grain-access-control | grep -w "Ready" | grep -w "Preview" | head -n 1 | awk '{print $2}'
    ```

6.  If the deployment fails with `● Error`, you MUST read the build logs BEFORE taking any corrective action. Do NOT blindly delete Neon branches or retry without diagnosing.

    **a. Fetch the build logs using the Vercel API:**
    ```bash
    # Get the Vercel auth token
    VERCEL_TOKEN=$(cat ~/.local/share/com.vercel.cli/auth.json | jq -r '.token')
    
    # Get the deployment ID from inspect
    npx vercel inspect <deployment-url>
    
    # Fetch and display build log text
    curl -s "https://api.vercel.com/v2/deployments/<deployment-id>/events" \
      -H "Authorization: Bearer $VERCEL_TOKEN" | jq -r '.[].payload.text'
    ```

    **b. Diagnose the error from the logs.** Common failures include:
    - **Migration SQL errors** (e.g., `cannot insert multiple commands into a prepared statement`): Fix the migration file or the `splitStatements` parser in `migrate.ts`.
    - **Neon branch limit exceeded**: Only THEN run `npx tsx scripts/cleanup-neon-branches.ts` to delete stale branches.
    - **TypeScript/build errors**: Fix the code.
    - **Missing environment variables**: Check Vercel project settings.

    **c. Fix the root cause**, push again, and return to step 4.

    > **CRITICAL**: Never delete Neon branches as a first response to a build error. Always read the logs first. Deleting branches is destructive and only appropriate when the logs explicitly indicate a branch limit error.

7.  Once the Vercel Preview URL is `Ready`, you MUST validate the frontend yourself by following the `/browser-agent` workflow (`.agent/workflows/browser-agent.md`).
    a. Use the Playwright CLI to attach to the browser and navigate to the specific Vercel URL (e.g., `https://project-branch.vercel.app`).
    b. Interact with the page to log in with a test user context if necessary.
    c. Wait for the page to fully load and use the snapshot/screenshot commands to confirm the specific features you built are visible and functional.

8.  Only AFTER the browser validation proves successful, notify the user.
    - If you encounter errors accessing the URL or interacting with the page via the Playwright CLI, stop and immediately inform the user.
    - Fetch the GitHub PR URL explicitly to ensure you have it in context:
      ```bash
      gh pr view --json url -q .url
      ```
    - Give the user BOTH the **GitHub PR URL** and the **Vercel Preview URL**.
    - Provide a short summary of the validation you performed.
    - Ask the user to manually verify the application state using the provided Preview URL.

> **Failure Reflection**: In the past, agents failed this workflow by providing ONLY the Vercel URL and hiding the PR URL. Also, agents failed to execute the `/browser-agent` workflow successfully by either skipping it entirely or ignoring errors when the Playwright CLI failed to attach to the Chrome instance, resulting in a silent failure. Always verify you successfully attached, loaded the page, and successfully gathered visual proof via screenshot, and ALWAYS provide both URLs to the user.

> **CRITICAL RULE**: Do not automate or invoke the `/deploy-prod` command at the end of this workflow. Only the user is authorized to merge to production after they are satisfied with the Preview URL.
