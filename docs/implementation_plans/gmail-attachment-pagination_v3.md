# gmail-attachment-pagination v3 — caller-directed windowing (supersedes v1/v2 design)

Branch: `claude/magical-montalcini-2db46e` · 2026-09-01

Ken's review of v1/v2 redirected the design: **no server-side extraction, no
server-side guessing.** The rest of the tool surface never offers encoding
choices (`gmail_read` always returns decoded text; `format` selects detail,
not encoding), and v1's `mode: auto|text|base64` enum plus an extraction
stack (`unpdf`, `fflate`, magic-byte sniffing) was more surface than we want
to support. The v1 root-cause analysis (403s = scope lockouts, already fixed;
404 wall = one user's stale-id loop, already fixed) and demand measurements
stand unchanged.

## The pattern

One standard mechanism for ANY tool whose payload can exceed an agent's
tool-result window: the **caller** specifies which section and how much —
`offset` (chars) + `limit` (chars, server-capped at 200000) — because the
agent knows its own harness's response budget and the server does not.

- Envelope, uniform across tools: `{ offset, chars_returned, total_chars,
  next_offset, data }` (+ per-tool extras like `size`/`encoding`).
- A window is a **plain substring** of the payload, so contiguous windows
  concatenate to exactly the original string. For base64url payloads the
  agent concatenates all windows first and decodes ONCE — no alignment
  arithmetic.
- Passing either `offset` or `limit` opts into the envelope; calls without
  them are byte-for-byte unchanged (back-compat), except the pre-existing
  over-cap ⚠️ refusal on `gmail_get_attachment`, which now names the
  windowed continuation (still `size_capped`, still non-`isError`).

## Adopted by

- `gmail_get_attachment` — payload = the base64url `data` string. (Gmail's
  `attachments.get` has no partial fetch, so each windowed call re-downloads
  the body server-side; fine at observed volume.)
- `docs_read_document` — payload = the serialized JSON document resource;
  composes with the existing `fields` mask (narrow first, window if still
  big). Ken's explicit second use case.

Shared helper `windowPayload()` in route.ts; other tools can adopt the same
envelope as demand appears (`window_total_chars` distribution per tool is the
signal).

## Analytics

Windowed calls stamp `window_offset` / `window_chars` / `window_total_chars`
(tool-agnostic names — the v1/v2 `attachment_mode`/`attachment_text_*`/
`attachment_extract_error` props are gone with the extraction stack;
`attachment_chars`/`attachment_kb`/`attachment_selector`/`attachment_selfheal`
are untouched).

## QA

Capability 20 rewritten to the envelope pattern (A1 legacy, A2 guided ⚠️,
A3 attachment windows honor `limit` and reassemble byte-for-byte, A4 doc
windows reconstruct the windowless JSON, A5 out-of-range offset fails safe,
A6 window props land). Runbook sections updated in all four agents.
