# Playwright AI CLI Integration Architecture in Antigravity

This architecture addresses the structural integration of `@playwright/cli` (Playwright's purpose-built agentic UI automation tool) specifically within the constraints and capabilities of the Antigravity framework. The goal is to fully eliminate fragmented bash commands and brittle `browser_subagent` runs by standardizing how we use isolated, headed, and persistent context loops natively.

## User Review Required
> [!IMPORTANT]
> Because Antigravity technically lacks native dynamic ingestion of third-party `.claude/skills` directory schemas (unlike Claude Code), we must adapt the Playwright CLI via explicit **Antigravity Workflows** (`.agent/workflows/`) instead of relying on zero-context zero-shot "skills" magic. Please review this architectural pivot.

## Proposed Changes

### 1. Centralized Playwright CLI Configuration
We will introduce a native Playwright configuration mapping that automatically forces `@playwright/cli` to inherit the persistent profile properties. This entirely prevents AI-generated typos like missing the `--user-data-dir` flag in bash. 

#### [NEW] [cli.config.json](file:///home/kyesh/GitRepos/fine_grain_access_control/.playwright/cli.config.json)
This config automatically routes CLI invocations to the `.playwright_user_data` profile and enforces `headed: true`.

```json
{
  "$schema": "https://playwright.dev/docs/getting-started-cli/config.schema",
  "browser": "chrome",
  "headed": true,
  "userDataDir": "../.playwright_user_data",
  "viewport": { "width": 1280, "height": 720 }
}
```

---

### 2. Antigravity Workflow Engine Definition
We will distill the usage of the Playwright CLI into a formal standardized Antigravity Workflow. Workflows are the most effective mechanism in Antigravity for orchestrating multi-step API sequences efficiently without confusing the context window.

#### [NEW] [browser-agent.md](file:///home/kyesh/GitRepos/fine_grain_access_control/.agent/workflows/browser-agent.md)
This workflow file handles instructions on exactly how Antigravity manages sessions, clicks refs, and pulls localized storage. 
*Example Execution Steps:*
- Always use a named session to persist context across bash bounds: `npx @playwright/cli -s=ui-qa open [url]`.
- Instead of raw UI clicks, rely on reading the `[Snapshot](.playwright-cli/page-...yml)` outputs efficiently for semantic reference targets.
- Prohibit running bare `screenshots` or `google-chrome-stable` workarounds.

---

### 3. Rules & Automation Hardening

#### [MODIFY] [general.md](file:///home/kyesh/GitRepos/fine_grain_access_control/.agent/rules/general.md)
We will refactor Rule 7 (which currently mentions `use headed mode and use the user profile`) to definitively route the agent's behavior globally:
*   "**NEVER directly call raw `playwright` generic screenshot tools.** When requested to analyze or test the UI interactively, you MUST explicitly trigger the `/browser-agent` workflow which properly initializes `@playwright/cli` bound to our configuration and dedicated named sessions."

## Open Questions
> [!WARNING]
> Do you prefer keeping the user data securely mapped directly in `.playwright_user_data`, or should we abstract it to `.auth/storageState.json` (Playwright's classic pattern) and use `playwright-cli state-load` manually per session? The persistent user directory is currently favored because you can manually drive the window concurrently.

## Verification Plan
1. Apply the configuration file natively into the workspace.
2. Draft and commit the explicit `.agent/workflows/browser-agent.md` and updated `general.md` rules.
3. Automatically execute a dry-run test: `/browser-agent https://fine-grain-access-control-2dewkpzdm-kenyesh-gmailcoms-projects.vercel.app/dashboard` and verify Antigravity seamlessly loads your *already logged in* profile and intelligently summarizes the loaded DOM via the CLI snapshots.
