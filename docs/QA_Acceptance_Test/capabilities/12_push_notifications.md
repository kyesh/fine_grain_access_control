# Capability: Push Notifications

> Gmail `users.watch` → Pub/Sub → `/api/webhooks/gmail` → rule filter →
> `webhook_deliveries` outbox → HMAC-signed thin ping to the partner webhook.
> Design: `docs/implementation_plans/third-party-handoff-permissions_v6.md`
> (Spike 4 Expanded).
>
> **Setup**: capability 11 approved connection with notifications granted;
> `scripts/setup-gmail-push.ts --project dev-fgac-ai --apply` run;
> `scripts/qa-webhook-receiver.ts` listening (its URL registered as the QA
> partner's webhook_url); `scripts/qa-pubsub-bridge.ts` draining the dev pull
> subscription (Pub/Sub cannot push to localhost).
>
> **Channels**: server-side capability — run once per QA cycle from the
> hosted-MCP runbook (curl + scripts + browser agent for A7/A10 dashboard
> checks), not repeated per agent runtime.

## Assertions

### A1: Consent creates subscription and arms watch
- After capability 11 A4 (Approve with notifications in the manifest)
- **Expected**: `notification_subscriptions` row for (connection, mailbox),
  status `active`, `watchExpiresAt` ≈ 7 days out, `lastHistoryId` set.

### A2: New email produces a signed thin ping
- Send a test email to the watched mailbox; let the bridge drain
- **Expected**: within 60s the QA receiver logs a POST with body
  `{event: "new_email", connection_id, account, message_ids: [...]}`, headers
  `X-FGAC-Signature` (HMAC valid against the partner webhook_secret),
  `X-FGAC-Timestamp`, `X-FGAC-Delivery-Id`. The message id matches the sent
  email, retrievable through the proxy with the partner key.

### A3: Payload is IDs-only
- Inspect the A2 ping body
- **Expected**: no subject, snippet, body content, or sender address anywhere
  in the payload — message ids and account only. (Product invariant: content
  stays behind the proxy where rules re-check at fetch.)

### A4: Rule-filtered silence
- Add a `label_blacklist` rule (reuse the capability 05 label baseline) bound
  to the partner key; send an email that carries that label on arrival (label
  applied via filter or self-labeled thread); drain
- **Expected**: NO ping for that message (webhook_deliveries has no row for
  it). A concurrently sent unlabeled email IS pinged — proving selective
  filtering, not breakage.

### A5: Zero-diff notifications are tolerated
- Re-arm the watch (`users.watch` publishes a test notification at arm time)
- **Expected**: receiver gets no ping; `/api/webhooks/gmail` returns 200 with
  `enqueued=0`; no error logs.

### A6: Pub/Sub duplicates do not double-ping
- Re-POST the same drained envelope to `/api/webhooks/gmail` (bridge replay)
- **Expected**: 200, `enqueued=0` (unique (subscription, messageId) absorbed
  it); receiver log shows no second ping for those delivery ids.

### A7: Retry, backoff, and suspension on a failing receiver
- Create the `qa-webhook-fail` flag file (receiver returns 500); send a test
  email; drain; run the delivery cron repeatedly (call
  `/api/cron/deliver-webhooks` directly, adjusting `nextAttemptAt` in test to
  step the ladder)
- **Expected**: delivery row cycles pending→delivering→pending with
  `attempts` incrementing and `nextAttemptAt` following the 1m/5m/15m/1h/6h/24h
  ladder; after max attempts the row goes `dead`; after 3 dead groups the
  subscription is `suspended` and no further pings are attempted.

### A8: Re-enable resumes delivery
- Remove the fail flag; re-activate the subscription; send a new email; drain
- **Expected**: new pings flow again (consecutiveFailures reset).

### A9: Renewal cron re-arms watches
- Null out / age `watchExpiresAt` on the subscription; GET `/api/cron/renew-watches`
- **Expected**: `watchExpiresAt` advances ≈ 7 days; `lastHistoryId` is NOT
  regressed.

### A10: Detach tears notifications down
- Detach the partner connection in the dashboard; send another email; drain
- **Expected**: subscription `cancelled`, Gmail watch stopped (no new Pub/Sub
  notifications for the mailbox once the pipeline drains), receiver logs no
  new pings.

### A11: Unauthenticated receiver POST rejected
- POST a valid-shaped envelope to `/api/webhooks/gmail` with no OIDC token and
  no (or wrong) `x-qa-bridge-secret`
- **Expected**: HTTP 401; nothing enqueued.

### A12: Push preflight is green
- Run the push preflight (topic project vs Google client project check —
  `scripts/setup-gmail-push.ts --project dev-fgac-ai` dry run shows all ✔)
- **Expected**: topic exists, gmail-api-push publisher binding present,
  `GMAIL_PUBSUB_TOPIC` in the environment matches the token's `azp` project.
