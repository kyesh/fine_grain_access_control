# Support-issue remediation plan — v3 (PR 4 rescoped: no composite docs tool)

Delta over v2. Only PR 4 (Issues 2+3) changes; everything else stands as of v2.

## Design decision (Ken, 2026-08-30): no meta tools that reinterpret content

FGAC tools stay direct passthroughs to the Google APIs. A `docs_replace_body`
that accepts structured/plain-text content would make FGAC own a content format
and its translation into batchUpdate requests — an interpretation surface we do
not want (every markdown/table/list edge case becomes our bug instead of
Google's documented behavior). The reporter's suggested composite tool is
declined; the support reply should explain this rationale.

Principle for future tools: input is native Google request shapes, output is
Google's verbatim response — optionally enriched with *verifiable facts*
(indices, ids, counts) clearly separated from Google's payload. FGAC never
returns its own rendering of user content.

## Revised PR 4 scope

1. **Read-back enrichment on `docs_edit`** (`src/app/api/mcp/route.ts:2104-2128`):
   when the request array contains structural ops (`deleteContentRange`,
   `insertText`, and similar), follow the successful batchUpdate with one
   `GET ?fields=body.content` and append neutral facts to the response — e.g.
   `{ body_end_index_after, body_end_index_before? }` — alongside Google's
   verbatim reply. No intent inference: the agent compares indices itself.
   Implementation notes: reuse `docsFetch` (`route.ts:843`); the extra GET runs
   inside the existing `withDocsGrace` window; keep it best-effort (a failed
   read-back never converts a successful write into an error — report
   `verification: 'unavailable'` instead). Decide during implementation whether
   before-index capture is worth the second GET or whether after-only suffices.
   Consider the same enrichment for the raw path (`executeRawGoogleCall`,
   `route.ts:1528-1535`) only if cheap; the typed tool is the priority.
2. **Description updates** (`toolDefs.ts:108-114`, 771 chars of headroom):
   - deletes spanning table boundaries can partially apply while returning 200 —
     read back or delete per-segment;
   - `insertText` inherits the landing paragraph's named style — include an
     explicit `updateParagraphStyle NORMAL_TEXT` sweep when replacing body
     content.
   Keep under the 1500-char lint cap (`scripts/mcp-tool-lint.ts:37`); do not
   touch `google_api_modify` (11 chars free).
3. **QA**: controlled repro of the table-boundary partial delete (needed to pin
   Google's exact semantics before trusting the description text), plus a new
   `### A<n>:` assertion in
   `docs/QA_Acceptance_Test/capabilities/19_docs_management.md` covering the
   read-back facts appearing in the `docs_edit` response.

Dropped from v1/v2: the `docs_replace_body` tool, its lint fallback entry, tool
inventory/doc updates, and the `initialize` instructions change.

Issue 4 (comment anchoring) handling unchanged: no build, honest reply. The
optional `quotedText`-prefix middle ground from v1 is now also declined under
the same principle (it would inject FGAC-authored formatting into user
content); the reply should point agents at including the quote in their own
comment text if they want it.
