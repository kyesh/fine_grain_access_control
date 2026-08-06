# Third-Party App Handoff: Auth, Default Permissions, and Push Notifications

> Strategy for letting third-party websites/agents (canonical example: "Data Driven Job
> Search", DDJS) hand their signed-in users off to FGAC, receive scoped credentials with
> app-declared default permissions, and get push notifications for new emails.
>
> Branch: `claude/third-party-handoff-permissions-81dc96` — v1 (strategy, pre-implementation)

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
    "access": "read_only",            // template: block send + all mutations
    "rule_templates": [
      { "service": "gmail", "actionType": "send_whitelist", "regexPattern": "^$" } // send nothing
    ],
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
          • Read email in [account picker: kenyesh@gmail.com ▾]  (read-only — cannot send or delete)
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
