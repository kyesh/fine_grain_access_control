# Approval funnel: fix the data contract, not just the links — v5

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **plan for review — nothing implemented**
Supersedes: `approval-funnel-delivery_v4.md` (v4 → v3 → v2 → v1)

## What changed since v4

Ken's read: the tracking and data model were bad, and misled us into thinking
performance was far worse than it was. **That is correct**, and v4 only fixed
half of it. v4 fixed the *grain* (deterministic `request_id`); it did nothing
about the *contract*, the *definition*, or the *routine* that produced the
misleading number. Without those, the next analysis re-derives the metric from
scratch and gets another different answer.

This revision adds that as workstream 0 — and it should ship first, because it
is cheap, and it is the only part that prevents recurrence.

---

## Finding 7: the funnel had no data contract at all

The reason three analyses produced three different numbers is not subtle. The
approval funnel was never specified anywhere.

**The event catalog (`docs/analytics.md`) is stale and incomplete:**

| symbol | mentions in `docs/analytics.md` |
|---|---|
| `approval_link_opened` | **0** — the middle stage of the funnel is undocumented |
| `link_id` | **0** — the join key the entire funnel depends on |
| `approval_link_id` (stamped on `$mcp_tool_call`) | **0** |
| `approval_link_minted` | 1 — but its "Key properties" column lists only `action`, omitting `link_id` and `via` |

All three were introduced together on 2026-08-19 (PR #74). The catalog was never
updated.

**Nothing else pins the definition down either:**

- **No saved insight** exists for the approval funnel. v4's instruction to
  "repoint whatever reports 31%" is unactionable — there is nothing to repoint.
  The number was computed ad hoc by the recurring analytics review, freshly, each
  time it ran.
- **PostHog's governed metrics catalog (`system.information_schema.metrics`) is
  empty.** No canonical measure is registered for this project at all.
- **QA capability 16 (analytics events) has 9 assertions, none covering approval
  events.** Nothing would have caught the drift.
- **`approval_link_minted` carries no target id**, which is why v2/v3 grouped by
  `(person, action)`, silently merged different spreadsheets into one "request,"
  and overstated conversion at 68%.

So every consumer invents a grouping. The 2026-08-19 review invented one (26%),
the 2026-08-25 review invented another (31%), and this investigation produced
68% and then 58% before settling. **The volatility is the symptom; the absent
contract is the disease.**

Answering Ken's question directly: **v4 as written does not make this clearer
going forward.** It makes the correct grouping *possible*. It does not make it
*canonical*, does not document it, and does not fix the routine that generated
the misleading figure. Workstream 0 below is what does.

---

## Workstream 0: make the approval funnel legible *(ship first)*

### 0a. Write the event contract down

Update `docs/analytics.md`'s event catalog with the full, current shape of all
three approval events plus the tool-call join key. Correct
`approval_link_minted`'s property list. Add a short paragraph defining **the
unit of analysis** in one sentence — *"an approval request is one
`request_id`; mint events per `request_id` are retries, not demand"* — so no
future reader has to infer it.

### 0b. Fix the grain at the source

- `request_id` (deterministic HMAC over `userId`, `proxyKeyId`, `action`,
  `target`) replaces `link_id` on minted / opened / approved.
- **Add `target_hash`** — a truncated SHA-256 of the file id or recipient — so
  requests for different resources are separable directly, and no future
  analysis needs the 30-minute time-burst heuristic v4 had to invent.
  **Hashed, not raw:** spreadsheet ids, document ids, and recipient addresses
  are customer data and should not sit in analytics in the clear.
- Emit minted **once per attempt**, so `uniq(request_id)` = demand and
  `count()` = retry pressure (v3 Finding 5).

### 0c. Stop "opened" conflating agents with people

`approval_link_opened` is captured server-side via `posthog-node` and carries no
user agent, so a Claude Desktop fetch is indistinguishable from a person opening
the page. Measured on client-side pageviews, **~23% of approve-page loads are
agent-driven** (v4 §1).

Stamp the event with an `agent_driven` flag derived from the request user agent
at capture time. Until then, "opened" overstates human reach and should not be
anyone's success metric.

### 0d. Persist exactly one definition

- **Create the saved insight** for the funnel: minted → opened → approved, keyed
  on `request_id`, internal accounts excluded. Today none exists.
- **Register a governed metric** (`approval_request_conversion`) in PostHog's
  catalog, which is currently empty. A registered metric is what makes future
  analyses *look it up* instead of re-deriving it — the actual anti-recurrence
  mechanism, and the direct answer to "easier to understand going forward."
- **Headline on approvals, not opens.** `approval_link_approved` is the only
  stage requiring a deliberate human act (a form submit on a page naming the
  grant). Opens are diagnostic; approvals are the metric.

### 0e. Close the loop on the routine and the tests

- **Point the recurring analytics review at the governed metric.** That daily
  routine produced the 31% figure. If its definitions are not fixed, this
  recurs next week no matter what the schema looks like.
- **Add approval-event assertions to QA capability 16**, which currently has
  none: the three events fire with `request_id` and `target_hash`, minted fires
  once per attempt, and `agent_driven` is populated on opens.

---

## The numbers, restated once (from v4)

Use these; discard every earlier figure in v1–v3.

| unit | requests | links/req | opened | approved |
|---|---|---|---|---|
| per link — the review's number | 151 | — | 41% | 31% |
| per `(person, action)` — over-merged, **discard** | 60 | 2.52 | 75% | 68% |
| **per time-burst — current best** | **104** | **1.45** | 66.3% | **57.7%** |

With the caveats that **~23% of opens are agent-driven** (so human reach is
lower than 66%), and that the burst grouping is a heuristic that **0b makes
unnecessary going forward**.

**Stuck cohort: 2 users**, stable across 14- and 30-day windows, out of 44 who
requested access. Neither retried. The approval flow is not dropping users at
scale — which is the substantive conclusion, and the one the old metric hid.

---

## Remaining workstreams (unchanged from v4)

### 1. Deterministic signed approval URLs, no expiry

Confirmed by Ken. HMAC over `(userId, proxyKeyId, action, target)`; drop `jti`,
`exp`, `mintApprovalToken`, `verifyApprovalToken`, `peekApprovalToken`, both TTL
constants and `approvalLinkMinutes`. Keep the live proxy-key ownership check as
the real authorization; keep the HMAC so tamper-rejection (capability 14 A7)
still holds. Remove every "expires in N minutes" string from denial copy, the
approve-page footer, and `request_access`'s note. New `approval_requests` table
(one row per request); drop `approval_consumptions`. Schema change →
`npm run db:branch` first, verify per Database Rule 8.

**Open decision (v4 §4):** a deterministic URL is permanent, so capability 14
A4's *"replaying an old link must not resurrect revoked permissions"* no longer
holds by construction. Recommended: the approve page detects a previously
revoked grant and shows *"You revoked this access on «date» — approve again?"*
rather than silently re-granting or reintroducing a dead end. **Still needs
Ken's call.**

### 2. QA rewrite

Full before/after for capability 14 is in v4 §5 and carries over unchanged:
A1–A3 and A5–A8 unchanged; A4 rewritten; A9/A10/A11 reworded; new **A12**
(repeated denials produce byte-identical URLs) and **A13** (no expiry).
Capability 15 reviewed; capability 16 extended per 0e.
`scripts/qa-coverage-check.ts` must learn the new assertions.

### 3. Reproduce the Docs open failure

6 requests, 1 opened, 0 approved, no retrying — and one of the two stuck users
is a docs user. Preview deploy, real docs denial through an agent, inspect the
emitted text. No code change until it reproduces.

### Explicitly not doing

- Retry-gates / stop-minting-after-N — dead on v3 Finding 5, reconfirmed by both
  stuck users having minted exactly once.
- A dedicated programme for the stuck cohort — 2 users in 30 days.
- Out-of-band email delivery, TTL increases, approve-page redesign.

## Validation

- `npx tsc --noEmit`
- `npm run db:branch` → generate → verify `.sql` lands → `npm run db:migrate`
- Capability 14 rewritten, 16 extended, 15 reviewed; `qa-coverage-check.ts`
  updated.
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.

## Evidence index

Production events via the PostHog MCP, 14d unless stated, internal accounts
excluded unless stated:

1. Per-user mint/open buckets → always/partial/never split.
2. Time-burst grouping (30-min gap) → 104 requests, 1.45 links, 66.3% opened,
   57.7% approved.
3. `$pageview` on `/dashboard/approve` by traffic type → 455 Regular (34 people)
   / 135 Claude Desktop (5 people).
4. Traffic-type control across client- and server-side events → the
   `Automation` label on `posthog-node` events is a capture artifact and proves
   nothing.
5. Minters × approvals × successful calls, 14d and 30d → 2 stuck users.
6. `docs_not_exposed` denials vs docs mints per user → no missing-link defect.
7. `system.information_schema.metrics` → **empty**; `system.insights` search →
   **no approval funnel insight exists**.
8. `docs/analytics.md` symbol audit → `approval_link_opened`, `link_id`, and
   `approval_link_id` undocumented.
