# gmail_get_attachment 404 self-heal — v1

Branch: `claude/gmail-attachment-selfheal`

## Problem

`gmail_get_attachment` has the worst published error rate of any FGAC tool on
Anthropic's Connector Directory (44% over the 7d ending 2026-08-28; 38 of 51
errors are Google 404s). The leading cause is that Gmail `attachmentId` values
are **ephemeral** — Google re-issues them when a message is re-indexed, so an
id taken from an earlier `gmail_read` (or another session) 404s even though the
message is fine.

## What already shipped (PR #89, merged 2026-08-27)

`gmailNotFoundResult` (route.ts) disambiguates message-vs-attachment 404s,
stamps `gmail_404_site`, and tells the agent to re-read the message and retry
with a fresh id. That helps agents recover, but the first 404 still counts as
a tool error in the directory metric — the error rate only moves if the error
never happens.

## Verification status (this session)

PostHog re-verification was **blocked**: the claude.ai PostHog connector is not
attached to this session and `POSTHOG_PERSONAL_API_KEY` is unprovisioned
(`npm run env:check` confirms; provisioning it is a user action). The fix is
therefore designed to be correct under either 404 cause and instrumented so
the causal split is measurable after deploy:

- If 404s are stale-but-healable ids → `attachment_selfheal: 'recovered'`
  rises and the published error rate falls.
- If 404s are hallucinated ids / wrong message → `'ambiguous'` /
  `'no_attachments'` / `'retry_failed'` rise instead, and the next iteration
  targets tool descriptions rather than healing.

## Change

In the `gmail_get_attachment` handler (route.ts), which already fetches the
parent message (`format=full`) before the attachment:

1. **Self-heal on attachment 404.** The parent read is fresh, so its
   attachment ids are the ones Gmail currently honours. When the supplied id
   is absent from the fresh list:
   - exactly one attachment on the message → retry once with the fresh id;
     on success return it as a normal success (`attachment_selfheal:
     'recovered'`).
   - several attachments → can't know which was meant; return an error that
     **lists** the current attachments (filename, type, size, fresh id) so
     recovery is one retry with no extra `gmail_read` (`'ambiguous'`).
   - none → say the message has no attachments (`'no_attachments'`).
   - supplied id present in fresh list but still 404 → fall through to the
     existing `gmailNotFoundResult` text (not a staleness case).
2. **`filename` selector.** New optional param; `attachmentId` becomes
   optional (backward compatible — every existing caller passes it). Filenames
   don't go stale, so agents that know the filename can skip the ephemeral id
   entirely. Ambiguous or missing filename errors list the current
   attachments. `attachment_selector: 'id' | 'filename'` stamped per call.

## Non-goals

- No change to outcome classification or to what counts as an error.
- No schema/db work.
- The 11 null-`error_status` failures in the 7d window are pre-`error_status`
  events; not diagnosable this session (PostHog blind) and not blocking this
  fix.

## Post-deploy verification (name the query)

HogQL over `$mcp_tool_call` where `tool = 'gmail_get_attachment'`, external
users only: breakdown of `attachment_selfheal` and trailing error rate. The
fix is confirmed when `'recovered'` accounts for the bulk of would-be 404s and
the tool's error rate converges toward the other Gmail read tools.
