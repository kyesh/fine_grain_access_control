# CASA Tier 2 Assessment Preparedness Plan

Based on the email from Google and the requirements of the Cloud Application Security Assessment (CASA), we must engage an authorized lab (TAC Security) to obtain a Letter of Validation (LoV) for the `gmail.modify` scope by July 2, 2026.

Running open-source tests beforehand (Pre-Scanning) is no longer the official submission method for CASA, but it is heavily recommended. Using Dynamic Application Security Testing (DAST) and Static Application Security Testing (SAST) up-front fixes "low-hanging fruit" vulnerabilities, which significantly reduces the back-and-forth cycles with the authorized lab and minimizes overall time to validation.

## User Review Required
> [!IMPORTANT]
> Please review the execution order below. The tasks are structured to emphasize parallel execution where possible (e.g., SAST can run immediately). Notice the clarification regarding Clerk test environments vs production environments.

## Proposed Strategy

### Phase 1: Pre-Assessment Preparation (Local & Staging configurations)

To successfully run DAST (OWASP ZAP) against our application, we need to create a dedicated testing environment that bypasses protections but doesn't negatively impact production metrics.

#### Clerk Configuration Clarification
- **Prod vs Dev:** Vercel Preview environments inherently use the `.env.preview` file. This file configures Clerk with `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...`. The `pk_test` implies it points exclusively to Clerk's isolated **Development** instance. ZAP scans will absolutely not touch production data or production user accounts.
- **Test Accounts/Tokens:** Clerk offers Testing Tokens for automated test runners like Playwright and Cypress to bypass bot detection. However, DAST tools like ZAP operate differently: they don't simulate browser clicks, they spider HTTP endpoints. The standard procedure for a DAST tool is session persistence. We manually authenticate once, capture the resulting token/cookie (`__session`), and configure ZAP to attach it to all its crawl requests as if it were the authenticated user.

#### Execution Timeline (Parallel vs Blocking)
The following dictates exactly who does what, and in what order, to maximize speed.

**[ PARALLEL EXECUTION ALLOWED ]**
*These two tasks can be done simultaneously right now.*

*   🤖 **Task 1 (Agent): Execute Fluid Attacks CLI (SAST)**
    - *Dependency:* None.
    - *Action:* I will create the `config.yaml` and run the raw codebase against Fluid Attacks via Docker to find vulnerabilities statically.
*   🚹 **Task 2 (Human): Vercel Dashboard Configurations**
    - *Dependency:* None.
    - *Action 1 (Disable Analytics):* Go to Vercel Project Dashboard -> Settings -> Environment Variables. Add an override for `NEXT_PUBLIC_POSTHOG_KEY` specifically for `feature/casa-tier-2-prep` and set the value to `DISABLED`.
    - *Action 2 (Bypass Auth):* Go to Settings -> Deployment Protection. Enable "Protection Bypass for Automation". Generate a Secret. Save this value to a local file `.vercel_bypass` in your project root.

**[ BLOCKING EXECUTION ]**
*These tasks must happen strictly sequentially.*

*   🤖 **Task 3 (Agent): Deploy Staging Environment**
    - *Dependency:* Blocks on Task 2 (Environment variables must be set first).
    - *Action:* I will execute the Vercel deployment specifically for this branch and return the live Preview URL.
*   🚹 **Task 4 (Human): Capture Clerk Session Cookie**
    - *Dependency:* Blocks on Task 3 (URL must be live).
    - *Action:* Open your browser to the provided Preview URL. Inject `x-vercel-protection-bypass: <YOUR_SECRET>` via an extension (like ModHeader). Log in manually using a standard email provider flow. Open DevTools -> Application -> Cookies and grab the `__session` value. Save it locally as `.clerk_session`.
*   🤖 **Task 5 (Agent): Execute OWASP ZAP (DAST)**
    - *Dependency:* Blocks on Task 4 (Need the valid session cookie).
    - *Action:* I will execute the OWASP ZAP docker container locally, pointing to the Preview URL, while injecting the Vercel Bypass headers and the Clerk Session cookie so it can scan authenticated routes.

### Phase 2: Dockerization Clarification
You asked if we need to Dockerize our Application. 
- **Answer:** **No, we do not.** TAC Security operates by either running DAST against an accessible web endpoint (which we provide via Vercel) or by running SAST against our source code. The CASA Tier 2 framework evaluates the security of the application and its data flow, irrespective of whether it runs on Vercel or a self-hosted Docker container. Docker is only needed locally *to run the scanning tools themselves* (ZAP and Fluid Attacks).

### Phase 3: Engaging TAC Security & SAQ Prep
1. 🤖 **Task 6 (Agent):** I will scaffold out the CASA SAQ markdown documentation (Architecture, Trust Boundaries, Deletion Policy) for us to review.
2. 🚹 **Task 7 (Human):** Contact TAC Security to initiate the Tier 2 assessment, providing them the Vercel preview URL (and bypass header) for their official scan.

## Verification Plan

### Automated Tests
- Execution of the `fluidattacks` Docker scanner on the local codebase. Resolving all Critical/High severity results.
- Execution of the `zaproxy` Docker baseline scanner against staging. Resolving all Critical/High severity results.

### Manual Verification
- Review the generated SAQ documentation.
- Track communication with TAC Security to closure, culminating in receiving the LoV (Letter of Validation) and uploading it to the Google OAuth portal.
