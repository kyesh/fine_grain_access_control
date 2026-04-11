# Playwright Browser Agent Workflow (/browser-agent)

This workflow defines the explicit sequence of operations Antigravity must execute when tasked with navigating the UI natively using the Playwright CLI agent (`@playwright/cli`).

**Trigger:** `/browser-agent [url]`

## Workflow Execution Steps

// turbo-all

1. **Initialize the Session**
   Always launch the cli with a dedicated named session so state propagates correctly through your bash bounds. Run:
   ```bash
   npx -y @playwright/cli --config .playwright/cli.config.json -s=antigravity_ui open [url] --headed
   ```

2. **Evaluate the DOM state**
   Do not guess locators. Obtain the deterministic element-ref snapshot emitted by Playwright to target elements securely:
   ```bash
   npx @playwright/cli -s=antigravity_ui snapshot
   ```
   Read the resulting snapshot `.yml` file generated in the `.playwright-cli/` directory.

3. **Navigate & Act sequentially**
   Act natively using the references parsed from the `.yml` snapshot. Ex:
   - `npx @playwright/cli -s=antigravity_ui click e15`
   - `npx @playwright/cli -s=antigravity_ui fill e12 "Email"`

4. **Take Final Assessment**
   When the target state is reached (e.g. Dashboard fully loaded with authentication preserved via our configuration defaults):
   ```bash
   npx @playwright/cli -s=antigravity_ui screenshot final_dashboard.png
   ```

5. **Resource Cleanup**
   Respect system resources by formally closing the session after your objectives are fulfilled:
   ```bash
   npx @playwright/cli -s=antigravity_ui close
   ```
