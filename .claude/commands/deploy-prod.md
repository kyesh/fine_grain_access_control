---
description: USER-ONLY — merge the PR to main, wait for the production deployment, and validate it
allowed-tools: Bash(gh:*), Bash(npx vercel ls:*), Bash(npx vercel inspect:*), Bash(npx vercel logs:*), Bash(curl:*), Bash(sleep:*)
---

# Deploy to Production

> **CRITICAL AGENT RULE**: Do NOT invoke or automate this command on your own. You are NEVER
> allowed to run it as part of another workflow or on your own initiative — it is strictly for
> the user to execute after they have verified the preview branch. If you believe your task is
> complete, give the user the working Preview URL to review instead.
>
> If you are reading this because the user typed `/deploy-prod` themselves, proceed.

1. **Merge the current PR to main**:

   ```bash
   gh pr merge --auto --merge
   ```

2. **Wait for the production deployment** (~5 minutes):

   ```bash
   sleep 300
   ```

3. **Validate the deployment**:

   ```bash
   npx vercel ls googleapis-fine-grain-access-control --prod --limit 1
   ```
   Optional precise status check if you have the deployment URL:
   ```bash
   npx vercel inspect <deployment-url>
   ```
   Health check:
   ```bash
   curl -I https://fgac.ai/
   ```

4. **If successful** (status `READY` and the health check passes), report success to the user.

5. **If there are issues**:
   - Flag the deployment issues explicitly.
   - Check logs:
     ```bash
     npx vercel logs googleapis-fine-grain-access-control --prod
     ```
   - Propose fixes. Do NOT attempt a production redeploy yourself — `vercel --prod`,
     `vercel promote`, and `vercel alias` are banned and denied in `.claude/settings.json`.
