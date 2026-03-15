# Implementation Plan: Public Setup Instructions and Agent Skills

## Goal Description
The objective is to create clear, concise public-facing setup instructions on the website for users to onboard their AI agents with the fine-grain access control (fgac) proxy. We will also create designated "skills" for Claude Cowork, Claude Code, and Open Claw, following their required directory+`SKILL.md` structure. The public setup page and `docs/user_guide.md` will be enhanced to cover configuration with these specific agents and clarify how multiple Gmail accounts operate with a single API key, along with corresponding skill queries. Finally, we will update all documentation references to use the newly acquired domain `fgac.ai`.

## Proposed Changes

### Web Application (Next.js)
---
#### [NEW] [page.tsx](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/setup/page.tsx)
- Create a new public-facing route `/setup`.
- Implement a beautiful, Tailwind-styled UI summarizing:
  1. Create Account
  2. Create API Key
  3. How multiple Gmail accounts work with a single key.
  4. Configure Agent: Provide specific setup instructions for Claude Cowork, Claude Code, and Open Claw.
- Include links/downloads to the Agent Skills for easy integration.
- Ensure all endpoint references point to `https://fgac.ai/api/proxy`.

### Agent Skills
---
#### [NEW] [SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-cowork/SKILL.md)
#### [NEW] [SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)
#### [NEW] [SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/open-claw/SKILL.md)
- Follow the correct format: use directories containing a `SKILL.md` file with YAML frontmatter.
- The skills will instruct the agents to override their default Google API endpoint to `https://fgac.ai/api/proxy` and use the provided proxy key as the Bearer token.
- Include explicit instructions on how multiple Gmail accounts work, specifically detailing how to query delegated/extra accounts through the API path (e.g., using `fgac.ai/api/proxy/gmail/v1/users/{email}/messages`).

### Documentation Updates
---
#### [MODIFY] [user_guide.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/user_guide.md)
- Replace generic `[your-deployment-url]` and `https://your-app.vercel.app` placeholders with `https://fgac.ai`.
- Enhance the guide with specific instructions to provide and configure the API key for Claude Cowork, Claude Code, and Open Claw.
- Expand on the multiple Gmail accounts documentation to explicitly clarify how a single API key handles this and provide examples.

#### [MODIFY] [01_signup_and_credential_workflow.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/01_signup_and_credential_workflow.md)
- Update `https://proxy.ourdomain.com` placeholder to `https://fgac.ai`.

## Verification Plan

### Automated Tests
- Run `npm run lint` and `npm run build` to ensure the Next.js application compiles successfully.

### Manual Verification
1. Start the local server with `npm run dev`.
2. Open a standard web browser to navigate to `http://localhost:3000/setup`.
3. Visually confirm the UI is correctly styled, beautiful, displays the correct domain `fgac.ai`, and includes the multiple email account explanation.
4. Verify the skill files are correctly formatted and accessible in the `public/skills/` directory structure.
