# Support-issue remediation plan — v6 (PR 4: final docs_edit description, verbatim)

Delta over v5. Supersedes v5's "description addition" section: the whole
docs_edit description is REPLACED with the approved condensed rewrite below
(Ken, 2026-08-30 — Haiku-condensed variant with "replace every occurrence"
restored). Per-call verification strings and tier design unchanged (v4/v5).

## Final docs_edit description (src/app/api/mcp/toolDefs.ts:111) — use verbatim

Apply Google Docs batchUpdate requests to edit documents — insert or delete text, tables, text styles, headings, images, page breaks, and positional content (https://developers.google.com/docs/api/reference/rest/v1/documents/batchUpdate). Examples: append text {"insertText":{"endOfSegmentLocation":{},"text":"..."}}, insert 3x3 table {"insertTable":{"rows":3,"columns":3,"endOfSegmentLocation":{}}}, or replace every occurrence {"replaceAllText":{"containsText":{"text":"old","matchCase":true},"replaceText":"new"}}. Requires Read & Write FGAC access. Doc comments live in Drive API — use comments_read / comments_add. Create new documents with google_api_modify (POST v1/documents). Inserted text inherits the target paragraph's style; add updateParagraphStyle NORMAL_TEXT sweep when replacing body content. Deletes are auto-verified: response ends with "verified" or returns a warning plus the actual end index if a delete applied only partially (ranges crossing table boundaries may do this despite success).

(1012 chars — under the 1500 cap in scripts/mcp-tool-lint.ts:37. Note this
replaces the existing description rather than appending; mcp:lint must still
pass its other invariants — title, destructiveHint, no behavioral-instruction
phrasing flags.)
