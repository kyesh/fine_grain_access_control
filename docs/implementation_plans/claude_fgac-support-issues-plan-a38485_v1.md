# Support-issue remediation plan — 2026-08-30 batch

Source: three support emails from the QA/test account (test.fgac.ai@gmail.com →
support@fgac.ai, all 2026-08-30), covering 7 distinct issues. Codebase findings
below were verified by exploration of this worktree on 2026-08-30.

| # | Issue | Severity | Proposed batch |
|---|---|---|---|
| 1 | Reconnect completes but grants no `drive.file`; nothing surfaces the gap | HIGH (bug) | PR 1 |
| 2 | `deleteContentRange` over a table silently partial-deletes | MEDIUM (bug) | PR 4 |
| 3 | Named style bleeds onto every paragraph after delete/re-insert | MEDIUM (bug) | PR 4 |
| 4 | `comments_add` cannot anchor to a text range | LOW (feature) | roadmap note |
| 5 | Approval links not bound to the signed-in FGAC user (no mismatch message) | HIGH (UX regression) | PR 2 |
| 6 | Agent profiles should live at their own routes | MEDIUM (feature) | PR 5 |
| 7 | Drive file renames don't propagate to the rule list | MEDIUM (feature) | PR 3 |

Recommended order: **Clerk-config check → PR 3 (tiny) → PR 1 → PR 2 → PR 4 → PR 5**.
PR 3 is nearly free; PRs 1–2 are the two issues that strand real users.

---

## Issue 1 — Reconnect grants no `drive.file` (HIGH)

**Report:** silly.demo.fgac.ai@gmail.com completed the `?reconnect=1` consent flow
repeatedly; every Docs/Drive call still returned the "connected WITHOUT the Google
Drive file permission" denial (`src/app/api/mcp/route.ts:1307-1323`); `list_accounts`
showed the account as connected throughout; disabling the connector "kept re-attaching".

**Root causes found (several compounding):**

1. **Likely primary, outside the repo:** `additionalScopes` on Clerk's `reauthorize`
   only reaches Google if the scope is permitted on the Clerk SSO connection.
   `drive.file` appears nowhere in repo Clerk config (`src/app/layout.tsx:87-88` lists
   `gmail.modify` only). If the **production Clerk instance's Google connection**
   doesn't include `drive.file`, repeating consent can never fix it — exactly the
   reported behavior. → **Action 0 (user): verify in the Clerk dashboard** before any
   code ships; nothing in the repo can prove this either way.
2. Dashboard scope check is Gmail-only: `googleAccess.ts:3` (`REQUIRED_SCOPE =
   gmail.modify`), so `accounts/page.tsx:90-97` renders **both** badges from one
   boolean — a Drive-blind account shows a green `drive.file` badge.
3. `ReconnectGoogleButton.tsx:84-86` renders "✓ Google reconnected." **unconditionally**
   on `?reconnected=1` — the "completes successfully" the reporter saw.
4. `googleReconnect.ts:52-61` destroy+recreate branch passes **neither
   `additionalScopes` nor a consent prompt** (the verified→`reauthorize` branch at
   `:45-51` does force `oidcPrompt:'consent'`).
5. `ConnectGoogleWarning.tsx:17-32` duplicates the reconnect leg with `gmail.modify`
   only — drops `drive.file`.
6. MCP `list_accounts` (`route.ts:1622-1658`) returns bare email strings from
   `key_email_access` — pure DB, zero scope info. Yet `getGoogleToken` (`:360-447`)
   already returns `{ hasGmailScope, hasDriveFileScope }`.
7. "Kept re-attaching" is a **separate mechanism, not a grant bug**: block rows are
   keyed `(userId, clientId)` (`src/app/api/connections/route.ts:149-175`), but Claude
   re-adds via DCR with a *new* `client_id`, so the block never matches and
   `route.ts:140-165` auto-approves a fresh row into the Default Profile. Track as its
   own backlog item (e.g. block-by-`client_name`, or a "recently blocked a client with
   this name" warning) — do not bundle into PR 1.

**PR 1 scope:**

- `googleAccess.ts`: return per-scope `{ gmail, driveFile }` from the tokeninfo scope
  string it already parses (`:43-44`).
- `accounts/page.tsx:90-97`: badge each scope independently.
- `ReconnectGoogleButton.tsx`: on `?reconnected=1`, re-check scopes before declaring
  success; render a failure state naming the missing scope. Must tolerate Clerk's
  propagation lag — copy the 4×1500 ms poll from `useGooglePicker.ts:115-120` or it
  false-alarms on successful reconnects.
- `googleReconnect.ts:52-61`: pass the requested scopes on `createExternalAccount`
  (check Clerk SDK for an `oidcPrompt` equivalent on that call).
- `ConnectGoogleWarning.tsx`: call the shared `startGoogleReconnect` with
  `[gmail.modify, drive.file]` instead of its inline Gmail-only copy.
- `route.ts:1622-1658` `list_accounts`: emit per-account objects
  `{ email, gmail, drive }` with **three-state** values (`granted`/`missing`/`unknown`
  — never coerce `hasDriveFileScope === undefined` to missing; `:1308` already honors
  that convention). Gotchas: `Promise.allSettled` with a short per-account budget (the
  15 s `CLERK_TOKEN_TIMEOUT_MS` is unacceptable ×N on the first tool most agents
  call); add a `via` discriminator to the `google_token_*` PostHog events fired inside
  `getGoogleToken` (`:396-399`, `:439-443`) or the §7.6 monitoring queries in
  `docs/monitoring.md` get corrupted; make `next_steps.sheets/docs` point at
  `?reconnect=1` when drive is missing. Note this changes the `accounts` array shape —
  keep `accounts` as strings and add a parallel `account_details` field if we want to
  avoid breaking existing agents' expectations (decide during implementation; the tool
  description must match either way).

**Verify:** QA capability 18 (`google_reconnect`) A4/A5 already assert the token bridge
and no-loop; add assertions for the independent badges and the honest post-reconnect
failure state. `list_accounts` change needs a new assertion in the relevant capability
doc + the four agent runbooks (`scripts/qa-coverage-check.ts` will enforce once the
`### A<n>:` heading exists).

---

## Issue 5 — Approval links not bound to the signed-in user (HIGH UX)

**Report:** grant link opened while signed in to a different FGAC account than it was
issued for; nothing flagged the mismatch.

**Findings:** This is a **regression of intentional behavior** — the pre-2026-08-25 JWT
links carried `userId` and had an explicit "different account" branch
(`docs/implementation_plans/approval-funnel-delivery_v2.md:81`). The deterministic HMAC
redesign (`src/lib/approvalLinks.ts:148-171`) folds `userId` into the signature and out
of the URL, so a wrong-account open is indistinguishable from a forged link: both fall
into the generic "Invalid link" card (`approve/page.tsx:156-168`). No security hole —
`approveMagicLink` re-scopes to the signed-in user (`actions.ts:1086-1091`) — purely
diagnostic. These opens are also invisible in analytics (`status:"invalid"`,
`request_id: undefined` at `approve/page.tsx:146-151`).

**Key insight:** `k` (proxyKeyId) is in the URL in cleartext and resolves the owner:
`proxy_keys.id → userId → users.email`. Safety gate: **resolve the owner from `k`,
re-verify the HMAC against the resolved owner's id, and only on a match** show the
wrong-account card (proves FGAC authored the link; tampered links still fall through to
the generic card, preserving QA A7). Mask the email (no `maskEmail` helper exists yet —
write one).

**PR 2 scope:**

- `actions.ts:884-898` `resolveApprovalLink`: split `invalid` into `invalid` /
  `wrong_account` (carrying `{ maskedOwnerEmail, keyLabel, action }`) / and a distinct
  status for "Clerk user with no FGAC row" (`:891-892`).
- Same branch in `approveMagicLink` (`actions.ts:1077-1083`) for stale form POSTs.
- `approve/page.tsx`: new warning-toned card before the invalid card at `:156` —
  "This link was issued for **k••••h@gmail.com** (profile "Default Profile"), but
  you're signed in as **X**. Sign out and sign back in…" with a sign-out control that
  round-trips back to the same approve URL (`linkQuery()` at `:65-72` already rebuilds
  it).
- Analytics: emit `status:"wrong_account"` + the real `request_id` (recomputable once
  the owner is resolved) so recovery becomes measurable.
- Tests: extend `scripts/test-approval-links.ts` (wrong-signed-in-user case) and QA
  capability 14 A5 (rejection copy now names the masked issued-for account; still no
  rule created on either side).

Model the copy on the existing Google-account mismatch warning
(`accounts/page.tsx:101-114`).

---

## Issues 2+3 — Silent partial delete & style bleed → `docs_replace_body` (MEDIUM)

**Findings:** `docs_edit` (`route.ts:2104-2128`) is a pure passthrough — the `requests`
array is never inspected, no read-back exists anywhere in the tool layer. Google's
partial-apply-with-200 on cross-table-boundary deletes is reported verbatim as success.
Style bleed is inherent Docs API behavior (insertText inherits the landing paragraph's
named style). The reporter's suggested composite tool is the right shape; the
self-healing `gmail_get_attachment` (`route.ts:1725-1878`) is the in-repo precedent.

**PR 4 scope (in dependency order):**

1. `src/app/api/mcp/toolDefs.ts` (~line 114): new `docs_replace_body` entry,
   `readOnly:false, destructive:true`, <1500 chars, names `docs_edit` as fallback.
   Description must say plainly that documents containing tables get **segmented**
   delete handling — the tool cannot bypass Google's restriction, it works around it
   and verifies.
2. `scripts/mcp-tool-lint.ts:26-35`: add `docs_replace_body: 'docs_edit'` to
   `REQUIRED_FALLBACK_REF`.
3. `route.ts` (~line 2129): handler = `requireApproval` → `resolveAccountAndToken` →
   `driveFileScopeDenial` → `checkDocsPermission(…, true)` → GET document (compute body
   endIndex, detect structural elements) → batchUpdate with table-aware per-segment
   delete + `insertText` + explicit `updateParagraphStyle NORMAL_TEXT` sweep over the
   new range → GET read-back → verified success, or specific "partial delete, N chars
   remain" error. Analytics wrapper applies automatically via patched `registerTool`.
4. Discoverability + docs: `initialize` instructions string (`route.ts:2384-2393`),
   `src/app/docs/page.tsx:32-40` WRITE_TOOLS table, `docs/architecture_and_strategy.md:107`,
   `docs/distribution_architecture.md`, `docs/connector_submission/listing_copy.md`.
5. QA: new `### A14:` in `docs/QA_Acceptance_Test/capabilities/19_docs_management.md`
   (+ agent runbooks; coverage check enforces).
6. **Cheap immediate mitigation in the same PR:** `docs_edit` description (729/1500
   chars used) gains a warning that deletes spanning table boundaries can partially
   apply with a success response — read back or use `docs_replace_body`. Do NOT touch
   `google_api_modify`'s description (1489/1500).

---

## Issue 4 — Comment anchoring (LOW) → roadmap note, honest reply

**Findings:** infeasible as requested. `comments_add` posts `{ content }` to Drive
`comments.create` (`route.ts:2182-2189`); Drive accepts an `anchor` field but the
Docs/Sheets editor anchor format is opaque/undocumented (kix, revision-scoped) and not
producible from Docs API indices. Already a recorded design decision
(`docs/implementation_plans/tool-discoverability-api-fallback_v2.md:46-50`) and stated
in the tool description. Read side already surfaces `quotedFileContent`.

**Action:** no build. Optional middle ground if demand recurs: accept a `quotedText`
param and prefix it in the comment body (">" quote style) so reviewers see which
sentence is under discussion. Reply to reporter explaining the Drive API limitation;
note the multi-reviewer-authorship observation is correct behavior (comments author as
the connected account).

---

## Issue 7 — Stale filenames in the rule list (MEDIUM, tiny fix)

**Findings — the fresh title is already in the browser and being thrown away.**
`verifyFileGrant` (`src/lib/driveFileGrantCheck.ts:27-50`) fetches the **live** title on
every dashboard load; the verify endpoints return it in `grants`, but
`AgentProfilesView.tsx:123` types the state as `{ state: string }` and discards `title`
(same in `ExposedFilesManager.tsx:64`). Names are stored in
`access_rules.resource_name` (`schema.ts:120`), captured only at grant time.

**PR 3 scope (zero new Google calls):**

- `AgentProfilesView.tsx:123` widen type to `{ state; title? }`; render
  `grantStates[id]?.title || rule.resourceName || rule.ruleName` at `:573` (+ `:578`
  recovery-link `&name=`, `:629` aria-label). Same in `ExposedFilesManager.tsx:64/:217`.
- `fileAccessHandlers.ts:92-99`: opportunistic best-effort write-back of changed titles
  to `access_rules.resource_name` (batched UPDATE, never fails the response) so
  server-rendered surfaces, `get_my_permissions` (`route.ts:2355-2358`) and
  approval-page copy (`approvalLinks.ts:252-258`) stop lying too.
- Cheap insurance while in the file: concurrency-cap the unbounded `Promise.all`
  fan-out at `fileAccessHandlers.ts:91-97` (exists today; 40 files = 40 parallel Google
  calls per dashboard load).

---

## Issue 6 — Per-agent profile routes (MEDIUM, largest change)

**Findings:** selection is `useState` inside the 1321-line `AgentProfilesView`
client component (`:91-104`); tabs are buttons, no URL sync anywhere. **A URL
identifier already exists and is already unique per user**: profile slugs
(`src/lib/profileSlugs.ts`, uniqueness enforced at creation `actions.ts:171-180`,
labels immutable) — already used for `/api/mcp/<slug>`. No schema work needed. Bonus
finding: the `?tab=connections&highlight=…` deep links emitted at `route.ts:229`,
`cli-token/route.ts:148,172`, `partner-token/route.ts:51` are **dead** — nothing reads
those params today.

**PR 5 scope:**

- New `src/app/dashboard/agents/[slug]/page.tsx` (first dynamic page route in the app);
  extract the loader from `dashboard/page.tsx`; `notFound()` on slug miss.
- `dashboard/page.tsx` → redirect to default/first profile's slug route.
- `AgentProfilesView.tsx`: `activeId` becomes a prop; `ProfileTabs` buttons
  (`:387-399`) → `next/link` (back-button, middle-click, bookmarking for free).
- `NavLink.tsx:13`: widen active match for `/dashboard/agents/*`.
- **The one silent breaker:** ~18 `revalidatePath("/dashboard")` sites in `actions.ts`
  must also revalidate the new routes (`revalidatePath('/dashboard', 'layout')` or
  per-slug) or mutations stop refreshing.
- Payoff wiring: replace the dead `?tab=connections&highlight` links with
  `/dashboard/agents/<slug>#connected-agents`; approval-flow "back" links can target
  the profile the grant was scoped to (`proxyKeyId` is already in the payload).
- `useGooglePicker` round-trips `window.location.pathname` and already carries the
  profile id as context — works unchanged.

---

## Out-of-band actions (not PRs)

1. **Ken, in the Clerk dashboard:** confirm the Google SSO connection includes
   `drive.file` in its permitted scopes (Issue 1, Action 0). If absent, adding it may
   resolve the silly.demo account without any deploy.
2. **Backlog:** connector block-by-rotating-DCR-client-id gap (Issue 1, finding 7).
3. **Backlog:** unfiltered full-table reads of `key_email_access` /
   `key_rule_assignments` in `dashboard/page.tsx:46,63` and
   `fileAccessHandlers.ts:136` — fine at current scale, flagged while exploring.
4. **Support replies** to the reporter for all three threads once PRs land (or now for
   Issue 4's "won't build, here's why").
