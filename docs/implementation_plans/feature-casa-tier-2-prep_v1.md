# CASA Tier 2 Assessment Preparedness Plan

Based on the email from Google and the requirements of the Cloud Application Security Assessment (CASA), we must engage an authorized lab (such as TAC Security) to obtain a Letter of Validation (LoV) for the `gmail.modify` scope by July 2, 2026.

Running open-source tests beforehand (Pre-Scanning) is no longer the official submission method for CASA, but it is heavily recommended. Using Dynamic Application Security Testing (DAST) and Static Application Security Testing (SAST) up-front fixes "low-hanging fruit" vulnerabilities, which significantly reduces the back-and-forth cycles with the authorized lab and minimizes overall time to validation.

## User Review Required
> [!IMPORTANT]
> The original "self-scanning" via the CASA portal has been deprecated in favor of lab-verified assessments for Tier 2. The strategy below uses local SAST and DAST strictly for **pre-assessment readiness** so that your scan with the Authorized Lab (e.g., TAC Security) is clean from the start.

## Proposed Strategy

### Phase 1: Pre-Assessment Preparation (Local & Staging)
1. **SAST (Static Analysis):** Run *Fluid Attacks CLI* locally using Docker. This tool scans the raw source code for exposed keys, insecure dependencies, and hardcoded vulnerabilities.
2. **DAST (Dynamic Analysis):** Deploy the application to a dedicated staging environment (like a Vercel Preview). Run *OWASP ZAP (Zed Attack Proxy)* via Docker to attack the running application to find things like insecure headers, cross-site scripting (XSS), or injection flaws.
    > [!WARNING]
    > **Never** point OWASP ZAP at the Production database/environment, as it will simulate attacks and can disrupt real user data.
3. **Remediation:** Triage and fix any Critical or High vulnerabilities discovered by the SAST/DAST tools. Create GitHub Issues for the remaining tasks and process them.

### Phase 2: Documentation Readiness (SAQ Prep)
We must prepare answers for a Self-Assessment Questionnaire (SAQ). We should create a new document in `docs/CASA_Assessment/` to track:
1. **Architecture & Trust Boundaries:** A simple model of how data enters, is processed by our service, and is stored or destroyed.
2. **Data Deletion Policy:** Documentation on how user data is securely erased when requested or when an account is deleted.
3. **Scope Justification:** Finalized documentation justifying why `gmail.modify` is absolutely required over `gmail.readonly` (already noted in previous email threads, but should be formalized).

### Phase 3: Engaging the Authorized Lab
1. Contact TAC Security (as recommended by the Google email) since they offer a discounted rate for Tier 2 assessments.
2. Submit our ready-made SAQ, architecture documentation, and provide them access to the staging environment for their scan.

## Open Questions

> [!WARNING]
> Please address these questions, as they will define our immediate next steps:

1. **Staging Environment:** Do we have a persistent staging/preview environment that is completely isolated from production data, where we can safely run the OWASP ZAP dynamic test?
2. **Engagement Timeline:** Are there any immediate feature deployments scheduled over the next few weeks that we need to wait for before initiating the external audit with TAC Security? (Usually, you want to freeze major architectural changes during the audit).
3. **Vendor Sign-off:** Are you comfortable proceeding specifically with TAC Security as mentioned in the email, or would you like to evaluate other Authorized Labs?

## Verification Plan

### Automated Tests
- Execution of the `fluidattacks` Docker scanner on the local codebase. Resolving all Critical/High severity results.
- Execution of the `zaproxy` Docker baseline scanner against staging. Resolving all Critical/High severity results.

### Manual Verification
- Review the generated SAQ documentation.
- Track communication with TAC Security to closure, culminating in receiving the LoV (Letter of Validation) and uploading it to the Google OAuth portal.
