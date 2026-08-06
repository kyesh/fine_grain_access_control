# FGAC Partner Integration Guide

> **Audience:** third-party applications that want their users to grant scoped,
> rule-governed access to Gmail through FGAC — with optional real-time
> notifications when new mail arrives.
>
> The model in one sentence: your user clicks "Connect" in your app, approves a
> single FGAC consent screen, and your servers receive credentials that can
> only do what that user allowed — FGAC holds the Google credentials, enforces
> the user's rules on every request, and never sends you email content you
> weren't granted.

---

## 1. What you provide us (one-time registration)

FGAC registers partners manually today. Send us:

| Item | Notes |
|------|-------|
| **App name** | Shown verbatim on the consent screen (e.g. "Data Driven Job Search") |
| **Logo URL** (optional) | HTTPS PNG/SVG, square, shown on the consent screen |
| **Redirect URI(s)** | Where we send the user back with the authorization code. HTTPS only (localhost allowed for your dev builds). Exact-match — no wildcards. |
| **Webhook URL** (if using notifications) | HTTPS endpoint on your infrastructure that receives new-mail pings. Publicly reachable; no IP allowlisting of our side required (verify by signature, not source). |
| **Requested access** | Today: `read_only` Gmail (+ optional `new_email` notifications). Read-only means your credentials can list and read mail the user's rules allow — they can never send, modify, or delete. |
| **Ops contact** | Email for delivery-failure and incident notices |

## 2. What we provide you (once, over a secure channel)

| Credential | Purpose |
|------------|---------|
| `client_id` | OAuth client identifier (public) |
| `client_secret` | OAuth code/refresh exchange (confidential — server-side only) |
| `webhook_secret` | HMAC-SHA256 key to verify our webhook signatures (confidential) |

Plus these fixed endpoints:

| Endpoint | URL |
|----------|-----|
| Authorize (start handoff here) | `https://fgac.ai/oauth/authorize` |
| Token exchange & refresh | `https://clerk.fgac.ai/oauth/token` |
| Proxy-key exchange (optional) | `https://fgac.ai/api/auth/partner-token` |
| Gmail REST proxy | `https://gmail.fgac.ai/gmail/v1/...` |
| MCP server (alternative surface) | `https://fgac.ai/api/mcp` |
| OAuth discovery metadata | `https://fgac.ai/.well-known/oauth-authorization-server` |

## 3. What you build

### 3.1 The handoff (OAuth 2.0 authorization code + PKCE)

**Step 1 — redirect the signed-in user to FGAC:**

```
https://fgac.ai/oauth/authorize
  ?client_id=<your client_id>
  &redirect_uri=<your registered redirect URI>
  &response_type=code
  &scope=email profile offline_access
  &state=<opaque anti-CSRF value you generate per attempt>
  &code_challenge=<BASE64URL(SHA256(code_verifier))>
  &code_challenge_method=S256
```

The user sees **one** consent screen (ours), picks which mailbox to share, and
approves or denies. You do not need to build any consent UI.

**Step 2 — handle the callback** at your redirect URI:

- Approved: `?code=...&state=...` — verify `state` matches what you issued.
- Denied: `?error=access_denied&state=...` — treat as a normal user choice.

**Step 3 — exchange the code (server-side):**

```
POST https://clerk.fgac.ai/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<code>
&redirect_uri=<same redirect URI>
&client_id=<client_id>
&client_secret=<client_secret>
&code_verifier=<the PKCE verifier>
```

Response: `access_token` (valid ~24h) + `refresh_token`. Store both per user,
encrypted at rest.

**Step 4 — refresh** with `grant_type=refresh_token`. Note the refresh token
**rotates** on every use: always persist the new one from the response.

### 3.2 Calling Gmail — pick one of two surfaces

**Option A — REST proxy with a proxy key (recommended for stock Google SDKs):**

Exchange your OAuth access token for the connection's long-lived proxy key:

```
POST https://fgac.ai/api/auth/partner-token
Authorization: Bearer <access_token>
```

→ `{ "status": "approved", "proxy_key": "sk_proxy_...", "emails": [...] }`

Then call the standard Gmail REST API shape against our proxy with that key:

```
GET https://gmail.fgac.ai/gmail/v1/users/me/messages/<id>
Authorization: Bearer sk_proxy_...
```

Official Google SDKs work by overriding the API endpoint
(Python: `client_options={'api_endpoint': 'https://gmail.fgac.ai/gmail/v1'}`;
Node: `rootUrl: 'https://gmail.fgac.ai/'`).

**Option B — MCP:** point any MCP client at `https://fgac.ai/api/mcp` with the
OAuth access token as bearer. Tools include `gmail_list`, `gmail_read`,
`gmail_labels`, `get_my_permissions`.

**Statuses you must handle on either surface:** a `pending` response means the
connection was created outside our consent flow and awaits manual approval
(rare, see §5); `blocked`/`403` means the user detached your app — stop
calling, discard stored credentials, and offer to reconnect.

### 3.3 The webhook receiver (if you requested notifications)

When mail arrives in a connected mailbox, we POST a **thin ping** — message
IDs only, never content:

```json
{
  "event": "new_email",
  "connection_id": "8bce0f81-…",
  "account": "user@example.com",
  "message_ids": ["19fd7e9b4f5d2cf4"],
  "deliveries": [
    { "delivery_id": "079b144e-…", "message_id": "19fd7e9b4f5d2cf4" }
  ]
}
```

Headers on every delivery:

| Header | Meaning |
|--------|---------|
| `X-FGAC-Signature` | `sha256=<hex HMAC-SHA256(webhook_secret, "<timestamp>.<raw body>")>` |
| `X-FGAC-Timestamp` | Unix seconds the signature was produced |
| `X-FGAC-Delivery-Id` | Stable across retries of the same delivery — use for dedup |

Your receiver MUST:

1. **Verify the signature** (constant-time compare) against the raw request
   body before parsing. Reject stale timestamps (e.g. > 5 minutes) to prevent
   replay.
2. **Respond 2xx within 10 seconds.** Do the real processing async — fetch
   message content afterwards through §3.2 with your own credentials.
3. **Be idempotent.** Delivery is at-least-once; dedup on `delivery_id` (or
   `message_id` per account).

Delivery semantics: a failed delivery (non-2xx or timeout) retries on a
backoff ladder (1m → 5m → 15m → 1h → 6h → 24h, then dead-lettered; retry
timing may be coarser depending on platform scheduling). Repeated dead
deliveries **suspend the subscription** and we notify your ops contact —
re-enabling triggers a catch-up sweep. Ordering is not guaranteed; because
pings carry only IDs, out-of-order arrival is harmless.

**What you will never receive:** subject lines, bodies, snippets, or sender
addresses in a webhook — and no ping at all for messages the user's rules
exclude from your access. Content always comes from your own authenticated
fetch, where rules are enforced again at read time.

## 4. Testing your integration

Work through this checklist with us on a test account before going live:

- [ ] **Happy path:** Connect → single FGAC consent screen shows your name,
      logo, and permission summary → callback receives `code` + your `state`.
- [ ] **Deny path:** user clicks Deny → callback receives
      `error=access_denied`, your UI handles it gracefully, no credentials stored.
- [ ] **Token exchange** returns access + refresh; a Gmail list call succeeds
      immediately (no pending step).
- [ ] **Refresh rotation:** two consecutive refreshes succeed and you persisted
      the rotated token both times.
- [ ] **Read-only enforcement:** a send attempt through your credentials
      returns 403 (expected — do not build send features against a read-only grant).
- [ ] **Webhook signature:** valid pings verify; a tampered body or wrong
      secret fails your verification.
- [ ] **Webhook dedup:** we will replay a delivery — confirm you process it once.
- [ ] **Failure/retry:** return 500 for a test ping; confirm the retry arrives
      and your recovery processes it once.
- [ ] **Disconnect:** we detach the test connection — confirm your API calls
      receive blocked/403 and your app surfaces "reconnect" rather than erroring.

## 5. Security model — what keeps everyone honest

- **You never see Google credentials.** FGAC vaults them; your credentials are
  FGAC-scoped and die instantly when the user detaches your app (both the
  OAuth tokens and the proxy key).
- **Permissions are copied at consent, not referenced.** If your requested
  manifest changes later, existing users keep exactly what they approved until
  they re-consent.
- **The consent screen cannot be bypassed.** Driving our OAuth endpoints
  directly yields tokens whose connection is pending-by-default — every API
  call refuses until the user explicitly approves.
- **Users can see everything.** Your app appears in their dashboard with a
  partner badge, the mailbox it can reach, the rules applied, and (soon) a
  delivery audit trail. One click detaches you.

## 6. Support

Registration changes (redirect URIs, webhook URL, logo, requested access) go
through your FGAC contact — access-broadening changes require your users to
re-consent by design. Include your `connection_id` (from webhook payloads or
`get_my_permissions`) in support requests; never send us your `client_secret`
or `webhook_secret`.
