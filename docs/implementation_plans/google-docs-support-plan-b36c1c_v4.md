# Google Docs Support — Implementation Plan (v4)

**Branch**: `claude/google-docs-support-plan-b36c1c`
**Status**: Draft for review — no implementation started.
**Pattern source**: the Google Sheets integration (see
`feature-google-drive-sheets-fgac_v6.md` and the code it produced).

**Changes from v3** (Ken's review, 2026-08-19):
- **D7 generalized from "docs reads" to "every tool response".** Size
  observability moves to the shared MCP result-serialization layer
  ([route.ts:198](../../src/app/api/mcp/route.ts) `textResult` — the choke
  point every tool result already funnels through), so EVERY tool call gets
  `response_chars` / `response_kb` stamped, not just docs. Cap *enforcement*
  stays per-kind via a small registry: attachments (existing) and docs reads
  (new) get caps on day one; sheets/gmail get observability now and caps
  only after PostHog shows their real size distribution — capping a
  battle-tested path without data is how regressions happen.

**Changes from v2** (Ken's review, 2026-08-19):
- **New D7 — response-size guardrail + observability**, following the
  `gmail_get_attachment` pattern from `claude/fgac-mcp-attachment-debug-3f9974`
  (commit `5aa23bd`): payload-size props on every outcome, and no returning
  payloads that exceed the MCP client's tool-result cap — with an actionable
  recovery message. For docs the recovery is agent-self-serviceable
  (`fields` mask), unlike attachments where the message punts to the user.

**Changes from v1** (Ken's review, 2026-08-19):
- **D2 resolved — generalize.** Presentations (Google Slides) are likely
  next, so the shared plumbing is designed for three kinds from day one,
  with `slide` stubbed in the descriptor type now.
- **D4 revised — the read tool returns the raw `documents.get` API response
  verbatim** instead of extracted plain text. Markdown conversion was
  considered and rejected for now: fidelity gets tricky with embedded
  objects (tables, images, inline drawings). An optional `fields` mask keeps
  large responses trimmable.

## 1. How Sheets works today (the pattern we're following)

The Sheets integration has five load-bearing properties, all of which carry
over to Docs unchanged:

1. **No service-wide OAuth scope.** FGAC never requests a Sheets scope; API
   access rides on per-file `drive.file` grants that Google registers only
   when the user picks the file in the Google Picker with our `appId`
   ([useGooglePicker.ts](../../src/app/dashboard/useGooglePicker.ts),
   [sheetsGrantCheck.ts](../../src/lib/sheetsGrantCheck.ts)). This is what
   keeps the CASA/verification surface small.
2. **Deny-by-default per-file rules.** `access_rules` rows with
   `service='sheets'`, `actionType ∈ {sheet_read, sheet_read_write,
   sheet_block}`, `targetResourceId=<spreadsheetId>`. No rule → denied.
3. **Two-halves enforcement.** FGAC's rule check
   (`checkSheetsPermission` in [route.ts](../../src/app/api/mcp/route.ts))
   is separate from the Google-side grant; a 403/404 *after* FGAC allows the
   call routes the user to `/dashboard/sheets-setup` (grant recovery), with
   grace retries for freshly created rules (`withSheetsGrace`).
4. **Denial → approval funnel.** Every denial mints a single-use magic link
   (`sheets_expose` / `sheets_write` in
   [approvalLinks.ts](../../src/lib/approvalLinks.ts)); the approve page runs
   picker-first (`SheetsApprovalFlow`) so a rule is never created for a sheet
   Google can't reach.
5. **Curated tools + raw passthrough, same policy.** Four `sheets_*` MCP
   tools plus `google_api_get/modify`, all funneling through one
   classification (`classifyGoogleApiCall` in
   [googleApiPolicy.ts](../../src/app/api/mcp/googleApiPolicy.ts)) and one
   permission check. Agent-created spreadsheets are auto-granted to the
   creating key (`sheets_create` posture, 2026-08-19).

A sixth pattern arrived with the attachment work and is adopted and
generalized here (D7):

6. **Payload-size observability + cap.** `gmail_get_attachment` records
   `attachment_chars` / `attachment_kb` on every outcome via
   `addToolCallProps`, and refuses payloads over `MAX_ATTACHMENT_CHARS`
   (200k base64url chars ≈ 150 KB) with a `⚠️` message instead — because MCP
   clients impose their own tool-result caps (Claude Code rejects results
   over ~25k tokens), so a server-side "success" can still be silently
   discarded client-side after we report it as delivered.

## 2. Key facts about the Google Docs API

- Endpoint family: `https://docs.googleapis.com/v1/documents/{documentId}`.
- **`drive.file` is a supported scope** for `documents.get`,
  `documents.create`, and `documents.batchUpdate` — the per-file Picker
  grant mechanism works identically. (Phase 0 verifies this empirically
  before we build on it.)
- Picker view: `google.picker.ViewId.DOCUMENTS` (we use `SPREADSHEETS`
  today; Slides later will use `PRESENTATIONS`).
- API shape differs from Sheets in one way that matters for policy:
  **there are no ranges.** `documents.get` returns the whole document;
  `documents.batchUpdate` is the *only* write endpoint and can insert,
  replace, style, and **delete** content. So "Read & Write" on a doc means
  full-document edit — the plan surfaces that honestly in tool annotations
  and rule UI copy, and offers a non-destructive append tool for the common
  agent case.
- Because reads are whole-document and the response is verbose structural
  JSON, **docs reads are the most cap-prone payload FGAC will serve** —
  they are D7's first enforced kind.

## 3. Design decisions

### D1 — Reuse the `drive.file` + Picker mechanism; no new OAuth scope
Same consent, same appId, same grant-recovery machinery. No Google
re-verification impact. (Alternative — request `documents` scope — rejected:
it breaks the entire FGAC premise and the CASA posture.)

### D2 — Generalize the shared plumbing (DECIDED — presentations coming next)
The Picker hook, grant check, setup/recovery page, and approval flow are
~95% file-type-agnostic. Parameterize them by a small descriptor rather than
copy-pasting; **Google Slides is expected soon and must be a descriptor
entry, not a third fork**:

```ts
// src/lib/driveFileKinds.ts (new)
export type DriveFileKind = 'sheet' | 'doc' | 'slide'; // 'slide' stubbed now, wired when Slides ships
export const DRIVE_FILE_KINDS: Record<DriveFileKind, {
  service: 'sheets' | 'docs' | 'slides'; // access_rules.service
  pickerViewId: 'SPREADSHEETS' | 'DOCUMENTS' | 'PRESENTATIONS';
  verifyUrl: (id: string) => string;      // grant-check probe endpoint
  setupPath: string;                      // /dashboard/sheets-setup | docs-setup | slides-setup
  noun: string;                           // "spreadsheet" | "document" | "presentation"
}>;
```

Implementation note for the refactor: every place Phase 2–4 generalizes
(`checkSheetsPermission`, `withSheetsGrace`, grant recovery, approval flow,
rule CRUD, exposed-files manager) must key off the descriptor — zero
remaining `if (kind === 'doc')` branches in shared code. The acceptance test
for the abstraction is: **adding Slides later touches `driveFileKinds.ts`,
tool defs/registrations, and QA docs — nothing else.**

Existing `sheets-*` route paths, action names, and analytics event props
**stay unchanged** (no churn for existing users/links); the docs variants
are new parameterizations of the same components.

### D3 — Rule model: `service='docs'`, no schema migration
`access_rules.service` and `actionType` are plain `text` columns. New values:
`doc_read`, `doc_read_write`, `doc_block`; `targetResourceId=<documentId>`.
Zero DDL — comment updates in [schema.ts](../../src/db/schema.ts) only.

### D4 — Curated MCP tool set (3 new tools); read returns the raw API response

| Tool | Maps to | Returns | Annotations |
|---|---|---|---|
| `docs_read_document` | `documents.get` | **The raw Docs API JSON response, verbatim.** Optional `fields` parameter passes Google's standard field mask through, so agents can trim large documents (e.g. `title,body.content`) | readOnly |
| `docs_append_text` | `batchUpdate` / `insertText` at `endOfSegmentLocation` | Raw batchUpdate response | write, `destructive: false` (mirrors `sheets_append_rows`) |
| `docs_replace_text` | `batchUpdate` / `replaceAllText` | Raw batchUpdate response | write, `destructive: true` |

**No content transformation on read** (decided in review): FGAC passes
through what `documents.get` returns, exactly as the `sheets_*` tools pass
through Sheets API responses. Markdown conversion was considered and
**rejected for the first release** — embedded objects (tables, inline
images, drawings, footnotes, suggestions) make a faithful conversion a
project of its own, and a lossy one would silently hide content from
agents, which is worse than verbose JSON. Modern agents parse the Docs JSON
structure fine. If token bloat shows up in practice, a `format: 'markdown'`
option can be added later as a follow-up without breaking anything; the
tool description will note that `fields` is the size-control lever for now
(and D7's over-cap message teaches it at exactly the moment it's needed).

Everything else (styling, deleting ranges, tables) goes through
`google_api_modify` under the same per-doc rule. `documents.create` via raw
POST is auto-granted to the calling key, mirroring the `sheets_create`
posture. All defs must pass `scripts/mcp-tool-lint.ts` invariants.

### D5 — Raw-API behavior change (call out explicitly)
Today `docs/v1/documents/...` through `google_api_get/modify` falls into the
**passthrough** branch (unknown family, backstopped only by the OAuth
scope — and in practice 403s because nothing grants docs files). This plan
moves the `documents` family into an **enforced** class: per-doc FGAC rule
required, denials mint approval links. Strictly a tightening; no working
flow regresses.

### D6 — Docs get the same approval-funnel treatment as Sheets
New approval actions `docs_expose` / `docs_write` (30-min TTL like sheets —
generalize the `startsWith('sheets')` TTL check to a kind lookup),
picker-first approve flow, `/dashboard/docs-setup` grant recovery, and
`request_access` grows `docs_read` / `docs_write` request types.

### D7 — Universal response-size observability; per-kind caps
Generalizes the `gmail_get_attachment` pattern (commit `5aa23bd`) from one
tool to the whole tool surface. Two layers with different blast radii:

**Layer 1 — observability on EVERY tool response (universal, day one).**
All tool results already funnel through one choke point —
`textResult` / `jsonResult` at [route.ts:198](../../src/app/api/mcp/route.ts).
Measure there: stamp `response_chars` and `response_kb` onto the tool-call
analytics event for **every** tool, every outcome (success, denial, error).
Zero behavior change — pure measurement. This is what lets PostHog answer,
for any tool and any client: how often do we report success on a payload
the client then silently discards? The existing `attachment_chars` /
`attachment_kb` props stay for dashboard continuity; the generic props are
additive.

The client-side budget varies by agent (Claude Code rejects tool results
over ~25k tokens; other MCP clients differ, and `user_agent` /
`client_name` already land on the event), so Layer 1 deliberately records
raw size and leaves "too large for whom?" as an analytics-time question —
per-client thresholds can be applied in PostHog without shipping code.

**Layer 2 — enforcement: per-kind caps with recovery guidance.**
A small registry (colocated with the D2 descriptor) declares, per response
kind: the cap in chars, and the recovery hint. Over the cap, the tool does
NOT return the doomed payload — it returns a `⚠️` message sized to the
payload with the kind's recovery action, and stamps `response_over_cap:
true`. Day-one entries:

| Kind | Cap | Recovery hint | Status |
|---|---|---|---|
| Gmail attachment | 200k b64 chars (existing `MAX_ATTACHMENT_CHARS`) | "Ask the user to retrieve it from Gmail" (opaque binary — no trim lever) | already live; migrates into the registry unchanged |
| Docs read (curated + raw) | `100_000` JSON chars ≈ 25k tokens, calibrated by Phase 0 measurements | "Retry with the `fields` parameter (e.g. `title,body.content`) — the user does not need to do anything" (agent-self-serviceable) | **new, this PR** |
| Sheets reads, Gmail reads/lists | — | candidate hints: narrower range / fewer results / `fields` | **observability only** — caps proposed as a follow-up once Layer 1 shows their real size distribution (capping a battle-tested path without data is how regressions happen) |

Writes are exempt everywhere: mutation responses are small; the guard
applies to read-shaped responses only. The proxy route is also exempt — it
serves plain HTTP clients that have no tool-result cap.

Implementation: `guardResponseSize(kind, payload)` pure helper (Phase 1,
unit-tested) + the `textResult`-layer measurement (Phase 2). Slides adopts
both by registry entry when it ships.

## 4. Work plan

### Phase 0 — Spike: prove Docs API + Picker per-file grant (½ day)
Manual/browser, QA accounts, no code merged:
1. Picker with `ViewId.DOCUMENTS` + our appId → pick a doc as USER_A.
2. `GET docs.googleapis.com/v1/documents/{id}` with the Clerk-vaulted token
   → expect 200 title/body; also confirm the `fields` mask works under
   `drive.file` (it backs `docs_read_document`'s trim parameter, the
   grant-check probe, AND D7's over-cap recovery advice).
3. `batchUpdate` insertText → expect 200.
4. Negative: same calls on an unpicked doc → 403/404 (confirms the grant is
   per-file, not ambient).
5. Size datapoint: fetch a real-world large doc (QA fixture below) and
   record raw response size vs `fields`-masked size, to sanity-check the
   docs cap's starting value.
Record results in `docs/spike_results/`. **Gate: everything after this
phase assumes the spike passed.**

### Phase 1 — Policy core (pure, unit-testable)
- `src/lib/driveFileKinds.ts` (new) — descriptor from D2, with `slide`
  stubbed in the type.
- `guardResponseSize` helper + per-kind cap registry (D7 Layer 2) — pure,
  unit-testable: size measurement, cap lookup, over-cap message rendering.
  `MAX_ATTACHMENT_CHARS` migrates into the registry unchanged.
- [googleApiPolicy.ts](../../src/app/api/mcp/googleApiPolicy.ts):
  `classifyGoogleApiCall` gains `documents` branch → `{kind:'docs',
  documentId, isMutating}` + `{kind:'docs_create'}`; `extractDocsDocumentId`;
  generalize `sheetsApprovalAction` → `fileApprovalAction(kind, …)`.
- [approvalLinks.ts](../../src/lib/approvalLinks.ts): add `docs_expose` /
  `docs_write` actions + TTL + validation list.
- Extend `scripts/test-google-api-policy.ts` and
  `scripts/test-approval-links.ts` with docs cases, including
  guard-over/under-cap cases (docs and attachment kinds).

### Phase 2 — Enforcement + MCP tools
- [route.ts](../../src/app/api/mcp/route.ts):
  - **D7 Layer 1**: `textResult`/`jsonResult` (route.ts:198) stamp
    `response_chars` / `response_kb` via `addToolCallProps` on every tool
    result. `gmail_get_attachment` keeps its `attachment_*` props and moves
    its cap check onto the shared guard.
  - Generalize `checkSheetsPermission` / `withSheetsGrace` /
    `sheetsErrorResult` into kind-parameterized versions (sheets behavior
    byte-identical).
  - Register the 3 `docs_*` tools (read passes the raw `documents.get`
    response through, with optional `fields` mask — D4 — behind the D7
    guard); raw `docs`-classified GETs go through the same guard.
  - Extend `request_access` enum + `get_my_permissions` posture text; handle
    `docs` / `docs_create` classes with auto-grant.
- [toolDefs.ts](../../src/app/api/mcp/toolDefs.ts): 3 new defs
  (`docs_read_document`'s description names `fields` as the size lever);
  update `google_api_get/modify` + `request_access` descriptions to name the
  Docs API; run `mcp-tool-lint`.
- [proxy route](../../src/app/api/proxy/%5B...path%5D/route.ts): service
  detection (`documents` → `docs`) + same rule enforcement as sheets there.
  (No size guard — plain HTTP clients have no tool-result cap.)
- Analytics: `denial_code`s `docs_not_exposed|docs_blocked|docs_read_only`,
  grace props `docs_grace_*`, universal `response_chars` / `response_kb` /
  `response_over_cap` (D7), keep `raw_api_family` stamping.

### Phase 3 — Grant flow + approval funnel (dashboard)
- [useGooglePicker.ts](../../src/app/dashboard/useGooglePicker.ts): accept a
  `DriveFileKind` (view id + title); consent round-trip params carry the
  kind so the auto-reopen lands on the right view.
- [sheetsGrantCheck.ts](../../src/lib/sheetsGrantCheck.ts) →
  `driveFileGrantCheck.ts` probing the kind's verify endpoint (docs:
  `documents.get?fields=title`); keep a `verifySheetsGrant` re-export.
- `/dashboard/docs-setup` (new page) + generalize `SheetsGrantRecovery` into
  the shared component both pages render.
- [approve page](../../src/app/dashboard/approve/page.tsx) +
  `SheetsApprovalFlow` → kind-parameterized `FileApprovalFlow`; docs
  approvals verify-then-grant with the same settling/grace UX.
- API routes: `grant-docs-access` / `verify-docs-access` (thin wrappers over
  shared handlers with `grant-sheets-access` / `verify-sheets-access`).
- [actions.ts](../../src/app/dashboard/actions.ts): docs rule CRUD +
  `exposeDocsFromPicker` mirroring the sheets server actions;
  `DOC_ACTION_TYPES` validation.

### Phase 4 — Dashboard management UI
- Generalize [ExposedSheetsManager.tsx](../../src/app/dashboard/ExposedSheetsManager.tsx)
  (or add a sibling driven by the same shared list component): expose/manage
  docs per profile, read vs read-write toggle, block, "needs Google access"
  chip wired to `/dashboard/docs-setup`.
- [EditRuleButton.tsx](../../src/app/dashboard/EditRuleButton.tsx) /
  `RuleControls` / `AgentProfilesView`: render `service='docs'` rules;
  write-access copy states plainly that Read & Write = full-document edit
  (§2 caveat).
- [defaultProfile.ts](../../src/db/defaultProfile.ts): comment update only —
  docs are deny-by-default with no rules, same as sheets.

### Phase 5 — Docs, QA, lint
- New QA capability `docs/QA_Acceptance_Test/capabilities/19_docs_management.md`
  modeled on `09_sheets_management.md` (same picker-iframe harness notes;
  the app-API seam for post-pick assertions is `grant-docs-access`).
  Includes a size-guard assertion: reading the oversized QA fixture doc
  without `fields` returns the ⚠️ guidance (not a payload), and the same
  read WITH a `fields` mask succeeds — proving the recovery path the
  message promises.
- QA fixtures: one normal QA Google Doc owned by USER_A + one deliberately
  large one (bulk-paste content until the raw response clears the cap —
  one-time manual setup, documented in `/qa-setup` docs).
- Touch-ups: `10_raw_google_api.md` (documents family now enforced + size
  guard on raw docs reads), `15_request_access_tool.md` (new request types),
  `17_sheets_grant_recovery.md` (shared component note),
  `16_analytics_events.md` (universal `response_chars` / `response_kb` /
  `response_over_cap` props — assert they appear on gmail and sheets tool
  calls too, since Layer 1 is universal).
- Agent runbooks in `docs/QA_Acceptance_Test/agents/` gain the docs
  capability; `npx tsx scripts/qa-coverage-check.ts` stays the arbiter.
- Repo docs: `user_guide.md`, `architecture_and_strategy.md` (data model),
  `analytics.md` (new universal size props), `connector_submission/listing_copy.md`
  + `mcp-registry-server.json` (tool list changed — connector directory
  listing must be resubmitted/updated).

### Phase 6 — Optional / follow-up (not in first PR)
- **Google Slides** (likely next): descriptor entry + `slides_*` tool defs +
  QA capability — the D2 abstraction's acceptance test.
- **Caps for sheets/gmail reads** (D7 Layer 2 extension): once Layer 1's
  `response_chars` distribution shows where sheets/gmail reads actually
  land, add registry entries with the right hints (narrower range, fewer
  results, `fields`). Data-first, because these paths are battle-tested.
- [partner manifest](../../src/lib/partner/manifest.ts): `'docs'` service +
  consent-screen line ("Access documents you explicitly share").
- Marketing: `use-cases/google-docs-agent` page, landing-page mention,
  `src/app/docs/page.tsx` API docs.
- Combined picker view (sheets + docs in one dialog) for the dashboard's
  generic "expose files" entry point.
- `docs_read_document` `format: 'markdown'` option, only if raw-JSON token
  bloat proves to be a real agent pain point (see D4) — the D7 props are
  exactly the data that decides this.

## 5. Testing & rollout

- Unit: policy classification + approval-link + size-guard suites (Phase 1
  scripts).
- Local QA: full docs capability run (incl. over-cap fixture assertion) +
  targeted re-run of sheets capabilities **09, 10, 14, 15, 17** and
  **16 (analytics)** — the generalization refactor and the universal size
  props touch their code paths.
- `/deploy-pr-preview` → preview-branch QA per standard workflow; user runs
  `/deploy-prod`.
- No DB migration, no new env vars, no new OAuth scope → no infra steps.
  Connector-directory listing update is the one external follow-up.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Docs API + Picker `drive.file` grant doesn't behave like Sheets in some corner (e.g. grant propagation lag differs) | Phase 0 spike gates everything; grace-retry machinery already handles propagation lag |
| Generalization refactor regresses battle-hardened sheets flows | Sheets behavior kept byte-identical (routes, action names, analytics props unchanged); targeted sheets QA re-run in Phase 5 |
| "Read & Write" on a doc is broader than users expect (batchUpdate can delete) | Explicit UI copy + `destructive: true` on replace/raw tools; append tool offered as the safe default |
| Raw `documents.get` JSON exceeds MCP clients' tool-result caps and gets silently discarded after we report success | D7: universal size props on every response + docs cap returning `fields`-mask recovery guidance instead of a doomed payload; over-cap rate visible in PostHog from day one |
| Docs cap miscalibrated (too tight = needless friction; too loose = silent client drops continue), and client budgets differ per agent | Phase 0 records real response sizes; universal `response_chars` + `client_name` on events make per-client threshold analysis a PostHog query and recalibration a one-constant change |
| Universal measurement layer accidentally alters result shape or breaks a tool | Layer 1 is measurement-only inside `textResult` — no payload change; QA capability 16 asserts props exist AND existing capabilities re-run green |
| Tool-count growth pushes connector-directory re-review | `mcp-tool-lint` invariants enforced; listing update planned as explicit follow-up |
