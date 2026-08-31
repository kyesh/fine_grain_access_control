# Support-issue remediation plan — v4 (PR 4: exception-based verification, minimal tokens)

Delta over v3. Only PR 4 item 1 (the docs_edit read-back enrichment) changes;
the rest of v3 stands. Motivation (Ken, 2026-08-30): keep per-call context cost
at ~zero for the common no-table, no-delete case.

## Revised docs_edit verification design (replaces v3 item 1)

Three tiers, decided per request array:

- **Tier 0 — no `deleteContentRange` in the array** (majority of edits): no
  read-back, no added output. Response is byte-identical to today. The Issue 3
  style-bleed guidance remains description-only.
- **Tier 1 — delete present AND every op has a deterministic index delta**
  (`deleteContentRange`: removes end−start; `insertText`: adds UTF-16 code-unit
  length of the text; extend the whitelist only with ops whose delta is exactly
  documented). After a successful batchUpdate, GET `?fields=body.content(endIndex)`
  (cheapest field mask that yields the final structural endIndex), compute
  expected end = before − deleted + inserted. Requires knowing the before value:
  take it from the same read-back when possible (see open question below) or a
  pre-GET.
  - Match → append the single word `verified` to the result (~3 tokens).
  - Mismatch → append the full warning block (~40 tokens): measured vs expected
    end index + "the edit may have applied partially — deletes spanning table
    boundaries can do this silently — read the document back before continuing."
- **Tier 2 — delete present but the array contains non-deterministic ops**
  (insertTable, insertSectionBreak, etc.): no expectation computed; append the
  compact line `body end: <after> (was <before>)` (~10 tokens) and let the agent
  compare. Legend lives in the tool description only.

Rules that hold across tiers:

- The write path stays byte-faithful passthrough; verification never mutates.
- Best-effort: a failed read-back never converts a successful write into an
  error — append `verification unavailable` and move on.
- Index math operates only on Google's documented request-field semantics —
  never on user content. This preserves the v3 "no interpretation" principle.
- Read-back runs inside the existing withDocsGrace window; only tiers 1–2 pay
  the extra GET (plus a pre-GET for the before-index where needed).
- Tool description documents the tiers once per session (still under the
  1500-char lint cap; docs_edit has 771 chars of headroom — draft carefully,
  the tier explanation must be compressed to a sentence or two).

Open implementation question (decide in the PR): how to obtain the *before*
endIndex for tier 1/2 — a pre-GET costs one more Google call on delete-bearing
edits only; alternatively tier 1 can verify against expected-after computed from
the requested delete range's own end bound when the delete is body-wide. Start
with the pre-GET (simple, correct), measure latency, optimize later if needed.

QA (unchanged from v3 plus): the 19_docs_management assertion should cover all
three tiers — a no-delete edit adds zero extra output, a clean delete returns
`verified`, and the table-boundary repro returns the mismatch warning.
