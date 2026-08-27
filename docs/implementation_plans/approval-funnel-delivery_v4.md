# Approval funnel: measurement corrections, the real stuck cohort, and the QA rewrite — v4

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **plan for review — nothing implemented**
Supersedes: `approval-funnel-delivery_v3.md` (v3 → v2 → v1)

## What changed since v3

Ken challenged two numbers and asked for the stuck-user investigation to be
completed before any other work. Both challenges were correct and both numbers
move. The stuck cohort is now investigated and is **smaller than any previous
estimate**.

1. **"Reached a human" was an overstatement.** ~23% of approve-page loads are
   an AI agent, not a person.
2. **"2.93 links per request" used a broken definition of "request."** The
   corrected figure is **1.45**.
3. **The stuck cohort is 2 users, not 6.** The earlier count was a filter
   artifact — the exact caveat flagged in v3, now resolved.
4. **Expiry removal is confirmed** by Ken, and carries one security consequence
   that needs an explicit decision (§4).

---

## 1. What "reached a human" actually means

**The honest answer: I cannot observe a human. I observe two things.**

- `approval_link_opened` — fires when the approve page server-component
  renders. It proves an authenticated session loaded the page (the route is
  behind Clerk `auth.protect()` in `src/middleware.ts`). It does **not** prove a
  person looked at it.
- `approval_link_approved` — fires only after a form submission (a Next server
  action POST) on a page displaying exactly what is being granted. **This is
  the one signal that requires a deliberate act.**

Testing the gap between them, `/dashboard/approve` pageviews over 14d
(client-side `$pageview`, which carries a real user agent):

| traffic | pageviews | people |
|---|---|---|
| Regular (ordinary browser) | 455 | 34 |
| AI Agent — Claude Desktop | 135 | 5 |

**So ~23% of approve-page loads are agent-driven, concentrated in 5 users.**
Ken's suspicion was right. Two consequences:

- Wherever earlier revisions said "reached a human," read **"the approve page
  was loaded in an authenticated session."** The human-attributable share is
  lower, and the agent share is concentrated rather than spread evenly, so it
  cannot be corrected by a flat multiplier.
- **`approval_link_approved` is the metric to trust.** It is the only one that
  requires a form submit on a page stating the grant.

A methodological note recorded so it is not repeated: server-side events
(`posthog-node`) are *all* classified `Automation` / `is_bot: true` by PostHog,
because they carry no browser user agent. That label says nothing about human
involvement. Confirmed by the control — client-side `$pageview` splits Regular
1404 / AI Agent 738, while every `posthog-node` event is uniformly `Automation`.
**Do not read the bot flag on server-side events as evidence of anything.**

## 2. What "links per request" means — and the corrected number

**Why one request can have several links.** Every denial mints a brand-new
signed JWT with a fresh `jti`, so a *new URL*. If an agent calls
`sheets_get_spreadsheet` on the same unexposed sheet three times, that is three
denials → three `approval_link_minted` events → **three different URLs that
grant the identical thing**. The user needs to open only one. That is the
duplicate this plan removes.

**Where v2/v3 went wrong.** `approval_link_minted` carries only `link_id`,
`action`, and `via` — **no target file id** (verified against the project's
event taxonomy). So grouping by `(person, action)` merged *different
spreadsheets* into one "request": a user wanting access to three separate sheets
counted as one request with three links. That inflated links-per-request and
deflated the request count.

**The corrected grouping** uses time bursts — consecutive mints for the same
`(person, action)` more than 30 minutes apart start a new request. Retries of
one ask cluster within seconds; separate asks are spread out.

| unit | requests | links/request | opened | approved |
|---|---|---|---|---|
| per link (the review's number) | 151 | — | 41% | 31% |
| per `(person, action)` — **over-merged, discard** | 60 | 2.52 | 75% | 68% |
| **per time-burst — use this** | **104** | **1.45** | **66.3%** | **57.7%** |

**The defensible headline: ~104 access requests, ~58% approved.** Not the
review's 31%, and not v2/v3's 68%. Of requests whose page was opened, 87%
approve (60 of 69).

The direction of v2's conclusion survives — the funnel is materially healthier
than 31%, and duplicate minting is real (1.45×) — but it is a smaller effect
than v2 and v3 claimed, and those numbers should not be quoted.

## 3. Finding 6: the stuck cohort is 2 users (investigation complete)

v3 reported 6 and flagged that their denial counts looked implausible. That
caveat was correct: the earlier query applied the internal-account email filter
in the same pass that computed each user's success count, so events where the
email property was unset were dropped and users with successful calls were
misclassified as stuck. Re-run without that flaw, and stable across both
windows:

| | 14d | 30d |
|---|---|---|
| users who minted a link | 43 | 44 |
| approved at least once | 29 | 30 |
| never approved, but making successful calls | 12 | 12 |
| **stuck (no approval, no successful call)** | **2** | **2** |

**The entire churn cohort attributable to the approval flow is 2 users**, and it
does not grow when the window doubles. Their profiles:

| | mints | opens | dashboard pageviews | denials | actions | last seen |
|---|---|---|---|---|---|---|
| user 1 | 1 | 0 | 7 | 0 | `sheets_expose` | 9 days ago |
| user 2 | 1 | 0 | 0 | 1 (`docs_not_exposed`) | `docs_expose` | 3 days ago |

Two things stand out:

- **Neither retried.** One mint each. This independently confirms v3's Finding
  5: stuck users ask once and stop. The loud retry loops all belong to users who
  converted.
- **They fail differently.** User 1 visited the dashboard seven times but never
  opened their approval link — the link did not reach them, or they did not
  recognise it. User 2 never visited the dashboard at all — the agent-only
  profile. One fix will not address both.

**This reframes the whole exercise.** The brief's premise was to "stop the
approval flow dropping users." Measured end-to-end, it is dropping **2 users in
30 days**, out of 44 who request access. That does not justify a large
engineering programme. It justifies the cleanup below — which is worth doing on
its own merits (correct metrics, two dead ends removed, less waste) — and
otherwise leaving the flow alone.

The 12 users who never approve yet make successful calls are **not** stuck; they
are working within their existing grants. They should not be counted as funnel
loss, and previous revisions came close to doing so.

## 4. Removing expiry — confirmed, with one consequence to decide

Ken has confirmed expiry is removed. The link is inert without the owner's Clerk
session, and expiry only ever produced dead ends.

**The consequence that must not be buried:** a deterministic URL is *permanent*.
Today, capability 14 A4 asserts that "replaying an old link must not resurrect
revoked permissions." With a permanent URL, replay after revocation becomes
possible — a stale link in a chat log could re-grant access the user had
deliberately removed, if they click Approve without reading.

Three options:

1. **Accept it.** Re-granting requires the owner's session plus an explicit
   click on a page naming the grant — the same bar as adding the rule in the
   dashboard.
2. **Warn on re-grant (recommended).** The approve page already knows the grant
   state via `approvalLinkStatus`. When a matching grant exists and was revoked,
   render an explicit warning — "You revoked this access on «date». Approve
   again?" — before the button. Preserves informed consent without a dead end.
3. **Keep a revocation tombstone** that permanently refuses the URL. Restores
   today's property but reintroduces a dead end and needs new state.

**Recommendation: option 2.** It is the only one that keeps A4's *intent*
(revocation is not silently undone) while removing the dead end. Ken's call.

## 5. QA flow changes — before and after

Capability 14 (`docs/QA_Acceptance_Test/capabilities/14_magic_link_approvals.md`)
is the main surface. Capability 15 (`request_access`) and 16 (analytics events)
need follow-on review.

### Header rewrite

The capability preamble currently reads: *"Links are signed, expire (15 min;
sheets links 30 min…), and require the owning user's session… Consumption is
idempotent, not single-use."*

It becomes: *"Links are signed, **deterministic, and do not expire** — the same
request always produces the same URL. Authorization is the owning user's Clerk
session plus a live proxy-key ownership check; the signature prevents forgery.
Re-opening an approved link is idempotent."*

### Assertion-by-assertion

| # | Before | After |
|---|---|---|
| A1 | Send denial returns two approval URLs | **Unchanged** |
| A2 | Approving grants exactly the denied recipient | **Unchanged** |
| A3 | Sheets denial pre-fills sheet, offers RO/RW | **Unchanged** |
| A4 | Used links idempotent while granted; refused once revoked; **expired link rejected** | **Rewritten.** Drop the expiry leg entirely. Keep idempotent re-use ("Already approved"). Replace the "used_inactive" leg with the §4 decision — recommended: re-opening after revocation renders an explicit re-grant **warning**, not a refusal and not a silent re-grant |
| A5 | Another user's session cannot approve | **Unchanged in intent, more load-bearing.** Now enforced solely by the live proxy-key ownership check rather than a signed `userId` claim. Must be tested, not assumed |
| A6 | Unauthenticated click requires owner sign-in | **Unchanged** |
| A7 | Tampered links rejected | **Unchanged — and this is why the HMAC is kept.** Tampering any of `a` / `k` / `r` must still fail |
| A8 | Read-block denials carry no link | **Unchanged** |
| A9 | URL is single-line, well-formed, non-empty **`token`** param | **Reworded.** Assert the new params (`a`, `k`, `r`, `s`) are present and well-formed. Keep the 2026-08-15 trailing-newline regression check verbatim |
| A10 | **Decode the JWT payload** to check the `action` claim matches the denied operation | **Simplified.** The action is now a plain query param — read `a=` directly. Same matrix, same intent, no base64 decode |
| A11 | Send-to-anyone grant works; **"the link is single-use"** | **Reworded.** Drop the single-use clause; the grant assertions stand |
| **A12** | — | **NEW: determinism.** Trigger the identical denial three times; assert all three URLs are **byte-identical**. This is the core new property and the one that fixes the funnel metric |
| **A13** | — | **NEW: no expiry.** A link minted well beyond the old 30-minute window still approves successfully |

### Capabilities 15 and 16

- **15 (`request_access`)** — any assertion reading the structured `approvalUrl`
  as a JWT needs the same treatment as A9/A10. Requires a read-through before
  implementation.
- **16 (analytics events)** — `link_id` becomes `request_id` on minted / opened
  / approved, and minted must be asserted to fire **once per attempt**, not once
  per unique link. This is what preserves retry visibility (v3 Finding 5).

`npx tsx scripts/qa-coverage-check.ts` parses the `### A<n>:` headings and is the
arbiter of completeness, so A12/A13 must be added there before the suite is
considered passing.

---

## 6. Proposed work, in order

### 1. Deterministic signed approval URLs, no expiry, per-attempt instrumentation

- `approvalLinks.ts`: deterministic HMAC over `(userId, proxyKeyId, action,
  target)`. Drop `jti`, `exp`, `mintApprovalToken`, `verifyApprovalToken`,
  `peekApprovalToken`, `APPROVAL_LINK_TTL_SECONDS`,
  `SHEETS_APPROVAL_LINK_TTL_SECONDS`, `approvalLinkMinutes`.
- `approve/page.tsx` + `actions.ts`: verify params by HMAC; keep the live
  ownership check as the real authorization; drop the consumption insert;
  implement the §4 re-grant warning.
- Copy: remove every "expires in N minutes" string from denial text, the
  approve page footer, and `request_access`'s `note`.
- Analytics: `request_id` replaces `link_id`, emitted **once per mint attempt**.
- New `approval_requests` table (one row per request: `request_id` PK,
  `user_id`, `action`, `target`, `first_minted_at`, `mint_count`, `opened_at`);
  drop `approval_consumptions`. Schema change → `npm run db:branch` first,
  verify the migration per CLAUDE.md Database Rule 8.
- QA: rewrite capability 14 per §5; review 15 and 16.

**Metrics it should move:** distinct URLs per request 1.45 → 1.00; "expired" and
"already used" approve-page renders → 0. It should **not** move request-level
conversion (~58%), and should **not** reduce mint *attempts* — that is agent
behaviour, now merely visible.

### 2. Reproduce the Docs open failure

6 requests, 1 opened, 0 approved, no retrying — and one of the 2 stuck users is
a docs user. Preview deploy, real docs denial through an agent, inspect the
emitted text. No code change until it reproduces.

### 3. Retire the link-count funnel

Repoint or remove whatever reports 31%. Report requests, and report **approvals**
rather than opens as the success metric (§1).

### Explicitly not doing

- **Retry-gates / stop-minting-after-N** — dead on v3 Finding 5 and reconfirmed
  here: both stuck users minted exactly once.
- **A dedicated programme for the stuck cohort** — it is 2 users in 30 days
  (§3). Worth a manual look, not a mechanism.
- Out-of-band email delivery, TTL increases, approve-page redesign.

## Validation

- `npx tsc --noEmit`
- `npm run db:branch` → generate → verify `.sql` lands → `npm run db:migrate`
- Capability 14 rewritten per §5, plus `qa-coverage-check.ts` updated for
  A12/A13; capabilities 15 and 16 reviewed.
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.

## Queries behind this plan

Production events, PostHog MCP, 14d unless stated, external users (internal
accounts excluded except where noted):

1. Per-user mint/open buckets → the always/partial/never split.
2. `(person, action)` grouping → **superseded by 6; do not quote**.
3. Per-action breakdown → **same caveat**.
4. `docs_not_exposed` denials vs docs mints per user → no missing-link defect.
5. Minters × approvals × successful calls, 14d and 30d, no filter-induced row
   loss → **2 stuck users**.
6. Time-burst grouping (30-min gap) → **104 requests, 1.45 links, 66.3% opened,
   57.7% approved**.
7. `$pageview` on `/dashboard/approve` by traffic type → **455 Regular / 135
   Claude Desktop**.
8. Traffic-type control across client- and server-side events → the
   `Automation` label is a capture artifact.
