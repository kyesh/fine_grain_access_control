# Bug Report: demoClaw gmail-fgac Skill — 401 Token Exchange Failure

**Reported by**: demoClaw team (OpenClaw demo environment)  
**Date**: April 11, 2026  
**Status**: RESOLVED  
**Root Cause**: `universe_domain` does not route Google Workspace API traffic through custom domains. See [ADR-001](../adr/001_universe_domain_rejection.md).

## Original Report

The gmail-fgac skill in the demoClaw demo container fails with `401 Unauthorized` / `invalid_grant: account not found` when using FGAC.AI service account credentials (`fgac-credentials-sk_proxy_fc899a9.json`).

### Steps to Reproduce
1. Configure the gmail-fgac skill with the downloaded FGAC.AI Service Account JSON
2. Run: `node scripts/gmail.js --account demo --action labels`
3. Observe: `invalid_grant: Invalid grant: account not found`

### Expected
The skill should authenticate via the FGAC.AI proxy and return Gmail labels.

### Actual
The Google auth library sends the JWT to `https://oauth2.googleapis.com/token` (Google's production endpoint) instead of `https://oauth2.fgac.ai/token` (our endpoint). Google rejects it because `sk_proxy_xxx@fgac.ai` is not a real Google service account.

## Root Cause Analysis

### Database verification
The proxy key `sk_proxy_SAMPLE_KEY_REDACTED` was verified to exist correctly in the production database:
- ✅ Key exists, not revoked, has RSA public key
- ✅ Owned by user `test-user@example.com`
- ✅ `key_email_access` entry linking key to the demo email
- ✅ Access rule configured (send_whitelist)

### Actual failure chain
1. Google SDK reads `universe_domain: "fgac.ai"` → switches to self-signed JWT auth path
2. SDK creates a JWT signed with the credential's RSA private key
3. SDK sends the JWT directly as a Bearer token to `https://gmail.googleapis.com/` (hardcoded, NOT `gmail.fgac.ai`)
4. Google rejects: 401 — unknown issuer `sk_proxy_xxx@fgac.ai`

Traffic **never reaches** the FGAC.AI proxy.

### DNS verification
```
$ dig oauth2.fgac.ai +short  →  (empty - no DNS record)
$ dig gmail.fgac.ai +short   →  (empty - no DNS record)
```
Even if the SDK routed correctly, the subdomains didn't exist.

## Resolution

Reverted to Option A (explicit `api_endpoint` + Bearer token). See [ADR-001](../adr/001_universe_domain_rejection.md) for full details.

The gmail-fgac skill was updated to use:
```javascript
const gmail = google.gmail({
  version: 'v1',
  auth: oauth2Client,
  rootUrl: 'https://fgac.ai/api/proxy/'
});
```
