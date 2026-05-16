# Support `universe_domain` for Seamless Integration

This plan implements support for Google's `universe_domain` configuration. This is a massive UX improvement over having users manually override API endpoints in their codebase. By providing a Service Account JSON with `"universe_domain": "fgac.ai"`, users can drop in our credentials locally or in production without needing a single code change. The Google SDK will inherently handle routing to `*.fgac.ai`.

## User Review Required

> [!IMPORTANT]
> **Subdomain Routing & Wildcard DNS Requirements for API routing**
> 
> Because the Google SDK will route requests to `https://{service}.fgac.ai` (e.g., `gmail.fgac.ai` and `oauth2.fgac.ai`), our DNS configuration in Vercel **must** support Wildcard Domains (`*.fgac.ai`). Locally, testing this will require overriding `/etc/hosts` or using a tool like `ngrok`/`localtunnel` with custom subdomains. Is this DNS requirement acceptable?

> [!WARNING]
> **Cryptographic Bypass in JWT**
> 
> Google's SDK strictly requires a mathematically valid RSA private key to generate a JWT. We will bundle a statically generated *dummy* RSA private key in the JSON, but embed the user's secret `sk_proxy...` key inside the `client_email` field (e.g., `sk_proxy_1234@fgac.ai`). Our custom `/api/auth/token` endpoint will parse this JWT to extract the proxy key and issue it as the `access_token`. This avoids needing to store real sensitive RSA private keys in our database while satisfying the Google SDK requirements.

## Proposed Changes

---

### Backend Components

#### [NEW] `src/middleware.ts`
Add a Next.js middleware to handle subdomain routing correctly.
- Intercept requests where `Host` header is `oauth2.fgac.ai` and rewrite them to `/api/auth/token`.
- Intercept requests where `Host` header is any other subdomain (e.g., `gmail.fgac.ai`) and rewrite the path to `/api/proxy/...` so our existing proxy handler processes them.

#### [NEW] `src/app/api/auth/token/route.ts`
Create an OAuth2 token exchange endpoint compatible with Google's Service Account flow.
- Process `POST` requests with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`.
- Decode the provided JWT `assertion`.
- Extract the proxy key from the `iss` (issuer) claim (which will be formatted as `{proxy_key}@fgac.ai`).
- Return a JSON response containing `{"access_token": "sk_proxy_...", "token_type": "Bearer", "expires_in": 3600}`.

### Frontend Components

#### [MODIFY] `src/app/dashboard/page.tsx`
- Add a "Download Service Account JSON" button next to or below each generated Proxy Key.
- This button will generate a Blob dynamically in the browser containing the required JSON structure.
- Generate a static dummy RSA Private key to include in the file download.

### Documentation

#### [MODIFY] `src/app/setup/page.tsx`
- Remove the instructions that tell users they must modify client code and use `client_options={"api_endpoint": ...}`.
- Replace it with a new seamless step: "Download your Service Account JSON and set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable."

#### [MODIFY] `docs/user_guide.md`
- Update the Quick Start guide.
- Explain the `universe_domain` approach.
- Update code blocks to show the standard Google SDK initialization without custom endpoints.
- Explain that the JSON handles the connection securely transparent to their application.

## Open Questions

1. **Local Development**:
   To test `universe_domain` locally, we'll likely need to either edit `/etc/hosts` to point `gmail.fgac.ai` and `oauth2.fgac.ai` to `127.0.0.1` locally, or just rely on Vercel preview environments. Do you have a preferred method for validating local routing?
2. **Key Expiry**: Right now we issue the access token for 3600 seconds, and the SDK will occasionally hit the token endpoint to refresh. Because the proxy key `sk_proxy...` never rotates automatically, providing it verbatim as the "refresh/access" token is fine, correct?

## Verification Plan

### Automated Tests
- Run static analysis (Semgrep) to ensure no vulnerabilities in JWT parsing.

### Manual Verification
- Locally edit `/etc/hosts` to route `googleapis.local` or `fgac.local` to localhost if needed, OR push to Vercel preview branch.
- Generate a Service Account JSON.
- Run a simple Node.js script using the official `googleapis` npm package, pointing to the JSON file via `GOOGLE_APPLICATION_CREDENTIALS`, and ensure it successfully fetches emails through the proxy by inspecting network logs.
