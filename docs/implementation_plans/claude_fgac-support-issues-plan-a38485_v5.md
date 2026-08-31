# Support-issue remediation plan — v5 (PR 4: final approved copy for docs_edit)

Delta over v4. Pins the exact user-approved wording (Ken, 2026-08-30) for the
docs_edit description addition and the per-call verification strings. Design
(tiers, best-effort rules) unchanged from v4.

## Description addition (append to docs_edit in src/app/api/mcp/toolDefs.ts:111)

> Two caveats: inserted text inherits the style of the paragraph it lands in —
> add an updateParagraphStyle NORMAL_TEXT sweep when replacing body content.
> Edits containing deletes are auto-verified: the response ends with
> "verified", or a warning plus the document's actual end index when a delete
> applied only partially (ranges crossing table boundaries can do this despite
> a success reply).

~350 chars on top of the current ~700; well under the 1500 lint cap
(scripts/mcp-tool-lint.ts:37). Do not restate the tier mechanics in the
description — the two sentences above are the entire budget.

## Per-call appended strings (exact copy)

- Tier 0 (no deleteContentRange): nothing appended.
- Tier 1 match: `verified`
- Tier 1 mismatch: `body end <after>, expected <expected> — delete may have
  partially applied; read the document back.`
  (No "why" clause per-call — the table-boundary explanation lives in the
  description only.)
- Tier 2 (non-deterministic ops present): `body end <after> (was <before>)`
- Read-back failure: `verification unavailable`
