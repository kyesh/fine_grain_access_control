# File approval-link open rate — investigation + relayable denial copy

Branch: `claude/sheets-approval-open-rate` — v2 (2026-08-29)

v2 revision: QA of the combined PR #97/#98/#99 deploy found the v1 sentence put
the URL flush against the closing quotation mark (`...dashboard: <url>"`). RFC
3986 excludes `"` from URLs so mainstream linkifiers are unaffected, but a
naive whitespace-delimited extraction sweeps the quote into the `s` signature
param and the approve page rejects the link ("Invalid link" — verified
empirically). The sentence is reordered so the URL sits mid-sentence followed
by a space: "FGAC is blocking this until you approve it here: <url> — one
click, and you can revoke it any time from your dashboard." Same content, no
delimiter adjacent to the URL in any direction.

Follow-up to `claude_first-run-mcp-instructions_v1.md`: that investigation flagged
the sheets access gate as the top blocker among called-but-never-succeeded users
(4 people stuck at `denied_by_policy` on `sheets_get_spreadsheet`, up to 13
retries). This traces where the approval funnel actually loses them.

## Findings (PostHog, production, queried 2026-08-29)

1. **Link minting and delivery work.** Every `sheets_not_exposed` read denial
   mints a deterministic approval link. The "only 6 of 52 denial calls carried
   `approval_request_id`" scare is instrumentation timing — the stamp shipped
   2026-08-27; since then every denial carries it (5/5 on 08-28). Two other
   apparent anomalies are the same effect: `denial_code`-less sheets denials all
   predate the 08-19 stamping, and pre-08-25 mint events lack `request_id`.
2. **The post-approval dead end is fixed.** The launch-cohort failure mode
   (approve → agent retries → Google 403/404 because the drive.file grant was
   missing → user re-approves → gives up) is visible verbatim in one cohort
   user's timeline: three `sheets_expose` approvals across 08-16/17, every retry
   an `error`, then churn — and when that same user returned on 08-26/28 and got
   fresh links, they no longer opened them. Since the 08-25 deploy
   (deterministic links + grant verification + sheets-setup recovery routing),
   every opened-and-approved file link verifies clean
   (`sheets_grant_verification result=ok`), none stuck in `missing`.
3. **The remaining loss is entirely the click.** Since 08-25, file approval
   links: 12 minted (distinct requests) → 4 opened (33%) → 2 approved. Send
   links over the same window: 7 → 6 opened (86%) → 5 approved. Same minting
   machinery, same agent protocol — the send denial offers concrete
   plain-language choices ("Allow sending to 'X' only" / "allow ANY recipient"),
   while the file denial leads with FGAC jargon ("not exposed in your FGAC
   rules") that agents paraphrase at the user. Caveat: samples are small and
   send-intent may be inherently hotter; treat as directional, not causal proof.

## Change

`policyDenialWithLink` (src/app/api/mcp/route.ts) adds one line to every
link-carrying policy denial: a quotable, jargon-free sentence for the agent to
relay, with the URL embedded mid-sentence — "FGAC is blocking this until you
approve it here: <url> — one click, and you can revoke it any time from your
dashboard." (v2: URL moved off the closing quote; see revision note above). This
mirrors the send denial's plain-language style, doubles the URL's survival odds
in agent paraphrase, and tells the user why clicking is safe. The 🚫 line,
`denial_code`, action-typed link, and AGENT_APPROVAL_PROTOCOL that QA caps
09/13/14/15/19 assert on are unchanged.

## Success measure

Open rate of file-action approval links (uniq `request_id`:
`approval_link_minted` → `approval_link_opened`, actions
sheets_expose/sheets_write/docs_expose/docs_write), baseline 33% (08-25→29).
Compare 2 weeks post-deploy. Approval and verification stages need no change —
they convert cleanly once opened.

## Rejected on evidence

- "Approval links aren't delivered/minted" — false, instrumentation timing.
- Post-approval grant fixes — already shipped 08-25 and verifiably working.
- Retry-pressure interventions — the protocol already suppresses most retries;
  remaining retry noise is from links users decline to open, which copy, not
  mechanics, addresses.
