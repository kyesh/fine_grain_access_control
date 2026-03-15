---
description: Deploys changes to a new PR, waits for the Vercel Preview to build, validates the live UI using a browser agent, and returns the Preview URL to the user.
---

1.  Push your current changes to the branch:

    ```bash
    git push origin HEAD
    ```

2.  Check if a PR exists for the current branch. If not, create one:

    ```bash
    gh pr view || gh pr create --fill
    ```

3.  Wait for the Vercel Preview Deployment to build and extract the live alias URL. Use the Vercel CLI to find the specific Preview deployment associated with your branch. Wait for its status to change to `Ready`:

    ```bash
    # Tip: Pipe the output to bypass interactive pagination prompts
    npx vercel ls googleapis-fine-grain-access-control | grep -w "Ready" | grep -w "Preview" | head -n 1 | awk '{print $2}'
    ```

4.  If the deployment fails, analyze the logs, fix the code, push again, and return to step 3.

5.  Once the Vercel Preview URL is `Ready`, you MUST launch a `browser_subagent` mission to validate the frontend.
    a. Provide the subagent the specific Vercel URL (e.g., `https://project-branch.vercel.app`).
    b. Instruct the subagent to log in with a test user context if necessary.
    c. Wait for the page to fully load and instruct the subagent to take a screenshot confirming the specific features you built are visible and functional.

6.  Only AFTER the browser validation proves successful, notify the user.
    - If the browser subagent fails due to `user did not add URL to allowlist` or similar access issues, stop and immediately inform the user.
    - Fetch the GitHub PR URL explicitly to ensure you have it in context:
      ```bash
      gh pr view --json url -q .url
      ```
    - Give the user BOTH the **GitHub PR URL** and the **Vercel Preview URL**.
    - Provide a short summary of the validation you performed.
    - Ask the user to manually verify the application state using the provided Preview URL.

> **Failure Reflection**: In the past, agents failed this workflow by providing ONLY the Vercel URL and hiding the PR URL. Also, agents failed to notice when the `browser_subagent` encountered a URL allowlist error, resulting in a silent failure. Always verify the subagent successfully loaded the page and successfully gathered visual proof, and ALWAYS provide both URLs to the user.

> **CRITICAL RULE**: Do not automate or invoke the `/deploy-prod` command at the end of this workflow. Only the user is authorized to merge to production after they are satisfied with the Preview URL.
