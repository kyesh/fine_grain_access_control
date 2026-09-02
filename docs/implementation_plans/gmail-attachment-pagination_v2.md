# gmail_attachment-pagination v2 — validation findings (delta from v1)

Branch: `claude/magical-montalcini-2db46e` · 2026-08-31

v1 design held up in live validation (local dev server, real mailbox, manual
DCR bearer). Full matrix exercised: legacy small-file path byte-identical;
1.3 MB PDF (previously a hard ⚠️ dead end) returned its full extracted text;
text offset continuation; base64 windows over a 218 KB PNG reassembled
byte-for-byte (3 windows, PNG magic + total length verified); over-cap PNG got
the guided ⚠️ (`size_capped`, non-error); out-of-range offsets → ❌ `failed`.
PostHog dev events carried every new prop as designed.

One real defect found and fixed:

**Caller-supplied attachment ids don't resolve metadata.** Gmail re-issues
attachment ids on every parent read, so the id an agent passes routinely
matches nothing in the handler's fresh attachment list even though the fetch
it feeds succeeds. The metadata lookup then produced filename `attachment` /
unknown mime, and `mode:'text'` refused to extract a perfectly extractable
PDF. Two-part fix:

1. Metadata fallback in the handler: fresh-list match → single-attachment
   fallback → caller-filename match.
2. Content sniffing in `extractAttachmentText` for metadata-less payloads:
   `%PDF-` magic → pdf; ZIP magic under generic mime → docx only when
   `word/document.xml` exists (an xlsx/plain zip returns null, never throws);
   essentially-clean UTF-8 decode (<0.5% U+FFFD, no NULs) → text.

Unit coverage: 12 fixture cases in a scratch harness (csv, pdf by mime / by
extension / by magic alone, docx by mime / sniffed, non-docx zip, mislabeled
binary, metadata-less binary, corrupt docx throws). Not committed as a test
suite — the repo has no unit-test framework; QA capability 20 carries the
persistent assertions.
