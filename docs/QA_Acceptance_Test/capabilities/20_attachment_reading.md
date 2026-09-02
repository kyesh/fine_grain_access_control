# Capability 20: Windowed Large Responses

Every read tool whose payload can exceed an agent's tool-result window
supports caller-directed windowing: `offset` + `limit` (chars), a uniform
envelope (`total_chars`, `next_offset`, `chars_returned`, `data`), and
windows that are plain substrings — contiguous windows concatenate to exactly
the original payload. The agent sizes windows to its own harness's budget;
the server never guesses or transforms.

Adopters and their payloads:

| tool | windowed payload |
| --- | --- |
| `gmail_get_attachment` | the base64url `data` string (decode ONCE after concatenating) |
| `gmail_read` | serialized parsed message, body UNtruncated (the default 20k inline truncation is bypassed when windowing) |
| `docs_read_document` | serialized JSON document resource (composes with `fields`) |
| `sheets_get_spreadsheet` / `sheets_read_range` | serialized JSON response |
| `google_api_get` | the serialized successful response; denials/errors/policy messages pass through whole |

Not adopted, by design: tools with native upstream pagination (`gmail_list`,
`comments_read` — Google page tokens), small bounded reads (`gmail_labels`,
`list_accounts`, `get_my_permissions`), and ALL write tools (`gmail_send`,
`sheets_update_range`/`append_rows`/`edit`, `docs_edit`, `comments_add`,
`google_api_modify`) — windowing a write's response would invite re-issuing
the side effect to fetch the next window.

Fixtures: a message with a small attachment (< 150 KB), one with an
attachment > 160 KB (over the 200k base64-char cap), and a long-bodied
message (> 20k chars body) in the QA mailbox — send between USER_A/USER_B
under the standing permission if absent; plus the QA-exposed sheet and doc
from setup.

### A1: Legacy paths unchanged when no window params are passed

`gmail_get_attachment` on the small attachment returns the full `{size,
data}` JSON (decoded bytes match the sent file). `gmail_read` on the
long-bodied message returns the parsed view with the 20k body truncation
notice, which names the offset/limit continuation. Windowless
`docs_read_document` / sheets reads return their raw resources.

### A2: Over-cap attachment without window params → guided ⚠️, non-error

`gmail_get_attachment` on the over-cap attachment with no offset/limit.
Response starts with `⚠️` (classified `size_capped`, NOT `isError`), states
the size, and instructs the windowed continuation.

### A3: Attachment windows honor limit and reassemble byte-for-byte

On the over-cap attachment, call with `offset: 0` and a chosen `limit`
(e.g. 100000), follow `next_offset` to `null`. Each response carries the
envelope; `chars_returned` ≤ limit; a limit above 200000 is capped to 200000.
Concatenating the `data` strings in offset order and base64url-decoding the
result once reproduces the original file (verify length + hash where the
environment allows).

### A4: gmail_read windows expose the untruncated body

`gmail_read` with `offset`/`limit` on the long-bodied message: following
`next_offset` to the end and concatenating yields parseable JSON whose `body`
contains the full text — longer than 20k chars, with no truncation marker.

### A5: Docs and sheets reads window the same envelope

`docs_read_document` (QA doc) and `sheets_read_range` (QA sheet) with
`offset`/`limit` return the envelope over their serialized JSON; following
`next_offset` and concatenating reconstructs byte-identical JSON to the
windowless read. (`sheets_get_spreadsheet` shares the identical seam — spot
check one envelope response.)

### A6: google_api_get windows successes only

`google_api_get` with `offset`/`limit` on an allowed Gmail read path (e.g.
`gmail/v1/users/me/messages/<id>?format=full`) returns the envelope over the
raw response. The same params on a DENIED path (e.g. a batch endpoint) return
the denial text whole — never a windowed slice of it.

### A7: Out-of-range offset fails safe

An `offset` at/beyond `total_chars` (any adopter) returns ❌ guidance to stop
retrying or restart from 0 — outcome `failed`, NOT `isError`, no data.

### A8: Windowing analytics props land

The `$mcp_tool_call` events from A3–A6 carry `window_offset`,
`window_chars`, and `window_total_chars`; A2's event carries
`attachment_chars`/`attachment_kb` and `outcome = size_capped`. Verify via
PostHog (dev project) or server logs per the environment's capability-16
method; skip with reason if the environment cannot observe events.
