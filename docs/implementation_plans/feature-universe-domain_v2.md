# Support `universe_domain` for Seamless Integration

This plan details the implementation of Google's `universe_domain` configuration. This approach improves the user experience dramatically—providing a true "Zero Code Change" drop-in credential mapping. Users download a generated Service Account JSON (`"universe_domain": "fgac.ai"`) instead of writing manual overrides in their application initialization code.

## User Feedback Integrated

**Safer approach to JWTs:**
We are eliminating the "Dummy RSA" approach from the v1 plan. As per your concerns regarding sending proxy keys inside unencrypted JWT claims, we will instead dynamically generate a real, unique RSA Keypair when the user creates an API key. 
- *Difficulty:* Medium. Requires adding a `public_key` column to `proxyKeys` table, generating keys using Node's `crypto` module, and importing `jose` to properly verify cryptographic signatures at the token exchange endpoint.
- *Backward compatibility:* This doesn't change or break existing users. The `sk_proxy...` format continues to work if they just want to inject a Bearer token. 

**Vercel / Cloudflare CLI Configuration & Route Conflicts**
- **Route conflicts:** There are no API conflicts. Our `src/middleware.ts` will explicitly check the incoming subdomain in the request (`oauth2.fgac.ai` vs `gmail.fgac.ai`) and internally rewrite the path.
- **CLI Tooling:** I will use Vercel CLI (or dashboard checks) and Cloudflare CLI commands to ensure `*.fgac.ai` wildcard DNS is configured securely.

**Dealing with Preview and Local Environments**
- **Local:** We can use `127.0.0.1.nip.io` as the local `universe_domain`. `gmail.127.0.0.1.nip.io` will automatically resolve back to `localhost` without needing `/etc/hosts` changes.
- **Preview / Dev:** Vercel doesn't support wildcard sub-domains dynamically generated on a preview deployment (e.g., `*.<slug>.vercel.app`). For Vercel preview environments specifically, automated testing will still use explicit `api_endpoint` overrides in the test scripts. Only Production (`*.fgac.ai`) will utilize the seamless JSON `universe_domain`.

**UX Comparison**
* **Old UX:** "Here is your `sk_proxy_123` token. Go into your codebase, find where you initialize Google's SDK, and configure `client_options={api_endpoint: "https://fgac.ai/api/proxy"}`."
* **New UX:** "Download this `fgac-credentials.json` file. Export its path to `GOOGLE_APPLICATION_CREDENTIALS` on your server and you're good to go." 

---

## Proposed Changes

### Database Changes
#### [MODIFY] `src/db/schema.ts`
- Add an optional `publicKey` column (`text`) to the `proxyKeys` table to store the RSA public key associated with that specific proxy token.

### Backend Components

#### [NEW] `src/middleware.ts`
- Handle subdomain routing explicitly via Next.js Edge Middleware.
- Intercept requests for `oauth2.*` and rewrite them to `/api/auth/token`.
- Intercept requests for `gmail.*` and rewrite them to `/api/proxy/...`.

#### [NEW] `src/app/api/auth/token/route.ts`
- Receive `POST` requests with a standard OAuth2 `jwt-bearer` grant type.
- Fetch the `public_key` for the targeted user from the database and verify the JWT cryptographic signature.
- If verified successfully, return `{ "access_token": "sk_proxy_...", "token_type": "Bearer", "expires_in": 3600 }`.

### Frontend Components

#### [MODIFY] `src/app/dashboard/actions.ts`
- Modify `createProxyKey`. Alongside generating the `sk_proxy_...` ID, we will run `crypto.generateKeyPair` to spin up an RSA-2048 keypair. We save the `publicKey` to the database and return the private key just once to the UI.

#### [MODIFY] `src/app/dashboard/page.tsx`
- Build a "Download Service Account JSON" action next to each API credential, baking the raw private key and settings into the downloadable JSON blob. Note: Because private keys aren't persistently stored on our server, users will only be able to download the full `universe_domain` JSON immediately upon key creation, much like how AWS/Google handles secrects.

### Documentation

#### [MODIFY] `src/app/setup/page.tsx` & `docs/user_guide.md`
- Clarify both integration patterns: Standard Bearer Token vs `universe_domain` zero-code configuration.

---

## Verification Plan

### QA Acceptance Tests
I will execute the following manual/automated test to validate end-to-end functionality:
1. `docs/QA_Acceptance_Test/01_signup_and_credential_workflow.md` - Ensuring users can successfully create a key under the new RSA keypair standard.
2. `docs/QA_Acceptance_Test/02_gmail_fine_grain_control.md` - Ensuring the JSON tokens authenticate properly and get routed through the `universe_domain` correctly locally using `.nip.io`.
