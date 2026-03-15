# Implementation Plan: Deployment Workflows

## Goal Description
The objective is to adapt the Vercel deployment workflows (`deploy-pr-preview.md` and `deploy-prod.md`) from the `Spec-Circulating-Opportunity-Finder` repository to the `fine_grain_access_control` repository to ensure consistent behavior when deploying to preview branches.

## Proposed Changes

### Workflows
---
#### [NEW] .agent/workflows/deploy-pr-preview.md
- Describe the process for creating a PR, waiting for Vercel's preview deployment to reach "Ready" state, validating the deployment URL via a browser subagent, and reporting to the user.
- Adapted the `vercel ls` commands to use the `googleapis-fine-grain-access-control` project name.

#### [NEW] .agent/workflows/deploy-prod.md
- Describe the process of merging the PR, waiting 5 minutes, and validating the Vercel production deployment.
- Adapted the `vercel ls` commands to use the `googleapis-fine-grain-access-control` project name and `curl` check to use `https://fgac.ai/`.

## Verification Plan
1. Ensure the files are placed correctly in `.agent/workflows`.
2. Vercel deployment commands are specific to the `googleapis-fine-grain-access-control` project name.
