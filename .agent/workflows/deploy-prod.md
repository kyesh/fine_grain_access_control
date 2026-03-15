---
description: Merges the PR to main, waits for production deployment, and validates it.
---

> **CRITICAL AGENT RULE**: Do NOT invoke or automate this workflow on your own. You are NEVER allowed to use the deploy prod slash command automatically. That is strictly for the user to execute after they have verified the preview branch. If you believe your task is complete, provide the user with the working preview branch URL to review instead.

1.  Merge the current PR to main:

    ```bash
    gh pr merge --auto --merge
    ```

2.  Wait for 5 minutes to allow the production deployment to complete:

    ```bash
    sleep 300
    ```

3.  Validate the production deployment:
    a. Check the latest deployment status on Vercel:
    ```bash
    npx vercel ls googleapis-fine-grain-access-control --prod --limit 1
    ```
    b. (Optional) precise status check if you have the deployment URL:
    ```bash
    npx vercel inspect <deployment-url>
    ```
    c. Perform a simple health check:
    ```bash
    curl -I https://fgac.ai/
    ```

4.  If the deployment is successful (status is READY and health check passes):
    - Report success to the user.

5.  If there are issues:
    - Flag the deployment issues.
    - Check logs:
      ```bash
      npx vercel logs googleapis-fine-grain-access-control --prod
      ```
    - Propose fixes.
