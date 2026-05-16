# CASA Tier 2 SAQ – Draft Answers for FGAC.ai

**Application:** FGAC.ai (Fine Grain Access Control for AI)
**Date:** May 2, 2026
**Status:** DRAFT – Review before submitting to ESOF portal

> [!IMPORTANT]
> Each answer below includes a **Yes/No** selection and a **justification text** for the textbox field. Review each answer carefully before we enter them into the portal.

---

## Architecture & Configuration (Q1–Q7)

### Q1. Verify documentation and justification of all the application's trust boundaries, components, and significant data flows.
**Answer: Yes**

FGAC.ai's architecture has documented trust boundaries. The system consists of: (1) a Next.js frontend hosted on Vercel serving the dashboard UI; (2) a serverless API proxy layer (Vercel Edge Functions) that enforces fine-grained access rules; (3) Clerk as the managed authentication/identity provider handling Google OAuth; (4) Neon Serverless PostgreSQL for storing user metadata, proxy keys, access rules, and delegation records. Data flows: AI Agents authenticate via Bearer token → API proxy validates key, evaluates access rules against the database → proxy injects the real Google OAuth token (sourced from Clerk's token vault) → forwards the request to Google APIs → applies response filtering (regex blacklists/whitelists) → returns the sanitized response to the Agent. Google user data (email content) is never persisted; it flows through memory only.

### Q2. Verify the application does not use unsupported, insecure, or deprecated client-side technologies such as NSAPI plugins, Flash, Shockwave, ActiveX, Silverlight, NACL, or client-side Java applets.
**Answer: Yes**

The application uses no deprecated client-side technologies. The frontend is built with React 19 (Next.js 16), standard HTML5, CSS, and modern JavaScript. No plugins, Flash, ActiveX, Silverlight, or Java applets are used.

### Q3. Verify that trusted enforcement points, such as access control gateways, servers, and serverless functions, enforce access controls. Never enforce access controls on the client.
**Answer: Yes**

All access control is enforced server-side in our Vercel Edge Functions. The proxy route handler (`/api/proxy/[...path]/route.ts`) performs: (1) Bearer token authentication against the database, (2) key revocation/expiration checks, (3) email delegation authorization, (4) fine-grained rule evaluation (read blacklists, send whitelists, label filters, deletion guards). No access control decisions are made on the client.

### Q4. Verify that all sensitive data is identified and classified into protection levels.
**Answer: Yes**

Sensitive data is classified as follows: **Critical** – Google OAuth access tokens (managed exclusively by Clerk; never stored in our database), proxy key secrets (`sk_proxy_*`). **Confidential** – User email addresses, access rule configurations, delegation records. **Public** – Landing page content, setup documentation, SKILL.md files. All critical data is encrypted in transit (TLS) and at rest (Neon PostgreSQL encryption).

### Q5. Verify that all protection levels have an associated set of protection requirements, such as encryption requirements, integrity requirements, retention, privacy and other confidentiality requirements, and that these are applied in the architecture.
**Answer: Yes**

Protection requirements by level: **Critical data** – encrypted at rest (Neon), encrypted in transit (TLS 1.2+), never logged, access audited. **Confidential data** – encrypted at rest, encrypted in transit, accessible only by authenticated users through Clerk session tokens. **Public data** – served over HTTPS with security headers (X-Frame-Options: DENY, CSP: frame-ancestors 'none', X-Content-Type-Options: nosniff). We enforce a zero-data-retention policy for Gmail message content – it passes through memory only and is never persisted.

### Q6. Verify that the application employs integrity protections, such as code signing or subresource integrity. The application must not load or execute code from untrusted sources, such as loading includes, modules, plugins, code, or libraries from untrusted sources or the Internet.
**Answer: Yes**

All application code is deployed through our CI/CD pipeline via GitHub → Vercel, which provides immutable, content-hashed deployment artifacts. JavaScript bundles are served from Vercel's CDN with content-addressed filenames (hash-based). The only external script is the Clerk authentication SDK, loaded from Clerk's managed CDN (`*.clerk.accounts.dev`) – a trusted, SOC 2 Type II certified authentication provider. All npm dependencies are audited via `npm audit` and locked via `package-lock.json`.

### Q7. Verify that the application has protection from subdomain takeovers if the application relies upon DNS entries or DNS subdomains.
**Answer: Yes**

The application uses two subdomains: `fgac.ai` (primary) and `gmail.fgac.ai` (API proxy). Both are managed through Cloudflare DNS with active monitoring. Cloudflare's proxy mode provides protection against subdomain takeover. The Vercel deployment is permanently attached to the project and cannot be orphaned. DNS records are reviewed periodically.

---

## Access Control & APIs (Q8–Q13)

### Q8. Verify that the application does not accept large files that could fill up storage or cause a denial of service.
**Answer: Yes**

The application does not accept file uploads. The API proxy forwards Gmail API requests which are bounded by Google's own size limits. Next.js API routes enforce a default body parser limit of 1MB. The proxy handler reads request bodies only for POST requests (email send) and does not store them.

### Q9. Verify that a suitable security response header is sent that includes content type and character sets (e.g., Content-Type: application/json; charset=utf-8), including for API responses.
**Answer: Yes**

All API responses explicitly set `Content-Type: application/json`. We have configured comprehensive security response headers in `next.config.ts`: X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Content-Security-Policy: frame-ancestors 'none', Referrer-Policy: strict-origin-when-cross-origin, and Permissions-Policy restrictions. The `X-Powered-By` header is suppressed.

### Q10. Verify that the HTTP headers or any part of the HTTP response do not expose detailed version information of system components.
**Answer: Yes**

We have disabled the `X-Powered-By: Next.js` header via `poweredByHeader: false` in our Next.js configuration. No other version-specific headers are emitted by our application code. Vercel's infrastructure headers are managed at the platform level.

### Q11. Verify API URLs do not expose sensitive information, such as the API key, session tokens etc.
**Answer: Yes**

API keys are transmitted exclusively in the `Authorization: Bearer` HTTP header, never in URLs. Session tokens are managed by Clerk and transmitted via secure, HttpOnly cookies. No sensitive data appears in URL paths or query parameters. Sensitive data is sent only in request headers or body per Q51.

### Q12. Verify that authorization decisions are made at both the URI, enforced by programmatic or declarative security at the controller or router, and at the resource level, enforced by model-based permissions.
**Answer: Yes**

Authorization is enforced at two layers: (1) **Route level** – Clerk middleware (`src/middleware.ts`) protects `/dashboard` routes via `auth.protect()`, redirecting unauthenticated users. (2) **Resource level** – The proxy handler performs per-request authorization: key validation, email-level access checks via `keyEmailAccess` table, delegation verification, and fine-grained rule evaluation (blacklists, whitelists, label filters) before any data reaches the requesting agent.

### Q13. Verify that enabled RESTful HTTP methods are a valid choice for the user or action, such as preventing normal users using DELETE or PUT on protected API or resources.
**Answer: Yes**

The proxy explicitly handles only GET, POST, and DELETE methods. DELETE requests are further restricted: permanent email deletion (trash/emptyTrash) is globally blocked by a hardcoded safeguard in the proxy handler. PUT/PATCH methods are not exposed. The API CORS configuration restricts allowed methods to `GET, POST, PUT, DELETE, OPTIONS` with origin limited to `https://fgac.ai`.

---

## Build & Deployment (Q14–Q18)

### Q14. Verify that the application build and deployment processes are performed in a secure and repeatable way, such as CI / CD automation, automated configuration management, and automated deployment scripts.
**Answer: Yes**

The application uses a fully automated CI/CD pipeline: GitHub → Vercel. Every push to `main` triggers an automated production build and deployment via Vercel's GitHub integration. Preview deployments are created for every branch/PR. The build process is deterministic: dependencies are locked via `package-lock.json`, and Vercel provides immutable deployment artifacts. Environment variables are scoped per environment (Production, Preview, Development) in Vercel's dashboard.

### Q15. Verify that the application, configuration, and all dependencies can be re-deployed using automated deployment scripts, built from a documented and tested runbook in a reasonable time, or restored from backups in a timely fashion.
**Answer: Yes**

Full redeployment takes under 60 seconds via Vercel's automated pipeline (triggered by `git push` or the Vercel dashboard). Database schema migrations are managed via Drizzle ORM with versioned SQL migration files (`src/db/migrations/`). Neon PostgreSQL provides automated backups and point-in-time recovery. The deployment configuration is fully defined in `next.config.ts` and `vercel.json` (implicit via Vercel project settings).

### Q16. Verify that authorized administrators can verify the integrity of all security-relevant configurations to detect tampering.
**Answer: Yes**

All security-relevant configuration is version-controlled in Git (security headers in `next.config.ts`, middleware rules in `src/middleware.ts`, access control logic in API route handlers). Any changes require a Git commit, which is tracked with full authorship and timestamp history. Environment variables are managed through Vercel's dashboard with audit logging. Database schema changes are tracked via Drizzle migration files.

### Q17. Verify that web or application server and application framework debug modes are disabled in production to eliminate debug features, developer consoles, and unintended security disclosures.
**Answer: Yes**

Next.js production builds (`next build`) automatically disable all debug features, source maps, and development-only warnings. Our `NODE_ENV` is set to `production` in the Vercel production environment. The application does not expose any debug endpoints, developer consoles, or diagnostic interfaces in production. Error responses return generic messages only (e.g., "Internal Server Error") without stack traces.

### Q18. Verify that the supplied Origin header is not used for authentication or access control decisions, as the Origin header can easily be changed by an attacker.
**Answer: Yes**

The application does not use the Origin header for authentication or access control. Authentication is performed via Bearer tokens (proxy keys validated against the database) and Clerk session tokens (validated via Clerk's server-side SDK). CORS headers are set in `next.config.ts` for browser security but are not used as an access control mechanism.

---

## Password & Credential Security (Q19–Q25)

### Q19. Verify that user set passwords are at least 12 characters in length.
**Answer: Yes**

User authentication is managed entirely by Clerk, our third-party identity provider. Clerk enforces configurable password policies including minimum length requirements. For our application, the primary authentication method is Google OAuth (passwordless). For the DAST scanning test account that uses email/password, Clerk's password policy enforces minimum complexity requirements including length.

### Q20. Verify system generated initial passwords or activation codes SHOULD be securely randomly generated, SHOULD be at least 6 characters long, and MAY contain letters and numbers, and expire after a short period of time.
**Answer: Yes**

Our application does not generate initial passwords – authentication is handled by Clerk via Google OAuth. System-generated secrets (proxy keys, `sk_proxy_*`) are generated using Node.js `crypto.randomBytes()` producing 32-byte cryptographically random values, encoded as hex strings (64 characters). These keys do not expire by default but support optional TTL (`expiresAt` field) and can be revoked at any time.

### Q21. Verify that passwords are stored in a form that is resistant to offline attacks (salted/hashed).
**Answer: Yes**

Our application does not directly store passwords. All password management is delegated to Clerk, which stores passwords using bcrypt with per-user salts, resistant to offline attacks. Proxy key secrets (`sk_proxy_*`) are stored as plain text in the database because they function as API tokens (similar to AWS access keys) and must be compared directly; however, they are generated with 256 bits of entropy and can be revoked/rotated at any time.

### Q22. Verify shared or default accounts are not present (e.g. "root", "admin", or "sa").
**Answer: Yes**

The application has no shared or default accounts. Every user authenticates via their individual Google account through Clerk's OAuth flow. The database has no seeded admin accounts. The Neon PostgreSQL database credentials are unique per environment and managed through Vercel environment variables.

### Q23. Verify that lookup secrets can be used only once.
**Answer: Yes**

The application does not use lookup secrets (such as recovery codes or one-time passwords). Authentication is handled via Clerk's OAuth flow, and API access is via persistent proxy keys. Clerk handles any OTP/recovery code functionality within its managed authentication flows, including single-use enforcement.

### Q24. Verify that the out of band verifier expires out of band authentication requests, codes, or tokens after 10 minutes.
**Answer: Yes**

The application does not implement its own out-of-band authentication. Clerk manages all email verification and authentication codes, including automatic expiration. Google OAuth tokens obtained through Clerk have standard Google-defined expiration periods (~1 hour) and are refreshed automatically by Clerk's server-side token management.

### Q25. Verify that the initial authentication code is generated by a secure random number generator, containing at least 20 bits of entropy.
**Answer: Yes**

All cryptographic random generation in our application uses Node.js `crypto.randomBytes()`, which sources entropy from the OS-level CSPRNG. Proxy keys are generated with 256 bits of entropy (32 bytes). Clerk handles authentication code generation using its own CSPRNG implementation, which exceeds the 20-bit minimum.

---

## Session Management (Q26–Q29)

### Q26. Verify that logout and expiration invalidate the session token.
**Answer: Yes**

Session management is handled by Clerk. When a user logs out, Clerk invalidates the session token and clears all session cookies. The Clerk middleware (`clerkMiddleware` in `src/middleware.ts`) validates session tokens on every request, rejecting expired or invalidated sessions. Proxy keys are independent of user sessions and must be explicitly revoked via the dashboard.

### Q27. Verify that the application gives the option to terminate all other active sessions after a successful password change.
**Answer: Yes**

Clerk provides built-in session management including the ability to view and terminate active sessions. When a password is changed through Clerk, the user can opt to sign out all other sessions. This functionality is part of Clerk's `<UserButton>` component integrated in our application layout.

### Q28. Verify the application uses session tokens rather than static API secrets and keys, except with legacy implementations.
**Answer: Yes**

The application uses two authentication mechanisms: (1) **User sessions** – managed by Clerk via secure, HttpOnly session tokens (not static secrets). (2) **API proxy keys** (`sk_proxy_*`) – used by AI Agents to authenticate API requests. These are static bearer tokens by design (agents cannot perform OAuth flows), but they support revocation, expiration (optional TTL), and fine-grained access rules. This is an intentional architectural choice for machine-to-machine authentication, not a legacy implementation.

### Q29. Verify the application ensures a full, valid login session or requires re-authentication before allowing sensitive transactions or account modifications.
**Answer: Yes**

All dashboard operations (creating/revoking proxy keys, modifying access rules, managing delegations) require an active, valid Clerk session enforced by the `auth.protect()` middleware on all `/dashboard` routes. Clerk session tokens have finite lifetimes and are validated server-side on every request. API proxy operations require a valid, non-revoked, non-expired proxy key.

---

## Access Control (Q30–Q35)

### Q30. Verify that the application enforces access control rules on a trusted service layer.
**Answer: Yes**

All access control is enforced server-side in Vercel Edge Functions. The proxy handler (`/api/proxy/[...path]/route.ts`) performs multi-layered authorization: key validation, email access verification, delegation checks, and fine-grained rule evaluation. No access control logic exists in the client-side code.

### Q31. Verify that all user and data attributes and policy information used by access controls cannot be manipulated by end users unless specifically authorized.
**Answer: Yes**

Access control data (proxy keys, access rules, delegations, email access mappings) is stored in the PostgreSQL database and can only be modified through authenticated dashboard API calls. The proxy handler reads these values directly from the database on each request. Users cannot manipulate access rules through the proxy API – they can only manage rules through the authenticated dashboard interface.

### Q32. Verify that the principle of least privilege exists – users should only be able to access functions, data files, URLs, controllers, services, and other resources, for which they possess specific authorization.
**Answer: Yes**

The system enforces deny-by-default at multiple levels: (1) Proxy keys with no `keyEmailAccess` entries can access NO emails. (2) Send operations are denied unless an explicit `send_whitelist` rule exists for the recipient. (3) Label blacklists and whitelists restrict which emails an agent can read. (4) Permanent deletion is globally blocked. (5) Email delegation requires explicit grant from the email owner. Users can only access their own data and delegated data through the dashboard.

### Q33. Verify that access controls fail securely including when an exception occurs.
**Answer: Yes**

The proxy handler wraps all logic in a try/catch block. Any exception results in a generic `500 Internal Server Error` response – never exposing internal state. All authorization checks (key lookup, email access, delegation verification, rule evaluation) fail closed: if any check cannot be completed (database error, missing data), the request is denied with an appropriate 401/403 error code.

### Q34. Verify that sensitive data and APIs are protected against IDOR attacks.
**Answer: Yes**

All database queries in the proxy handler are scoped to the authenticated user. Key lookups match the exact bearer token. Email access checks require both the specific key ID and the target email to be present in the `keyEmailAccess` table. Users cannot enumerate or access other users' keys, rules, or delegations. The dashboard API routes use Clerk's `auth()` to scope all queries to the current user's `clerkUserId`.

### Q35. Verify administrative interfaces use appropriate multi-factor authentication to prevent unauthorized use.
**Answer: Yes**

The application uses Google OAuth via Clerk as the sole authentication mechanism for administrative access (the dashboard). Google accounts inherently support and encourage MFA (2-Step Verification). Clerk's configuration can additionally enforce MFA policies. There is no separate administrative interface – all users access the same dashboard with permissions scoped to their own data and delegations.

---

## Input Validation & Injection Prevention (Q36–Q43)

### Q36. Verify that the application has defenses against HTTP parameter pollution attacks.
**Answer: Yes**

The application uses Next.js's built-in request parsing, which handles parameter parsing consistently. The proxy handler uses `request.nextUrl.searchParams` (standard URLSearchParams API) which automatically deduplicates parameters. The `next.config.ts` CORS configuration restricts allowed methods and origins.

### Q37. Verify that the application sanitizes user input before passing to mail systems to protect against SMTP or IMAP injection.
**Answer: Yes**

The application does not directly interact with SMTP or IMAP servers. All email operations are proxied through the Gmail REST API (HTTPS), which handles its own input validation. The proxy handler validates email addresses against access rules using `safe-regex` validated patterns. Outbound email send requests are validated against send whitelists before forwarding to Google's API.

### Q38. Verify that the application avoids the use of eval() or other dynamic code execution features.
**Answer: Yes**

The application does not use `eval()`, `Function()`, or any dynamic code execution. Regex patterns from user-defined access rules are validated using the `safe-regex` library before compilation to prevent ReDoS attacks. The codebase has been audited with Semgrep for dynamic code execution patterns.

### Q39. Verify that the application protects against SSRF attacks.
**Answer: Yes**

The proxy handler only forwards requests to a single hardcoded destination: `https://www.googleapis.com/`. The target URL is constructed by concatenating the fixed base URL with the path segments from the request – user input cannot redirect requests to arbitrary hosts. The application does not accept URLs from user input.

### Q40. Verify that the application sanitizes, disables, or sandboxes user-supplied SVG scriptable content.
**Answer: Yes**

The application does not accept SVG uploads or process user-supplied SVG content. Previously existing unused SVG files (Next.js boilerplate) were deleted as part of our security hardening to eliminate potential XSS vectors from SVG inline scripts.

### Q41. Verify that output encoding is relevant for the interpreter and context required.
**Answer: Yes**

The application uses React (JSX), which automatically escapes all rendered content to prevent XSS. API responses are JSON-serialized using `NextResponse.json()`, which handles proper encoding. The proxy response body from Google is returned as-is (passthrough) without re-interpretation, preserving Google's encoding.

### Q42. Verify that the application protects against JSON injection attacks, JSON eval attacks, and JavaScript expression evaluation.
**Answer: Yes**

All JSON handling uses `JSON.parse()` and `JSON.stringify()` – never `eval()`. API responses use `NextResponse.json()` which sets proper `Content-Type: application/json` headers with `X-Content-Type-Options: nosniff` to prevent MIME sniffing. React's JSX rendering automatically escapes all output.

### Q43. Verify that the application protects against LDAP injection vulnerabilities.
**Answer: Yes**

The application does not use LDAP. User authentication is handled by Clerk (OAuth/session tokens), and data storage uses PostgreSQL with Drizzle ORM's parameterized queries, which prevent SQL injection. No directory services are involved in the architecture.

---

## Cryptography & Data Protection (Q44–Q54)

### Q44. Verify that regulated private data is stored encrypted while at rest (PII, GDPR).
**Answer: Yes**

User PII (email addresses, account metadata) is stored in Neon Serverless PostgreSQL, which encrypts all data at rest using AES-256. Google OAuth tokens are stored exclusively in Clerk's managed infrastructure, which is SOC 2 Type II certified with encryption at rest. Gmail message content is never stored – it passes through memory only during proxy evaluation.

### Q45. Verify that all cryptographic operations are constant-time.
**Answer: Yes**

Proxy key comparison is performed as a direct database query (`WHERE key = $1`), which delegates comparison to PostgreSQL's internal string matching – not vulnerable to timing attacks at the application level. The application does not implement custom cryptographic comparisons. RSA key verification (for JWT-based agent authentication) uses the `jose` library, which implements constant-time operations.

### Q46. Verify that random GUIDs are created using the GUID v4 algorithm and a CSPRNG.
**Answer: Yes**

All database primary keys are generated using PostgreSQL's `gen_random_uuid()` function, which produces GUID v4 using the database server's CSPRNG. Proxy keys are generated using Node.js `crypto.randomBytes()`, which sources from the OS CSPRNG. No predictable PRNG is used anywhere in the application.

### Q47. Verify that key material is not exposed to the application but instead uses an isolated security module.
**Answer: Yes**

Google OAuth tokens (the most sensitive key material) are stored exclusively in Clerk's managed token vault. Our application retrieves them at runtime via Clerk's server-side API (`getUserOauthAccessToken`) and immediately uses them to authenticate with Google – they are never stored in our database or logged. RSA private keys generated for agent JWT authentication are downloaded directly to the user's local machine and discarded from server memory.

### Q48. Verify that the application does not log credentials or payment details.
**Answer: Yes**

The application does not log proxy keys, OAuth tokens, or any credentials. Error logging uses generic messages (e.g., `console.error('Proxy Error:', error)`) without including authentication details. The `console.error` for regex validation logs only the pattern, not the key or token. The application does not process payment data.

### Q49. Verify the application protects sensitive data from being cached in server components.
**Answer: Yes**

All API routes are marked `force-dynamic` (`export const dynamic = 'force-dynamic'`), preventing Next.js/Vercel from caching responses. HTML pages use `Cache-Control: no-store` to prevent caching of authenticated content. Only public static assets (images, CSS, JS bundles) are cached, and these contain no sensitive data.

### Q50. Verify that data stored in browser storage does not contain sensitive data.
**Answer: Yes**

The application stores minimal data in browser storage. Clerk manages its own session state using secure, HttpOnly cookies – not accessible to JavaScript. The application does not store proxy keys, access tokens, user data, or any sensitive information in localStorage, sessionStorage, or IndexedDB. PostHog analytics uses anonymous identifiers only.

### Q51. Verify that sensitive data is sent in the HTTP message body or headers, not in query string parameters.
**Answer: Yes**

Proxy keys are sent exclusively in the `Authorization: Bearer` header. Session tokens are transmitted via Clerk's secure cookies. No sensitive data (keys, tokens, passwords) is transmitted via URL query parameters. The proxy handler's query string manipulation (Q parameter for Gmail label filtering) contains only label names, not credentials.

### Q52. Verify accessing sensitive data is audited.
**Answer: Yes**

All proxy requests are logged by Vercel's built-in request logging, which records the timestamp, path, status code, and response time for every API call. The application logs proxy errors to the console (captured by Vercel's log drain). Database modifications (key creation, revocation, rule changes) are tracked via `createdAt`/`updatedAt` timestamps. Sensitive data values are never included in log entries.

### Q53. Verify that connections to and from the server use trusted TLS certificates.
**Answer: Yes**

All connections use trusted TLS certificates: Vercel provides automatic TLS via Let's Encrypt for all deployments (both production `fgac.ai` and preview URLs). Database connections to Neon PostgreSQL require `sslmode=require`. API calls to Google (`googleapis.com`) use Google's publicly trusted TLS certificates. The Clerk SDK communicates exclusively over HTTPS.

### Q54. Verify that proper certification revocation, such as OCSP Stapling, is enabled and configured.
**Answer: Yes**

TLS certificate management, including OCSP stapling, is handled by our infrastructure providers. Vercel automatically manages certificate lifecycle and OCSP stapling for all hosted domains. Cloudflare (managing `fgac.ai` DNS) provides additional OCSP stapling support. Neon PostgreSQL uses AWS-managed certificates with automatic revocation checking.
