# Capability 20: Attachment Reading (windows + extraction)

`gmail_get_attachment` must serve attachments of any size without dead ends:
small files keep the legacy full-base64url response, large extractable files
return windowed extracted text, and raw bytes are always reachable via
stateless base64 windows. The ⚠️ size-capped refusal survives only for
over-cap files with no text layer, stays non-`isError` (Connector Directory
error rate), and must name the continuation call.

Fixtures: send mail between USER_A and USER_B carrying (1) a small text/CSV
attachment (< 150 KB), (2) a text-bearing PDF larger than ~160 KB (over the
200k base64-char cap), and (3) any binary with no text layer (e.g. a PNG),
ideally over-cap — an under-cap binary still covers A4/A6. Standing permission
covers sending real mail between the QA accounts.

### A1: Legacy path unchanged for small attachments

Call with only messageId + attachmentId/filename on the small attachment.
Response is the full JSON `{size, data}` with base64url data — no window
metadata, no mode/offset required. Decoded bytes match the sent file.

### A2: Over-cap extractable attachment returns text, not a refusal

Default call (no mode) on the over-cap PDF. Response starts with `📎`, states
the filename, `extracted pdf text`, a `chars 0–N of TOTAL` range, and — when
TOTAL exceeds the ~50k-char window — the exact `offset:` to continue with.
Outcome is `success` (not `size_capped`), and the body contains real text from
the PDF.

### A3: Text windows continue by offset and terminate

`mode:'text'` with the offset from A2's response returns the next window with
a contiguous char range; the final window says `End of text.` instead of a
next offset. `mode:'text'` also works on the small (under-cap) attachment —
extraction is not gated on size.

### A4: Base64 windows page bytes and reassemble exactly

`mode:'base64', offset:0` on an attachment (use the over-cap PDF if fixture 3
is under-cap) returns JSON with `total_bytes`, `offset`, `bytes_returned`,
`next_offset`, and base64url `data`. Following `next_offset` until it is
`null` and concatenating the DECODED windows reproduces the original file
byte-for-byte (verify by length + a hash where the environment allows).

### A5: Non-extractable over-cap file gets a guided ⚠️, not a dead end

Default call on the over-cap binary with no text layer. Response starts with
`⚠️` (classified `size_capped`, NOT `isError`), states the size, and names the
`mode:'base64'` + `offset` continuation. If only an under-cap binary fixture
exists, assert instead that `mode:'text'` on it returns the ❌ no-extractor
guidance pointing at `mode:'base64'` — same seam, under-cap variant.

### A6: Out-of-range offset fails safe

An offset at/beyond the end (text or base64 mode) returns ❌ guidance to stop
retrying or restart from 0 — outcome `failed`, NOT `isError`, and no content.

### A7: Windowed-read analytics props land

The `$mcp_tool_call` events from A2–A4 carry `attachment_mode`/
`attachment_offset` (windowed calls), `attachment_window` (`text`/`bytes` as
returned), and for text windows `attachment_text_kind` + total
`attachment_text_chars`; A5's event carries `attachment_extract_error`.
Verify via PostHog (dev project) or server logs per the environment's
capability-16 method; skip with reason if the environment cannot observe
events.
