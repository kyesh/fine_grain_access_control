# Denial copy: tell the agent to stop, and who can change it — v1

Branch: `claude/quizzical-bhaskara-bafbd3` · 2026-09-11

## Problem as stated

PostHog (production, 2026-09-04 → 09-11) showed agents "retrying policy
denials in tight loops because the denial text does not tell them to stop":
a 12-denial `send_disabled` burst, an hourly job stuck on
`account_not_permitted`, and a handful of 2–5 denial repeats.

## What re-verification showed

Every count was re-run over `$mcp_tool_call` / `approval_link_minted` before
any text was touched (queries now in `docs/monitoring.md` 7.22).

1. **The 12-in-84-s burst is a batch, not a loop.** 12 `send_disabled`
   denials in 19 s from claude.ai (`Anthropic/Toolbox`), each to a
   *different* recipient: 12 distinct `send_whitelist` request ids, one
   `send_all` id at `mint_count` 12. The agent emitted 12 sends in one turn,
   was denied 12 times, stopped, relayed the link; the user approved
   `send_all` 65 s after the last denial and the 12 sends succeeded on the
   next turn. `AGENT_APPROVAL_PROTOCOL` ("Do NOT retry … returns the SAME
   link") has been appended to every linked denial since 2026-08-19 and was
   obeyed. The "84 s" spanned the approval, not the retries.
2. **The hourly job passes a wrong `account`; nothing was revoked.** The
   person has no `delegation_*` or `account_linked` events at all, and the
   calls that omit `account` resolve to their own address. The ❌ form
   (2026-09-05 → 09-08, 18 rows) was graduated to a 🚫 that names the fix on
   2026-09-08 (already on main). When the agent reads it, it applies the fix
   within seconds — but a Claude-desktop scheduled task re-sends the same
   value on the next run, so the 🚫 form has been hit 23 times since. The
   task is what has to change; the copy never said so.
3. **Error-rate optics.** The caller-chosen `account_not_permitted` is
   already 🚫 (graduated 2026-09-08). The default form (no `account`, owner's
   own address not on the key) stays ❌ per the 2026-09-03 precedent — nothing
   the caller sent caused it — and has produced 0 rows since the split, so
   optics are moot there.
4. The remaining repeats (`jayrockliffe`: 7 `send_disabled` across three
   days, one per session; `detachedparent`: 2 sends 6 s apart, two
   recipients; `ameya`: one denial, approved 105 s later) are per-session
   demand, not loops.
5. The refusals with **no** next step at all were: explicit blocks
   (`sheets_blocked` / `docs_blocked` — no link by design), the mint-failure
   fallback in `policyDenialWithLink` / `sendDenialWithLinks`, and both
   `account_not_permitted` forms as far as retry/scheduled-task guidance
   goes.

## Decisions on the candidate directions

- **Append "do not retry / link does not change" to linked denials** —
  already present in the protocol footer; tightened one clause ("the link
  does not change no matter how many times the call is repeated") rather
  than duplicating the sentence. `send_disabled` gains "covers ANY recipient,
  hold the rest of the batch"; `recipient_not_whitelisted` gains "do not
  retry it".
- **`account_not_permitted`**: 🚫 form gains do-not-retry, "no approval link
  exists, only the user can add an account", and the scheduled-task sentence.
  ❌ form keeps its class and gains "pass an accessible address, or ask the
  user to add yours". **No approval link**: the key's account list is not a
  grant an agent should be able to request, and the job's problem is the job.
- **Explicit blocks and mint failures** get a stop sentence
  (`withNoLinkStop`, `LINK_UNAVAILABLE_STOP`).
- **"Your agent has asked N times" on the approve page** — rejected. The
  high-`mint_count` cases were a batch (12 recipients) and a user already on
  the page; a counter helps neither and risks reading as "12 emails will go
  out" on a `send_all` link.

## Shipped

- `src/lib/denialCopy.ts` — builders and constants (protocol moved here).
- `src/app/api/mcp/route.ts` — wired; outcome prefixes unchanged.
- `scripts/test-denial-copy.ts` — 42 checks, in `npm run mcp:lint`.
- `docs/analytics.md` (funnel reading + `account_not_permitted` paragraph),
  `docs/monitoring.md` 7.22 (queries + baseline).

## Measure afterwards

`monitoring.md` 7.22: same-target `mint_count` per request should stop
climbing; distinct-target batches will not move; the hourly job moves only
when its owner edits the task.
