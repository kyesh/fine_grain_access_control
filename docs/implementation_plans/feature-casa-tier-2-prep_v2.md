# CASA Tier 2 Assessment Preparedness Plan

Based on the email from Google and the requirements of the Cloud Application Security Assessment (CASA), we must engage an authorized lab (TAC Security) to obtain a Letter of Validation (LoV) for the `gmail.modify` scope by July 2, 2026.

Running open-source tests beforehand (Pre-Scanning) is no longer the official submission method for CASA, but it is heavily recommended. Using Dynamic Application Security Testing (DAST) and Static Application Security Testing (SAST) up-front fixes "low-hanging fruit" vulnerabilities, which significantly reduces the back-and-forth cycles with the authorized lab and minimizes overall time to validation.

## User Review Required
> [!IMPORTANT]
> Please review the specific architecture configuration steps in Phase 1. We must execute these accurately to avoid polluting production analytics or hitting authentication walls during the automated vulnerability scans. 

## Proposed Strategy

### Phase 1: Pre-Assessment Preparation (Local & Staging configurations)

To successfully run DAST (OWASP ZAP) against our application, we need to create a dedicated testing environment that bypasses protections but doesn't negatively impact production metrics.

1. **Vercel Configuration (Staging Environment)**
   - We will utilize Vercel Preview Deployments (confirmed active via `vercel ls`).
   - By default, Vercel Preview URLs are protected by Vercel Authentication. DAST scanners will simply scan the Vercel Login page if not configured properly.
   - **Action:** We will generate a **Vercel Protection Bypass Secret** in the Vercel dashboard and configure the OWASP ZAP Docker container to inject the `x-vercel-protection-bypass: <secret>` header into every request.

2. **Clerk Configuration (Authentication)**
   - DAST scanners cannot navigate Clerk's complex UI (OAuth, CAPTCHAs, MFA) to log in dynamically.
   - **Action:** We will manually log in to the preview environment with a test account, capture the active Clerk `__session` cookie, and configure ZAP to use this cookie globally. This ensures ZAP scans authenticated routes and API endpoints instead of just the public homepage.

3. **PostHog Configuration (Analytics Protection)**
   - DAST tools generate tens of thousands of rapid, malformed requests. If PostHog tracks these, it will permanently pollute our product analytics and potentially incur overage charges.
   - **Action:** In the Vercel Preview environment variables for this specific branch, we will omit or set `NEXT_PUBLIC_POSTHOG_KEY` to an empty string. As verified in `src/app/providers.tsx`, this will completely disable PostHog initialization for the scan environment.

4. **SAST & DAST Execution (Dockerized Scanning Tools)**
   - **SAST (Static Analysis):** Run *Fluid Attacks CLI* locally using Docker. This tool scans the raw source code for exposed keys, insecure dependencies, and hardcoded vulnerabilities.
   - **DAST (Dynamic Analysis):** Run *OWASP ZAP (Zed Attack Proxy)* via Docker, pointing it to our dedicated Vercel Preview URL with the Clerk Session Cookie and Vercel Bypass headers attached.
    > [!WARNING]
    > **Never** point OWASP ZAP at the Production database/environment, as it will simulate attacks and can disrupt real user data.

### Phase 2: Dockerization Clarification
You asked if we need to Dockerize our Application. 
- **Answer:** **No, we do not.** TAC Security operates by either running DAST against an accessible web endpoint (which we provide via Vercel) or by running SAST against our source code (which they can access if granted, or we provide). The CASA Tier 2 framework evaluates the security of the application and its data flow, irrespective of whether it runs on Vercel or a self-hosted Docker container. Docker is only needed locally *to run the scanning tools themselves* (ZAP and Fluid Attacks).

### Phase 3: Documentation Readiness (SAQ Prep)
We must prepare answers for a Self-Assessment Questionnaire (SAQ). We should create a new document in `docs/CASA_Assessment/` to track:
1. **Architecture & Trust Boundaries:** A simple model of how data enters, is processed by our service, and is stored or destroyed.
2. **Data Deletion Policy:** Documentation on how user data is securely erased when requested or when an account is deleted.
3. **Scope Justification:** Finalized documentation justifying why `gmail.modify` is absolutely required over `gmail.readonly` (already noted in previous email threads, but should be formalized).

### Phase 4: Engaging TAC Security
1. Since we have verbally frozen the feature branches and confirmed TAC Security as the vendor, we will contact them to initiate the Tier 2 assessment.
2. Submit our ready-made SAQ, architecture documentation, and provide them the Vercel preview URL (and bypass header) for their official scan.

## Verification Plan

### Automated Tests
- Execution of the `fluidattacks` Docker scanner on the local codebase. Resolving all Critical/High severity results.
- Execution of the `zaproxy` Docker baseline scanner against staging. Resolving all Critical/High severity results.

### Manual Verification
- Review the generated SAQ documentation.
- Track communication with TAC Security to closure, culminating in receiving the LoV (Letter of Validation) and uploading it to the Google OAuth portal.
