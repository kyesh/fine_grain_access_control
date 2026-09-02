# gmail-attachment-pagination v4 — pattern rolled out to every large-read tool

Branch: `claude/magical-montalcini-2db46e` · 2026-09-01 · delta from v3

Ken asked for the v3 windowing pattern (`offset` + `limit`, uniform
`total_chars`/`next_offset` envelope, plain-substring windows) to be applied
everywhere it makes sense, with QA to match. The adoption survey over all 19
tools:

**Adopt (6)** — unbounded read payloads:

| tool | payload windowed | notes |
| --- | --- | --- |
| `gmail_get_attachment` | base64url `data` | v3; decode once after concatenating |
| `gmail_read` | serialized parsed message | body UNtruncated when windowing — the 20k inline truncation protects the default response only; its notice now names offset/limit |
| `docs_read_document` | serialized JSON resource | v3; composes with `fields` |
| `sheets_get_spreadsheet` | serialized JSON | many-tab spreadsheets |
| `sheets_read_range` | serialized JSON | description steers to narrowing the range first |
| `google_api_get` | serialized successful response | applied post-executor; denials/errors/policy messages (⏳🚫⚠️❌) pass through whole — guidance is never sliced |

**Reject, with reasons:**

- `gmail_list`, `comments_read` — Google-native pagination already exists
  (`maxResults`/page tokens); a second windowing layer would compete with it.
- `gmail_labels`, `list_accounts`, `get_my_permissions`, `request_access` —
  small, bounded responses.
- All write tools (`gmail_send`, `sheets_update_range`, `sheets_append_rows`,
  `sheets_edit`, `docs_edit`, `comments_add`, `google_api_modify`) — write
  responses are small confirmations, and windowing one would invite
  re-issuing the write to fetch the next window, i.e. repeating the side
  effect. `google_api_modify` stays unwindowed for the same reason even
  though a few of its endpoints return sizable bodies.

Shared implementation: `windowPayload()` + `windowedResult()` in route.ts
(single envelope + out-of-range ❌, `failed` non-isError). Analytics props
unchanged from v3 (`window_offset`/`window_chars`/`window_total_chars`,
tool-agnostic).

QA capability 20 rewritten: A1 legacy paths, A2 guided ⚠️, A3 attachment
reassembly + limit honoring, A4 gmail_read untruncated body, A5 docs/sheets
envelope reconstruction, A6 google_api_get successes-only windowing, A7
out-of-range safety, A8 analytics props. Agent runbooks updated to the
adopter list.
