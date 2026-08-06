# Setup 04: Partner App Registration

> Registers the QA partner application used by capabilities 11 and 12.
> Idempotent — re-running updates the existing registration. Part of
> `/qa-setup` after 01–03.

## Steps

1. **Start the QA webhook receiver** (it must own a port before registration so
   the webhook URL is real):

   ```bash
   npx tsx scripts/qa-webhook-receiver.ts --port 4571
   ```

   (Run it in the background for the QA session; secret comes in step 3.)

2. **Register the partner app** against the dev Clerk instance + branch DB:

   ```bash
   npx tsx scripts/register-partner-app.ts \
     --name "QA Spike Partner" \
     --redirect-uri http://localhost:3000/oauth/callback \
     --webhook-url http://localhost:4571/webhook \
     --notifications
   ```

3. **Record the credentials** the script prints into `qa-test-agents.json`
   (gitignored) under the key `qa_partner`, adding a PKCE pair (generate as in
   `scripts/qa-dcr-setup.ts`):

   ```json
   {
     "qa_partner": {
       "client_id": "…",
       "client_secret": "…",
       "webhook_secret": "…",
       "pkce": { "verifier": "…", "challenge": "…" }
     }
   }
   ```

   Restart the receiver with `FGAC_WEBHOOK_SECRET=<webhook_secret>` so it can
   validate signatures.

4. **Provision push infra** (idempotent; topic + binding already exist in dev):

   ```bash
   npx tsx scripts/setup-gmail-push.ts --project dev-fgac-ai --apply
   ```

   This also writes `GMAIL_PUBSUB_TOPIC` and `QA_BRIDGE_SECRET` into
   `.env.local` (script-managed, like `db:branch`). **Restart the dev server**
   afterwards so the new env vars load.

5. **Start the Pub/Sub bridge** for the QA session:

   ```bash
   npx tsx scripts/qa-pubsub-bridge.ts
   ```

## Verification

- `register-partner-app.ts` re-run prints "Updated partner app" (idempotent).
- `setup-gmail-push.ts --project dev-fgac-ai` dry run shows all ✔.
- `curl -s -X POST http://localhost:3000/api/webhooks/gmail` (no auth) → 401.

## Teardown notes

- The QA partner registration persists across cycles (dev Clerk + branch DB).
  A fresh Neon branch loses the `partner_apps` row while the Clerk app
  survives — step 2 handles that (it re-links by name).
- Kill the receiver/bridge with the session; remove `qa-webhook-fail` if a
  failure-injection test left it behind.
