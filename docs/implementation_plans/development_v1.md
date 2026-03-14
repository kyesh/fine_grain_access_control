# MVP Implementation Plan: Fine-Grained Google API Proxy

This document outlines the development roadmap for building the MVP based on our agreed-upon architecture (Vercel, Neon Postgres, Clerk) and QA Acceptance Test specifications.

## Required API Keys & Credentials
To fully complete the backend integration and end-to-end testing, the following credentials will eventually be required. **However, development can begin immediately without them (see Phase 1).**

1. **Clerk Credentials**: 
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` for authentication and OAuth token management.
2. **Neon Serverless Postgres**:
   - `DATABASE_URL` (and `neon__POSTGRES_URL` for branch environments) for the database connection.
3. **Google Cloud Console**:
   - Google `CLIENT_ID` and `CLIENT_SECRET` (These will be plugged into the Clerk dashboard to enable the Google OAuth consent screen with Drive/Gmail/Calendar scopes).

---

## Proposed Changes / Development Roadmap

We are structuring the MVP development to build out the full, production-ready systems now, but we will wait to fully test/launch until the required API keys are available. We will build the application using **Next.js (App Router)** deployed to Vercel, using **Tailwind CSS** for a premium UI, and **Drizzle ORM** for database management.

### Phase 1: Project Scaffolding & Database Setup
We will stand up the core project and database structure without any mock data.

#### [NEW] `schema.ts` (Database Layer)
- Define the Drizzle ORM schema for Neon Postgres.
- **Tables**:
  - `users` (mapped to Clerk user IDs).
  - `access_rules` (the fine-grained rules linking a Clerk User to a Google service, action type, whitelist/blacklist regex, and rule name).
- *(Note: We are offloading all proxy credential generation and token lifecycle management to Clerk.)*

### Phase 2: Auth, API Keys, and UI Integration
Once the Clerk keys are available, we will implement the real user flows.

#### [NEW] Next.js Dashboard UI (Frontend Layer)
- **Landing Page**: A premium, modern landing page explaining the proxy service.
- **Onboarding Flow**: Integrate the Clerk `<SignIn />` and `<SignUp />` components. Ensure the Google OAuth connection is requested during sign-up. We will use Clerk's API key management or custom JWT features to issue the `proxy_credentials` string given to the agent.
- **Access Control Dashboard**: A dynamic dashboard where users can view their proxy key and manage their rules that save directly to Neon.
  - UI for creating "Whitelist Outbound" and "Blacklist Inbound" rules.
  - UI to name Regex rules (e.g., "Block Project X").
  - "Quick Add" buttons for Security Templates (2FA, Password Resets).

### Phase 3: The Proxy Engine
Once the Clerk Google OAuth and Neon keys are available, we will build the core routing logic.

#### [NEW] Proxy API Route (`app/api/proxy/[...path]/route.ts`)
- **Ingestion & Auth**: Intercept the incoming request. Use the Clerk SDK (`auth()`) to validate the incoming Bearer token (the proxy key the agent is holding) to securely identify the user. Ensure strict multi-tenant isolation.
- **Rule Engine**: Query Neon Postgres for the user's rules and evaluate the requested path/payload against the regex lists.
- **Google Token Exchange**: If the request passes the rules engine, make the Clerk backend SDK call (`clerkClient.users.getUserOauthAccessToken(userId, 'oauth_google')`) to retrieve the user's *real*, fresh Google Access Token.
- **The Pass-Through**: Append the real Google token and forward the exact payload to `https://www.googleapis.com`, returning the response to the agent.

---

## Verification Plan

We will verify this implementation strictly against the tests defined in the `docs/QA_Acceptance_Test/` directory.

### Automated Tests
- We will write unit tests for the Rule Evaluation Engine (the logic that checks an email address or body content against the user's Regex rules) to ensure the core security logic is flawless before it ever touches a network request.

### Manual Verification
1. **Sign-up & Multi-tenant Test**: We will manually execute the steps in `docs/QA_Acceptance_Test/01_signup_and_credential_workflow.md` using two separate Google accounts to verify the Clerk integration and data isolation.
2. **Agent Simulation**: We will write a simple Python script using `google-api-python-client`. We will configure it with the `api_endpoint` override pointing to our local dev server and manually execute the whitelist/blacklist tests in `docs/QA_Acceptance_Test/02_gmail_fine_grain_control.md` to ensure the proxy correctly intercepts, blocks, and formats the error messages (including the named regex rules and the 2FA structural alert).
