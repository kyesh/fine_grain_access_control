---
description: Deploys changes to a new PR, waits for the Vercel Preview to build, validates the live UI using a browser agent, and returns the Preview URL to the user.
---

1.  Pull the latest changes from main into your current branch to ensure the preview is up to date:

    ```bash
    git fetch origin main && git merge origin/main
    ```

2.  If you made any schema/data model changes during this task, ensure you have generated a migration file and added it to the `MIGRATIONS` array in `src/db/migrate.ts` *before* pushing. Without this, your changes will not propagate to the Vercel Preview Database.
    
    ```bash
    npm run db:generate
    # Manually append the new file name (e.g. 000X_xxx.sql) to src/db/migrate.ts
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

6.  If the deployment fails with an error (for example, if you hit your Neon Database Branch Limit), run the script to find and delete stale Neon branches:

    ```bash
    npx tsx scripts/cleanup-neon-branches.ts
    ```
    After cleaning up, fix any other code issues, push again, and return to step 4.

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
