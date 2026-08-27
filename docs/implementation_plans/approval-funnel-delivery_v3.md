# Approval funnel: deterministic links, and the retry signal is a red herring — v3

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **plan for review — nothing implemented**
Supersedes: `approval-funnel-delivery_v2.md` (which superseded v1)

## What changed since v2

Ken asked whether a deterministic approval URL would still capture users whose
agents re-request access repeatedly without ever surfacing it — or whether ten
attempts would collapse into one invisible request.

Answering it produced two changes:

1. **A correction to v2.** v2 claimed determinism makes v1's ledger and
   retry-gate "unnecessary." That is wrong. Determinism fixes the *denominator*
   and the *dead ends*; it does nothing to stop an agent calling repeatedly, and
   detecting or acting on that still requires state. The instrumentation
   requirement below is now explicit.
2. **The retry-gate is dead on evidence.** The population it would protect is
   empty, and it would fire on users who are already succeeding.

Everything else from v2 stands: the request-level reframe, the deterministic
signed URL, the docs investigation, the stuck-user triage.

---

## Finding 5: retry volume is not the stuck-user signature

Grouping minted links by `(person, action)` over 14d, external users only:

| mints on one request | requests | mint events | never opened |
|---|---|---|---|
| 5+ | 8 | 70 | **0** |
| 3–4 | 8 | 27 | 1 |
| 2 | 10 | 20 | 2 |
| 1 | 34 | 34 | **12** |

**Every request minted 5 or more times was eventually opened** — 8 for 8, with
the worst loop at **17 mints**. Meanwhile **12 of the 15 never-opened requests
were minted exactly once.**

Splitting the 15 never-opened requests by whether the user ever opens anything:

| | requests | mint events |
|---|---|---|
| users who never open any link | 8 | 9 |
| users who open links normally | 7 | 10 |

The genuinely stuck users generated 8 never-opened requests across **9 mint
events** — almost no retrying at all. Their agents ask once and stop. The other
7 belong to users who open links routinely and simply declined one particular
request, which is a user decision, not a failure.

**Conclusion: heavy retrying is what a session looks like while the human walks
over to click.** It is noisy and wasteful, but it is a *success* signature. A
gate that stops minting after N unopened attempts would fire on 16 requests that
all converted, and catch none of the 15 that did not.

The real stuck signature is quiet: **one ask, never opened, then silence.**
That is what any future intervention has to key on, and it is a much weaker
signal — absence of activity rather than excess of it. Candidate mechanisms (a
pending-requests surface on the dashboard, a never-activated nudge) are
deliberately left out of scope here; the cohort is 5 users and should be
understood by hand first (Finding 4 / workstream 3).

### Instrumentation requirement (the answer to the question)

Deterministic URLs must **not** collapse the attempt count. Emit one
`approval_link_minted` event **per mint attempt**, carrying the deterministic
`request_id`. Then:

- `uniq(request_id)` = **demand** — the honest funnel denominator
- `count()` per `request_id` = **retry pressure** — diagnostics

Both numbers survive, and the retry signal becomes *more* legible than today:
currently ten attempts carry ten distinct `link_id`s, so "ten unopened links" is
indistinguishable from "ten different things the user ignored." With a stable
id, "one request, ten attempts, zero opens" is unambiguous.

A small `approval_requests` table — `request_id` PK, `user_id`, `action`,
`target`, `first_minted_at`, `mint_count`, `opened_at` — makes that queryable in
SQL and would be the substrate for any later intervention. It is **one row per
request**, not per link, so it is far smaller than v1's ledger. Ship it for
diagnostics; do **not** wire an intervention onto it yet.

---

## Findings carried forward from v2

### Finding 1: the funnel converts at ~68%, not 31%

Counting **links**: 41% opened, 31% approved. Counting **requests**: **75%
reached a human, ~68% approved.** Agents mint ~2.5 links per real request.

Ratios are stable as data accumulates — two runs a few hours apart returned
57 requests / 134 links and 60 requests / 151 links, both at 75% reached.
The 14-day window is live and these loops are ongoing.

- 24 of 38 minting users open **100%** of their links.
- Only ~6% of links belong to users who never open anything.
- `sheets_expose` — called the worst action at 30.7% — converts at **83.3% per
  request**, and looked bad only because it has the worst retry loop
  (2.93 links/request).
- **Of requests that reach a human, ~91% approve.** The approve page is the
  strongest part of the system.

Retired: the delivery thesis; out-of-band email (also Ken's call on the UX);
raising the TTL; redesigning the approve page.

### Finding 2: the signed single-use JWT is not carrying its weight

`approveMagicLink` (`src/app/dashboard/actions.ts:1020-1030`) already verifies
the proxy key against the live database, scoped to the signed-in Clerk user, and
re-checks revocation. A forged `proxyKeyId` fails **independently of the
signature**. The remaining payload only ever describes a grant on the user's own
key over a resource they choose — which the dashboard permits directly. No
privilege-escalation path is closed by the signature that the ownership check
does not already close.

Each of the token's three properties generates a measured failure: the unique
`jti` produces the duplicate-minting distortion, the expiry produces the "Link
expired" dead end, and single-use produces the rage-clicked "already used"
string (`actions.ts:1056`).

**Proposal: keep an HMAC over the parameters only — no `jti`, no `exp`.**

```
/dashboard/approve?a=sheets_expose&k=<proxyKeyId>&r=<fileId>&s=<hmac>
```

A pure function of `(userId, proxyKeyId, action, target)`, so the same request
always yields the same URL. Duplicate *URLs* become impossible by construction,
both dead ends disappear, the URL shrinks from ~400 to ~120 characters, and
forgery stays closed — so nobody can craft an approval URL and socially-engineer
a click. Determinism is the useful property; uniqueness never was.

Note the scope correction from v2: this removes duplicate *links*, not duplicate
*calls*. The agent can still loop; we now simply observe it correctly.

### Finding 3: Docs — no missing-link defect

Every user who hit `docs_not_exposed` did get a docs link minted (internal
accounts excluded; zero missing). All six docs call sites route through
`policyDenialWithLink`. The docs signal sits at the open stage — 6 requests,
1 reached a human, 0 approved — with no retrying (1.33 links/request). Small n
(5 users, shipped 2026-08-20). **Investigation, not a fix.**

### Finding 4: the stuck cohort is 6 users

Of 42 users who minted in 14d: 25 approved at least once, 11 never approved but
make successful calls anyway, 6 stuck (no approval, no successful call).
*Caveat:* their denial counts returned implausibly low (1 across all six) —
re-query before acting.

---

## Proposed work, in order

### 1. Deterministic signed approval URLs + per-attempt instrumentation

- `approvalLinks.ts`: deterministic HMAC over `(userId, proxyKeyId, action,
  target)`; drop `jti`, `exp`, `mintApprovalToken`, `verifyApprovalToken`,
  `peekApprovalToken`.
- `approve/page.tsx` + `actions.ts`: verify params by HMAC; keep the existing
  live ownership check as the real authorization; drop the consumption insert.
- Analytics: `request_id` replaces `link_id`, emitted **once per mint attempt**.
- New `approval_requests` table (one row per request, `mint_count`,
  `opened_at`); drop `approval_consumptions`. Schema change → `npm run db:branch`
  first, verify the migration per CLAUDE.md Database Rule 8.

**Metrics it should move:** distinct links per request → 1.00; "expired" and
"already used" approve-page renders → 0. It should **not** move request-level
conversion, already ~68%. It should **not** reduce mint *attempts* — that is the
agent's behaviour, now merely visible.

### 2. Reproduce the Docs open failure

Preview deploy, real docs denial through an agent, inspect the emitted text.
No code change until it reproduces.

### 3. Triage the 6 stuck users

`support-triage`. Re-run their denial counts first. This cohort — not the retry
loops — is where the churn is, and it should be understood by hand before any
mechanism is designed for it.

### 4. Retire the link-count funnel

Repoint or remove whatever reports 31%. It is why four symptoms read as one
crisis.

### Explicitly not doing

- **Retry-gate / stop-minting-after-N** (v1 P3, softened in v2). Dead on
  Finding 5: it would fire on 16 requests that all converted and catch none of
  the 15 that failed.
- Out-of-band email delivery, TTL increases, approve-page redesign.

## Validation

- `npx tsc --noEmit`
- `npm run db:branch` → generate → verify `.sql` lands → `npm run db:migrate`
- QA capability **approval links** suite — **its single-use and expiry
  assertions must be rewritten**, since both properties are being deliberately
  removed. This is the main QA surface affected and should be agreed before
  implementation starts.
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.

## Queries behind this plan

Production events, 14d, external users (internal accounts excluded), PostHog MCP:

1. Per-user mint/open buckets → the 24/9/5 split.
2. `(person, action)` grouping → request-level conversion.
3. Same, split by action → per-action table.
4. `docs_not_exposed` denials vs docs mints per user → no missing-link defect.
5. Minters × approvals × successful calls → the 25/11/6 split.
6. Requests bucketed by mint count × opened → **Finding 5**.
7. Never-opened requests split by whether the user ever opens → **Finding 5**.
