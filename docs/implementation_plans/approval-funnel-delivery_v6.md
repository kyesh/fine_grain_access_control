# Approval funnel: decision resolved, A4 retired — v6

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **plan for review — QA specs updated, no code changed**
Supersedes: `approval-funnel-delivery_v5.md` (v5 → v4 → v3 → v2 → v1)

## What changed since v5

The open decision carried since v4 §4 is **resolved**. Ken's call: drop the
requirement. Capability 14 A4 is removed rather than rewritten, and there is no
re-grant warning card.

**Accepted behaviour:** approval URLs are permanent, so re-opening one after the
grant was revoked renders the ordinary approve card and re-approving re-grants.
The bar for that is the owner's Clerk session plus an explicit click on a page
naming the grant — the same bar as re-adding the rule from the dashboard.

This is now applied to the QA specs (the only files this revision touches).

---

## Applied in this revision

| file | change |
|---|---|
| `capabilities/14_magic_link_approvals.md` | **A4 deleted.** Preamble rewritten: links are signed + deterministic, do **not** expire, are **not** single-use; authorization is the Clerk session plus the live proxy-key ownership check; the HMAC prevents forgery, not authorizes; re-approval after revocation is explicitly permitted. A11's stray "the link is single-use" clause removed |
| `capabilities/15_request_access_tool.md` | **A6 rewritten** — it referenced 14's A4 and would have been orphaned. Now repeats 14's A5 (wrong user) and A7 (tampering) instead, dropping expiry/single-use. A4's "30-minute TTL" phrasing removed |

Capability 14 now runs A1, A2, A3, A5–A11. `scripts/qa-coverage-check.ts` parses
assertion ids into a `Set` with no contiguity requirement, so the gap at A4 is
harmless — verified by reading the parser, not assumed.

### One consequence to note

A4 bundled three properties. Two are deliberately gone (expiry, refuse-after-
revoke). The third — **re-opening a still-granted link renders "Already
approved" rather than double-writing** — is live behaviour that survives the
redesign and is now **asserted nowhere**.

`approvalLinkStatus` still resolves it from live grant state, not from the
consumption table, so it keeps working. But it is real behaviour with no test.
**Recommendation:** fold it into the new A13 as a second bullet rather than
leaving it uncovered. Marked as a recommendation, not applied — say the word and
it goes in, or stays out.

### Code simplification this unlocks

With single-use and expiry both gone, `approvalLinkStatus`'s five-state return
(`fresh | already_granted | used_inactive | expired | invalid`) collapses to
**two**: grant active → `already_granted`, otherwise → `fresh`. `used_inactive`
and `expired` become unreachable, so the "Link expired" card, the "Link already
used" card, and the message at `actions.ts:1056` can all be deleted outright.
Both rage-click sources disappear as dead code rather than as reworded copy.

### Sequencing

These QA specs now describe the **target** state, while production still has
expiry and single-use. Workstream 1 (code) and the remaining QA edits must land
in the same PR. Until then the suite intentionally does not assert those two
properties — noted so a QA run in the interim is not read as a regression.

---

## Updated QA change table (supersedes v4 §5)

| # | Before | After |
|---|---|---|
| A1 | Send denial returns two approval URLs | Unchanged |
| A2 | Approving grants exactly the denied recipient | Unchanged |
| A3 | Sheets denial pre-fills sheet, offers RO/RW | Unchanged |
| ~~A4~~ | Idempotent while granted; refused once revoked; expired link rejected | **Deleted** — requirement dropped |
| A5 | Another user's session cannot approve | Unchanged in intent, **more load-bearing**: now enforced solely by the live proxy-key ownership check |
| A6 | Unauthenticated click requires owner sign-in | Unchanged |
| A7 | Tampered links rejected | Unchanged — **this is why the HMAC is kept** |
| A8 | Read-block denials carry no link | Unchanged |
| A9 | Single-line URL, non-empty `token` param | Reworded for the new params (`a`, `k`, `r`, `s`); keep the 2026-08-15 trailing-newline regression verbatim |
| A10 | Decode the JWT to check the `action` claim | Simplified — read `a=` directly; same matrix, same intent |
| A11 | Send-to-anyone grant; "link is single-use" | **Applied** — single-use clause removed |
| **A12** | — | **NEW: determinism.** Three identical denials produce three byte-identical URLs |
| **A13** | — | **NEW: no expiry.** A link minted well beyond the old 30-minute window still approves *(recommended: plus an "Already approved" re-open bullet, see above)* |
| Cap 15 A6 | Repeated 14's A4 | **Applied** — repeats A5 + A7 instead |
| Cap 16 | 9 assertions, none on approval events | Add approval-event assertions per v5 workstream 0e |

---

## Workstreams (carried from v5)

### 0. Make the approval funnel legible — **ship first**

The root cause of the whole episode: the funnel had no data contract, so every
consumer invented a grouping (26% → 31% → 68% → 58%). Unchanged from v5 §0:

- **0a** Document the contract in `docs/analytics.md` — `approval_link_opened`,
  `link_id`, and `approval_link_id` are currently absent entirely, and
  `approval_link_minted`'s property list is wrong. State the unit of analysis in
  one sentence.
- **0b** Deterministic `request_id` replaces `link_id`; add a **hashed**
  `target_hash` so different resources separate directly and no future analysis
  needs the time-burst heuristic. Emit minted **once per attempt**.
- **0c** Stamp opens with `agent_driven` — ~23% of approve-page loads are agent
  traffic, invisible today because server-side events carry no user agent.
- **0d** Create the saved insight (none exists) and register a governed metric
  (catalog is empty). **Headline on approvals, not opens.**
- **0e** Point the recurring analytics review at the governed metric; add
  approval-event assertions to capability 16.

### 1. Deterministic signed URLs, no expiry, no single-use

HMAC over `(userId, proxyKeyId, action, target)`. Drop `jti`, `exp`,
`mintApprovalToken`, `verifyApprovalToken`, `peekApprovalToken`, both TTL
constants, `approvalLinkMinutes`, and the `approval_consumptions` table. Keep the
live ownership check as the real authorization; keep the HMAC for A7. Collapse
`approvalLinkStatus` to two states and delete the expired / already-used cards.
Remove every "expires in N minutes" string from denial copy, the approve-page
footer, and `request_access`'s note. New `approval_requests` table (one row per
request). Schema change → `npm run db:branch` first, verify per Database Rule 8.

### 2. Finish the QA rewrite

Apply A9/A10 rewording, add A12/A13, extend capability 16, update
`qa-coverage-check.ts`. Lands with workstream 1.

### 3. Reproduce the Docs open failure

6 requests, 1 opened, 0 approved, no retrying — and one of the two stuck users
is a docs user. Preview deploy, real docs denial through an agent, inspect the
emitted text. No code change until it reproduces.

### Explicitly not doing

Retry-gates; a programme for the stuck cohort (2 users in 30 days); out-of-band
email delivery; TTL increases; approve-page redesign; **and now, any
revocation-replay protection**.

## The numbers (unchanged from v4/v5)

**104 requests, 1.45 links each, 66.3% opened, 57.7% approved** — time-burst
grouping, 14d, external users. The review's 31% counted links, not requests.
Discard every figure in v1–v3. ~23% of opens are agent-driven, so human reach is
below 66%; approvals are the trustworthy stage.

**Stuck cohort: 2 users**, stable across 14- and 30-day windows, out of 44
requesting access. Neither retried.

## Validation

- `npx tsc --noEmit`
- `npm run db:branch` → generate → verify `.sql` lands → `npm run db:migrate`
- Capability 14 (A12/A13 added), 15 (done), 16 (extended);
  `qa-coverage-check.ts` updated. `qa-results.json` is absent in this worktree,
  so the checker cannot run to completion here — it must pass in the QA
  environment before the PR is considered validated.
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.
