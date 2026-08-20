# Google Docs Support — Implementation Plan (v1)

**Branch**: `claude/google-docs-support-plan-b36c1c`
**Status**: Draft for review — no implementation started.
**Pattern source**: the Google Sheets integration (see
`feature-google-drive-sheets-fgac_v6.md` and the code it produced).

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

## 2. Key facts about the Google Docs API

- Endpoint family: `https://docs.googleapis.com/v1/documents/{documentId}`.
- **`drive.file` is a supported scope** for `documents.get`,
  `documents.create`, and `documents.batchUpdate` — the per-file Picker
  grant mechanism works identically. (Phase 0 verifies this empirically
  before we build on it.)
- Picker view: `google.picker.ViewId.DOCUMENTS` (we use `SPREADSHEETS`
  today).
- API shape differs from Sheets in one way that matters for policy:
  **there are no ranges.** `documents.get` returns the whole document;
  `documents.batchUpdate` is the *only* write endpoint and can insert,
  replace, style, and **delete** content. So "Read & Write" on a doc means
  full-document edit — the plan surfaces that honestly in tool annotations
  and rule UI copy, and offers a non-destructive append tool for the common
  agent case.

## 3. Design decisions (please review)

### D1 — Reuse the `drive.file` + Picker mechanism; no new OAuth scope
Same consent, same appId, same grant-recovery machinery. No Google
re-verification impact. (Alternative — request `documents` scope — rejected:
it breaks the entire FGAC premise and the CASA posture.)

### D2 — Generalize the shared plumbing instead of copy-pasting it
The Picker hook, grant check, setup/recovery page, and approval flow are
~95% file-type-agnostic. Rather than duplicating five files with `s/sheet/doc/`,
parameterize them by a small descriptor:

```ts
// src/lib/driveFileKinds.ts (new)
export type DriveFileKind = 'sheet' | 'doc';
export const DRIVE_FILE_KINDS: Record<DriveFileKind, {
  service: 'sheets' | 'docs';            // access_rules.service
  pickerViewId: 'SPREADSHEETS' | 'DOCUMENTS';
  verifyUrl: (id: string) => string;      // grant-check probe endpoint
  setupPath: string;                      // /dashboard/sheets-setup | docs-setup
  noun: string;                           // "spreadsheet" | "document"
}>;
```

Existing `sheets-*` route paths, action names, and analytics event props
**stay unchanged** (no churn for existing users/links); the docs variants
are new parameterizations of the same components. If we ever add Slides,
it's a descriptor entry, not a third copy.

*Alternative*: straight duplication (faster to review, ~5 new files with
diverged twins). I recommend generalization — the sheets grant-recovery
code has absorbed multiple field-tested fixes (grace retries, consent
round-trip params, dead-button errors) and a fork would rot.

### D3 — Rule model: `service='docs'`, no schema migration
`access_rules.service` and `actionType` are plain `text` columns. New values:
`doc_read`, `doc_read_write`, `doc_block`; `targetResourceId=<documentId>`.
Zero DDL — comment updates in [schema.ts](../../src/db/schema.ts) only.

### D4 — Curated MCP tool set (3 new tools)

| Tool | Maps to | Annotations |
|---|---|---|
| `docs_read_document` | `documents.get`, returns title + extracted plain text (+ optional raw structure flag) | readOnly |
| `docs_append_text` | `batchUpdate` / `insertText` at `endOfSegmentLocation` | write, `destructive: false` (mirrors `sheets_append_rows`) |
| `docs_replace_text` | `batchUpdate` / `replaceAllText` | write, `destructive: true` |

Everything else (styling, deleting ranges, tables) goes through
`google_api_modify` under the same per-doc rule. `documents.create` via raw
POST is auto-granted to the calling key, mirroring the `sheets_create`
posture. All defs must pass `scripts/mcp-tool-lint.ts` invariants.

*Open question for Ken*: is 3 the right curated set, or do we want a 4th
(`docs_batch_update` as a structured wrapper)? My take: no — raw passthrough
already covers it and a curated wrapper adds no policy value.

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

## 4. Work plan

### Phase 0 — Spike: prove Docs API + Picker per-file grant (½ day)
Manual/browser, QA accounts, no code merged:
1. Picker with `ViewId.DOCUMENTS` + our appId → pick a doc as USER_A.
2. `GET docs.googleapis.com/v1/documents/{id}` with the Clerk-vaulted token
   → expect 200 title/body.
3. `batchUpdate` insertText → expect 200.
4. Negative: same calls on an unpicked doc → 403/404 (confirms the grant is
   per-file, not ambient).
Record results in `docs/spike_results/`. **Gate: everything after this
phase assumes the spike passed.**

### Phase 1 — Policy core (pure, unit-testable)
- `src/lib/driveFileKinds.ts` (new) — descriptor from D2.
- [googleApiPolicy.ts](../../src/app/api/mcp/googleApiPolicy.ts):
  `classifyGoogleApiCall` gains `documents` branch → `{kind:'docs',
  documentId, isMutating}` + `{kind:'docs_create'}`; `extractDocsDocumentId`;
  generalize `sheetsApprovalAction` → `fileApprovalAction(kind, …)`.
- [approvalLinks.ts](../../src/lib/approvalLinks.ts): add `docs_expose` /
  `docs_write` actions + TTL + validation list.
- Extend `scripts/test-google-api-policy.ts` and
  `scripts/test-approval-links.ts` with docs cases.

### Phase 2 — Enforcement + MCP tools
- [route.ts](../../src/app/api/mcp/route.ts): generalize
  `checkSheetsPermission` / `withSheetsGrace` / `sheetsErrorResult` into
  kind-parameterized versions (sheets behavior byte-identical); register the
  3 `docs_*` tools; extend `request_access` enum + `get_my_permissions`
  posture text; handle `docs` / `docs_create` classes with auto-grant.
- [toolDefs.ts](../../src/app/api/mcp/toolDefs.ts): 3 new defs; update
  `google_api_get/modify` + `request_access` descriptions to name the Docs
  API; run `mcp-tool-lint`.
- [proxy route](../../src/app/api/proxy/%5B...path%5D/route.ts): service
  detection (`documents` → `docs`) + same rule enforcement as sheets there.
- Analytics: `denial_code`s `docs_not_exposed|docs_blocked|docs_read_only`,
  grace props `docs_grace_*`, keep `raw_api_family` stamping.

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
  (D4 caveat).
- [defaultProfile.ts](../../src/db/defaultProfile.ts): comment update only —
  docs are deny-by-default with no rules, same as sheets.

### Phase 5 — Docs, QA, lint
- New QA capability `docs/QA_Acceptance_Test/capabilities/19_docs_management.md`
  modeled on `09_sheets_management.md` (same picker-iframe harness notes;
  the app-API seam for post-pick assertions is `grant-docs-access`).
- Touch-ups: `10_raw_google_api.md` (documents family now enforced),
  `15_request_access_tool.md` (new request types), `17_sheets_grant_recovery.md`
  (shared component note), setup docs fixture: one QA Google Doc owned by
  USER_A.
- Agent runbooks in `docs/QA_Acceptance_Test/agents/` gain the docs
  capability; `npx tsx scripts/qa-coverage-check.ts` stays the arbiter.
- Repo docs: `user_guide.md`, `architecture_and_strategy.md` (data model),
  `connector_submission/listing_copy.md` + `mcp-registry-server.json` (tool
  list changed — connector directory listing must be resubmitted/updated).

### Phase 6 — Optional / follow-up (not in first PR)
- [partner manifest](../../src/lib/partner/manifest.ts): `'docs'` service +
  consent-screen line ("Access documents you explicitly share").
- Marketing: `use-cases/google-docs-agent` page, landing-page mention,
  `src/app/docs/page.tsx` API docs.
- Combined picker view (sheets + docs in one dialog) for the dashboard's
  generic "expose files" entry point.

## 5. Testing & rollout

- Unit: policy classification + approval-link suites (Phase 1 scripts).
- Local QA: full docs capability run + targeted re-run of sheets
  capabilities **09, 10, 14, 15, 17** — the generalization refactor touches
  their code paths, so sheets regressions are the main risk.
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
| Tool-count growth pushes connector-directory re-review | `mcp-tool-lint` invariants enforced; listing update planned as explicit follow-up |
