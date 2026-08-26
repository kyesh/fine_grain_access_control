# Approval funnel: consolidated plan of record — v8

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **QA specs partially applied; no code changed**
Supersedes: v7 → v6 → v5 → v4 → v3 → v2 → v1

## Why this revision

The QA changes designed in v4 §5 were applied across v6 and v7, but their status
was spread over three documents and no single revision showed what had actually
landed. **§1 below is the authoritative status table.** Nothing new is proposed
here; this is consolidation plus one correction.

---

## 1. QA spec status — authoritative

Verified against the working tree (`git diff origin/main`: 79 lines changed in
capability 14, 11 in capability 15).

### ✅ Applied and committed

| item | file | what changed |
|---|---|---|
| Preamble rewrite | cap 14 | Links are signed + **deterministic**, do **not** expire, are **not** single-use. Authorization is the Clerk session plus the live proxy-key ownership check; the HMAC prevents forgery rather than authorizes. Re-approval after revocation explicitly permitted |
| Transitional marker | cap 14 | Dated ⚠ paragraph — see §2 |
| **A4 deleted** | cap 14 | Requirement dropped per Ken. Was: idempotent-while-granted + refuse-after-revoke + expiry |
| A11 | cap 14 | Stray "the link is single-use" clause removed |
| **A12** *(new)* | cap 14 | Repeating a denial re-emits a **byte-identical** URL. Carries the regression note: one request produced ~1.45 distinct URLs on average (worst observed 17), which made a ~58% funnel report as 31% |
| **A13** *(new)* | cap 14 | Links **do not expire**; no path renders an expired card; no copy promises a window |
| **A14** *(new)* | cap 14 | Re-opening an approved link is **idempotent** — the property retained from A4. Notes that re-approval after *revocation* is deliberately permitted and intentionally unasserted |
| A6 rewrite | cap 15 | Referenced 14's A4 and would have been orphaned; now repeats A5 (wrong user) + A7 (tampering) |
| TTL phrasing | cap 15 | "30-minute TTL" removed from A4's docs-link expectation |

Capability 14 now runs **13 assertions**: A1–A3, A5–A14.

### ⏸ Deliberately deferred to the workstream-1 PR

| item | why deferred |
|---|---|
| **A9** reword — `non-empty token query parameter` → the new params (`a`, `k`, `r`, `s`) | Currently **correct for production**. Rewording before the parameter names are settled would make the spec wrong in both directions at once |
| **A10** simplify — `decode the JWT payload` → read `a=` directly | Same reason. The matrix and intent are unchanged either way |
| Delete cap 14's transitional ⚠ paragraph | Only true until the redesign ships |

### ⬜ Still pending

| item | status |
|---|---|
| **Capability 16** approval-event assertions | Not started — the file currently contains **zero** references to `approval_link*` across its 9 assertions |

### ✏️ Correction: `qa-coverage-check.ts` needs no edit

v4, v5, and v6 each said the coverage checker "must learn A12/A13" or "must be
updated." **That is wrong.** The script builds its inventory by reading the
capability markdown at runtime — `readdirSync(CAPS_DIR)` then
`line.match(/^###\s+(A\d+)\s*:/)` into a `Set`. Adding assertions to the docs is
sufficient, and the `Set` imposes no contiguity requirement, so the gap left at
A4 is harmless.

What *does* need to cover the new assertions is `qa-results.json`, which the QA
runners write — not the script.

---

## 2. Transitional marker (operational, time-boxed)

Capability 14's preamble carries a dated ⚠ paragraph because **A12 and A13 fail
against current production by design** — the deterministic-URL change has not
shipped. Without it, the next QA run reports two false regressions.

It instructs runners to record A12/A13 as `skip` with
`reason: "pending deterministic-URL redesign"`. The results schema accepts
`pass | fail | skip` only and `skip` requires a `reason` — an earlier draft of
that note said `blocked`, which would itself have failed the coverage check.

**Delete this paragraph in the same PR that ships workstream 1.**

---

## 3. Workstreams

### 0. Make the approval funnel legible — **ship first**

Root cause of the whole episode: the funnel had no data contract, so every
consumer invented a grouping (26% → 31% → 68% → 58%).

- **0a** Document the contract in `docs/analytics.md` — `approval_link_opened`,
  `link_id`, and `approval_link_id` are absent entirely, and
  `approval_link_minted`'s property list is wrong. State the unit of analysis in
  one sentence: *an approval request is one `request_id`; mint events per
  `request_id` are retries, not demand.*
- **0b** Deterministic `request_id` replaces `link_id`; add a **hashed**
  `target_hash` so different resources separate directly and no future analysis
  needs a time-burst heuristic. Emit minted **once per attempt**.
- **0c** Stamp opens with `agent_driven` — ~23% of approve-page loads are agent
  traffic, invisible today because server-side events carry no user agent.
- **0d** Create the saved insight (none exists) and register a governed metric
  (PostHog's catalog is empty). **Headline on approvals, not opens.**
- **0e** Point the recurring analytics review at the governed metric; add the
  capability 16 assertions from §1.

### 1. Deterministic signed URLs, no expiry, no single-use

HMAC over `(userId, proxyKeyId, action, target)`. Drop `jti`, `exp`,
`mintApprovalToken`, `verifyApprovalToken`, `peekApprovalToken`, both TTL
constants, `approvalLinkMinutes`, and the `approval_consumptions` table. Keep the
live proxy-key ownership check as the real authorization; keep the HMAC so
capability 14 A7 still holds.

`approvalLinkStatus` collapses from five states to **two** (grant active →
`already_granted`, else `fresh`), so `used_inactive` and `expired` become
unreachable — the "Link expired" card, the "Link already used" card, and
`actions.ts:1056` are deleted outright. **Both rage-click sources disappear as
dead code rather than reworded copy.**

Remove every "expires in N minutes" string from denial copy, the approve-page
footer, and `request_access`'s note. New `approval_requests` table (one row per
request). Schema change → `npm run db:branch` first, verify per Database Rule 8.

**Also required in this PR:** the three deferred items from §1 — reword A9 and
A10, and delete the transitional marker.

### 2. Reproduce the Docs open failure

6 requests, 1 opened, 0 approved, no retrying — and one of the two stuck users is
a docs user. Preview deploy, real docs denial through an agent, inspect the
emitted text. No code change until it reproduces.

### Explicitly not doing

Retry-gates; a dedicated programme for the stuck cohort (2 users in 30 days);
out-of-band email delivery; TTL increases; approve-page redesign;
revocation-replay protection.

---

## 4. The numbers

**104 requests, 1.45 links each, 66.3% opened, 57.7% approved** — time-burst
grouping, 14d, external users. The review's 31% counted links, not requests.
**Discard every figure in v1–v3.** ~23% of opens are agent-driven, so human reach
is below 66%; approvals are the only stage requiring a deliberate human act and
are the metric to trust.

**Stuck cohort: 2 users**, stable across 14- and 30-day windows, out of 44
requesting access. Neither retried. The approval flow is not dropping users at
scale — the conclusion the old metric hid.

## 5. Validation

- `npx tsc --noEmit`
- `npm run db:branch` → generate → verify `.sql` lands → `npm run db:migrate`
- `npx tsx scripts/qa-coverage-check.ts` must pass **in the QA environment** — it
  cannot run to completion in this worktree, since `qa-results.json` is absent
  (no QA run has happened here).
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.
