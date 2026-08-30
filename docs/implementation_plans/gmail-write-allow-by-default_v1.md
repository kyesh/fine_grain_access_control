# Gmail Writes: Allow-by-Default (branch `claude/gmail-write-allow-by-default`, v1)

## Product direction (Ken, 2026-08-30)

FGAC currently blocks every raw Gmail write except `messages/send`. Flip this to
**allow-by-default**: any Gmail write our access token can perform — labels,
drafts, `messages/modify` (archive/mark-read), trash/untrash, `batchModify`,
sending via a configured alias — should work through the proxy. "We want to
empower users, not block them. Things without explicit rules stopping them
should be allowed until we create the rule engine for it." The recipient send
whitelist stays; a general Gmail-write rule engine is explicitly deferred.

This extends the 2026-08-19 posture precedent already stated in
`googleApiPolicy.ts`'s header ("classify usage, don't block it — Google's OAuth
scopes are the backstop") from unknown families to the Gmail family itself.

## Verified facts this plan relies on

- The Google grant requested at sign-in is exactly
  `https://www.googleapis.com/auth/gmail.modify`
  (`src/app/layout.tsx:88`, `src/app/dashboard/googleAccess.ts:3`). The MCP
  route additionally *accepts* a legacy `https://mail.google.com/` grant
  (`GMAIL_SCOPES`, `src/app/api/mcp/route.ts:347`) if an account carries one.
- Under `gmail.modify`, Google itself 403s: all `users.settings.*` writes
  (sendAs/alias management, filters, forwarding, vacation, delegates — those
  need `gmail.settings.basic`/`gmail.settings.sharing`), and permanent deletion
  (`messages.delete`, `messages.batchDelete`, `threads.delete` need the full
  `mail.google.com` scope). Settings **reads** (e.g. `settings/sendAs` GET) are
  covered by `gmail.readonly`/`gmail.modify` and already work as `gmail_read`.
- `google_api_modify` only offers POST/PUT/PATCH — the HTTP `DELETE` method is
  unreachable through the raw pair, so `DELETE messages/{id}` cannot happen
  regardless of classification. The one permanent-delete endpoint reachable by
  POST is `messages/batchDelete`.
- The legacy REST proxy (`/api/proxy/[...path]`) is ALREADY allow-by-default
  for Gmail writes (it only whitelists `messages/send` recipients and blocks
  DELETE-method trash paths) — no change needed there; the MCP surface is the
  one being brought into line.
- Trailing-7d production demand: 2 `gmail_write_unsupported` denials (a
  `PATCH settings/sendAs`, one message write). Philosophy, not volume, drives
  the change.

## Design decisions (the five open questions, resolved)

### 1. Endpoints that SEND mail keep the recipient whitelist

- `POST …/messages/send` — unchanged: `gmail_send`, recipients parsed from the
  request's `raw` RFC 2822 body, `checkSendWhitelist`, denial mints approval
  links.
- `POST …/drafts/send` — **new kind `gmail_draft_send`**. The recipients live
  in the stored draft, not the request body, so the route resolves them
  server-side: it extracts the draft id from the body (`{"id": …}`), fetches
  `…/drafts/{id}?format=raw` with the same token, and parses To/Cc/Bcc out of
  `message.raw` with the existing `extractSendRecipients` parser. If the body
  also carries an inline `message.raw` (drafts.send allows updating the draft
  while sending), those recipients are unioned in — every recipient from
  either source must pass the whitelist. Missing id, failed draft fetch, or no
  parseable recipients ⇒ deny with `recipients_undetermined` (never forward
  blind), same as A7 for messages/send. Denials go through
  `sendDenialWithLinks` (same one-click approval UX).
- `POST …/messages/insert` and `…/messages/import` — **plain allowed writes**
  (`gmail_write`). They plant a message in the *user's own mailbox* and never
  deliver mail to a third party, so the send whitelist does not apply. They
  are stamped like every other write for demand monitoring.
- **`upload/` bypass closed**: `upload/gmail/v1/users/me/messages/send` (the
  media-upload variant) previously classified as unknown-family *passthrough*
  — a send path that skipped the whitelist entirely. The classifier now strips
  a leading `upload/` segment before family detection, so upload-variant Gmail
  paths classify as their non-upload twins (send ⇒ whitelist; an RFC 822 media
  body has no parseable JSON `raw`, so recipients are undetermined ⇒ denied).
  Drive media uploads keep working (family passthrough as before).

### 2. Alias sending

Sending "via alias" is just a From header on `messages/send` naming an
already-configured sendAs alias — allowed by `gmail.modify`, and the recipient
whitelist is the only FGAC gate (per Ken's direction). No code change needed;
the From header is not consulted. Managing aliases (`PATCH settings/sendAs`)
cannot work under our grant — see decision 5. Adding a from/alias parameter to
the typed `gmail_send` tool is a separate optional nicety, out of scope here.

### 3. batchModify allowed; the batch check narrows to HTTP batch endpoints

The old check denied any segment *starting with* `batch`, which caught
`messages/batchModify` and `messages/batchDelete` — neither is an HTTP batch
endpoint. Google's multiplexing endpoints are exactly the `batch` path segment
(`batch/gmail/v1`, `batch/drive/v3`); the check narrows to an exact-segment
match. `batchModify` (the standard bulk-label endpoint) then flows into the
gmail branch and is **allowed** as `gmail_write`. `batchDelete` is handled in
decision 4. (Sheets `values:batchGet` / `:batchUpdate` were never caught —
colon-suffixed verbs are not standalone segments.)

### 4. Deletion: trash allowed; permanent deletion still refused, honestly

- `messages/{id}/trash`, `untrash`, `threads/{id}/trash` — reversible ⇒
  allowed (`gmail_write`).
- `messages/batchDelete` — **kept denied**, with the `gmail_write_unsupported`
  code. Two reasons: `get_my_permissions` documents "deletion: NEVER available
  through any tool" as a product guarantee, and the Google backstop is NOT
  airtight here — `GMAIL_SCOPES` accepts legacy `mail.google.com` grants,
  under which batchDelete would really destroy mail permanently. The denial
  text is honest: permanent deletion is the one Gmail write FGAC refuses;
  trash is the alternative. The `gmail_write_unsupported` code thus shrinks to
  exactly this endpoint (matching the brief: "shrink to only whatever remains
  genuinely unsupported").
- `DELETE messages/{id}` — unreachable (no DELETE method on the raw pair);
  documented rather than classified.

### 5. Settings writes: honest scope error, new denial code

Mutating `…/settings/*` calls deterministically fail under both accepted
grants (`gmail.modify` and legacy `mail.google.com` — settings writes need
`gmail.settings.*`, which FGAC never requests). Following the
`raw_api_family_unsupported` precedent (name the real cause once, stop the
retry loop before a wasted network call), these are refused pre-flight with a
**new denial code `gmail_settings_unsupported`** whose text says explicitly:
this is a Google OAuth scope FGAC doesn't hold, not an FGAC policy rule;
reading settings still works; the user changes settings in Gmail directly.
A real user hit `PATCH settings/sendAs` on 2026-08-29 — the distinct code
keeps "wants settings scopes" separable from "wants permanent delete" in the
roadmap-demand analytics.

## Analytics

- New classifier kind `gmail_write` rides the existing stamping
  (`classifyAndStampRawCall`): every allowed Gmail write lands with
  `raw_api_kind: 'gmail_write'`, `raw_api_family: 'gmail'`,
  `raw_api_mutating: true`, and the id-stripped `raw_api_endpoint` (PR #97
  conventions) — the demand feed for the future rule engine.
- `templateGoogleApiPath` learns the new literal subresources
  (`batchModify`, `batchDelete`, `insert`, `import`) so they template as
  themselves instead of `messages/{id}`.
- `gmail_write_unsupported` remains a valid code, now meaning only
  "permanent-deletion endpoint"; `gmail_settings_unsupported` is added.
  `rawApiFamily` keeps `family: 'gmail'` on both, as today.

## Changes shipped

1. `src/app/api/mcp/googleApiPolicy.ts` — classifier flip (`gmail_write`,
   `gmail_draft_send`, batch-check narrowing, `upload/` normalization,
   settings + batchDelete denials), new pure helper `extractDraftSendInfo`,
   `templateGoogleApiPath` literals, header comment updated.
2. `src/app/api/mcp/route.ts` — `executeRawGoogleCall` handles
   `gmail_draft_send` (draft fetch → whitelist) and lets `gmail_write` flow to
   the generic Gmail fetch; `get_my_permissions` defaults gain a `gmailWrite`
   line; `list_accounts` `next_steps` and the server `instructions` mention
   the write surface.
3. `src/app/api/mcp/toolDefs.ts` — `google_api_modify` description rewritten
   ("only supported write is messages/send" dies); `gmail_send` description
   already correct.
4. `scripts/test-google-api-policy.ts` — assertions flipped/extended: labels
   create/update/apply, drafts create/update, drafts/send routing,
   messages/modify, trash/untrash, batchModify allowed; insert/import allowed;
   batchDelete + settings denied with the right codes; upload-variant send
   classifies as send; templating of the new literals.
5. Docs: `docs/distribution_architecture.md` (raw-pair section),
   `docs/analytics.md` (denial-code notes), QA capability
   "Raw Google API Pair" (`docs/QA_Acceptance_Test/capabilities/10_raw_google_api.md`)
   A4/A9 rewritten to assert allowed behavior (+ new assertions for
   drafts/send routing and honest settings error), agent runbook touchpoints,
   `.claude/commands/support-triage.md` stale claim fixed.
6. `npx tsx scripts/qa-coverage-check.ts` re-run after QA-doc edits.

## Non-goals

- No general Gmail-write rule engine (explicitly deferred).
- No `gmail.settings.*` scope request.
- No typed-tool additions (e.g. `gmail_send` alias parameter).
- No REST-proxy changes (already allow-by-default).

## Validation

- `npx tsx scripts/test-google-api-policy.ts` (pure unit suite).
- Local `npm run dev:qa` spot-checks via hosted MCP: label create, message
  modify, draft create, drafts/send against whitelisted + non-whitelisted
  recipients, batchModify, settings write (honest scope text).
- `/deploy-pr-preview`, then the applicable QA capability suites (raw Google
  API pair; send-whitelist capability unaffected but re-asserted) against the
  preview.
