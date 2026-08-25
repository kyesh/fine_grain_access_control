# Fix: glob/regex mismatch breaks rule create + edit; add error observability

## Context

Production `POST /dashboard` returned 500 twice on 2026-08-25 (01:25:55Z, 01:27:14Z) for
`kenyesh@gmail.com`:

```
Error: The provided regular expression '*' is too complex and poses a performance risk.
```

**Root cause.** Every *enforcement* site treats `regexPattern` as a **glob** and converts
it before compiling — `src/lib/gmailRules.ts:68`, `src/app/api/mcp/route.ts:366`,
`src/app/api/proxy/[...path]/route.ts:531,696`:

```ts
const regexStr = rule.regexPattern.replace(/\*/g, '.*');
if (!safeRegex(regexStr)) continue;
```

But the two *writers* — `createRule` ([actions.ts:279](src/app/dashboard/actions.ts:279))
and `updateRule` ([actions.ts:326](src/app/dashboard/actions.ts:326)) — run `safeRegex()`
on the **raw, unconverted** string. `safe-regex` returns `false` for anything that will not
compile, and a leading `*` is a syntax error. So the form rejects exactly the syntax its own
placeholder advertises (`e.g. *@competitor.com`, `RuleControls.tsx:177`).

**Regression origin.** Commit `38e5c84` (2026-04-10, *"CASA Tier 2 SAST fixes and
safe-regex"*) added both guards in one change. The enforcement-side guard checks `regexStr`
(converted) — correct. The dashboard-side guard checks `regexPattern` (raw) — wrong. Same
commit, two different variables.

**Why it surfaced only now.** Rule volume grew (14/1/5 gmail rules in Mar/Apr/May vs **35 in
August**), and `1fece87` (2026-08-16, *"one-click 'Send to Anyone'"*) began writing
`regexPattern: '*'` directly via `db.insert`, bypassing `createRule`. Once the app itself
generated bare `*` rules, `*` became the obvious thing to type — and typing it 500s.

**Blast radius** (read-only prod query): 55 gmail rules / 16 users; **4 rules pattern `*`,
4 distinct users** (created 8/17, 8/18, 8/24 ×2). Each of those accounts hits the same 500
the moment they open that rule and press Save. None belong to the reporting user — both of
his 500s were failed *attempts*, one through each action.

**Secondary problem.** Nothing recorded this. No error-tracking SDK, no `error.tsx`
anywhere, no rule telemetry, ~1h Vercel log retention, no alerting. The only reason we have
evidence is that it was reported within the hour.

**Intended outcome.** Glob patterns save again; invalid patterns show an inline message
instead of a 500; validation can no longer drift from enforcement; and the next server error
of this class is visible without a same-hour bug report.

---

## Part 1 — Single source of truth for pattern handling

`src/lib/gmailRules.ts` already exists as the shared rule module ("so notification filtering
can never drift from read-time filtering") and already imports `safe-regex`. Extend it:

```ts
export function globToRegex(pattern: string): string      // the one .replace(/\*/g, '.*')
export function validateRulePattern(pattern: string):
  | { ok: true;  regex: string }
  | { ok: false; reason: 'invalid' | 'unsafe'; message: string }
```

`validateRulePattern` converts first, then checks `new RegExp()` (→ `invalid`), then
`safeRegex()` (→ `unsafe`) — two distinct user-facing messages instead of today's
conflated "too complex".

Then:

- Replace all four inline `.replace(/\*/g, '.*')` + `safeRegex` pairs with `globToRegex` /
  `validateRulePattern`, so the write and read paths compile literally the same string.
- `createRule` / `updateRule`: call `validateRulePattern` and **return** `{ error }` rather
  than `throw`. This matters — Next.js redacts *thrown* server-action messages in production
  and replaces them with a digest, which is why the real cause was invisible in the browser.
  A returned value is not redacted.
- Route `grantSendToAnyone` ([actions.ts:614](src/app/dashboard/actions.ts:614)) and
  `applyRecommendedSecurityRules` ([actions.ts:549](src/app/dashboard/actions.ts:549))
  through the same validator, so no writer can produce a row the form later rejects.

**No data migration.** `*` is a valid glob; the four existing rules become editable the
moment the validator is corrected.

## Part 2 — Surface the error in the form

`RuleControls.tsx` and `EditRuleButton.tsx` currently `await createRule(formData)` inside
`startTransition` with no handling, so a failure closes the modal or blanks the page.

Reuse the established modal-error pattern from
[DelegateAccessButton.tsx:9-20,63](src/app/dashboard/DelegateAccessButton.tsx:9) —
`useState<string | null>`, `<p role="alert" className="… text-destructive">` — but drive it
from the action's **return value**, not a `catch`. On error: keep the modal open, preserve
the user's input, show the message under the pattern field.

Same-class fix while here: `DelegateAccessButton`'s `catch (err) => err.message` displays
Next's redacted generic text in production. Convert `createDelegation` to the same
return-an-error shape.

## Part 3 — Instrumentation

| Item | File | Note |
|---|---|---|
| Client exception capture | `src/app/providers.tsx:7` | add `capture_exceptions: true` to `posthog.init` (posthog-js 1.360 supports it) |
| Route error boundary | `src/app/error.tsx` (new) | themed with existing `bg-background`/`text-foreground` tokens; reports to PostHog; "Try again" reset |
| Root error boundary | `src/app/global-error.tsx` (new) | catches layout-level failures |
| Server-side capture | `src/lib/posthogServer.ts` | add `captureServerError(distinctId, where, err)` beside `captureServerEvent`; use it in the dashboard actions |
| Rule telemetry | `src/app/dashboard/actions.ts` | `rule_saved` / `rule_save_failed` with `action_type`, `service`, `reason`, `pattern_kind` (`glob`\|`regex`\|`literal`) and pattern **length** |
| Alerting | PostHog (no code) | once `$exception` flows, `$error_tracking_issue_created` / `$error_tracking_issue_spiking` become usable alert triggers — this closes the "nothing pages on a 500" gap without a log drain |

The connector confirms `$exception` is a defined event that this project has **not seen in
the last 30 days** — direct evidence that `capture_exceptions` is off and PostHog Error
Tracking is receiving nothing today. Enforcement-side rule telemetry already exists
(`read_restriction_enforced`); only the authoring side is silent.

**Never send the raw pattern to PostHog.** `send_whitelist` patterns contain real email
addresses; `pattern_kind` + length carry the diagnostic signal without the PII. Likewise
`captureServerError` sends error name, stack and a `where` label — never interpolated user
input. Note that Part 1 turns validation failures into *return values* rather than throws,
so a rejected pattern never reaches the exception path at all.

**Vercel Log Drain: out of scope** (decided 2026-08-24). Runtime log retention stays at the
measured ~1h. Consequence for this PR: **PostHog is the durable record of production
errors** — `vercel logs` is only usable within the hour, so the post-deploy check below
leans on PostHog rather than log queries. Log-line PII scrubbing is likewise out of scope;
no existing `console.*` call is modified.

## Part 4 — Regression test

New `scripts/test-rule-patterns.ts`, matching the hand-rolled style of
`scripts/test-auth-sampling.ts` (no test framework in this repo; `check(name, cond)` +
`process.exit(1)`). Wire it into `"mcp:lint"` in `package.json`, which both `npm run lint`
and `npm run build` already invoke — so CI enforces it.

Cases:
- Accepted: `*`, `*@competitor.com`, `2FA Code`, `.*@x\.com`
- Rejected `unsafe`: `(a+)+$`
- Rejected `invalid`: `[`, `+`
- **Invariant**: for every accepted pattern, the string each of the four enforcement sites
  compiles is byte-identical to the one `validateRulePattern` approved. This is the guard
  that makes the April 10 drift impossible to reintroduce.

## Part 5 — Docs, and one disclosure fix

**Glob is the documented syntax:**

- `docs/user_guide.md:131-132,157,296` — convert examples to glob (`*2FA*`,
  `*@yourcompany.com`) and rename "regex pattern" → "match pattern". Line 144 already
  documents `*` correctly and stays.

**Privacy policy — add PostHog as a processor.**
[`src/app/privacy/page.tsx:68`](src/app/privacy/page.tsx:68) currently names only Clerk,
Neon and Vercel. PostHog already receives Clerk user ids as `distinctId`
([docs/analytics.md](docs/analytics.md)), and Part 3 expands what it receives to include
exception reports. Add it to the same sentence, described as product analytics and error
monitoring acting on our behalf. This is a pre-existing gap, but this PR is what makes it
material, so it is fixed here.

> CASA Tier 2 SAQ discrepancies (a log drain asserted at
> `docs/archive/casa-tier-2/CASA_SAQ_Answers.md:300` that does not exist, and the Q48
> "sensitive values never logged" claim at line 280) are deliberately **out of scope** —
> those documents are regenerated at the next submission cycle.
- `docs/QA_Acceptance_Test/capabilities/01_send_whitelist.md` — add
  `### A5: The "Send to Anyone" rule can be edited and re-saved` (assertion headers are
  parsed by `npx tsx scripts/qa-coverage-check.ts`).
- Save this plan to
  `docs/implementation_plans/claude_email-rule-production-issues-fd6b07_v1.md` per CLAUDE.md.

---

## Verification

**Unit** — `npm run mcp:lint` (runs the new test plus existing ones).

**Local** — `npm run db:branch && npm run dev:qa`, then via the built-in browser tools
(`preview_start` / `read_page` / `computer` / `read_network_requests`):

1. Create rule, pattern `*@competitor.com` → saves; appears in the rules list.
2. Click "Enable sending to anyone", then Edit that rule → Save → **succeeds** (this is the
   exact production failure).
3. Enter `(a+)+$` → inline "too complex" message, modal stays open, input preserved,
   **no 500** in `read_network_requests`.
4. Enter `[` → inline "not a valid pattern" message.
5. Confirm enforcement is unchanged: `gmail_send` to a matching address passes, a
   non-matching one is still denied.
6. `rule_saved` / `rule_save_failed` fire — verify through the **PostHog connector MCP**
   (`ToolSearch "posthog exec"`), which authenticates independently of the unprovisioned
   `POSTHOG_PERSONAL_API_KEY` and is already scoped to project FGAC.ai (343912):
   - `call read-data-schema {"query":{"kind":"events"}}` — the two event names must appear
     (verified absent today, so this is a clean before/after).
   - `call read-data-schema {"query":{"kind":"event_properties","event_name":"rule_save_failed"}}`
     — confirms `reason`, `action_type`, `pattern_kind` land, **and that no raw pattern
     property exists**.
   - `call query-trends {...}` on `rule_saved` vs `rule_save_failed` for the save
     success rate.
7. `$exception` starts arriving — `read-data-schema` currently marks it *"not seen in the
   last 30 days"*, which is direct confirmation that `capture_exceptions` is off. After
   deploy it should be non-empty.
8. Throw a deliberate error on a dashboard route → `error.tsx` renders instead of a raw
   Next error page, and the exception shows up in PostHog Error Tracking.

**Preview** — `/deploy-pr-preview`, then re-run QA capabilities 01 (send whitelist) and
02 (read blacklist) against the preview URL.

**Production, after the user deploys** — run `npx vercel logs --environment production
--status-code 500 --since 1h` **within the hour of deploying** (retention is ~1h and no
drain is being added); it should stay empty. Thereafter PostHog exception capture is the
standing signal. The four accounts holding a `*` rule can then edit it — re-run the
read-only pattern audit to confirm none remain unsavable.
