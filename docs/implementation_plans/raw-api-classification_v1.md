# Raw Google API Classification + Attachment Instrumentation Port — v1

Branch: `claude/raw-api-classification` (off main `0cb5c58`)

## Motivation (from 2026-08-20 analytics review)

1. **Raw API is the highest-volume tool surface (933 calls/7d) and 99.9% of it is
   unclassifiable in analytics.** `classifyGoogleApiCall` already computes the product
   (`sheets`/`docs`/`gmail_read`/`gmail_send`/`passthrough`/…) on every call, but
   `executeRawGoogleCall` only stamps analytics props on the `passthrough` (unknown
   family) and `denied` branches. The recognized branches — nearly all real traffic —
   stamp nothing, so "what Google product is being used and what action" is unanswerable.
2. **The attachment-size instrumentation never shipped.** Commit `5aa23bd`
   (`attachment_chars`/`attachment_kb` on every `gmail_get_attachment` outcome) lives
   only on the dangling branch `claude/fgac-mcp-attachment-debug-3f9974` and was never
   merged. Meanwhile the docs-branch merge generalized the idea into universal
   `response_chars`/`response_kb` — but `docs/analytics.md` and QA capability 16 already
   document the attachment props as live, so docs assert props the code doesn't emit.
   The universal props also do NOT cover the size-cap failure path: the ⚠️ over-cap
   return is a ~120-char message, losing the actual attachment size that triggered it.
3. **`client_name` is stored on `agent_connections` but never reaches events**, so the
   per-product split (Cowork / Claude Code / Claude.ai) stays unmeasurable.

## Changes

### A. Raw API product/action classification (route.ts + googleApiPolicy.ts)

- **`googleApiPolicy.ts`**: add pure `templateGoogleApiPath(rawPath: string): string` —
  returns the path with identifier segments replaced by placeholders, safe to stamp as a
  low-cardinality, PII-free analytics property. Rules:
  - strip leading slashes, query string, and fragment (same normalization as
    `classifyGoogleApiCall`);
  - a segment directly following one of the ID-parent resources
    (`spreadsheets`, `documents`, `messages`, `threads`, `drafts`, `labels`,
    `attachments`, `files`, `calendars`, `events`, `tasklists`, `tasks`, `contacts`)
    becomes `{id}`; following `values` it becomes `{range}`;
  - a `:verb` suffix on a replaced segment is preserved (`values/Sheet1:append` →
    `values/{range}:append`);
  - fallback heuristic for unknown families: any segment ≥ 25 chars, or ≥ 10 chars
    containing a digit, becomes `{id}` (versions like `v4` and words like `me` survive).
- **`route.ts` `executeRawGoogleCall`**: immediately after classification, stamp on
  EVERY raw call (including denied):
  - `raw_api_kind`: `cls.kind`
  - `raw_api_family`: `'spreadsheets'` for sheets kinds, `'documents'` for docs kinds,
    `'gmail'` for gmail kinds, `cls.family` for passthrough, omitted for denied
    (`denial_code` already identifies those)
  - `raw_api_endpoint`: `` `${method} ${templateGoogleApiPath(path)}` ``
  - `raw_api_mutating`: `method !== 'GET'`
  - the passthrough branch keeps `raw_api_passthrough: true` and drops its now-redundant
    `raw_api_family` stamp.
- No backfill is possible (raw paths were never captured — correct, they can contain
  ids); coverage starts at deploy.

### B. Port `5aa23bd` — attachment size on every outcome

In the `gmail_get_attachment` handler: compute `attachmentChars`/`approxKb` once,
`addToolCallProps({ attachment_chars, attachment_kb })` BEFORE the size-cap check, so
the props ride on success, over-cap ⚠️ failures, and (via the shared props context)
any later outcome. This matches what `docs/analytics.md:94` and QA capability 16
already claim exists. After merge, delete the stranded
`claude/fgac-mcp-attachment-debug-3f9974` branch.

### C. `client_name` on `$mcp_tool_call`

`ConnectionApproved` gains `clientName: string | null` (from
`agent_connections.client_name`); `requireApproval` stamps
`addToolCallProps({ client_name })` on success. Known limitation, documented rather than
solved here: the MCP auto-attach path stores `clientName = clientId` (opaque), so
meaningful names currently arrive only via `cli-token` registrations. Capturing the DCR
`client_name` metadata at OAuth registration is a separate follow-up; this change makes
the pipe exist so events light up as soon as storage improves.

## Tests

Extend `scripts/test-google-api-policy.ts` with `templateGoogleApiPath` cases: gmail
message/attachment ids, sheets values range with `:append` verb, docs, drive files,
calendar events, id-less list paths, query strings, %-encoded segments, and a
no-placeholder identity case (`gmail/v1/users/me/labels` — `me` follows `users`, which
is not an ID parent... note: `users` IS followed by `me`; keep `me` literal via
explicit allowlist `me` before parent-rule placeholder).

## Docs

- `docs/analytics.md`: document `raw_api_kind` / `raw_api_family` / `raw_api_endpoint` /
  `raw_api_mutating` / `client_name`; correct the attachment-props paragraph to note the
  props ship with THIS change (they were documented ahead of code).
- QA capability 16 (`16_analytics_events.md`): add an assertion that raw
  `google_api_get`/`google_api_modify` calls carry the four `raw_api_*` props with an
  id-stripped endpoint.
- QA capability 10 (`10_raw_google_api.md`): prose note pointing at capability 16 for
  the analytics expectations (no new assertion here to keep runbook scope stable).

## Validation

1. `npx tsx scripts/test-google-api-policy.ts` (all existing + new cases green).
2. `npm run lint` + production build type-check.
3. `/deploy-pr-preview` → preview URL.
4. Scoped QA: `qa-env-runner` limited to raw Google API (capability 10) + analytics
   events (capability 16) against the preview deployment — exercise `google_api_get`
   (gmail + sheets + unknown-family path), `google_api_modify`, and
   `gmail_get_attachment`, then verify via `scripts/qa-posthog-events.ts` that the new
   props (`raw_api_*`, `attachment_chars`/`attachment_kb`, `client_name`) arrive on
   `$mcp_tool_call` events in the preview environment tier.
5. `npx tsx scripts/qa-coverage-check.ts` for the touched capabilities.
