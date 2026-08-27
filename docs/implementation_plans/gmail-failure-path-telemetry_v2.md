# Gmail post-policy failure path: telemetry then copy

Branch: `claude/distracted-germain-3d9e18` · Plan v2 · 2026-08-26

v2 supersedes v1 on one point only: **the production figures are now
verified.** The PostHog connector became available mid-task, after v1 was
written and after the code had shipped to the PR. No design decision changed
as a result — but the priority ordering did, and one finding materially
changes how the headline error rate should be read.

See v1 for the full design rationale, the code-established causes (C1-C3),
and the D1-D3 decisions. They stand unchanged.

## Verified production numbers

HogQL over `$mcp_tool_call`, project 343912, trailing 7 days ending
2026-08-26, `environment = 'production'`, internal person/account emails
excluded.

| tool | calls | tool errors | err % | error | failed | exception | `$mcp_is_error` | users hit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gmail_get_attachment | 91 | 53 | **58.2%** | 40 | 13 | 0 | 40 | 8 |
| gmail_list | 320 | 40 | **12.5%** | 16 | 22 | 2 | 18 | 16 |
| google_api_modify | 114 | 14 | 12.3% | 14 | 0 | 0 | 14 | 9 |
| sheets_get_spreadsheet | 135 | 11 | 8.1% | 2 | 9 | 0 | 2 | 5 |
| google_api_get | 847 | 19 | 2.2% | 17 | 2 | 0 | 17 | 8 |
| gmail_read | 1624 | 32 | 2.0% | 30 | 2 | 0 | 30 | 3 |

`gmail_get_attachment` **worsened** since the review window (49.1% → 58.2%).
Gmail remains the worst surface.

### D1 is confirmed empirically

`gmail_list` shows 40 tool errors but `$mcp_is_error` true on only 18 — the
22 `failed` rows are genuinely outside the field Anthropic's Connector
Directory reads. Promoting them to `errorResult` would have moved 22 calls
into the published error rate. v1's D1 decision was correct.

## The finding that reorders priorities

Failure breakdown for Gmail, by outcome and status:

| tool | outcome | status | n | users |
| --- | --- | --- | --- | --- |
| gmail_get_attachment | error | 404 | 38 | 3 |
| gmail_read | error | 404 | 30 | 3 |
| gmail_list | failed | (none) | 22 | 10 |
| gmail_list | error | 403 | 16 | 7 |
| gmail_get_attachment | failed | (none) | 13 | 4 |
| gmail_get_attachment | error | 403 | 2 | 2 |

**404s are the dominant Gmail failure mode: 68 of roughly 100 Gmail tool
errors.** v1's brief framed the 403 reason mix as the load-bearing unknown;
the data says 403s are 19 calls total. The 404 disambiguation (P2b), not the
403 branching (P2a), is the high-volume change. Both shipped, so this is a
prioritization correction, not a rework — but any follow-up effort belongs on
the 404 path.

**62 of those 68 404s belong to a single user.** That user's profile over
three active days:

| | successes | 404s |
| --- | --- | --- |
| gmail_read | 494 | 27 |
| gmail_get_attachment | 6 | 35 |

Two things follow.

1. **The headline error rate is one agent in a retry loop, not a broad cohort
   problem.** `gmail_get_attachment` at 58% across 8 users is really one
   heavy user failing 35 times against 6 successes. This is worth stating
   plainly wherever that error rate is quoted, including externally.
2. **The attachment-id hypothesis holds.** With 494 successful reads the
   agent's `messageId` handling is demonstrably fine, yet attachments fail
   85% of the time for it. That is the signature P2b's `attachment` branch
   was written for: valid message, stale or wrong `attachmentId`, retried
   unchanged. The remediation — re-read the message, take a fresh
   `attachmentId`, retry once, then stop — targets exactly this.

The 27 `gmail_read` 404s for the same user mean the `message` branch will
also fire, so both branches earn their place.

## Status of the open questions from the task brief

| # | question | status |
| --- | --- | --- |
| 1 | 403 reason split | **still open** — needs `error_reason` from a deploy. Now known to be low-volume (19 calls), so lower priority than assumed. |
| 2 | behind the attachment 404s | **strongly narrowed** — concentrated in one user with a healthy read path and an 85% attachment failure rate; consistent with stale/wrong attachment ids. `gmail_404_site` will confirm the split after deploy. |
| 3 | which `resolveAccountAndToken` branch | **still open** — needs `failure_reason` from a deploy. Sized at 39 statusless Gmail calls (22 + 13 + 2 + 2). |
| 4 | re-verify the rates | **done** — this document. |

## Follow-up, revised

The single highest-value next step is no longer the 403 mix. It is to watch
`gmail_404_site` after deploy for the one heavy user, and confirm the stop
conditions actually break the loop — measurable as attachment 404s per user
per day falling, not as an error-rate change (a loop that stops early
produces *fewer* calls, so the rate may barely move while the absolute
failure count drops).
