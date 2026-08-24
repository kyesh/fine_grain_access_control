# Tool Discoverability — Raw-API Fallback — v2

Revision of v1 after Ken's design review (2026-08-23). v1's description/instructions
layer shipped and stands; v2 reshapes the tool surface itself instead of only
patching descriptions around it.

## What changed vs. v1 (Ken's decisions)

Grounding data (30d production `$mcp_tool_call`): `google_api_get` 964 calls,
`sheets_update_range`/`sheets_read_range` 600/595, `google_api_modify` 135 (top
mutating endpoints: Sheets `batchUpdate` 25, `values:batchUpdate` 10,
`batchClear` 8), `sheets_append_rows` 32, `gmail_send` 13, `docs_read_document`
11, **`docs_append_text` + `docs_replace_text` 9 combined**.

1. **Replace `docs_append_text` + `docs_replace_text` with `docs_edit`**
   (`documentId`, `requests[]` → `v1/documents/{id}:batchUpdate`). The
   plain-text pair saved agents nothing (they compose batchUpdate JSON
   natively), actively taught a false capability model — it caused the
   pipe-table field failure — and carried 9 calls/30d. Clients re-fetch
   `tools/list` per session, so removal doesn't strand anyone.
2. **Add `sheets_edit`** (`spreadsheetId`, `requests[]` →
   `v4/spreadsheets/{id}:batchUpdate`). The values tools stay untouched
   (1,200 calls/30d; A1 notation is genuinely simpler than GridRange), but
   structural/formatting demand is real (43 raw batchUpdate-family calls
   while undiscoverable). Template for future services: one read tool, one
   `{service}_edit` bound to the native mutation endpoint, values-style
   shortcuts only where the native simple path is meaningfully simpler
   (Sheets values; `gmail_send`'s MIME assembly).
3. **Comments: classify AND expose dedicated tools.** Doc/Sheet comments live
   in the Drive API (`drive/v3/files/{fileId}/comments[/{cid}/replies]`).
   Today those paths hit unclassified passthrough — comment writes on a
   read-only-ruled (or blocked) file sail through, bounded only by the
   `drive.file` scope. v2 closes that and adds a read/write tool pair
   (split, per the no-mixed-safety directory rule):
   - `googleApiPolicy.ts`: new `file_comments` classification kind
     (fileId + isMutating) for `drive/v3/files/{id}/comments...`;
     `drive/v3/files` listing stays passthrough (QA cap 10 A3 updated).
   - Route enforcement: resolve which service's rules mention the file id
     (docs → 'doc', sheets → 'sheet'); enforce via the existing
     `checkFilePermission` + approval-link + grant-grace machinery. No rule
     for the id at all → `file_not_exposed` denial (no mintable action —
     service unknown; message points at the picker / `request_access`).
   - `comments_read(fileId)` — Drive `comments.list` with a fixed compact
     fields mask (content, resolved, author display names, quoted anchor
     text, replies). Requires the file exposed.
   - `comments_add(fileId, content, commentId?, resolve?)` — new unanchored
     comment, or reply (optionally `action: 'resolve'`). Requires Read &
     Write. Anchored/positional comments are out (Drive's anchor format is
     opaque for Docs/Sheets editors); stated in the description.

Resulting catalog (19 tools): list_accounts, gmail_list, gmail_read,
gmail_get_attachment, gmail_send, gmail_labels, sheets_get_spreadsheet,
sheets_read_range, sheets_update_range, sheets_append_rows, sheets_edit,
docs_read_document, docs_edit, comments_read, comments_add, google_api_get,
google_api_modify, request_access, get_my_permissions.

## Follow-ups deliberately out of scope

- `google_api_discover` (deferred in v1, unchanged).
- Other `drive/v3/files/{id}` subresources (`export`, `alt=media` content,
  `revisions`) have the same rule-bypass shape as comments for ruled files;
  they stay classify-don't-block passthrough for now — flagged for a
  dedicated pass since export semantics (read of full content) deserve the
  same read-rule treatment.

## Mechanical change list

- `toolDefs.ts`: drop 2 defs, add 4 (docs_edit, sheets_edit destructive:true;
  comments_read readOnly; comments_add destructive:false); retarget values
  tools' redirect sentences to `sheets_edit`; docs/sheets `_edit` +
  read tools cross-reference comments tools and `google_api_modify`
  (creation).
- `mcp-tool-lint.ts`: fallback-reference map updated (values tools →
  sheets_edit; docs_edit/sheets_edit → google_api_modify; gmail trio
  unchanged).
- `route.ts`: register new tools; delete old handlers; `resolveCommentFileKind`
  helper + comments handlers with grace/denial links; `file_comments` branch
  in `executeRawGoogleCall`; server `instructions` + `list_accounts.next_steps`
  updated to the new names; sheets values `fgac_hint`s retarget to sheets_edit.
- `googleApiPolicy.ts`: `file_comments` kind + extractor + `rawApiFamily`
  mapping (`drive_comments`); tests extended in
  `scripts/test-google-api-policy.ts`.
- Docs sweep: `distribution_architecture.md` (lists + discoverability note),
  `architecture_and_strategy.md` mention, `src/app/docs/page.tsx` tool tables,
  `connector_submission/listing_copy.md`, QA capability 19 (docs tool renames,
  A8), capability 10 (A3 comments carve-out, A10 tool list), runbooks
  `agents/01`/`agents/04` tool mentions.
- QA: capability 19 gains comment assertions (read on exposed file; add
  denied at read-only; add succeeds at R&W; raw comments path classified,
  never `raw_api_passthrough` for ruled files).

## Validation

Same as v1 (mcp:lint, policy tests, tsc, preview deploy, authed
initialize/tools-list probe) plus policy-test cases for the comments
classification.
