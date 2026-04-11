---
trigger: always_on
---

When asked to work on a task you should:

1. **Branching**: Always pull in the latest changes from main and create a new branch when starting a new work.
2. **Database Changes**: Follow the strict workflow defined in `.agent/rules/database.md`. Always run `npm run db:branch` BEFORE schema changes to enforce Neon branching.
3. **Implementation Plans**: Document implementation plans as you normally would but please save a copy of each revision in `docs/implementation_plans/[branch_name]_v[revision].md`. If the file already exists, increment the revision number by 1 instead of editing it. This ensures we can easily review past implementation plans, track how they evolved over time, and reference back to what happened for QA and validation work.
4. Review the docs folder and make updates to the docs and data model based on your changes.
5. Commit frequently as you work through the problem.
6. **Validation**: Validate changes work locally and then in the preview branch using the `/deploy-pr-preview` workflow and the browser tool to run through applicable `docs/QA_Acceptance_Test` before handing it back to the user for review.
7. **Browser Automation**: NEVER directly call raw `playwright` generic screenshot tools or write ad-hoc Node.js scripts. When requested to analyze or test the UI interactively, you MUST use the `/browser-agent` workflow (`.agent/workflows/browser-agent.md`) which uses `@playwright/cli attach --cdp=http://localhost:9222` to connect to the user's real Chrome browser, preserving all Google sign-in sessions and cookies.


### Security, Safety, and Workflow Best Practices

- **Strict UI Policy**: Put debug information exclusively in server logs. NEVER render debug identifiers, developer tokens, or internal error objects directly into the HTML/UI.
- **Git Hook Restrictions**: NEVER bypass Git hooks without explicit user approval. Stop and investigate failures like secret scanning to prevent compromised credentials.
- **Never Push to Main**: NEVER push changes directly or merge automatically to the `main` branch. Always open a PR, use `/deploy-pr-preview` for validation, and leave `/deploy-prod` for the user.
