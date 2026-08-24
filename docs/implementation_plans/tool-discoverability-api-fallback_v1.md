# Tool Discoverability — Raw-API Fallback — v1

Branch: `claude/tool-discoverability-api-fallback-1766ee` (off main `1cab522`)

## Motivation

Feedback session 2026-08-23 (`FGAC-mcp-tool-strategy.md`, external strategy doc): an
agent asked to put a table in a Google Doc loaded `docs_append_text` /
`docs_replace_text`, read descriptions that mention no alternative, concluded "plain
text only," and shipped a pipe-character text table — while `google_api_modify`
(Docs `batchUpdate`, full table/styling support) sat unused. Agents consume tool
catalogs as paths, not lists: task → first plausible tool → stop looking. Nothing at
any decision point referenced the raw-API fallback.

Compounding it, an audit for this change found the raw-pair **descriptions are stale
— they understate what is actually allowed**, in ways that are directory-compliance
problems in their own right (descriptions must "precisely match actual functionality"):

- `google_api_get` says "other Google APIs and batch endpoints are denied" — but
  since the 2026-08-19 classify-don't-block posture change, unknown families
  (Drive, Calendar, …) are **forwarded** with the account token, with Google's OAuth
  scopes as the backstop (QA capability "raw google api" A3).
- `google_api_modify` says "Allowed writes: … Sheets value updates/appends" — but
  every Sheets write endpoint on a Read & Write spreadsheet passes classification,
  including `:batchUpdate` (formatting, charts, sheet management). It also omits
  Docs/Sheets **creation** (`POST v1/documents`, `POST v4/spreadsheets`), which is
  allowed and auto-granted (capability A9 / docs A10), and omits unknown-family
  write passthrough.
- Same staleness in `docs/distribution_architecture.md` ("spreadsheet creation …
  and every other Google API are denied", docs tools missing from the tool lists),
  `src/app/docs/page.tsx` blurbs, and
  `docs/connector_submission/reviewer_runbook.md` (tells the Anthropic reviewer
  `drive/v3/files` demonstrates deny-by-default — it now demonstrates passthrough).

## Decision vs. the strategy doc's three layers

Evaluated against the Anthropic directory policy (descriptions narrow/accurate,
`readOnlyHint`/`destructiveHint`/`title` required, token frugality, and — per
review practice — **auto-reject for any tool mixing safe and unsafe HTTP methods**,
which `scripts/mcp-tool-lint.ts` already encodes):

- **REJECTED — Layer 1 as proposed** (per-service `docs_api`/`gmail_api`/… tools
  with a `method` param). Each would mix GET with POST/PUT/PATCH — the exact
  auto-reject shape the current `google_api_get`/`google_api_modify` split was
  built to avoid. Splitting each service into a get/modify pair would roughly
  double the catalog and rename tools out from under live directory users, for a
  benefit (service-named search bait) that description keywords + redirects
  deliver without churn. **Keep the raw pair; move Layer 1's payload (capability
  keywords, worked example, cross-API notes) into its descriptions.**
- **ADOPTED — the discoverability payload, at every decision point**:
  1. Accurate, keyword-rich raw-pair descriptions with a worked `batchUpdate`
     example and the real access model (passthrough + creation + auto-grant).
  2. A redirect sentence at the end of every typed convenience tool that has a
     raw superset (`docs_append_text`, `docs_replace_text`, `sheets_update_range`,
     `sheets_append_rows`, `gmail_send`, `gmail_list`, `gmail_read`).
  3. MCP server `instructions` block (supported by `mcp-handler`'s
     `ServerOptions`; currently unset) stating the typed-tools-are-shortcuts /
     raw-pair-is-the-full-surface model and the denial → approval-link pattern.
  4. Result-level hints (`fgac_hint`) on typed write-tool successes — read
     mid-task, exactly when the limitation bites.
  5. `list_accounts.next_steps` and `get_my_permissions.defaults` gain raw-API
     entries (both are already agent-facing orientation surfaces).
  6. Lint enforcement: convenience tools must reference their raw fallback, so
     the typed layer stays capped-with-redirects on every future commit.
- **DEFERRED — Layer 2 (`google_api_discover`)**: in-band endpoint lookup via
  Google's Discovery Service is genuinely novel and worth building, but it is new
  engineering (fetch + filter + cache multi-MB discovery docs, token-frugal
  output shaping) and expands the directory-listed catalog. The redirects above
  fix the observed failure without it. Proposed as a follow-up branch; its
  descriptions slot ("Unsure of the endpoint? …") gets added when it exists.

## Changes

1. **`src/app/api/mcp/toolDefs.ts`** — rewrite `google_api_get` /
   `google_api_modify` descriptions (accurate access model, capability keywords,
   worked Docs `insertTable` example, Gmail raw-MIME note, creation + auto-grant,
   scope-backstopped passthrough, batch/DELETE exclusions); append redirect
   sentences to the seven convenience tools listed above.
2. **`src/app/api/mcp/route.ts`** —
   - `instructions` block in the `createMcpHandler` server options;
   - `fgac_hint` on success payloads of `docs_append_text`, `docs_replace_text`,
     `sheets_update_range`, `sheets_append_rows`;
   - `raw_api` entry in `list_accounts.next_steps`; `rawApi` line in
     `get_my_permissions.defaults`.
3. **`src/app/api/mcp/googleApiPolicy.ts`** — fix the stale "deny-by-default /
   everything else is refused" header comment (contradicts the passthrough code
   it sits above).
4. **`scripts/mcp-tool-lint.ts`** — new invariants: (8) convenience tools must
   name their raw fallback tool in the description; (9) description length cap
   (token frugality guard).
5. **Docs** — `distribution_architecture.md` Hosted MCP Tool Surface section
   rewritten (complete tool lists incl. docs tools, current raw posture,
   discoverability-layer note); `src/app/docs/page.tsx` raw-pair blurbs updated;
   `reviewer_runbook.md` drive-passthrough note corrected; QA capability
   `10_raw_google_api.md` A1 updated + new A10 (instructions + redirect + hint
   assertions).

## Validation

- `npm run mcp:lint` (new invariants included) + `npm run lint` + `npx tsx
  scripts/test-google-api-policy.ts` locally.
- `tools/list` + `initialize` inspected against a local dev server (or the PR
  preview via `/deploy-pr-preview`) to confirm descriptions/instructions land.
- QA capability "raw google api" re-run scoped to A1/A10 on the preview before
  merge.
