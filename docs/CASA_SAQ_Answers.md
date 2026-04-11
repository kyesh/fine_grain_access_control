# CASA Tier 2 Self-Assessment Questionnaire (SAQ) - Draft

**Application Name:** FGAC.ai
**Google OAuth Scopes Justified:** `gmail.readonly`, `gmail.send`, `gmail.modify`
**Primary Purpose:** Fine Grain Access Control proxy for AI Agents using Google APIs.

## 1. Application Architecture & Data Flow
**Q: Describe the architecture of your application and how it handles user data.**
Our application acts strictly as a proxy middleware interface. The backend is hosted on Vercel Edge functions and primarily written in Node.js (TypeScript). AI Agents authenticate by generating standard JWTs signed with dynamically provided true RSA Private Keys (mimicking Google Cloud Service Accounts exactly, including explicit `universe_domain` declarations). We parse these incoming JWT signatures strictly within our edge network utilizing the `jose` crypto library. Upon successful signature validation, we verify the granular access rules stored in our Neon Postgres database natively. If the rules pass, we inject the active Google OAuth token to forward the exact request structure to the official Google APIs. We receive the response from Google, apply algorithmic redaction and filtering via user-defined Regex blacklists/whitelists, and return the safe JSON payload to the requesting Agent.

## 2. Data Storage & Encryption
**Q: How and where is Google User Data stored?**
Google User Data *is never permanently stored* on our infrastructure. We do not persist messages, email bodies, subject lines, or attachments. The only data processed is temporarily held in memory during the real-time proxy evaluation sequence. 

Tokens and metadata (Access Rules, Blacklists, user emails, and Public RSA Keys) are securely stored in our Neon Serverless Postgres database. Connections to the database are strictly encrypted via TLS, and sensitive columns are encrypted at rest by the database provider. We explicitly enforce that newly generated RSA Private Credentials are synchronously downloaded to the user's local machine via standard JSON files and are immediately discarded from memory to guarantee stateless edge storage compliance.

## 3. Data Deletion
**Q: What is your data deletion policy?**
We offer a 1-click self-serve deletion mechanism for users via our dashboard. Upon account deletion, or upon disconnection of the Google Workspace integration, we immediately issue a revocation request to the Google OAuth endpoint. Concurrently, all proxy tokens, access rules, and related metadata are permanently purged from our PostgreSQL database. We actively enforce a Zero-Data-Retention policy for the actual contents of Gmail messages.

## 4. Security Measures & Pre-Scan Results
**Q: What vulnerability scanning do you perform?**
We perform both Static Application Security Testing (SAST) and Dynamic Application Security Testing (DAST) continuously during our development lifecycle.
- **SAST (Open Source):** We utilize Semgrep for semantic code logic analysis and npm audit for dependency vulnerability resolution.
- **DAST (Open Source):** We actively leverage OWASP ZAP automated baseline scans during staging deployments against isolated, seeded development databases. 

Our latest pre-scan remediation reports zero High or Critical vulnerabilities.
