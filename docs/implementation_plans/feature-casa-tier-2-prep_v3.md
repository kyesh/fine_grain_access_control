# CASA Tier 2 Assessment Preparedness Plan

Based on the email from Google and the requirements of the Cloud Application Security Assessment (CASA), we must engage an authorized lab (TAC Security) to obtain a Letter of Validation (LoV) for the `gmail.modify` scope by July 2, 2026.

Running open-source tests beforehand (Pre-Scanning) is no longer the official submission method for CASA, but it is heavily recommended. Using Dynamic Application Security Testing (DAST) and Static Application Security Testing (SAST) up-front fixes "low-hanging fruit" vulnerabilities, which significantly reduces the back-and-forth cycles with the authorized lab and minimizes overall time to validation.

## User Review Required
> [!IMPORTANT]
> Please review the delineation of Human vs Agent tasks below. My CLI access is limited to the local environment and standard Vercel deployments, so certain Dashboard actions must be performed by you.

## Proposed Strategy

### Phase 1: Pre-Assessment Preparation (Local & Staging configurations)

To successfully run DAST (OWASP ZAP) against our application, we need to create a dedicated testing environment that bypasses protections but doesn't negatively impact production metrics.

#### 🚹 Human Action Required (Dashboard & Browse Tasks)
*These tasks require Vercel Dashboard access and manual browser authentication, which I cannot execute via CLI.*

1. **Disable PostHog in Vercel:**
   - Go to your Vercel Project Dashboard -> Settings -> Environment Variables.
   - Find `NEXT_PUBLIC_POSTHOG_KEY`.
   - Add a branch-specific override for `feature/casa-tier-2-prep` and set the value to `DISABLED`. This ensures the DAST test won't pollute production metrics.
2. **Generate Vercel Protection Bypass Secret:**
   - Go to Vercel Project Dashboard -> Settings -> Deployment Protection.
   - Scroll to "Protection Bypass for Automation" and enable it.
   - Generate a Secret. Copy this value and save it in a local file named `.vercel_bypass` in the project root.
3. **Capture Clerk Session for ZAP:**
   - Once I deploy the preview branch, visit the Vercel Preview URL.
   - Use a browser extension (like ModHeader) to inject the header: `x-vercel-protection-bypass: <YOUR_SECRET>`.
   - Log in to the application with a test account.
   - Open Developer Tools -> Application -> Cookies. Copy the value of the `__session` cookie. 
   - Save this value in a local file named `.clerk_session` in the project root.

#### 🤖 Agent Action (Automated CLI Tasks)
*These are the tasks I will run after you complete the human steps.*

1. **Deploy Staging Environment:**
   - I will use `npx vercel build && npx vercel deploy --pre` to deploy the `feature/casa-tier-2-prep` branch explicitly.
   - I will return the specific Preview URL to you for the Clerk session capture step.
2. **Execute OWASP ZAP (DAST):**
   - I will construct and run the OWASP ZAP Docker command locally.
   - I will intelligently inject the headers from the `.vercel_bypass` and `.clerk_session` files:
     ```bash
     docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t <VERCEL_PREVIEW_URL> \
     -config replacer.full_list\(0\).description=vercel_bypass \
     -config replacer.full_list\(0\).enabled=true \
     -config replacer.full_list\(0\).matchtype=req_header \
     -config replacer.full_list\(0\).matchstr=x-vercel-protection-bypass \
     -config replacer.full_list\(0\).regex=false \
     -config replacer.full_list\(0\).replacement=$(cat .vercel_bypass) \
     -config replacer.full_list\(1\).description=clerk_cookie \
     # ... applying the clerk cookie ... 
     ```
3. **Execute Fluid Attacks CLI (SAST):**
   - I will create the `config.yaml` for Fluid Attacks.
   - I will run the `fluidattacks/cli` Docker container against our local codebase to scan for secret leaks and code vulnerabilities.
4. **Draft SAQ Docs:** I will scaffold out the CASA SAQ markdown documentation (Architecture, Trust Boundaries, Deletion Policy) based on the repository structure.

### Phase 2: Dockerization Clarification
You asked if we need to Dockerize our Application. 
- **Answer:** **No, we do not.** TAC Security operates by either running DAST against an accessible web endpoint (which we provide via Vercel) or by running SAST against our source code. The CASA Tier 2 framework evaluates the security of the application and its data flow, irrespective of whether it runs on Vercel or a self-hosted Docker container. Docker is only needed locally *to run the scanning tools themselves* (ZAP and Fluid Attacks).

### Phase 3: Engaging TAC Security
1. Since we have verbally frozen the feature branches and confirmed TAC Security as the vendor, we will contact them to initiate the Tier 2 assessment once our pre-scans are clean.
2. Submit our ready-made SAQ, architecture documentation, and provide them the Vercel preview URL (and bypass header) for their official scan.

## Verification Plan

### Automated Tests
- Execution of the `fluidattacks` Docker scanner on the local codebase. Resolving all Critical/High severity results.
- Execution of the `zaproxy` Docker baseline scanner against staging. Resolving all Critical/High severity results.

### Manual Verification
- Review the generated SAQ documentation.
- Track communication with TAC Security to closure, culminating in receiving the LoV (Letter of Validation) and uploading it to the Google OAuth portal.
