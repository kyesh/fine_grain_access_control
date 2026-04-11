# Playwright CDP Agent Workflow (/browser-agent)

This workflow defines how Antigravity natively drives your authenticated browsing sessions using standard Playwright Node automation over the Chrome Debugging Protocol (CDP), completely bypassing Google Bot-Detection blocks!

**Trigger:** `/browser-agent [url]`

## Workflow Execution Steps

// turbo-all

1. **Verify Host Port**
   The agent MUST check if the Chrome debugging port is active.
   ```bash
   curl -s http://localhost:9222/json/version
   ```
   **If this fails (connection refused):** HALT immediately! Ask the user to spawn the Headed Chrome instance natively on their OS using this exact command:
   ```bash
   google-chrome-stable --remote-debugging-port=9222 --user-data-dir="$(pwd)/.playwright_user_data"
   ```

2. **Execute Automation**
   Once the port is active, do NOT use the rigid `@playwright/cli`. Instead, write a fast, deterministic Node.js script using native `@playwright/test` logic to execute the UI checks.
   Example `test-runner.ts`:
   ```typescript
   import { chromium } from 'playwright';
   (async () => {
       const browser = await chromium.connectOverCDP('http://localhost:9222');
       const context = browser.contexts()[0];
       const page = context.pages()[0] || await context.newPage();
       await page.goto('[url]');
       await page.screenshot({ path: 'qa_proof.png' });
       await browser.disconnect();
   })();
   ```
   Run it via `npx tsx test-runner.ts` and evaluate the output natively.
