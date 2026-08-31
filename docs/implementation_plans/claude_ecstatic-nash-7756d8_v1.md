# Support-issue remediation — Issues 5, 6, 7 (single PR)

Implements Issues 5, 6, and 7 from
`claude_fgac-support-issues-plan-a38485_v1.md` (the 2026-08-30 support-email
batch analysis, authored on branch `claude/fgac-support-issues-plan-a38485`).
Issues 1–4 of that plan are out of scope here. No schema changes.

## Issue 5 — Wrong-account approval links get a real message (HIGH UX)

Regression of the pre-2026-08-25 JWT-link behavior: a link opened by the wrong
signed-in FGAC user renders the generic "Invalid link" card, indistinguishable
from a forged link.

- `src/lib/maskEmail.ts` — new `maskEmail` helper (keeps first/last local
  char + full domain: `k••••h@gmail.com`).
- `src/app/dashboard/actions.ts`
  - `resolveApprovalLink`: when HMAC verification against the signed-in user
    fails, resolve the owner from the cleartext `k` param
    (`proxy_keys.id → userId → users.email`), recompute the HMAC against the
    **resolved owner's** id, and only on a match return a new
    `wrong_account` status carrying `{ maskedOwnerEmail, keyLabel, action,
    requestId, signedInEmail }`. Tampered links verify against nobody and
    still fall through to `invalid` (preserves QA capability 14 A7).
    The "Clerk user with no users row" early return stays distinct and
    unchanged (still `invalid`).
  - `approveMagicLink`: same owner-recovery branch for stale form POSTs —
    failure reason names the masked issued-for account.
- `src/app/dashboard/approve/page.tsx` — new warning-toned card before the
  invalid card: names the masked issued-for email + profile label, tells the
  user to sign out and back in, with a sign-out control
  (`SignOutAndReturn.tsx`, Clerk `signOut({ redirectUrl })`) that round-trips
  to the same approve URL via `linkQuery()`. Analytics: `approval_link_opened`
  now emits `status: "wrong_account"` with the REAL `request_id`
  (recomputable once the owner is resolved). `markApprovalRequestOpened` is
  NOT called for wrong-account opens — the owner hasn't seen the link.
- Tests: `scripts/test-approval-links.ts` gains the wrong-signed-in-user
  recovery case (fails for the wrong user, re-verifies against the owner;
  tampered links recover against nobody) and `maskEmail` cases.
- QA: capability 14 A5 updated — still rejected, no rule created, and the
  page now names the masked issued-for account.

## Issue 6 — Agent profiles at their own routes (MEDIUM)

Profile slugs already exist, are unique per user, and already address
`/api/mcp/<slug>`.

- `src/app/dashboard/loadDashboard.ts` — loader extracted verbatim from
  `dashboard/page.tsx` (profiles, rules, accessibleEmails, mcpEndpoint,
  google-access gate).
- `src/app/dashboard/agents/[slug]/page.tsx` — new server page;
  `notFound()` on slug miss; a revoked profile's slug redirects to
  `/dashboard` instead of 404ing.
- `src/app/dashboard/page.tsx` — redirects to the default (else first)
  active profile's slug route; renders the empty state inline when the user
  has no active profiles (or none with a usable slug — legacy labels).
- `src/app/dashboard/AgentProfilesView.tsx` — `activeId` becomes a prop
  (the `useState` + keep-valid effect are removed); `ProfileTabs` buttons
  become `next/link` `<Link>`s; revoking a profile navigates back to
  `/dashboard` (its route is gone).
- `src/app/NavLink.tsx` — `/dashboard` also counts as active on
  `/dashboard/agents/*`.
- `actions.ts` — all ~18 `revalidatePath("/dashboard")` sites become a
  shared `revalidateDashboard()` helper calling
  `revalidatePath("/dashboard", "layout")`, so the new slug routes (and
  `/dashboard/accounts`) revalidate on every mutation. **This is the one
  silent breaker** the plan flags.
- Dead deep links (`?tab=connections&highlight=` — nothing reads those
  params) replaced via new `src/lib/dashboardAgentLinks.ts`
  `connectionsDeepLink()`: resolves the user's default/first profile slug to
  `/dashboard/agents/<slug>#connected-agents`, falling back to
  `/dashboard#connected-agents`. Call sites: `src/app/api/mcp/route.ts`,
  `src/app/api/auth/cli-token/route.ts` (×2),
  `src/app/api/auth/partner-token/route.ts`.
- `useGooglePicker` round-trips `window.location.pathname` — unchanged.

## Issue 7 — Live Drive filenames in the rule list (MEDIUM)

`verifyFileGrant` already fetches the live title on every dashboard load; the
verify endpoints return it in `grants`; the clients discard it.

- `AgentProfilesView.tsx` — grant-state type widened to
  `{ state; title? }`; the rule row renders
  `grantStates[id]?.title || rule.resourceName || rule.ruleName` (row label,
  recovery-link `&name=`, permission-select aria-label).
- `ExposedFilesManager.tsx` — same widening + render (title cell and
  recovery-link `&name=`).
- `src/app/api/rules/fileAccessHandlers.ts` (`verifyFileAccessGET` list
  branch):
  - the unbounded `Promise.all` fan-out is capped at 5 concurrent Google
    calls;
  - best-effort write-back of changed titles to
    `access_rules.resource_name` (single batched pass, wrapped so it can
    never fail the response) — server-rendered surfaces,
    `get_my_permissions`, and approval-page copy stop showing stale names
    once a dashboard load has seen the new title.

## Validation

`npm run mcp:lint` (includes `test-approval-links.ts`), `npm run build`,
local browser validation of: wrong-account card (USER_A link opened as
USER_B), slug routes + tab navigation + mutation revalidation, live-title
rendering. Then `/deploy-pr-preview`.
