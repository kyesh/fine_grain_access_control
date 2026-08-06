# Partner Onboarding & Configuration Runbook (Internal)

> **Audience:** FGAC operators. The partner-facing counterpart is
> [`partner_integration_guide.md`](partner_integration_guide.md); the design and
> spike evidence live in
> [`implementation_plans/third-party-handoff-permissions_v7.md`](implementation_plans/third-party-handoff-permissions_v7.md).
>
> This repo is public — nothing in this runbook is secret, and no real partner
> credentials, ids, or emails may ever be committed or pasted into issues.

---

## 0. One-time environment prerequisites (per environment)

Before the FIRST partner in an environment can use notifications:

1. **GCP push infrastructure** — run the idempotent setup script against the
   environment's Google-OAuth-client project (spike-verified constraint: the
   Pub/Sub topic MUST live in that project — dev `dev-fgac-ai`, prod
   `fine-grain-access-control`):

   ```bash
   npx tsx scripts/setup-gmail-push.ts --project fine-grain-access-control \
     --push-endpoint https://fgac.ai/api/webhooks/gmail --prod --apply
   ```

   Creates/verifies: topic, `gmail-api-push@system.gserviceaccount.com`
   publisher grant, OIDC push subscription with a dedicated invoker service
   account. Dev omits `--push-endpoint` (QA uses the pull-drain bridge) and
   also writes the local env vars.

2. **Vercel env vars** (per environment, pasted WITHOUT quotes; production
   changes require a redeploy by the user):
   - `GMAIL_PUBSUB_TOPIC` — `projects/<project>/topics/fgac-gmail-watch`
   - `PUBSUB_PUSH_AUDIENCE` — the push endpoint URL (OIDC `aud` claim)
   - `PUBSUB_PUSH_SA_EMAIL` — `fgac-push-invoker@<project>.iam.gserviceaccount.com`
   - `CRON_SECRET` — random string; **without it the delivery/renewal crons
     401 in production and never run**
3. **Plan constraint**: Vercel Hobby allows max 2 crons, daily granularity —
   `vercel.json` is configured accordingly. Consequence: failed-webhook
   *retries* wait for the daily drain (happy path is unaffected — first
   delivery is inline). Upgrading to Pro or pointing an external scheduler at
   `/api/cron/deliver-webhooks` (Bearer `CRON_SECRET`) restores fast retries.
   Decide before onboarding latency-sensitive partners.

## 1. Intake & review

Collect from the partner (see the integration guide §1): name, logo URL,
redirect URIs, webhook URL, requested access, ops contact.

Review gate — decline or escalate if any of these fail:

- [ ] Redirect URIs and webhook URL are HTTPS on domains the partner
      demonstrably controls (localhost acceptable for their dev registration).
- [ ] Requested access is expressible as a manifest we support — today that is
      `read_only` Gmail ± `new_email` notifications. Write access
      (`scoped_write` + send whitelists) is a deliberate product decision per
      partner, not a default.
- [ ] The app name/logo do not impersonate another product.
- [ ] We are satisfied the use case is legitimate (the consent screen renders
      OUR summary of their manifest — users trust our description, so we own it).

## 2. Registration (per environment — dev and prod are separate Clerk instances)

Registration = one script, which creates BOTH the pre-registered Clerk OAuth
application (`consent_screen_enabled: false` — the FGAC interstitial is the
only consent screen) AND the `partner_apps` registry row:

```bash
# Dev (default; uses .env.local + branch DB):
npx tsx scripts/register-partner-app.ts \
  --name "Data Driven Job Search" \
  --redirect-uri https://ddjs.example.com/fgac/callback \
  --webhook-url https://api.ddjs.example.com/fgac/webhook \
  --logo-url https://ddjs.example.com/logo.png \
  --notifications

# Production (reads .secrets/prod.env by name; both flags required):
npx tsx scripts/register-partner-app.ts ... --prod --apply
```

The script prints `client_id`, `client_secret`, and `webhook_secret` **once**
— we do not store the client secret outside Clerk. Deliver all three to the
partner over a secure channel (never email/issue/chat log), then delete any
local copy. `--roll-webhook-secret` rotates the HMAC key on a re-run.

Re-running with the same `--name` updates the existing registration
idempotently. A changed manifest bumps `manifestVersion` — see §4.

## 3. Verification before telling the partner "you're live"

- [ ] `GET https://fgac.ai/oauth/authorize?client_id=<theirs>&redirect_uri=<theirs>`
      (signed in as a test user) renders the consent screen with their
      name/logo and correct permission lines.
- [ ] A wrong redirect_uri renders "Invalid redirect URI" and shares nothing.
- [ ] Unauthenticated `POST /api/webhooks/gmail` → 401.
- [ ] Walk the partner through the testing checklist in the integration guide
      §4 against a QA account. For notifications, confirm on OUR side:
      subscription row active, `watchExpiresAt` ~7 days out, and a signed ping
      in their receiver within a minute of a test email.
- [ ] Confirm the **bypass fail-safe** stands: their client driven straight at
      `clerk.fgac.ai/oauth/authorize` yields a `pending` connection whose
      calls refuse (this is capability 11 A7 — it must never regress).

## 4. Manifest changes & re-consent policy

Permissions are **copied** into keys/rules at consent and pinned by
`manifestVersion` on each connection. Therefore:

- **Narrowing or metadata changes** (name, logo, URIs): re-run the register
  script; existing connections are unaffected.
- **Broadening** (e.g. read_only → scoped_write, adding notifications): re-run
  the script (registry version bumps automatically), but existing users keep
  their consented grant until they go through `/oauth/authorize` again. Never
  hand-edit rules to "upgrade" existing connections — that bypasses consent by
  design, and the QA suite (capability 11 A10) will catch it.

## 5. Monitoring & incident response

- **Delivery health**: `webhook_deliveries` is both queue and audit trail —
  `dead` rows and `notification_subscriptions.status = 'suspended'` are the
  failure signals. Suspension happens after 3 consecutive dead delivery
  groups; notify the partner's ops contact, and on their fix re-enable the
  subscription (which should be followed by a reconciliation sweep from
  `lastHistoryId`).
- **Watch health**: `renew-watches` cron re-arms anything expiring within 48h
  and self-heals subscriptions whose initial arm failed (`watchExpiresAt`
  NULL). Gmail also publishes a zero-diff notification at arm time — normal,
  not a bug.
- **Instant Vercel deploy failures with empty Builds**: check the Neon branch
  count (10-branch limit) AND `vercel.json` plan-validity (sub-daily crons on
  Hobby reject the deployment) before anything destructive.

## 6. Suspension & offboarding

| Action | Effect | How |
|--------|--------|-----|
| **User detaches** (their choice) | Connection blocked, partner proxy key revoked, subscriptions cancelled, Gmail watch stopped if last subscriber — both credential surfaces die immediately | Dashboard "Detach" (self-serve) |
| **Suspend partner** (our choice, all users) | New authorizations refused ("Unknown application" path); existing connections keep working | Set `partner_apps.status = 'suspended'` |
| **Full offboarding** | Everything above plus existing access dies | Suspend registry row; block each connection (revokes keys, cancels subscriptions); delete the Clerk OAuth application (kills token refresh) |

Rotate the webhook secret (`--roll-webhook-secret`) any time the partner
reports a possible leak.

## 7. QA hooks

Capabilities [`11_partner_handoff.md`](QA_Acceptance_Test/capabilities/11_partner_handoff.md)
and [`12_push_notifications.md`](QA_Acceptance_Test/capabilities/12_push_notifications.md)
cover this surface (22 assertions);
[`setup/04_partner_app_registration.md`](QA_Acceptance_Test/setup/04_partner_app_registration.md)
bootstraps the QA partner ("QA Spike Partner") each cycle. Any change to the
consent flow, provisioning, or webhook pipeline must keep those suites green —
`npx tsx scripts/qa-coverage-check.ts` is the arbiter.
