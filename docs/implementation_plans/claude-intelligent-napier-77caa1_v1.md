# Decoded-content Gmail read rules + self-identifying denials — v1

Branch: `claude/intelligent-napier-77caa1`. Motivated by the 2026-09-03 support case;
full analysis in `docs/bug_reports/gmail_content_rules_match_encoded_payload_not_content.md`.

## Goals

1. Gmail `read_blacklist` content rules match the **message content a human would
   read** — decoded bodies, subject, participants, snippet, attachment filenames —
   identically across `gmail_read`, `google_api_get` gmail reads,
   `gmail_get_attachment` parent checks, and the push-notification filter, regardless
   of message size, MIME structure, or requested format.
2. Every read-rule denial names the governing rule, identifies FGAC as the source of
   the decision, and links the rules dashboard — so client-layer failures can never be
   mistaken for FGAC policy, and FGAC denials are actionable.
3. The "Recommended Security Rules" template ships patterns scoped to security
   notifications, not any mention of signing in.

## Changes

### src/lib/gmailRules.ts

- New `collectMessageContent(message)`: walks any Gmail response shape (message,
  thread `{messages:[…]}`, list `{messages|threads:[…]}`) and returns the decoded
  corpus per message: `From/To/Cc/Subject` header values, `snippet`, part filenames,
  and decoded `text/plain` + tag-stripped `text/html` bodies (base64url). Returns
  `null` when the shape carries no recognizable message payloads.
- `checkReadRestrictions`: content rules test the corpus; falls back to
  `JSON.stringify(message)` when the corpus is `null` (unknown shapes keep the old,
  strictly-conservative behavior). Label rules unchanged.
- Denial copy (all three kinds) becomes:
  `🚫 FGAC read rule '<rule name>' blocked this message (<detail>). This denial was
  made by FGAC.ai, not by your agent or client; the FGAC account owner can adjust
  rules at https://fgac.ai/dashboard/rules.` — with `<detail>` naming the blacklisted
  label, the missing whitelist label, or the matched content pattern's rule.
- Label-rule messages now name the rule (blacklist previously named only the label id;
  whitelist named nothing).

### src/app/api/mcp/route.ts

- `parseGmailMessage` reuses the shared body-decoding helpers moved into
  `gmailRules.ts` (single decode implementation; no behavior change to parsing).

### src/app/dashboard/actions.ts

- `applyRecommendedSecurityRules` patterns tightened:
  - `2FA Code` → `\b2fa\b|two.?factor`
  - `Password Reset` → `password reset|reset your password`
  - `Sign In` → `sign.?in (alert|attempt|notification)|new sign.?in|security alert`
  - `Verification Code` → `verification code|one.?time (code|passcode)|\botp\b`
  Existing users' stored rules are untouched (their rows keep old patterns; the reply
  to the reporter covers tuning hers).

## Non-goals

- No change to send whitelists, sheets/docs rules, windowing, or outcome
  classification (audited: every refusal path already carries the ⏳🚫⚠️❌ prefix).
- No migration of existing rule rows.

## Validation

1. `npm run db:branch` + local dev server; QA accounts per `.qa_test_emails.json`.
2. Seed: send QA mail (a) large multi-attachment message with a pattern phrase ONLY in
   the body text, (b) large multi-attachment message with no matching phrase, (c) small
   plain message with the phrase.
3. Assert: (a) and (c) deny with the rule named, identically via `gmail_read`
   (full/metadata/windowed) and `google_api_get`; (b) reads fine via both paths;
   denial text names rule + dashboard link.
4. `/deploy-pr-preview`, re-run the same assertions against the preview build.
