# Approval funnel: fix delivery, not the page — v1

Branch: `claude/approval-funnel-delivery` (off `main` @ b2b2a68)
Status: **plan for review — nothing implemented**

## Summary

The four friction points in the 2026-08-25 review are one failure: **approval
links are not reaching humans.** The measured funnel is

> 80 minted → 33 opened (41%) → 25 approved (76% of opened) — 10d, production,
> external users, DISTINCT `link_id`.

Everything below is organised around the finding that the 59% mint→open loss is
real, is not an artifact, and is not fixable by asking agents to behave — that
was already tried on 2026-08-19 and did not move the number.

Two of the five candidate directions in the brief are rejected on evidence, one
is not implementable as stated, and the highest-leverage change turns out to be
buildable with infrastructure the app already has.

---

## What the investigation established

### 1. The 41% open rate is trustworthy. The mint→open loss is the real problem.

The brief flagged ~5.6 `approval_link_opened` events per distinct `link_id` and
asked whether the open rate could be trusted before anything else was concluded.
It can:

- **`link_id` is never missing.** `approve/page.tsx:105` sets it from
  `verified.payload.jti`, falling back to `peekApprovalToken(token)` — an
  unsigned decode that exists precisely so expired and invalid links still
  carry their jti. Every open event that has a decodable token has a `link_id`.
- **It is not prefetching or bots.** `src/middleware.ts` matches
  `/dashboard(.*)` and calls `auth.protect()`. An unauthenticated fetch is
  redirected to sign-in and the page component never runs, so no event fires.
  Every `approval_link_opened` comes from a signed-in session.
- **The inflation is re-renders of real visits**, and the page has several:
  the sign-in round-trip on a cold browser, the `?notice=` retryable-failure
  redirect back to the live token page (`page.tsx:181`), back/forward
  navigation, and a user re-clicking the same link in their history.

Because the metric counts DISTINCT `link_id`, re-renders do not inflate it.
**41% stands** — if anything it is generous, since one human clicking twice
still counts as one opened link while the 80 minted includes links no human
ever saw. The loss is delivery.

### 2. Agent cooperation was already tried, and it is falsified.

`AGENT_APPROVAL_PROTOCOL` (`route.ts:417`) was introduced in **10475bc,
2026-08-19**, merged as PR #74. Reading
`docs/implementation_plans/approval-funnel-nudges_v1.md`, it was written against
the *identical* diagnosis — "the dominant failure is links that are never
opened… an agent-relay failure" — and its fix was to make the agent's job
explicit in the denial copy.

The before/after the brief asks for **cannot be run**, and does not need to be:

- The funnel instrumentation (`approval_link_opened`, `link_id` on
  `approval_link_minted`) shipped **in the same commit as the protocol text**.
  There is no `approval_link_opened` data before 2026-08-19, so there is no
  pre-protocol open rate to compare against. This is a structural gap, not a
  query I have not written.
- What *is* comparable is end-to-end conversion across the two reviews:
  **26%** (92 minted → 24 approved, 7d, 8/19 review) → **31%** (80 → 25, 10d,
  8/25 review). Roughly five points, on overlapping windows, at n≈80.
- Decisively: **41% open is the with-protocol number.** The instruction to show
  the link verbatim and not retry has been live for the entire measured window,
  and three of five links still never reach a human.

**Conclusion: no further change may depend on the agent relaying anything.**
That constraint drives the whole plan.

### 3. TTL is not what is blocking the dominant action.

The brief cites `APPROVAL_LINK_TTL_SECONDS = 15 * 60`. That constant is real but
it does not apply to the action in question. `approvalLinks.ts:27` defines
`SHEETS_APPROVAL_LINK_TTL_SECONDS = 30 * 60`, and `isFileGrantAction()` routes
**every `sheets*` and `docs*` action** to it. So:

| action | actual TTL | minted | conv |
|---|---|---|---|
| `sheets_expose` | **30 min** | 88 | 30.7% |
| `sheets_write` | **30 min** | 26 | 42.3% |
| `docs_*` | **30 min** | 5 | 0% |
| `send_whitelist` / `send_all` | 15 min | 11 | 36% |

The worst-converting action already has double the TTL and 119 of 130 minted
links are already on the 30-minute path. A link that is never shown to a human
does not die of expiry — it is never seen at all. Raising the TTL further
targets a stage that is not where the loss is.

### 4. The approve page is already largely self-healing.

The brief asks whether a spent or expired token is a dead end. Mostly it is not
— **8a6ea70, 2026-08-19** ("used links are idempotent while granted") landed
before the rage-click window closed:

- `approvalLinkStatus()` resolves `fresh | already_granted | used_inactive |
  expired | invalid` **at page load**, so a used link renders its true state
  instead of erroring on submit.
- `already_granted` renders a **success** card ("✓ Already approved"), not an
  error. This is the common re-click case and it is already handled well.
- Retryable failures redirect back to the **live token page** with an inline
  notice, token intact (`page.tsx:181`).
- Even terminal failures carry the token so the error card offers "Try again".

One branch is still a dead end: **`used_inactive`** — link consumed *and* the
grant is no longer active. `actions.ts:1056` is the source of the exact string
in the rage-click evidence, and its only advice is "ask the agent to request
access again", which routes the user back through the channel that already
failed them. Real, but narrow, and it sits at the stage that already converts
at 76%. Cheap to fix; not the funnel fix.

### 5. Docs 0-for-5 is not a defect. It is five samples.

I found no broken or missing code path. The per-file machinery is
kind-agnostic through `DRIVE_FILE_KINDS` (`src/lib/driveFileKinds.ts`), and
every docs leg exists and is wired: `'doc'` is in `ACTIVE_DRIVE_FILE_KINDS`,
`docsApprovalAction()` mints `docs_expose`/`docs_write`, `page.tsx` branches to
`FileApprovalFlow` on `isDocs`, `/api/rules/verify-docs-access` and
`/dashboard/docs-setup` exist, and the Picker uses the `DOCUMENTS` view via the
descriptor.

Docs shipped 2026-08-20 (PRs #76/#77), so this is 5 links from 3 minters over
5 days. Against the 31% baseline, **P(0 of 5) ≈ 16%** — an unremarkable draw.
Shipping a fix for a 5-sample null would be guessing. Instrument it (P0/P2
below give a per-action open rate) and re-measure once n is meaningful.

### 6. The spreadsheet title cannot be resolved at denial time.

Candidate direction 5 is **not implementable as written**, for an architectural
reason worth stating plainly: `src/lib/driveFileGrantCheck.ts:6` —
*"The app never requests a Sheets/Docs OAuth scope — API access rides on
per-file `drive.file` grants, which Google registers ONLY [when the user picks
the file]."*

For a file that is `not_exposed`, FGAC has **no Google access to it at all**, so
it cannot read `properties.title`. There is no server-side call that turns an
unexposed spreadsheet id into a name.

The plumbing for the name already exists and is used wherever it *can* be:
`ApprovalPayload.resourceName` is carried in the JWT, `describeApproval()`
prefers it over the raw id, and `FileApprovalFlow` resolves and displays the
real title once a grant exists. The gap is only the pre-grant denial text, and
it can be closed only by the *caller* supplying the name (P4).

### 7. Out-of-band delivery is cheap — the capability is already there.

There is no transactional email provider in `package.json` (no Resend,
SendGrid, Postmark, nodemailer). But FGAC does not need one:

- Every user's Google connection carries `gmail.modify`
  (`src/app/dashboard/googleAccess.ts:3`), and `gmail.modify` authorizes
  `users.messages.send`.
- The app already performs `messages/send` against Google
  (`api/proxy/[...path]/route.ts:508`).

So FGAC can put an approval link **in the account owner's own inbox, sent from
their own mailbox to themselves**, with no new vendor, no new secret, no new
OAuth scope, and no new consent screen. This is the one delivery channel that
does not depend on the agent's output reaching a human, and it is buildable
today.

### 8. Send denials double-mint (accounting note).

`sendDenialWithLinks()` mints **two** links per denial — `send_whitelist` and
`send_all` — and emits a `approval_link_minted` for each, but a human can only
ever open one. Send-action minted counts are inflated ~2×, and their true
per-denial conversion is roughly double the table's 36%. Send is not where the
problem is. (Also noted as a break in `approval-funnel-nudges_v1.md`.)

---

## The plan

Four changes, each tied to the stage it fixes and the number it should move.
Ordered by leverage.

### P0 / P2 (same table) — Mint ledger: instrument the loss

**Stage: measurement.** New table `approval_link_mints`:

| column | notes |
|---|---|
| `jti` | PK, matches `approval_consumptions.jti` and the analytics `link_id` |
| `user_id` | FK users, cascade |
| `proxy_key_id` | scope of the grant |
| `action` | `sheets_expose` … |
| `target_id` | spreadsheet/document id or recipient, nullable |
| `minted_at` | default now |
| `opened_at` | nullable — set by the approve page |

Written at all four mint sites (`route.ts:399`, `:441`, `:445`, `:1663`);
`opened_at` stamped in `approve/page.tsx` beside the existing
`approval_link_opened` capture.

**Why this is first:** it makes three of the brief's five questions answerable
in SQL, permanently, without PostHog — the unopened-vs-expired split
(investigation item 2), per-action open rates including docs (item 3), and the
blocked-cohort size (item 5). All three are currently unanswerable in this
session (see *Blocked* below). It is also the precondition for P1's dedup and
P3's gate.

Schema change → `npm run db:branch` before `drizzle-kit generate`, and verify
the migration file per CLAUDE.md Database Rule 8.

### P1 — Email the link to the account owner *(the funnel fix)*

**Stage: mint → open. Target: 41% → 65%+.**

At mint time, send the approval link to the owning user's own mailbox using the
Google token FGAC already holds (finding 7). New `src/lib/approvalNotify.ts`,
called fire-and-forget after each mint so a mail failure never turns a denial
into an error.

This is the only proposed change that removes the agent from the delivery path
entirely, which finding 2 says is required.

Design constraints:

- **Strictly self-addressed.** Owner → owner, address taken from the FGAC user
  record, never from tool input. A separate code path from `gmail_send` so no
  agent-reachable route can ever invoke it and it can never target a third
  party. It is FGAC's own notification, so the send whitelist does not apply —
  which is exactly why it must be unreachable from the agent surface.
- **Rate-limited via the P0 ledger**: at most one mail per
  (user, action, target) per TTL window, so a retry loop cannot mailbomb
  anyone. This is why P0 ships first.
- **Opt-out**, honoured per user.
- Content states what is being granted, who is asking, the expiry, and that
  nothing has been granted yet. Phishing-resistant plain copy — this is a link
  that grants access, so it must not read like the mail it is trying not to
  resemble.
- New event `approval_link_emailed` (with `link_id`) so the email leg gets its
  own funnel stage.

### P3 — Stop the retry loop at the source

**Stage: mint (waste elimination). Target: near-zero unopened re-mints.**

Using the P0 ledger, `policyDenialWithLink()` checks for prior links on the same
(user, action, target) in the trailing 24h. At **≥3 consecutive unopened**, stop
minting and return a denial that says so — the user has not opened the last N
links, stop retrying, ask them directly.

The brief is right that this is the fix that does not depend on the agent
relaying anything: it does not ask the agent to cooperate, it removes the
agent's ability to keep spending. This directly addresses the observed pattern
in the blocked cohort — one user minting six links over nine days with zero
opens and zero successful calls, another minting twenty with zero approvals —
where the retry cadence (two calls 1.2s apart) is a loop, not a person.

Pairs with P1: the gate is what makes it safe to stop, because the human has
already been mailed.

### P4 — Cheap correctness at the approve stage

**Stage: open → approve (already 76%). Small, bounded.**

a. **Self-heal `used_inactive`.** Instead of the dead-end copy at
   `actions.ts:1056`, mint a fresh token in place and render the normal approve
   card with an explanatory notice. Everything needed is present — the user is
   signed in, and the payload is valid and correctly scoped. Removes the last
   un-healed branch (finding 4).

b. **Carry `resourceName` when it is knowable.** Add an optional
   `resourceName` to `request_access` input and thread it through
   `sheetsApprovalAction`/`docsApprovalAction` into the payload, which already
   supports it. Best-effort by nature (finding 6): when the agent knows the
   title the human sees a name instead of an id. Additionally, in the
   `read_only` denial case a grant *does* exist, so `verifyUrl` can resolve the
   real title server-side — do it there.

c. **Send TTL 15 → 30 min**, for consistency with the file actions. Trivial and
   harmless; **claim no funnel movement from it** (finding 3).

### Rejected

- **Raise the TTL substantially as the primary fix.** The dominant action
  already has 30 minutes and converts worst; 119 of 130 links are already on
  that path. Wrong stage. (Kept only as P4c, a consistency tidy.)
- **Redesign `/dashboard/approve`.** It converts at 76% and is already
  self-healing in every branch but one. Redesigning it would spend effort where
  the funnel is working, exactly as the brief warns.

---

## Validation

- `npx tsc --noEmit`
- `npm run db:branch` → `drizzle-kit generate` → verify the `.sql` file lands in
  `src/db/migrations/` and `npm run db:migrate` succeeds on the dev branch
  (Database Rule 8).
- QA capability **approval links** suite; the file-approval and send-denial
  flows via the browser agent.
- P1 needs an end-to-end check that the mail actually arrives, using the two QA
  accounts — and an explicit negative test that no agent-reachable path can
  invoke the notifier.
- `/deploy-pr-preview` before handing back. No merge to main, no production
  deploy.

## Post-ship measurement

Ship P0 first and let it accumulate. The numbers that decide whether this
worked:

1. **Open rate 41% → 65%+** (P1). The primary metric.
2. **Unopened re-mints per (user, action) → ~0** at 3 (P3).
3. **Docs open rate**, once n is meaningful — settles finding 5 with data
   instead of a binomial argument.
4. **Blocked cohort shrinks**: users with ≥1 mint, zero approvals, and no
   successful call ever.

## Blocked: production verification

**PostHog is unavailable in this session.** Diagnosed rather than assumed:

- The claude.ai connector is absent — searched the documented keyword
  (`ToolSearch "posthog exec"`) and the UUID-prefixed form; neither resolves.
- `POSTHOG_PERSONAL_API_KEY` is unset in the shell env, so the `.mcp.json`
  `posthog` server cannot authenticate.
- There is no `.env.local` in this worktree, so `scripts/qa-posthog-events.ts`
  has no key either.

This matches the known state: the `phx_` personal API key is unprovisioned, and
creating one is a user action in the PostHog UI.

Consequently these were **not** run, and the plan does not claim them:

- Open rate before vs after the 8/19 protocol deploy — also structurally
  impossible (finding 2); the 26%→31% comparison across reviews is used instead.
- The unopened-vs-expired split (item 2) — **P0 makes this answerable in SQL.**
- Blocked-cohort sizing (item 5) — **P0 makes this answerable in SQL.**

If the key is provisioned before implementation starts, the two queries worth
running first are: `approval_link_minted` vs `approval_link_opened` by
`link_id`, split at 2026-08-19, to size what the protocol did; and per-action
open rate for `docs_*` to confirm or kill finding 5.
