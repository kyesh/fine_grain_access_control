# Approval funnel: capability 14 assertions completed — v7

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **plan for review — QA specs updated, no code changed**
Supersedes: `approval-funnel-delivery_v6.md` (v6 → v5 → v4 → v3 → v2 → v1)

## What changed since v6

v6 flagged that retiring A4 left one live behaviour untested and recommended
folding it into A13. Ken asked for that to be applied. **It is applied — but as
its own assertion, not folded**, and the reason matters.

### Why not fold it into A13

A4 had to be deleted wholesale precisely *because* it bundled three unrelated
properties into one assertion: idempotent re-use, refuse-after-revoke, and
expiry. Two became obsolete, and the third — which is still correct behaviour —
went out with them. Folding the survivor into A13 (`no expiry`) would rebuild
the same trap: the next time expiry semantics change, an unrelated idempotency
check disappears with them.

**One assertion, one property.** That is the actual lesson from A4, and it is
worth more than the tidiness of a shorter list. My v6 recommendation was wrong
on this point; the correction is applied below.

## Applied in this revision

`docs/QA_Acceptance_Test/capabilities/14_magic_link_approvals.md` gains three
single-property assertions:

| # | Property | Note |
|---|---|---|
| **A12** | Repeating a denial re-emits a **byte-identical** URL | Carries the regression note: one request produced ~1.45 distinct URLs on average (worst observed 17), which is what made a ~58% funnel report as 31% |
| **A13** | Links **do not expire** | Also asserts no path renders an "expired" card and no copy promises a window |
| **A14** | Re-opening an approved link is **idempotent** | The property retained from A4. Explicitly notes that re-approval after *revocation* is deliberately permitted and intentionally unasserted |

A12 and A13 were already planned (v4 §5) and the rewritten preamble already
claims determinism and no-expiry, so leaving them unasserted would have left the
spec claiming behaviour nothing tested. They are applied alongside A14.

Capability 14 now runs **13 assertions**: A1–A3, A5–A14. Verified against the
`### A<n>:` parser used by `scripts/qa-coverage-check.ts`.

### Transitional marker added

Capability 14's preamble now carries a dated ⚠ paragraph. This matters
operationally: **A12 and A13 fail against current production by design**, since
the deterministic-URL change has not shipped. Without the marker, the next QA
run reports two false regressions.

The marker instructs runners to record A12/A13 as `skip` with
`reason: "pending deterministic-URL redesign"`. Note the results schema accepts
`pass | fail | skip` only, and `skip` requires a `reason` — an earlier draft of
this note said `blocked`, which would itself have failed the coverage check.
**The paragraph must be deleted in the same PR that ships workstream 1.**

### Still outstanding in capability 14

A9 (`non-empty token query parameter`) and A10 (`decode the JWT payload`) still
describe the outgoing link format. They are **correct for production today**, so
they are deliberately left alone until the new parameter names are settled in
workstream 1 — rewording them now would make the spec wrong in both directions
at once.

---

## Workstreams

### 0. Make the approval funnel legible — **ship first**

The root cause: the funnel had no data contract, so every consumer invented a
grouping (26% → 31% → 68% → 58%).

- **0a** Document the contract in `docs/analytics.md` — `approval_link_opened`,
  `link_id`, and `approval_link_id` are absent entirely and
  `approval_link_minted`'s property list is wrong. State the unit of analysis in
  one sentence.
- **0b** Deterministic `request_id` replaces `link_id`; add a **hashed**
  `target_hash` so different resources separate directly. Emit minted **once per
  attempt**.
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
live proxy-key ownership check as the real authorization; keep the HMAC for A7.

`approvalLinkStatus` collapses from five states to **two** (grant active →
`already_granted`, else `fresh`), so `used_inactive` and `expired` become
unreachable — the "Link expired" card, the "Link already used" card, and
`actions.ts:1056` are deleted outright. Both rage-click sources disappear as dead
code rather than reworded copy.

Remove every "expires in N minutes" string from denial copy, the approve-page
footer, and `request_access`'s note. New `approval_requests` table (one row per
request). Schema change → `npm run db:branch` first, verify per Database Rule 8.

**Must also do in this PR:** delete capability 14's transitional ⚠ paragraph, and
reword A9/A10 for the new parameters.

### 2. Finish the QA rewrite

Capability 16 gains approval-event assertions (it has 9, none covering them).
Capability 15 is done (A6 rewritten, TTL phrasing removed).

### 3. Reproduce the Docs open failure

6 requests, 1 opened, 0 approved, no retrying — and one of the two stuck users is
a docs user. Preview deploy, real docs denial through an agent, inspect the
emitted text. No code change until it reproduces.

### Explicitly not doing

Retry-gates; a programme for the stuck cohort (2 users in 30 days); out-of-band
email delivery; TTL increases; approve-page redesign; revocation-replay
protection.

## The numbers

**104 requests, 1.45 links each, 66.3% opened, 57.7% approved** — time-burst
grouping, 14d, external users. The review's 31% counted links, not requests.
Discard every figure in v1–v3. ~23% of opens are agent-driven, so human reach is
below 66%; approvals are the trustworthy stage.

**Stuck cohort: 2 users**, stable across 14- and 30-day windows, out of 44
requesting access. Neither retried.

## Validation

- `npx tsc --noEmit`
- `npm run db:branch` → generate → verify `.sql` lands → `npm run db:migrate`
- `npx tsx scripts/qa-coverage-check.ts` must pass in the QA environment — it
  cannot run to completion in this worktree (`qa-results.json` is absent, as no
  QA run has happened here).
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.
