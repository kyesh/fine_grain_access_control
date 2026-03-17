---
trigger: always_on
---

When asked to work on a task you should:

1. See if there are relevant github issue(s) with information and create issue(s) if there are no relevant github issue(s)
2. On the github issue(s) Document the context you've learned and your plan for developing a solution
3. Commit frequently as you work through the problem
4. Validate the changes by driving the UI with the web browser tool
5. **Database Changes**: Follow the strict workflow defined in `.agent/rules/database.md`. Always run `npm run db:branch` before schema changes to enforce Neon branching.
6. Review the docs folder and make updates to the docs and data model based on your changes
7. **Strict UI Policy**: Put debug information exclusively in server logs or console outputs! NEVER render debug identifiers, developer tokens, or internal error objects directly into the HTML/UI where end-users can see them.
8. **Implementation Plans**: Document implementation plans as you normally would but please save a copy of each revisions in `docs/implementation_plans/[branch_name]_v[revision].md`. If the file already existing increment the revision number by 1 instead of editing it. This ensures we can easily review past implementation plans, track how they evolved over time, and reference back to what happened for QA and validation work.
9. **Git Hook Restrictions**: NEVER bypass Git hooks (e.g., using `git commit --no-verify`) without explicit user approval. If a commit fails due to a pre-commit hook (such as the secret scanner in `.husky/pre-commit`), you must stop, investigate the failure, and present the findings to the user. Bypassing security checks like secret scanning can lead to compromised credentials. If you believe the hook failure is a false positive (e.g., matching a `.example` file), you must still explain this to the user and request permission to bypass it.
10. **Never Push to Main**: NEVER push changes directly to the `main` branch. Always create a new branch, push the branch, and then open a Pull Request against `main`. Do not merge it immediately; instead, use the `/deploy-pr-preview` workflow to generate a Vercel preview URL for validation. The `/deploy-prod` workflow should NEVER be automated by the agent and is strictly reserved for the user to execute after reviewing the preview.
