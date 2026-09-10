# Drive file id hardening: never mint an approval link for an id Google cannot verify (v3)

Branch: `claude/quizzical-lamport-f146fd` · Date: 2026-09-09 · Base: main @ 4594040 (PR #128)

## Problem

Verified locally 2026-09-08 (main @ e60a8f7): `docs_read_document` called with
`<realId>/edit` — what an agent pastes from a Docs URL — and with a junk
44-character string both returned "🚫 Access Denied: Document '<id>' is not
exposed…" **plus a live approval link** (`r=<id>%2Fedit`). `checkFilePermission`
looked the literal value up in `access_rules`, found nothing, and
`policyDenialWithLink` minted a deterministic `docs_expose` link for it. Such a
link can never verify with Google (the Picker shows a substitution at best), so
the user gets a dead end that looks like a one-click approval, and the request
ledger records demand for a file that does not exist.

Production ids in the week to 2026-09-08 were all well-formed 44-character ids,
so this is hardening, not the cause of the docs_expose conversion gap
(`claude_busy-jang-032d40_v1`).

## Change

1. **`parseDriveFileId(raw, expected)`** in `src/app/api/mcp/googleApiPolicy.ts`
   (pure, unit-testable). Accepts, in order: a bare id
   (`[A-Za-z0-9_-]{20,80}`, deliberately loose — a false rejection strands a
   real call, a well-formed-but-unknown id just takes the ordinary not-exposed
   path); a full URL (`…/d/<id>/edit?usp=…`, `drive.google.com/open?id=<id>`)
   with the id extracted; `<id>/edit`, `<id>?usp=…`, `<id>#gid=0`, `/d/<id>/edit`
   residue with the id extracted. Anything else is `file_id_malformed`; a URL
   whose path names the other product (a spreadsheets URL as a `documentId`) is
   `file_id_wrong_kind` — minting a docs link for a sheet id is the same dead
   end, since the Documents Picker view never lists the sheet. Both refusals are
   🚫 text naming the expected shape (and, for wrong-kind, the right tools and
   the extracted id). Extraction is preferred over refusal wherever the intent is
   unambiguous.
2. **`resolveDriveFileId(kind, raw)`** in `route.ts`, called at every per-file
   entry point *before* the rule lookup: the five typed sheets tools, the two
   docs tools, the two comments tools, the raw Sheets/Docs/comments branches of
   `google_api_get` / `google_api_modify`, and `request_access` (both file
   types). It replaces the caller's variable with the normalized id (so the
   Google fetch, the `file_id` stamp, and the link action all use the bare id)
   or returns the refusal with `denial_code` stamped and **no** link. Placed at
   the call sites rather than inside `checkFilePermission` because the callers
   forward the id to Google and into the link action — the lookup key alone is
   not enough. Two-to-three lines per site keeps the diff surgical.
3. **Analytics**: new `DenialCode` members `file_id_malformed` and
   `file_id_wrong_kind`; new `$mcp_tool_call` prop `file_id_input`
   (`url` / `suffixed` on extraction, `malformed` on refusal, absent for a bare
   id). Outcome stays `denied_by_policy` (🚫 prefix). These are caller-data
   errors like stale-id 404s, which stay ❌, but the same inputs were already 🚫
   (`*_not_exposed`) before this change, so keeping 🚫 moves nothing in the
   public rate; `denial_code` is what separates them from real not-exposed
   demand.
4. **Tool schema copy**: `spreadsheetId` / `documentId` descriptions on the two
   primary read tools and `request_access` now say a full URL is accepted.
5. **Tests**: `scripts/test-drive-file-id.ts` (46 cases), wired into `mcp:lint`
   right after `test-google-api-policy.ts`.
6. **Docs**: `docs/analytics.md` (denial codes + `file_id_input`),
   `19_docs_management.md` A6 (extended), `09_sheets_management.md` A11 (new).

## Non-goals

No schema change (no `db:branch` needed for schema). No change to
`checkFilePermission`'s rule matching, to link determinism, or to the approve
page. Comments tools never minted a link for an unknown id, but they now accept
URL-shaped ids for exposed files rather than denying them as not-exposed.

## Validation plan

- `npm run mcp:lint`, `tsc --noEmit`, eslint on changed files.
- Local (dev server + a QA bearer, via a runner): the A6/A11 matrix —
  `<id>/edit`, full URL, junk, wrong-product URL — through `docs_read_document`,
  `sheets_get_spreadsheet`, `request_access`, and a raw `v4/spreadsheets/abc123`
  path; assert link/no-link, `r=<id>` never `r=<id>%2Fedit`, and no
  `approval_requests` row for refusals.
- Preview via `/deploy-pr-preview`; same matrix against the preview URL.

## v2 — validation results

PR: https://github.com/kyesh/fine_grain_access_control/pull/129 · Preview (commit 9515e48):
https://fine-grain-access-control-1in6p0trc-kenyesh-gmailcoms-projects.vercel.app

**Static:** `npm run mcp:lint` (incl. `test-drive-file-id.ts`, 46 cases), `tsc --noEmit`,
eslint — all clean.

**Local (dev server on the `claude-quizzical-lamport-f146fd` Neon branch, USER_A via a
DCR-minted bearer, built-in browser only — no Google chooser, no password prompt):
17/17 PASS** on the A6/A11 matrix (synthetic unexposed ids):

| calls | input form | seen |
| --- | --- | --- |
| 1, 6, 12 | bare id (docs, sheets, raw `v1/documents/<id>`) | `*_not_exposed` + deterministic link, `r=<id>` |
| 2, 3, 7, 8, 13 | `<id>/edit`, `<id>/edit#gid=0`, full Docs/Sheets URL, `request_access` with `<id>/edit` | byte-identical denial and the SAME link as the bare id; `%2Fedit` in no link |
| 4, 9, 11, 14, 16 | junk (`not-a-real-id`, `Q3 Budget`, raw `v4/spreadsheets/abc123`, `request_access` junk, `comments_read abc`) | 🚫 `file_id_malformed` naming the 20–80-char shape; no `http` anywhere in the response |
| 5, 10, 15 | wrong-product URL (Sheets URL as documentId and vice versa, incl. `request_access`) | 🚫 `file_id_wrong_kind` naming the right tools and the extracted id; no link |
| 17 | `comments_read` `<id>/edit` | denied by the bare id, no link (comments never mint) |

Ledger (read-only SELECT): one `docs_expose` row for the DOC target with
`mint_count=5` (calls 1, 2, 3, 12, 13) and one `sheets_expose` row with
`mint_count=3` (calls 6, 7, 8); no row coincides with any refused call.

PostHog (`$mcp_tool_call`, project 343912, same hour): `file_id_malformed` ×5 and
`file_id_wrong_kind` ×3 across the five tools, all with `approval_request_id`
null; normalized-then-denied rows carry `file_id_input=suffixed|url` and the
ledger request ids; bare-id rows carry no `file_id_input`.

**Preview (commit 9515e48, USER_A via a DCR-minted bearer against the preview,
built-in browser only): 18/18 PASS** — the 17 API calls above with identical
outcomes, plus opening the docs link as USER_A: the approve page renders
"read-only access to document <bare id>" (never `/edit`), a `docs_expose`
grant, and the Picker step (nothing clicked). PostHog separates the runs on
`environment` (`development` vs `preview`), 14 file-id rows each, same
per-tool/code breakdown; the `$host` / `$current_url` props are absent on
these server-side events.

Pre-existing preview quirk, not from this change: links minted on a preview
point at the production dashboard host (`DASHBOARD_URL` is env-configured),
while the request row lives only in the preview Neon branch — the runner
opened the same path on the preview host instead.

Runner note (recipe drift, not an app bug): the OAuth protected-resource
document is served at `/.well-known/oauth-protected-resource/mcp` (advertised in
the 401 `WWW-Authenticate: resource_metadata`), not at the bare path.
