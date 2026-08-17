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

2. **Wait for the production deployment.** Successful builds typically go
   Ready in under 1 minute — poll every ~15 seconds for up to **90 seconds**
   instead of one long sleep:

   ```bash
   for i in 1 2 3 4 5 6; do
     npx vercel ls fine-grain-access-control --prod --limit 1 2>&1 | grep -E "Ready|Error|Building|Queued"
     sleep 15
   done
   ```

   (Pipe through `grep` rather than picking lines positionally — the CLI
   splits its output across stdout and stderr, so line numbers shift.)
   If it still isn't Ready after 90 seconds, treat that as unusual: check the
   status once more and move to step 5 rather than waiting longer blindly.

3. **Validate the deployment**:

   ```bash
   npx vercel ls fine-grain-access-control --prod --limit 1
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
     npx vercel logs fine-grain-access-control --prod
     ```
   - Propose fixes. Do NOT attempt a production redeploy yourself — `vercel --prod`,
     `vercel promote`, and `vercel alias` are banned and denied in `.claude/settings.json`.
