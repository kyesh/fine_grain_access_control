# Playwright MCP Agent Workflow (/browser-agent)

This workflow defines how Antigravity natively drives your authenticated browsing sessions using the Playwright CLI over the MCP Bridge Extension, seamlessly hooking into your live browser window to bypass Google bot-detection blocks!

**Trigger:** `/browser-agent [url]`

## Workflow Execution Steps

// turbo-all

1. **Verify Host Environment & MCP Bridge**
   The agent MUST check if the Chrome debugging port is active.
   ```bash
   curl -s http://localhost:9222/json/version
   ```
   **If this fails (connection refused):** HALT immediately! Ask the user to:
   1. Install the "Playwright MCP Bridge" extension in their Chrome profile natively.
   2. Spawn the Headed Chrome instance natively on their OS using:
   ```bash
   google-chrome-stable --remote-debugging-port=9222 --user-data-dir="$(pwd)/.playwright_user_data"
   ```

2. **Initialize CLI via MCP**
   Once the port is active and the extension is present, connect the CLI directly to the active tabs:
   ```bash
   npx -y @playwright/cli -s=antigravity_ui open [url] --extension
   ```

3. **Evaluate the DOM state**
   Obtain the deterministic element-ref snapshot emitted by Playwright:
   ```bash
   npx @playwright/cli -s=antigravity_ui snapshot
   ```
   Read the resulting `.yml` file generated in `.playwright-cli/`.

4. **Navigate & Act sequentially**
   Act natively using the references parsed from the `.yml` snapshot. Ex:
   - `npx @playwright/cli -s=antigravity_ui click e15`
   - `npx @playwright/cli -s=antigravity_ui fill e12 "Email"`

5. **Take Final Assessment**
   When the target state is reached:
   ```bash
   npx @playwright/cli -s=antigravity_ui screenshot final_dashboard.png
   ```
