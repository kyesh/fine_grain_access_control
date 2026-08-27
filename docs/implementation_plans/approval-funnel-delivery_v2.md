# Approval funnel: the metric was broken, not the funnel — v2

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **plan for review — nothing implemented**
Supersedes: `approval-funnel-delivery_v1.md`

## What changed since v1

v1 was written without PostHog access (no personal API key). The connector became
available mid-session and the queries v1 listed as blocked have now been run.
**They overturn v1's central premise**, and v1's headline recommendation
(out-of-band email delivery) is withdrawn — both because Ken judged the UX
uncomfortable, and because the data says it was solving a problem that mostly
does not exist.

The measurement change is the whole story, so it comes first.

---

## Finding 1: the funnel converts at 68%, not 31%

The review counted **links**. The unit that matters is **requests** — one user
wanting one thing. Grouping minted links by `(person, action)` over 14d,
external users only:

| unit | count | reached a human | approved |
|---|---|---|---|
| links | 134 | 41% | 31% |
| **requests** | **57** | **75.4%** (43) | **68.4%** (39) |

Agents mint **2.35 links per real request**. The user opens one and ignores the
duplicates. "59% of approval links are never opened by a human" is largely an
artifact of counting retries as demand.

Three independent confirmations:

- **24 of 38 minting users open 100% of their links** (41 minted, 41 opened).
- Only **8 of 134 links (6%)** belong to users who never open anything. Nine
  heavy minters account for 85 links — 63% of all volume — and open 53%.
- **`sheets_expose` converts at 83.3% per request** (30 requests → 27 reached a
  human → 25 approved). The review called it the worst-converting action at
  30.7%; it is in fact the *best*-performing established action, and it looked
  bad only because it has the worst retry loop at **2.93 links per request**.

Per-action, request-level:

| action | requests | links | links/req | reached human | approved | conv |
|---|---|---|---|---|---|---|
| `sheets_expose` | 30 | 88 | 2.93 | 27 | 25 | **83.3%** |
| `sheets_write` | 14 | 26 | 1.86 | 12 | 11 | **78.6%** |
| `send_whitelist` | 3 | 7 | 2.33 | 2 | 2 | 66.7% |
| `send_all` | 3 | 4 | 1.33 | 0 | 0 | 0% |
| `docs_expose` | 3 | 4 | 1.33 | 1 | 0 | 0% |
| `docs_write` | 3 | 4 | 1.33 | 0 | 0 | 0% |

`send_all` reaching zero humans is expected, not a defect: `sendDenialWithLinks`
mints it as the *second* of two links per denial (v1 finding 8), and users open
the specific `send_whitelist` one instead.

**Of requests that reach a human, 90.7% approve** (39 of 43). The approve page
is not a problem. It is the strongest part of the system.

### What this retires

- **The delivery thesis.** The URL reaches people. Agents just ask three times.
- **Out-of-band email delivery** (v1's P1) — withdrawn.
- **Raising the TTL** — 83% per-request conversion on a 30-minute link.
- **Redesigning `/dashboard/approve`** — 91% of arrivals convert.

---

## Finding 2: the signed single-use JWT is not carrying its weight

Prompted by Ken's question — do we need to mint unique links at all, given the
user must be signed in to act?

**The authorization does not depend on the signature.** `approveMagicLink`
(`src/app/dashboard/actions.ts:1020-1030`) already does:

```ts
if (p.userId !== dbUser.id) return { ok: false, reason: "…different account." };

const key = await db.select().from(proxyKeys)
  .where(and(eq(proxyKeys.id, p.proxyKeyId),
             eq(proxyKeys.userId, dbUser.id),      // ← live ownership check
             isNull(proxyKeys.revokedAt)))
```

The proxy key is verified against the live database, scoped to the signed-in
Clerk user, and re-checked for revocation. A forged `proxyKeyId` belonging to
someone else fails **independently of the signature**. The remaining payload
fields (`action`, `recipient`, `spreadsheetId`, `documentId`) only ever describe
a grant on the user's *own* key over a resource *they* choose — which the
dashboard already lets them do directly. **There is no privilege-escalation path
the signature closes and the ownership check does not.**

Meanwhile the token's three properties each generate a measured failure:

| property | what it buys | what it costs |
|---|---|---|
| unique `jti` per mint | replay protection | **2.35 links per request** — the entire measurement distortion above |
| 15/30-min expiry | limits leak window for a link only its owner can use | "Link expired" dead end |
| single-use | replay protection (again) | "already used" dead end — the literal rage-clicked string (`actions.ts:1056`) |

### Proposal: a deterministic signed URL

Keep an HMAC **over the parameters only** — no `jti`, no `exp`:

```
/dashboard/approve?a=sheets_expose&k=<proxyKeyId>&r=<fileId>&s=<hmac>
```

Because the signature is a pure function of `(userId, proxyKeyId, action,
target)`, the **same request always produces the same URL**. That single change:

- **Makes duplicate minting impossible by construction.** A retry loop emits the
  identical URL. 134 links collapse to ~57 with no dedup table, no ledger, no
  gate — v1's P0/P2/P3 all become unnecessary.
- **Removes both dead ends.** No expiry card, no "already used" card.
- **Shortens the URL from ~400 chars to ~120**, which matters if agents mangle or
  truncate long opaque tokens.
- **Keeps forgery closed.** The HMAC still means only FGAC can author a valid
  approval URL, so the modest social-engineering vector (tricking a user into
  approving a crafted grant on their own key) stays shut. This is why the
  signature is kept rather than dropped entirely — it is free, stateless, and
  costs nothing once determinism replaces uniqueness.
- **Lets `approval_consumptions` be dropped**, along with `mintApprovalToken`,
  `verifyApprovalToken`, and `peekApprovalToken`.

Analytics: replace `link_id` with a deterministic `request_id` (the HMAC, or a
truncation of it). The minted → opened → approved join still works, and it now
joins on the unit that means something. **The funnel becomes honest without a
new dashboard.**

Open questions for review:

1. **Idempotent re-approval.** Without single-use, re-opening a URL after
   approval should render the existing "✓ Already approved" card
   (`approvalLinkStatus` → `already_granted` already does this by checking live
   grant state, not the consumption table — so this mostly already works).
2. **Revocation and re-grant.** A user revokes a rule, then re-clicks an old
   URL. Correct behaviour is to re-grant on explicit confirmation — arguably
   better than today's `used_inactive` dead end.
3. **Whether to keep any expiry at all.** Recommendation: no. The link is inert
   without the owner's Clerk session, and expiry only ever produced dead ends.

---

## Finding 3: Docs — no missing-link defect; failure is at open

**Corrected from an intermediate reading during this session.** An unfiltered
denial-code query suggested docs denials were failing to mint links. With
internal accounts filtered out, the gap closes completely: of the users who hit
`docs_not_exposed`, **every one had a docs approval link minted** (5 users, zero
missing). Code review agrees — all six docs call sites route through
`policyDenialWithLink` with `docsDenialAction`.

The real docs signal is at the open stage: **6 requests, 1 reached a human,
0 approved**, against 27-of-30 reaching a human for `sheets_expose`. And docs is
*not* being retried (1.33 links/request — agents mint once and stop), which is a
different failure shape from sheets.

Against an ~80% baseline, 0-of-6 is unlikely (P ≈ 6×10⁻⁵), but this is 5 users
over 5 days and the action shipped 2026-08-20. **This is an investigation, not a
fix**: reproduce a docs denial end-to-end in a preview deployment and look at
what the agent actually emits — whether the link is present, well-formed, and
survives into the agent's visible output.

## Finding 4: the stuck cohort is 6 users

Of 42 users who minted a link in 14d:

- **25** approved at least once
- **11** never approved but are making successful calls anyway
- **6** stuck — no approval, no successful call

Small enough to hand-triage rather than to design a product change around. Best
handled via the `support-triage` skill.

*Caveat:* the denial counts returned for the stuck group were implausibly low
(1 denial across all 6), which does not match the retry-loop behaviour described
in the review. Cohort *membership* looks sound; their call volume needs a second
query before anyone acts on it.

---

## Proposed work, in order

### 1. Deterministic signed approval URLs *(the change)*

Replaces v1's P0 + P2 + P3 + P4a with one simpler change. Fixes the duplicate
minting, both dead ends, and the measurement, at once.

- `approvalLinks.ts`: deterministic HMAC over `(userId, proxyKeyId, action,
  target)`; drop `jti`, `exp`, `mintApprovalToken`, `verifyApprovalToken`,
  `peekApprovalToken`.
- `approve/page.tsx` + `actions.ts`: verify params by HMAC, keep the existing
  live ownership check as the real authorization, drop the consumption insert.
- Analytics: `request_id` replaces `link_id` on minted/opened/approved.
- Drop the `approval_consumptions` table — schema change, so `npm run db:branch`
  first, and verify the migration per CLAUDE.md Database Rule 8.

**Metrics it should move:** links per request 2.35 → 1.00; "expired" and
"already used" approve-page renders → 0. It should *not* move request-level
conversion, which is already 68%; if it does, that is a bonus, not the thesis.

### 2. Reproduce the Docs open failure

Preview deploy, real docs denial through an agent, inspect the emitted text.
Decide on evidence. No code change until it reproduces.

### 3. Triage the 6 stuck users

`support-triage`. Re-run their denial counts first (see Finding 4 caveat).

### 4. Retire the link-count funnel

Whatever dashboard or insight reports 31% should be repointed at request-level
conversion, or removed. It is the reason four symptoms looked like one crisis.

## Validation

- `npx tsc --noEmit`
- `npm run db:branch` → generate → verify `.sql` lands → `npm run db:migrate`
- QA capability **approval links** suite — note that single-use and expiry
  assertions will need rewriting, since both properties are being deliberately
  removed. That suite is the main QA surface affected.
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.

## Queries behind this plan

All against production events, 14d, external users (internal `fgac.ai` and
owner accounts excluded), via the PostHog MCP:

1. Per-user mint/open buckets → the 24/9/5 split.
2. `(person, action)` grouping → 57 requests, 2.35 links/request, 75.4% / 68.4%.
3. Same, split by action → the per-action table.
4. `docs_not_exposed` denials vs docs mints per user → no missing-link defect.
5. Minters × approvals × successful calls → the 25/11/6 split.
