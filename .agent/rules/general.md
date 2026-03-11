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
