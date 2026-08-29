# Raw Google API error quality — google_api_modify error-rate fix

Branch: `claude/heuristic-noether-09e779`

## Problem (PostHog, trailing 7d ending 2026-08-29, production, internal excluded)

`google_api_modify` is the worst-error-rate MCP tool with meaningful volume: 115 calls,
19 tool errors (16.5%), 9 users. The Anthropic Connector Directory publishes per-tool
error rates computed from these same outcomes, so this is a public-optics issue.

Breakdown of the 19 errors:

| endpoint | errors | root cause (established from code) |
| --- | --- | --- |
| POST v4/spreadsheets (create) | 3×403, 1×400, 1×503 | 403s: token lacks `drive.file` (account connected before the scope was added / box unchecked). Sheets' gRPC-style error body carries the reason only in `error.details[]`, which `extractGoogleErrorReason` doesn't read → generic hedged text, `error_reason` null. |
| POST v4/spreadsheets/{id}:batchUpdate | 2×400 | agent request errors; Google's message passes through — OK as-is |
| POST drive/v3/files/{id}/permissions | 2×404, 1×403 | passthrough; under `drive.file` an unpicked/un-created file returns 404 even though it exists. Response says "Check the ID and try again" — wrong advice. |
| POST people/v1/people:createContact + retry POST v1/people:createContact | 2×404 | People API is routed to `www.googleapis.com` (not served there → bare 404) AND no contacts scope exists in FGAC's grant — can never work. Agent retried a path variant, doubling the error count. |
| POST slides/v1/presentations + retry POST v1/presentations | 2×404 | routing bug: passthrough sends slides to `www.googleapis.com`, which doesn't serve Slides. `drive.file` IS an accepted Slides scope — creates would succeed on `slides.googleapis.com`. |
| PATCH drive/v3/files/{id} | 1×404 | same drive.file-invisibility as permissions above |
| POST gmail/v1/users/me/messages/{id} | 1×400 | actually `messages/send` — `templateGoogleApiPath` id-strips the literal `send` segment (`{id}`), mislabeling analytics. Underlying 400 is a bad send body (error_reason 'invalid'), passes through fine. |
| null endpoint/family | 2 | raw_api_* props are stamped inside `executeRawGoogleCall`, which runs AFTER `resolveAccountAndToken` — resolution failures never get them. |

Grant surface (verified): FGAC requests only `gmail.modify` (+ legacy `mail.google.com`)
and `drive.file`. Sheets/Docs/Slides/Drive ride `drive.file` per-file. People, Calendar,
Tasks, Contacts, YouTube, Chat, Admin, Classroom, Photos can never work with this token.

## Changes

### src/app/api/mcp/googleApiPolicy.ts (pure, unit-tested)
1. **Unsupported-family pre-flight denial**: new `DenialCode` `raw_api_family_unsupported`.
   Detect known never-can-work API families (people, contacts, calendar, tasks, youtube,
   chat, admin, classroom, photoslibrary, meet, groups) in the first two path segments
   (verb-suffix tolerant, so both `people/v1/…` and `v1/people:createContact` match) and
   return a 🚫 denial naming the grant surface and saying no retry/path spelling can work.
   🚫 classifies as `denied_by_policy` — not an error in the directory metric, and honest:
   it IS a policy of the product. Denied kind gains optional `family` so demand per family
   stays visible on events (`rawApiFamily` returns it).
2. **Slides recognition**: paths containing a `presentations` segment classify as
   passthrough family `slides` (both `slides/v1/…` and bare `v1/presentations`).
   Enforcement stays scope-backstop (Slides per-file policy is the stubbed `slide` kind,
   a separate feature); with the routing fix below, creates succeed under `drive.file`.
3. **`templateGoogleApiPath`**: stop id-stripping the literal `send` subresource under
   `messages` (`messages/send` was templating as `messages/{id}`). New template value;
   historical events keep the old one.
4. **Move + extend `extractGoogleErrorReason`** here (pure parsing): also read
   `error.details[]` ErrorInfo entries (`reason`/`domain`) — the shape Sheets v4 / Docs
   v1 / Slides v1 / People v1 actually return. Fixes both the null `error_reason`
   analytics gap and the describe403 branch selection (ACCESS_TOKEN_SCOPE_INSUFFICIENT
   now reaches the SCOPE_REASONS branch → concrete reconnect advice).

### src/app/api/mcp/route.ts
5. **Host routing**: `rawUrl` gains `slides.googleapis.com` (presentations) and
   `forms.googleapis.com` (forms) branches, mirroring sheets/docs.
6. **`drive.file` scope pre-flight** (mirrors `gmailScopeDenial`): `getGoogleToken`
   computes `hasDriveFileScope` from Clerk's granted-scope list; non-gmail raw calls on a
   token that provably lacks it get a deterministic ❌ `failed` result with the one-click
   reconnect link instead of an opaque Google 403 (`failure_reason:
   'drive_file_scope_missing'`, `google_scope_missing` event gains a `scope` prop:
   `gmail` | `drive_file`).
7. **Passthrough 404 wrap**: passthrough failures with status 404 append the drive.file
   invisibility explanation ("404 does not prove the id is wrong — files never exposed to
   FGAC are invisible; do not retry; use request_access for sheets/docs, dashboard
   otherwise").
8. **Stamp raw_api_* props before account resolution**: classification+stamping moves to
   the tool handlers (helper `classifyAndStampRawCall`), so resolution failures carry
   endpoint/family too (fixes the 2 null-property events); unsupported-family denials
   short-circuit before resolution.
9. **`error_reason` fallback**: when Google's body has no reason enum, stamp the
   canonical `error.status` string (PERMISSION_DENIED, NOT_FOUND) instead of null.
10. **Docs/tool descriptions**: google_api_get/modify descriptions + server instructions
    name the supported surface (Gmail, Sheets, Docs, Slides create, Drive per-file) and
    state that People/Calendar/Tasks/etc are denied — steering agents away from probing.

### Tests / docs
- Extend `scripts/test-google-api-policy.ts`: unsupported-family variants, slides
  classification both spellings, template `send` fix, ErrorInfo-shape reason extraction.
- Update `docs/analytics.md` / `docs/monitoring.md` where they describe
  `google_scope_missing`, `error_reason`, raw_api props.

## Expected effect on the 19 errors
- 4 (people ×2, spreadsheet-create 403s pre-flightable) → clean denial/failed, not error.
- 2 (slides) → success (correct host + drive.file).
- 3–4 (drive 403/404) → still errors, but with self-arresting guidance (no retry loops)
  and correct `error_reason` for triage; scope-missing cases become pre-flight failures.
- 2 (null endpoint) → attributed.
- Remaining 400s are genuine agent request errors with passthrough messages — correct.

## Verification
PostHog re-verification of the 16.5% baseline was **blocked in this session**
(`POSTHOG_PERSONAL_API_KEY` unprovisioned everywhere; claude.ai connector not attached) —
numbers above are from the dispatching context. Post-deploy query to confirm the fix:
`$mcp_tool_call` + legacy, tool `google_api_modify`, outcome in failed/error/exception,
environment=production, internal accounts excluded, grouped by
`raw_api_family`/`raw_api_endpoint`/`denial_code` — expect people/calendar probes as
`denied_by_policy`, slides creates as success, `error_reason` populated on ≥90% of
remaining Google errors.
