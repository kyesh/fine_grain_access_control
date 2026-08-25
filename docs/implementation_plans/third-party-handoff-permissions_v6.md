# Third-Party App Handoff: Auth, Default Permissions, and Push Notifications

> Strategy for letting third-party websites/agents (canonical example: "Data Driven Job
> Search", DDJS) hand their signed-in users off to FGAC, receive scoped credentials with
> app-declared default permissions, and get push notifications for new emails.
>
> Branch: `claude/third-party-handoff-permissions-81dc96` — v6 (deployment roadmap + QA additions)
>
> **v6 changes (2026-08-06):** added the Deployment Roadmap to Production and the QA
> Acceptance Test Additions sections (new capability docs 11 & 12, setup doc 04, runbook
> and harness changes).
>
> **v5 changes (2026-08-06):** Production GCP project confirmed as
> **`fine-grain-access-control`** (project number 727876597677) — verified by reading
> the `client_id` off the prod sign-in Google redirect
> (`727876597677-mah85mt4es0j11hkbin5a0ira72lhqq4.apps.googleusercontent.com`), not by
> name-matching. The Phase 2 prod topic must be created in that project
> (`projects/fine-grain-access-control/topics/fgac-gmail-watch`).
>
> **v4 changes (2026-08-06):** Spike 2 closed end-to-end — topic
> `projects/dev-fgac-ai/topics/fgac-gmail-watch` created with
> `gmail-api-push@system.gserviceaccount.com` as publisher (durable dev infra, kept);
> watch armed via Clerk-vaulted token (`{historyId: 4467423, expiration: +7d}`); test
> email → Pub/Sub notification `{emailAddress, historyId}` in ~2s → `history.list`
> diff resolved the exact message id. Watch stopped and spike pull subscription
> deleted after the test. Added the Dev→Prod Infrastructure Sync section.
> **v3 changes:** Spikes 1 and 2 executed 2026-08-05 — results below. Spike 3 resolved
> (FGAC has passed CASA Tier 2 for Gmail read). Spike 4 expanded from a question into a
> concrete design recommendation (DB-backed outbox + cron).
> **v2 changes:** added the De-risking Spikes section; corrected the DDJS manifest
> example — send is already deny-by-default when no `send_whitelist` rule exists
> (`src/app/api/proxy/[...path]/route.ts` §5), so a read-only role needs no rule
> templates at all.

## Spike Results (executed 2026-08-05, dev environment)

### Spike 1 — Clerk as OAuth AS with FGAC-owned consent: **PASS** ✅

Method: created a pre-registered OAuth application ("DDJS Spike Partner App") via the
Clerk Backend API (`POST /v1/oauth_applications`), walked the full authorize flow in
the browser as USER_A against the dev instance, exercised the token endpoint, and
probed the bypass path against the local MCP server.

| Question | Result |
|----------|--------|
| Can Clerk's consent screen be skipped per-app? | **Yes.** `consent_screen_enabled` is a per-app, API-writable boolean. `false` → authorize silently redirects with a code, no screen. `true` → consent shown on **every** authorize (no grant-memory skip), so the toggle is fully authoritative. |
| Is Clerk's consent screen usable as FGAC consent? | No — it renders only identity scopes ("your email address, basic profile"), nothing about Gmail/FGAC permissions. Confirms the FGAC interstitial is required and Clerk's screen should be disabled for partner apps. |
| Does the bypass fail safe? | **Yes.** With consent disabled, driving Clerk's authorize URL directly issues tokens silently — but calling `/api/mcp` with that token creates a `pending` connection and every tool call refuses with "awaiting user approval". Deny-by-default holds. |
| Refresh tokens for pre-registered confidential clients? | **Yes.** `offline_access` is in default scopes; access tokens live 24h (`expires_in: 86399`); `refresh_token` grant works and **rotates** the refresh token. |
| Do we need to become our own AS? | **No.** The fallback (FGAC-issued codes/tokens) is unnecessary. |

Implications for the design: partner apps are created with `consent_screen_enabled:
false`; the FGAC interstitial performs provisioning *before* redirecting into Clerk's
authorize URL; the pending-by-default MCP behavior is the safety net for anyone who
skips the interstitial. One consent screen total, as designed.

### Spike 2 — Gmail `users.watch` + Pub/Sub with Clerk-vaulted tokens: **PASS (one step remains, gated on GCP access)** 🟡

Method: pulled USER_A's Google token via the Clerk Backend API (the same path
`getGoogleToken` uses), inspected it via tokeninfo, called `users.watch` with several
topic names, and validated the `history.list` diff mechanic with a real send.

| Question | Result |
|----------|--------|
| Does dev Clerk use shared or custom Google credentials? | **Custom.** Token `azp` = client `627660126377-…` in GCP project **`dev-fgac-ai`**. The feared dev blocker (Clerk shared creds) does not exist — dev/QA of Phase 2 is viable. |
| Topic-project constraint real? | **Confirmed empirically.** Watch with any foreign topic → `400 Invalid topicName does not match projects/dev-fgac-ai/topics/*`. The topic must live in the OAuth client's project, and the error names it. |
| Scope sufficient? | **Yes.** Vaulted tokens carry `gmail.modify`; watch calls authenticate and proceed to topic resolution. |
| Watch → publish chain | Watch with a correctly-formed `projects/dev-fgac-ai/topics/…` name returns `404 Error sending test message to Cloud PubSub … Resource not found` — Gmail **publishes a test message at watch time**, so a single successful watch call will prove the publish grant end-to-end. |
| `history.list` diff mechanic | **Validated.** Baseline `historyId` 4467334 → sent test email → `history.list(startHistoryId, historyTypes=messageAdded)` returned exactly the new message id and the next cursor (4467385). |

**CLOSED 2026-08-06:** topic + publisher grant created in `dev-fgac-ai`; watch armed
(`{historyId: 4467423, expiration: +7 days}`); test email produced a Pub/Sub
notification `{"emailAddress": "kenyesh2@gmail.com", "historyId": …}` within ~2
seconds; `history.list(startHistoryId=<notification cursor>)` resolved to exactly the
new message id. Note Gmail also publishes a notification *at watch time* (the arming
test message) — the receiver must tolerate notifications that diff to zero new
messages. Dev topic and IAM grant are kept as standing infra; the same setup is
needed in the production client's GCP project before Phase 2 ships (see Dev→Prod
Infrastructure Sync below).

## Dev→Prod Infrastructure Sync

The Pub/Sub resources live **outside** the repo/Vercel pipeline — nothing in
`/deploy-pr-preview` or `/deploy-prod` creates them. Keep dev and prod in sync by
construction, not by memory:

1. **One idempotent setup script, checked in** — `scripts/setup-gmail-push.sh`
   (Phase 2 deliverable). Takes `--project <id>`; creates the topic if missing, adds
   the `gmail-api-push` publisher binding if missing, creates the push subscription
   pointing at `https://<host>/api/webhooks/gmail` with OIDC auth. Follows the repo's
   production-script convention: requires explicit `--prod --apply` to touch the prod
   project, prints a diff-style plan without `--apply`. Running the same script in
   both projects is what keeps them identical.
2. **Topic name is an env var, never hardcoded** — `GMAIL_PUBSUB_TOPIC` set per Vercel
   environment (development → `projects/dev-fgac-ai/topics/fgac-gmail-watch`,
   production → the prod project's topic). Pasted into Vercel **without quotes**.
   Code that arms watches reads only this var, so a missing/mismatched value fails
   loudly instead of silently watching into the wrong project.
3. **Preflight verification** — extend `env:check` (or add `npm run push:check`) to
   assert: (a) `GMAIL_PUBSUB_TOPIC` is set and well-formed; (b) the topic's project
   matches the GCP project of the Clerk instance's Google OAuth client (probe: pull
   any vaulted token, compare `azp` client project vs. topic project — exactly the
   mismatch class the spike surfaced); (c) the publisher binding exists. This makes
   "is prod wired?" a command, not a memory.
4. **Prod OAuth client's project: IDENTIFIED** — `fine-grain-access-control`
   (727876597677), verified 2026-08-06 via the `client_id` on the prod sign-in Google
   redirect. The prod topic goes there:
   `projects/fine-grain-access-control/topics/fgac-gmail-watch`.
5. **What does NOT need syncing**: watch registrations are runtime state, created
   per-subscription by the app and re-armed by the renewal cron — they are never
   provisioned by hand in either environment. Only topic + IAM binding + push
   subscription + env var are infrastructure.
6. **Prod checklist (before Phase 2 `/deploy-prod`)**: run the setup script with
   `--prod --apply` against the prod project → add `GMAIL_PUBSUB_TOPIC` to Vercel
   production env (user redeploys) → `push:check` green against prod config.

### Spike 3 — Google verification: **RESOLVED** ✅

FGAC has passed **CASA Tier 2 for Gmail read**. No unverified-app warning in partner
funnels and no 100-user cap. (Keep in view: scope additions or new restricted scopes
would trigger re-verification; annual CASA recertification applies.)

### Spike 4 — Webhook delivery on Vercel: design decision (expanded)

See the dedicated section below — recommendation is a **DB-backed outbox drained by
Vercel cron**, with QStash as the documented escalation path.

## Spike 4 Expanded — Webhook Delivery Mechanics on Vercel

### Why this needs deciding at all

Vercel functions are request-scoped: no resident workers, no in-memory queues that
survive a response, no `setTimeout`-and-retry. Every delivery attempt must be triggered
by an inbound HTTP request (a Pub/Sub push, a cron tick) and finish within the
function's `maxDuration`. "Retry with exponential backoff" therefore has to be encoded
as *durable state plus a scheduler*, not as code that waits.

### The delivery chain and where each failure lands

```
Pub/Sub push → /api/webhooks/gmail          (ack fast: verify OIDC, enqueue, 200)
                    │ write outbox row(s)
                    ▼
        webhook_deliveries (outbox table)   status: pending | delivering | delivered | failed | dead
                    ▼
Cron tick → /api/cron/deliver-webhooks      (drain due rows, POST to partners)
                    │ success → delivered
                    │ failure → attempts++, next_attempt_at = now + backoff(attempts)
                    ▼
        after N failures → dead + subscription flagged; dashboard shows it
```

Key separation: **ack Pub/Sub immediately** (do the `history.list` diff + rule filter +
outbox insert, return 200), and let delivery to partners be async. Coupling Google's
retry loop to partner availability is the failure mode to avoid — Pub/Sub's ack
deadline is short, and an unacked backlog on a flaky partner would stall notifications
for *everyone* on that subscription's topic.

### Option A — DB-backed outbox + Vercel cron (recommended)

- `webhook_deliveries` table is the queue: `(id, subscriptionId, payload, status,
  attempts, nextAttemptAt, lastError, createdAt, deliveredAt)`.
- A Vercel cron hits `/api/cron/deliver-webhooks` every minute (Pro plan floor). The
  drainer claims due rows (`status='pending' AND nextAttemptAt <= now`) with
  `UPDATE … SET status='delivering' … RETURNING` (skip-locked semantics) so overlapping
  ticks never double-send, POSTs each with the HMAC signature, and writes back the
  outcome.
- Backoff schedule: 1m, 5m, 15m, 1h, 6h, 24h → `dead` (≈6 attempts over ~31h). With a
  1-minute cron, sub-minute backoff is unachievable — acceptable, because the *first*
  attempt is not cron-gated: the Pub/Sub handler fires one immediate best-effort
  delivery inline after inserting the row (happy path stays real-time, measured
  seconds from email arrival), and the cron only picks up failures.
- Auto-disable: N consecutive `dead` deliveries on one subscription → subscription
  `status='suspended'`, surfaced on the user dashboard and (optionally) emailed to the
  partner's ops contact. Re-enable is a partner/dashboard action that also triggers a
  reconciliation sweep (`messages.list` since last delivered `historyId`).

**Pros:** zero new vendors; state lives next to the data it describes; the audit trail
("DDJS was notified of 42 messages") is the queue table itself; trivially testable in
QA (call the cron route directly). **Cons:** 1-minute retry granularity; drainer must
respect `maxDuration` (cap batch size, let the next tick continue); Neon connection
budget for a chatty cron (fine at this scale).

### Option B — QStash (or similar HTTP task queue)

Publish each delivery to QStash with the partner URL as target; QStash owns retries,
backoff, and DLQ, and signs requests. **Pros:** less delivery code, second-granularity
retries, built-in DLQ. **Cons:** new vendor dependency + cost; the audit trail and
auto-disable logic still need our own table (so much of Option A gets built anyway);
partner-visible requests originate from QStash IPs (harder allowlisting story);
webhook secrets/HMAC handling shifts partially into a third party's custody, which is
an awkward fit for a security-positioning product.

### Option C — lean on Pub/Sub redelivery (rejected)

Don't ack until the partner accepts. Rejected for the coupling reason above, plus:
ack deadline ceiling (~600s) can't express multi-hour backoff, and one notification
may fan out to multiple subscriptions with different outcomes — partial-failure
acking is unexpressible.

### Idempotency & ordering (applies to every option)

- **Inbound dedup:** Pub/Sub is at-least-once. The `(subscription, historyId-range)`
  work is naturally idempotent because the diff runs off our stored cursor: a duplicate
  push re-diffs from the same `lastHistoryId` and upserts the same outbox rows —
  enforce with a unique index on `(subscriptionId, messageId)`.
- **Outbound idempotency:** every delivery carries an `X-FGAC-Delivery-Id` (the outbox
  row id) so partners can dedup; document that retries reuse the id.
- **Ordering:** not guaranteed and not promised — the payload's `historyId` cursor is
  monotonic, and partners fetching via the proxy always see current state, so
  out-of-order thin pings are harmless.

### Recommendation

**Option A** for Phase 2. The scale argument is decisive: at launch volume (tens of
partners, thousands of notifications/day) a cron drainer is far below any limit, and
the pieces Option B doesn't cover (audit, auto-disable, dashboard) are the majority of
the work anyway. Revisit QStash only if retry-latency granularity or cron volume
becomes a measured problem. Build the drainer behind an interface
(`deliverPending(batch)`) so swapping the scheduler later is contained.

### Verified during strategy review (no spike needed)

- **Read-only role expressibility**: send is deny-by-default absent a whitelist rule
  (proxy §5); `google_api_modify` exposes only `messages/send` and denies unparseable
  recipients; DELETE isn't exposed on MCP and trash/emptyTrash are hard-blocked on the
  proxy. A no-rules key is already read-only.
- **Token→key resolution chain** for partner servers: `verifyClerkToken` → connection →
  key already works (MCP), and `/api/auth/cli-token` proves the OAuth-token→proxy-key
  exchange pattern.

## The Scenario

DDJS runs a server-side agent that categorizes every new email a user receives into an
interview stage and extracts action items. It needs:

1. A signed-in DDJS user handed off to FGAC (account creation if needed) and back.
2. FGAC-side **default permissions for the DDJS agent role** (read-only Gmail, no send,
   no delete) applied without the user hand-assembling rules.
3. Credentials returned to DDJS's **server** (not a browser/MCP client) that work with
   the existing proxy/MCP surfaces.
4. **Push notifications** to DDJS when new mail arrives, filtered by the same rules.

## What Exists Today (and what's missing)

| Need | Today | Gap |
|------|-------|-----|
| Third-party OAuth into FGAC | Clerk DCR + `agent_connections` pending-approval flow (built for MCP clients) | Approval is a *separate dashboard visit* where the user manually picks a proxy key; no inline consent, no way back to the app |
| Default permissions per app | `access_rules` + `key_rule_assignments` exist, fully manual | No concept of a **registered app** with a declared permission manifest/template |
| Server credentials | `sk_proxy_...` keys + REST proxy; `/api/auth/cli-token` already exchanges an OAuth token for a proxy key | No partner-facing token endpoint; keys are provisioned manually in the dashboard |
| Push notifications | Nothing (no `users.watch`, no Pub/Sub, no webhook delivery) | Entire subsystem is net-new |

The good news: 1–3 are mostly **recomposition of existing primitives**. Only 4 is a new
subsystem.

## Piece 1 — Partner App Registry with Permission Manifests ("Agent Roles")

The core new concept. A third-party app registers with FGAC once (initially by us,
manually — this is also the review/verification gate) and gets:

- An OAuth `client_id` (Clerk OAuth application — same machinery the MCP DCR flow uses,
  but pre-registered rather than dynamic).
- A **permission manifest**: the app's requested "role", declared as a template of
  `access_rules` plus capability flags. For DDJS:

```jsonc
{
  "app": "Data Driven Job Search",
  "logo_url": "...",
  "requested": {
    "services": ["gmail"],
    "access": "read_only",            // no send whitelist rule = send denied by default (proxy §5)
    "rule_templates": [],             // read-only needs none; write-capable apps declare whitelists here
    "notifications": { "trigger": "new_email" }
  },
  "webhook_url": "https://api.ddjs.com/fgac/webhook",   // verified at registration
  "redirect_uris": ["https://ddjs.com/fgac/callback"]
}
```

**Consent-time provisioning**: when a user approves the app, FGAC auto-creates in one
transaction what the user builds by hand today:

1. A proxy key labeled `"Data Driven Job Search"`.
2. `key_email_access` rows for the account(s) the user selected on the consent screen.
3. Copies of the manifest's rule templates as `access_rules` bound to that key via
   `key_rule_assignments` (copies, not references — the user can then tighten them per
   normal, and a later manifest change by the app cannot silently widen existing grants).
4. The `agent_connections` row, already `approved` and bound to the key.
5. (If requested + granted) a `notification_subscriptions` row per account.

Manifest changes that *broaden* access require re-consent: bump a `manifest_version`
on the registry row; connections pinned to an older version keep old permissions until
the user re-approves.

New schema: `partner_apps` (clientId, name, manifest JSON, manifestVersion, webhookUrl,
webhookSecret, status). Existing tables carry everything else.

## Piece 2 — The Handoff Flow (lowest-friction path)

Standard OAuth 2.0 authorization-code + PKCE, with Clerk as the identity/token layer
(as today) and a new **FGAC consent interstitial** replacing the manual dashboard
approval:

```
DDJS "Connect your Gmail" button
  → https://fgac.ai/oauth/authorize?client_id=<ddjs>&state=...&code_challenge=...
  → [no Clerk session] Clerk sign-in with Google → Google consent (Gmail scope)
       ← this is the ONLY Google screen; FGAC becomes the token holder via Clerk
  → FGAC consent page (server-renders partner_apps manifest):
       "Data Driven Job Search wants to:
          • Read email in [account picker: user@example.com ▾]  (read-only — cannot send or delete)
          • Be notified when new email arrives
        [Approve] [Deny]"
  → Approve = one click → provisioning transaction (Piece 1) → redirect to
    https://ddjs.com/fgac/callback?code=...&state=...
  → DDJS server exchanges code at the token endpoint
```

Click count: **existing FGAC user = 1 screen** (consent). New user = Google account
chooser + Google consent + FGAC consent ≈ 3 screens, all standard-feeling. No dashboard
visit, no manual key creation, no rule configuration.

Why keep Clerk underneath: the MCP flow already proves out Clerk DCR → token → userId
resolution, discovery endpoints exist, and Google token custody stays exactly where it
is (Clerk as token vault — the fake-token principle is preserved; DDJS never sees a
Google credential).

## Piece 3 — Credentials DDJS Receives

Two-step, both reusing existing machinery:

1. **Token endpoint** (Clerk's, as today): authorization code → access token + refresh
   token. The MCP server already resolves `OAuth token → (userId, clientId) →
   agent_connections → proxy_key`, so these tokens work against `/api/mcp` immediately.
2. **Optional key exchange** for the REST proxy: a partner-facing sibling of the
   existing `/api/auth/cli-token` — `POST /api/auth/partner-token` with the OAuth
   token returns the connection's `sk_proxy_...` for direct
   `gmail.fgac.ai/gmail/v1/...` calls with off-the-shelf Google SDKs (Prong 1).

DDJS stores per-user: `{ refresh_token or proxy_key, connection_id }`. Revocation
story is already built: user blocks the connection or revokes the key in the dashboard
and both surfaces die.

Recommendation: steer partners to the **OAuth-token path** as primary (rotatable,
standard, auditable per-connection) and treat the raw proxy key as the escape hatch for
SDK-endpoint-override users.

## Piece 4 — Push Notifications (net-new subsystem)

Gmail's push model: `users.watch` → Google Cloud **Pub/Sub topic** → HTTPS push to us →
we fan out to partners. FGAC sits in the middle, which is precisely the product: the
partner gets notified only about mail its rules let it see.

```
Gmail ── users.watch ──▶ Pub/Sub topic ── push ──▶ POST /api/webhooks/gmail  (verify OIDC token from Google)
                                                        │  {emailAddress, historyId}
                                                        ▼
                                          history.list(since lastHistoryId)   [owner's Clerk Google token]
                                                        │  new message IDs
                                                        ▼
                                          For each subscription on that account:
                                            apply the bound key's READ RULES to each message
                                            (label/sender blacklists — same code path as gmail_read)
                                                        │  surviving IDs only
                                                        ▼
                                          POST partner webhook_url   (HMAC-signed, thin payload)
                                          { connection_id, account, message_ids: [...], event: "new_email" }
```

Design decisions:

- **Thin pings, not payloads.** The webhook carries message IDs only; DDJS fetches
  content back through the proxy with its own credentials, where rules are enforced
  again at read time. This keeps FGAC out of the business of pushing email bodies to
  third parties, makes the webhook low-sensitivity, and means a mid-flight rule change
  is honored at fetch.
- **Rule-filtered notification.** If the user blacklists a label/sender, DDJS is not
  even *told* those messages exist. This is the differentiating feature — notification
  as an access-controlled surface, not a firehose.
- **Watch lifecycle**: `users.watch` expires after 7 days → daily cron (Vercel cron)
  re-arms all active subscriptions; store `lastHistoryId` per subscription;
  `historyId` gaps (expired history) fall back to a `messages.list` reconciliation.
- **Delivery semantics**: at-least-once, HMAC-SHA256 signature header with the app's
  `webhookSecret`, exponential-backoff retries, auto-disable + dashboard flag after N
  consecutive failures. `webhook_deliveries` table for the audit trail ("DDJS was
  notified about 42 messages this week" belongs in the user's dashboard).
- **One topic, many accounts**: a single Pub/Sub topic; the notification names the
  account, we route by `emailAddress → notification_subscriptions`.

New schema: `notification_subscriptions` (connectionId, targetEmail, lastHistoryId,
watchExpiresAt, status), `webhook_deliveries` (subscriptionId, messageIds, status,
attempts, timestamps).

Prerequisite: a GCP project with Pub/Sub + granting `gmail-api-push@system.gserviceaccount.com`
publish rights on the topic. Note `users.watch` must be called with the *user's* OAuth
token (from Clerk) — scope-wise `gmail.readonly` suffices, which we already hold.

## Security Notes

- **Confused deputy / CSRF**: `state` + PKCE mandatory; consent page binds to the
  authenticated Clerk session.
- **No silent escalation**: manifest is copied at consent; broadening requires
  re-consent (manifest_version pinning).
- **Webhook SSRF/exfil**: webhook URLs are registered and verified at app registration
  (challenge round-trip), never taken from runtime requests; reject private-range hosts.
- **Fake-token principle intact**: partners receive FGAC credentials only; Google
  tokens never leave Clerk custody.
- **Registry as trust gate**: manual app registration doubles as app review; the
  consent screen renders only registry data, never client-supplied strings.

## Sequencing

**Phase 1 — Handoff + default permissions** (recomposition, ~all existing infra):
`partner_apps` table + manifest format → consent page (`/oauth/authorize` interstitial)
→ provisioning transaction → partner token exchange endpoint → dashboard shows partner
connections like agent connections today.
*Fallback that works day one: DDJS polls `gmail_list` on an interval — notifications are
an optimization, not a blocker for the integration.*

**Phase 2 — Push notifications**: Pub/Sub topic + `/api/webhooks/gmail` receiver →
subscription provisioning at consent → watch-renewal cron → HMAC webhook dispatcher
with retries → delivery audit in dashboard.

**Phase 3 — Self-serve registry** (later): partner-facing app registration UI with a
review queue, once more than a handful of partners exist.

## Deployment Roadmap to Production

Two PRs, each following the standard pipeline: branch → implement → local QA →
`/deploy-pr-preview` → QA suites against the preview → user runs `/deploy-prod`.
Phase 1 ships alone first; the polling fallback (`gmail_list`) makes it independently
useful, and it de-risks the schema and consent surface before any Pub/Sub code exists.

### PR 1 — Partner handoff + default permissions (Phase 1)

1. **Schema** (`npm run db:branch` FIRST, then edit `src/db/schema.ts`):
   `partner_apps` (clerkOauthAppId, clientId, name, logoUrl, manifest JSONB,
   manifestVersion, webhookUrl, webhookSecret, status). Add `partnerAppId` +
   `manifestVersion` nullable FKs on `agent_connections` (provenance + re-consent
   pinning). `drizzle-kit generate` → verify NNNN_*.sql exists → `npm run db:migrate`
   against the branch (Database Rule 8).
2. **Partner registration script** — `scripts/register-partner-app.ts`: creates the
   Clerk OAuth application (`consent_screen_enabled: false`, partner redirect URIs)
   via the Backend API AND the `partner_apps` row in one go. Per-environment by
   design (dev Clerk + prod Clerk are separate instances — a partner must be
   registered in each). `--prod` + `--apply` guards per repo convention.
3. **Consent interstitial** — `/oauth/authorize` page route: require Clerk session
   (redirect to sign-in and back if absent); look up `partner_apps` by `client_id`;
   render manifest-driven consent (app name/logo, permission summary, account
   picker); Approve = one provisioning transaction (proxy key labeled with app name,
   `key_email_access`, rule copies from manifest, `agent_connections` row approved +
   pinned to manifestVersion) then 302 into Clerk's authorize URL; Deny = 302 to
   partner `redirect_uri` with `error=access_denied`. `state` and PKCE params pass
   through untouched.
4. **Partner token exchange** — `/api/auth/partner-token` (sibling of `cli-token`):
   Clerk OAuth token in, connection's `sk_proxy_...` out.
5. **Dashboard** — partner connections render in ConnectionsPanel with a partner
   badge (name/logo from registry); revoke/block works unchanged.
6. **Docs** — update `distribution_architecture.md` (5th distribution channel),
   `architecture_and_strategy.md`, `user_guide.md`, data model docs.
7. **QA** — new capability doc 11 + setup doc 04 (below); update the four agent
   runbooks; `npx tsx scripts/qa-coverage-check.ts` green; run `/qa-hosted-mcp`
   minimum, ideally all four suites.
8. **Security review** — run `/security-review` on the branch (new auth surface).
9. **Deploy** — `/deploy-pr-preview`, register the spike partner app against the
   preview URL, walk the handoff end-to-end on preview, then hand to user for
   `/deploy-prod`. Post-deploy: run `register-partner-app.ts --prod` for the first
   real partner (DDJS), smoke the flow against `fgac.ai`.

### PR 2 — Push notifications (Phase 2)

1. **Schema**: `notification_subscriptions` (connectionId, targetEmail,
   lastHistoryId, watchExpiresAt, status) + `webhook_deliveries` (subscriptionId,
   messageIds, status, attempts, nextAttemptAt, lastError, deliveredAt; unique
   (subscriptionId, messageId)).
2. **GCP infra script** — `scripts/setup-gmail-push.sh --project <id> [--prod
   --apply]`: idempotent topic + `gmail-api-push` publisher grant + push
   subscription → `https://<host>/api/webhooks/gmail` with OIDC. Dev
   (`dev-fgac-ai`) already has topic+grant from the spike — script adopts it;
   prod target is `projects/fine-grain-access-control/topics/fgac-gmail-watch`.
3. **Env** — `GMAIL_PUBSUB_TOPIC` per Vercel environment (no quotes). Extend
   `env:check`/add `push:check`: topic set + topic project == token `azp` project +
   publisher binding present.
4. **Receiver** — `/api/webhooks/gmail`: verify Google OIDC JWT, load subscriptions
   for `emailAddress`, `history.list` from stored cursor, apply the bound key's read
   rules, insert outbox rows, fire one inline delivery attempt, ack 200 fast.
   Tolerate zero-diff notifications (watch-time test message — spike finding).
5. **Crons** (`vercel.json`): `/api/cron/deliver-webhooks` every minute (atomic
   claim, HMAC POST, backoff ladder 1m→5m→15m→1h→6h→24h→dead, auto-suspend after N
   dead + reconciliation sweep on re-enable); `/api/cron/renew-watches` daily
   (re-arm watches expiring within 48h; watches live 7 days).
6. **Consent integration** — manifest `notifications` grant creates the subscription
   and arms the watch inside the Phase 1 provisioning transaction; revoke/block
   tears down watch + subscription.
7. **QA** — capability doc 12 + local webhook-receiver harness (below); coverage
   check green; full suites.
8. **Deploy** — preview QA uses the dev topic with a **pull-drain harness** (Pub/Sub
   cannot push to localhost/preview reliably: a QA script drains a pull subscription
   and POSTs to the local receiver, simulating Google's push). Prod: run infra
   script `--prod --apply`, add prod env var, user runs `/deploy-prod`, `push:check`
   green, then a canary: arm one watch on the owner account, send a self-email,
   verify the delivery row and partner ping.

### Standing prod checklist (condensed)

| Step | Owner |
|------|-------|
| `setup-gmail-push.sh --prod --apply` (topic/grant/push-sub in `fine-grain-access-control`) | Claude (user-approved) |
| `GMAIL_PUBSUB_TOPIC` added to Vercel production env, no quotes | user approves `vercel env add` |
| Production redeploy | **user** (`/deploy-prod`) |
| `register-partner-app.ts --prod` per partner (Clerk prod app + registry row) | Claude (user-approved) |
| `push:check` + canary watch verification | Claude |

## QA Acceptance Test Additions

Two new capability docs (assertion checklists) + one setup doc + harness changes.
Adding them makes `qa-coverage-check` require their assertions in every
`qa-results.json` — the agent runbooks must be updated in the same PR, with
channel-applicability notes where a surface is browser-only.

### `capabilities/11_partner_handoff.md` (PR 1) — draft assertions

- **A1** Unknown `client_id` on `/oauth/authorize` → error page, nothing provisioned.
- **A2** Registered partner authorize → FGAC consent interstitial renders manifest
  (app name, permission summary, account picker) — registry data only, no
  client-supplied strings.
- **A3** Deny → partner callback receives `error=access_denied`, `state` intact; no
  key/connection/rules created.
- **A4** Approve → single transaction provisions: key labeled with app name,
  `key_email_access` for the chosen account, manifest rule copies bound to the key,
  connection `approved` + pinned to manifestVersion; redirect carries `code` + `state`.
- **A5** Code exchange returns access + refresh token; an MCP tool call works
  immediately (no pending step). Refresh grant rotates and works.
- **A6** `/api/auth/partner-token` exchanges the OAuth token for the connection's
  `sk_proxy_...`; REST proxy call succeeds with it.
- **A7** **Bypass fail-safe**: driving Clerk's authorize URL directly (interstitial
  skipped) yields tokens whose MCP calls return "pending approval" — never
  auto-provisioned. (Spike 1 finding, must stay true forever.)
- **A8** Read-only default: `gmail_send` and proxy `messages/send` → 403
  deny-by-default (manifest has no send whitelist).
- **A9** Dashboard shows the partner connection with partner badge; Detach/block
  kills BOTH the OAuth-token path and the proxy-key path.
- **A10** Re-consent pinning: bumping `manifestVersion` in the registry does not
  widen an existing connection's permissions.
- *Channels*: A2–A4, A9 are browser-agent assertions; A1, A5–A8, A10 run via curl —
  primary runbook `agents/01_hosted_mcp.md`, with dashboard steps marked
  browser-only (same pattern as capability 06).

### `capabilities/12_push_notifications.md` (PR 2) — draft assertions

- **A1** Consent with notifications grant → `notification_subscriptions` row exists,
  watch armed (`watchExpiresAt` ~7 days out, `lastHistoryId` set).
- **A2** New email → local webhook receiver gets thin ping `{connection_id, account,
  message_ids[]}` with valid HMAC signature and `X-FGAC-Delivery-Id` header, within
  60s.
- **A3** Payload is IDs-only — no subject, snippet, body, or sender anywhere in it.
- **A4** **Rule filtering**: email carrying a read-blacklisted label (reuse
  capability 05 baseline) produces NO webhook; a mixed batch delivers only the
  allowed IDs.
- **A5** Zero-diff notification (watch-time test message) produces no partner ping.
- **A6** Duplicate Pub/Sub delivery of the same notification → exactly one outbox
  row per (subscription, messageId); no double ping.
- **A7** Failing receiver (harness returns 500) → `attempts` increments on backoff
  schedule; after N dead the subscription is `suspended` and the dashboard flags it.
- **A8** Re-enabling a suspended subscription triggers a reconciliation sweep that
  delivers the missed message IDs.
- **A9** Renewal cron advances `watchExpiresAt` for watches near expiry.
- **A10** Detach/revoke → watch stopped, subscription cancelled, no further pings
  (send another email to prove silence).
- **A11** Unsigned/invalid-OIDC POST to `/api/webhooks/gmail` → 401/403, nothing
  processed.
- **A12** `push:check` passes: `GMAIL_PUBSUB_TOPIC` project matches the Google
  client (`azp`) project and the publisher binding exists.
- *Channels*: inherently channel-independent (server-side) — runs once per QA cycle
  from the hosted-MCP runbook + browser agent for dashboard assertions, not
  repeated per agent runtime.

### `setup/04_partner_app_registration.md` (PR 1)

Registers the QA partner app ("QA Spike Partner") via `register-partner-app.ts`
against the dev Clerk instance with redirect URI on localhost, read-only Gmail
manifest + notifications grant, and records client credentials into the gitignored
QA config (pattern: `qa-test-agents.json`). Torn down / re-created idempotently each
cycle.

### Harness changes

- **Local webhook receiver** for capability 12: tiny script
  (`scripts/qa-webhook-receiver.ts`) that listens on localhost, records received
  pings + HMAC validity to a JSON file the runner asserts against, and can be told
  to return 500 (for A7).
- **Pull-drain bridge** for non-prod Pub/Sub: script drains the dev pull
  subscription and POSTs to the local receiver-under-test, simulating Google push
  (Pub/Sub cannot reach localhost).
- **USER_B re-auth** precondition: dev-instance Google refresh token for USER_B is
  currently dead (`oauth_token_retrieval_error`, found 2026-08-06) — `/qa-setup`
  must re-sign-in USER_B before delegation-dependent capabilities run.
