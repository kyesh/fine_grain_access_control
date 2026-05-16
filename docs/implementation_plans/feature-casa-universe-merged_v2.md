# Unified Security & Universe Domain Deployment - Revision 2

Merge the other agent's architecture (`feature/universe-domain-deploy`) seamlessly into the CASA Tier 2 remediation timeline (`feature/casa-tier-2-prep`), ensuring no security loopholes are accidentally orphaned.

## Answers to User Comments

1. **Rebase vs Merge:** Yes! Using a `rebase` is the cleanest option. Instead of a messy merge commit, I will rebase our CASA security branch onto the newest `universe-domain-deploy` commits. I will pause the rebase when it hits the conflict on `actions.ts`, perfectly stitch together the `jose` RSA creation loop with the `!safeRegex()` check loop, and continue the rebase.
2. **SAQ Updates:** **Yes!** Your other agent's work drastically improves our architecture. Our `CASA_SAQ_Answers.md` currently says we just store "proxy tokens". We *must* update this to reflect that we now issue fully-compliant RSA Public/Private keypairs, hand the private key straight to the user as a JSON, and natively parse standard JWTs. I've added a section below to update the SAQ exactly for this.

## Proposed Changes

### Rebase & Code Updates
#### [MODIFY] [package.json](file:///home/kyesh/GitRepos/fine_grain_access_control/package.json)
- Rebase will pause here. I will unify NPM dependencies to ensure both the `safe-regex` toolkit and `jose` (for RSA Keypairs) are loaded.

#### [MODIFY] [src/app/dashboard/actions.ts](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/dashboard/actions.ts)
- Rebase will pause here. I will resolve the conflict by keeping the newly minted RSA implementation (`jose.generateKeyPair`).
- Re-instate the explicit `!safeRegex()` security gateway checks immediately before Database Insert hooks for access rules.

### Documentation Polish
#### [MODIFY] [docs/CASA_SAQ_Answers.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/CASA_SAQ_Answers.md)
- Update Q1 (Architecture) to detail our new Google SDK-compliant RSA Service Account mapping & native JWT parsing routing.
- Update Q2 (Encryption) to reflect that we now only store the *Public RSA Key* in our database and force the Private RSA Key to strictly live with the user.

## Verification Plan

### Database & State
- Run `npm run db:branch` internally and ensure Vercel uses the Neon database natively. The other agent has successfully placed `0003_huge_celestials.sql` into the migration runner.

### Security Validation
- **SAST Check**: Re-run Semgrep locally to prove ReDoS checks survived the rebase.
- **DAST Check**: Trigger the live Vercel Preview from the rebased PR. Run OWASP ZAP baseline docker scan against the deployment utilizing Vercel bypass tokens and Clerk Session state.
