# gmail_get_attachment: 403 root cause + large-attachment reading

Branch: `claude/magical-montalcini-2db46e` · Plan v1 · 2026-08-31

## Part 1 — Root cause of the Aug 24–26 error wall (no new code needed)

Production data (PostHog `$mcp_tool_call`, external users only, Aug 20–31):

| finding | evidence |
| --- | --- |
| The Aug 25–26 "wall" was overwhelmingly ONE user's stale-attachment-id 404 retry loop | 9 of 10 Aug-25 errors and 26 of 27 Aug-26 errors are 404s from a single user (~30 errors in one 3-minute burst on Aug 26, same client). Their `gmail_read` failures the brief flagged (9 errors + 2 failed on Aug 26) are 404s from the same loop, not grant failures. All rows predate the PR #94 self-heal props (`attachment_selector`/`attachment_selfheal` absent). |
| The 403s are a *different, tiny* population: 2 events, 2 users, both grant-level | User A: 403 on `google_api_get` (05:26) then `gmail_get_attachment` (07:33) on Aug 24 — two different tools hours apart. User B: `list_accounts` (no Google call) succeeds at 20:40 Aug 26, `gmail_get_attachment` 403s at 20:41; next morning `gmail_list` 403s twice. Cross-tool + cross-day persistence rules out attachment ids, mid-session token expiry, and rate limiting. |
| Cause: Google grant missing the Gmail scope (granular-consent checkbox left unchecked) | The token fetch itself succeeded (calls reached Google; no `google_token_error` / `failure_reason` on the rows), so the token was valid but under-scoped → Google 403s every Gmail call. Exactly the failure mode commit `5d66331` ("pre-flight Gmail scope check stops per-user 403 lockouts", Aug 28) diagnosed on `gmail_list` and fixed. |
| The self-heal deploy did NOT fix the 403s — and didn't need to | Both 403 users have zero events after Aug 27; they left before the Aug-28 scope preflight deployed. The daily collapse (43→6 calls, 31→0 errors) = the 404-loop user churning (volume) + self-heal absorbing stale ids (Aug 27) + scope preflight reclassifying 403 lockouts into guided non-error denials (Aug 28). `google_scope_missing` events confirm the preflight is live and catching a real population (6 users Aug 30, 8 users Aug 31). |

**Conclusion:** the 403 class already has its fix in production (`5d66331` + `bbc51ff`
error-reason stamping, which will make any future 403 self-describing via
`error_reason`). No further token-path code is implied. Part 2 addresses the one
remaining hard dead end: the size cap.

## Part 2 — Large attachments: measured demand

`outcome='size_capped'` Aug 1–31 (external): **11 events, 5 distinct users**. Sizes:
215, 256, 263, 277, 285, 323, 330, 331 KB (8 rows barely over the ~150 KB cap) and
1.8 MB, 13 MB, 17.5 MB (3 rows). One currently-active user hit the cap 5× on
Aug 29–31 (256–331 KB) — live demand, not just the churned power user.

Gmail API constraint (verified against current reference docs):
`users.messages.attachments.get` takes only path params and returns the full
`MessagePartBody` — **no Range/partial/paged download exists**. Any windowing is
server-side.

## Part 2 — Options

- **(a) Chunked base64 windows** — ACCEPT as fallback. Stateless `offset` on decoded
  bytes; server re-fetches the full body per call (unavoidable, see constraint).
  Cheap, but base64 is token-hostile: even one 75 KB window ≈ 25k tokens, and
  "read a 300 KB PDF" via base64 chunks costs ~100k+ tokens of garbage to the agent.
  Kept for genuine byte access, not as the primary read path.
- **(b) Server-side text extraction, windowed** — **PRIMARY**. Nearly all observed
  usage intent is "read the attachment". A 300 KB PDF is a few thousand words; a
  13 MB text-bearing PDF still returns a readable window. Serves BOTH modes of the
  measured distribution. Cost: `unpdf` (serverless pdf.js) + `fflate` (docx unzip),
  dynamic-imported; CPU ≪ 1 s at observed volume (≤ ~5 capped calls/day).
- **(c) Raise cap / return head** — REJECT for raw base64: the head of a compressed
  binary is useless, and today's 200k-char cap already exceeds some clients'
  tool-result budgets (Claude Code ~25k tokens), so a raise makes silent client-side
  rejection MORE likely. The "head" idea survives as the first extracted-text window.
- **(d) Drive hand-off** — REJECT for now: most accounts lack the `drive.file` grant
  (scope preflight data), and it turns a read into a cross-service write. Revisit if
  non-extractable binary demand materialises.

## Part 2 — Design (behind the existing tool)

New optional params: `mode: 'auto'|'text'|'base64'` (default `auto`),
`offset: int ≥ 0` (default 0).

| case | behavior |
| --- | --- |
| `auto`/`base64`, offset 0, fits cap | UNCHANGED: full base64url JSON (back-compat) |
| `text` (any size) | extract text (PDF / docx / text-family mime+ext) → window of 50k chars, header states char range, total, and next offset; outcome `success` |
| `auto`, over cap or offset > 0 | try extraction → text window; no extractor → base64 byte window (offset > 0) or ⚠️ size_capped with paging guidance (over cap, offset 0) |
| `base64`, over cap or offset > 0 | decoded-byte window [offset, offset+75 000), re-encoded base64url, with `total_bytes`/`next_offset`; outcome `success` |
| offset ≥ size | ❌ guidance (outcome `failed`, non-isError) |
| extraction throws / unsupported in `text` mode | ❌ guidance pointing at `mode:'base64'` (outcome `failed`, non-isError) |

The ⚠️ size_capped refusal keeps its prefix and non-isError classification (directory
error rate untouched) but is no longer a dead end — it names the continuation call.

Analytics: `attachment_mode`, `attachment_offset`, `attachment_text_kind`
(`pdf|docx|text`), `attachment_text_chars`, `attachment_extract_error`
(`unsupported|failed`), `attachment_window` (`text|bytes`). Existing props unchanged.

New lib: `src/lib/attachmentText.ts` (`extractAttachmentText`). Deps: `unpdf`,
`fflate` (both dynamic-imported inside the extractor).

## QA

New `capabilities/20_attachment_reading.md` (assertions A1–A7: back-compat, text
windows + continuation, byte windows reassemble byte-identical, capped-refusal
guidance + classification, offset validation, analytics props), listed in
`capabilities/README.md` and referenced from the four `agents/` runbooks, mirroring
how capability 19 was added. `scripts/qa-coverage-check.ts` picks the file up
automatically. `capabilities/16_analytics_events.md` prop table gains the new props.

Tool description stays within the 1500-char `scripts/mcp-tool-lint.ts` budget.
