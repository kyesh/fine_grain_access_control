# Gmail content read-rules match the encoded payload, not the message content

**Reported:** 2026-09-03, support email ("Token Lookup Problem" thread — reporter details
in the operator mailbox, not this repo). **Status:** fix in progress.

## Symptom (as reported)

A user reading a delegated mailbox reported that `gmail_read` with `format=full` failed
on two large attachment-bearing messages with an error reading "No approval received"
(naming no rule), while the same messages read fine via `google_api_get`
(`gmail/v1/users/me/messages/{id}?format=full`), `gmail_read format=metadata` worked on
both, and `gmail_read format=full` worked on a smaller message. The user's two explicit
complaints: the error names no rule, and the two read paths appear to disagree on
enforcement.

## What the evidence showed

Full timeline in the support case notes (operator-local). Key findings from production
analytics and the production database (read-only):

1. **Every request that reached the FGAC server succeeded or was correctly denied.**
   The user's `gmail_read format=full` calls on both "failing" messages returned parsed
   content (attachment-heavy messages parse small: ~7.0 KB and ~2.6 KB responses),
   recorded `outcome=success`, with the windowed envelope behaving exactly as designed.
   The one real denial in the window was via `google_api_get` and its text **did** name
   the governing rule.
2. **The failing attempts never reached FGAC.** In the ~50-minute window where the
   failures were experienced there are zero `$mcp_tool_call` events, zero MCP 401s
   attributable to the user, and zero server exceptions. The literal string
   "No approval received" appears nowhere in this codebase — it came from the MCP
   *client* layer (a hosted-agent tool-approval flow), not from FGAC. FGAC cannot emit
   it and cannot observe the client declining to send a call.
3. **The user's rules came from our own "Recommended Security Rules" one-click
   template** (`applyRecommendedSecurityRules`): four global `read_blacklist` content
   rules with broad patterns (`Sign In`, `Verification Code`, `2FA Code`,
   `Password Reset`).

## The actual defects (what this fix addresses)

While the reported failure was client-side, the investigation surfaced real
enforcement defects that produce exactly the "rules behave inconsistently by message
size/path" experience the user described:

1. **Content rules are tested against `JSON.stringify(raw Gmail payload)`.** In Gmail's
   `format=full` JSON, body text is base64url-encoded. A content pattern therefore:
   - **cannot match the message body** — the one place users expect a content rule to
     look — for any multipart message (the pattern only ever matches the plaintext
     fields: snippet, headers, attachment *filenames*, label ids);
   - matches differently depending on `format` (`metadata` has no parts → fewer fields
     to match) and on message structure (small single-part vs large multipart), which
     reads as size-dependent, path-dependent enforcement;
   - can in principle false-positive on base64/id gibberish for space-free patterns.
2. **Denial texts do not identify FGAC as the decision-maker** and offer no remediation
   link, so a client-side failure message is indistinguishable from an FGAC policy
   denial to the end user — this is how a client-layer "No approval received" got
   attributed to FGAC rules. Label-rule denials also did not name the governing rule
   (only the label id, or nothing for whitelist misses).
3. **The recommended template's patterns are too broad** for post-fix semantics: once
   content rules can actually see body text, `Sign In` would block any email whose body
   invites the reader to sign in to a portal.

## Fix

1. `checkReadRestrictions` (shared by `gmail_read`, `google_api_get` gmail reads,
   `gmail_get_attachment` parent checks, and the push-notification filter) now builds a
   **decoded content corpus** — subject/from/to/cc headers, snippet, attachment
   filenames, and *decoded* text bodies (text/plain, tag-stripped text/html) across
   every message nested in the response (threads and lists included) — and tests
   content rules against that, instead of the raw JSON string. Unrecognized shapes fall
   back to the raw serialization so nothing silently un-enforces.
2. Every read-rule denial now names the governing rule, states that FGAC made the
   decision, and links the rules dashboard.
3. The recommended-template patterns are tightened to target security emails
   (sign-in alerts, verification codes) rather than any mention of signing in.

Existing user rules keep their stored patterns; only enforcement semantics (what text
the pattern is tested against) and denial copy change.

## Verification

- Unit-style reproduction against a local build with the QA accounts: a pattern present
  only in a base64-encoded body (previously invisible) now blocks, with the rule named,
  identically via `gmail_read` and `google_api_get`; a large multi-attachment message
  with no matching content reads fine via both paths in full/metadata/windowed forms.
- Preview validation via `/deploy-pr-preview` before hand-off.
