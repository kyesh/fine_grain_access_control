# Drive file id hardening: never mint an approval link for an id Google cannot verify (v1)

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
