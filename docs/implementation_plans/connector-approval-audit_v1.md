# Anthropic Connectors Directory — FGAC MCP Audit & Submission Plan (v1)

Branch: `claude/connector-approval-audit-4bf125` · Date: 2026-07-27

Research sources: official Claude docs (submission page, pre-submission checklist /
review criteria, authentication, Software Directory Policy) plus firsthand accounts
(joeir.substack.com, sunpeak.ai, Tallyfy, TheTechDude on Medium). Full source list at
the bottom.

## How the process works (2026)

- Submission happens in the **Claude.ai submission portal** (`claude.ai/admin-settings/directory/submissions/new`).
  It requires a **Team or Enterprise Claude organization**; only Owners (or Enterprise
  custom roles with Directory management) can submit. The portal walks through 11 steps:
  Connection → Tools → Listing → Use cases → Company → Authentication → Data handling →
  Test & launch → Compliance (7 acknowledgments) → Review.
- On submit, an **automated policy scan** runs and, if passed, the server lists as a
  **community connector**. Anthropic may escalate popular listings to **verified review**
  (human reviewers functionally test every tool). Same criteria apply either way.
- **Timelines are unpublished.** Community reports range from ~2 weeks to months; a
  resubmission goes to the back of the queue, so one missing checklist item costs ~a week+.
  Escalations: `mcp-review@anthropic.com`.
- The connector keeps working as a **custom connector** the whole time — the directory
  adds discovery, not functionality.

## Hard requirements (each missing item = rejection)

1. Every tool: `title` + `readOnlyHint: true` (reads) or `destructiveHint: true` (writes).
2. No catch-all tool mixing safe and unsafe HTTP methods (`api_request` with a `method`
   param is called out by name as an automatic rejection).
3. OAuth 2.0 with PKCE S256; DCR or CIMD or Anthropic-held credentials; token endpoint
   accepts `application/x-www-form-urlencoded`; 401 + `WWW-Authenticate: Bearer
   resource_metadata=…` on every unauthenticated request including `initialize`;
   RFC 9728 / RFC 8414 discovery reachable from Anthropic egress `160.79.104.0/21`
   (WAF/bot protection in front of MCP *or* the IdP is a common silent failure).
4. Published HTTPS **privacy policy** covering collection, usage, storage/retention,
   third-party sharing, and a real contact. "Missing or incomplete privacy policies
   result in immediate rejection."
5. **Public documentation** (blog/help-center is fine) by publish date: product summary,
   setup + auth steps, ≥3 example prompts with expected outcomes, limitations, support
   contact. Reviewer should succeed in ~10 minutes.
6. **Fully populated test account** with credentials + step-by-step access instructions.
7. Functional quality: valid params → success; actionable (not generic) errors;
   right-sized, token-frugal responses; no conversation-data collection.
8. Tool descriptions narrow and factual; no prompt-injection patterns; custom query
   tools must name/link the target API.
9. First-party API ownership: MCP domain should match the service; verify domain control.
10. Streamable HTTP transport (SSE deprecated). Tool names ≤ 64 chars.
11. No financial-transaction or AI-media-generation use cases (FGAC is fine here).

## Audit of `src/app/api/mcp/route.ts` (and related)

### Blockers (would fail the automated scan or review)

- **B1 — No tool annotations anywhere.** None of the 11 tools has `title`,
  `readOnlyHint`, or `destructiveHint`. The portal's Tools step flags these before you
  can even submit. The installed `@modelcontextprotocol/sdk` (via `mcp-handler` ^1.1.0)
  supports `server.tool(name, description, schema, annotations, cb)` — code change only.
  Mapping: `list_accounts`, `gmail_list`, `gmail_read`, `gmail_get_attachment`,
  `gmail_labels`, `sheets_get_spreadsheet`, `sheets_read_range`, `get_my_permissions`
  → `readOnlyHint: true`; `gmail_send`, `sheets_update_range`, `sheets_append_rows`
  → `destructiveHint: true` (+ `openWorldHint` where appropriate: `gmail_send` true).
- **B2 — `raw_google_api_call` is the exact named auto-reject pattern**: freeform `path`
  + `method` enum spanning GET→DELETE. Options: (a) drop it from the hosted MCP surface
  (keep the raw proxy on `/api/proxy` for API-key users), or (b) split into
  `google_api_get` (readOnlyHint) and `google_api_modify` (destructiveHint), each
  description explicitly naming/linking the Gmail and Sheets API docs. Recommendation:
  (a) for the directory build — it also closes enforcement gaps (see B5).
- **B3 — Unauthenticated `GET`/`DELETE` exports.** Only `POST` is wrapped in
  `experimental_withMcpAuth`; `GET = handler` and `DELETE = handler` bypass the 401 +
  `WWW-Authenticate` contract (cited by one guide as ~30% of rejections). Wrap all three
  verbs.
- **B4 — Privacy policy gaps.** `/privacy` exists but ends with "please contact support"
  — no actual contact channel; no explicit retention periods for logs/metadata while an
  account is active. Both are named review items. Add a real support email (and put the
  same one in the listing's support-contact field).

### Security findings (reviewers test against "Anthropic's security standards")

- **B5 — `verifyClerkJwtDirect` trusts the token's own `iss`.** The fallback derives the
  JWKS URL from the attacker-controlled `iss` claim — any issuer on the internet can
  mint a token that passes verification. Downstream damage is limited (connection starts
  `pending`), but a forged token with a known Clerk user id auto-creates connections and
  touches `lastUsedAt`. Pin the expected issuer (the Clerk frontend API origin) before
  fetching JWKS.
- **B6 — Enforcement asymmetry in `raw_google_api_call`** (moot if dropped): send path
  only checks that send rules *exist* (not that the recipient matches the whitelist);
  Gmail read/list via raw path skips `checkReadRestrictions`; non-Gmail, non-Sheets
  Google APIs pass through with no rules at all. If B2 chooses option (b), enforcement
  must reach parity with the dedicated tools first.

### Quality issues (functional-review failures, fix before submitting)

- **Q1 — No Google API error handling.** `gmailFetch`/`sheetsFetch` return `res.json()`
  regardless of status; an expired Google token, 403 scope error, or HTML error page
  surfaces as a raw dump or a throw. Reviewers explicitly fail "generic errors". Wrap
  with status checks and map to actionable messages ("Google token expired — reconnect
  in the dashboard", etc.).
- **Q2 — Oversized responses.** `gmail_read` returns the entire `format=full` payload;
  `gmail_get_attachment` returns base64 file bodies as text (unbounded); `gmail_list`
  re-dumps raw JSON. The policy requires token-frugal responses "commensurate" with the
  task. Trim: default `gmail_read` to parsed headers + decoded text body; cap/paginate
  attachment size with a clear over-limit message; summarize list results.
- **Q3 — Tool description hygiene.** `raw_google_api_call`'s "Guarantees access to any
  API endpoint" is promotional and wrong (rules can deny). `gmail_send`'s "Subject to
  send whitelist rules" is fine; keep descriptions factual. The pending-approval text
  ("Please share this exact error message with the user") is acceptable in a *response*
  but reads as behavior-steering — rephrase to plain data ("This connection is awaiting
  approval. Approve at: <url>").
- **Q4 — `serverInfo` polish.** Add `title` and website URL; bump version honestly.

### Already in good shape

- OAuth: Clerk MCP tooling gives DCR + PKCE S256, RFC 8414 + RFC 9728 metadata routes
  with CORS, and `resourceMetadataPath` is wired into the POST auth wrapper. Hosted on
  Vercel over HTTPS with streamable HTTP transport. `/terms` exists. No financial or
  AI-media use cases. Read-time rule enforcement (labels, content, send whitelist,
  sheets permissions) is exactly the kind of scoped behavior the directory rewards.
- Watch item: Vercel WAF/bot protection must not block `160.79.104.0/21` (Cloudflare
  Bot Fight broke one submitter's server); verify discovery endpoints from outside.
- Watch item: DCR registers a new client per fresh connection; at directory scale Clerk
  will accumulate registered clients. Anthropic recommends CIMD or Anthropic-held
  credentials for high-traffic listings — acceptable to launch on DCR, revisit later.

## Plan

**Phase 1 — Code changes (this repo)**
1. Add `title` + `readOnlyHint`/`destructiveHint`/`openWorldHint` annotations to all tools (B1).
2. Remove `raw_google_api_call` from the hosted MCP tool surface (B2/B6).
3. Wrap GET and DELETE in `experimental_withMcpAuth` (B3).
4. Pin the Clerk issuer in `verifyClerkJwtDirect` (B5).
5. Add Google API error handling with actionable messages (Q1).
6. Right-size `gmail_read` / `gmail_get_attachment` / `gmail_list` responses (Q2).
7. Clean descriptions + pending-approval copy + `serverInfo` (Q3/Q4).

**Phase 2 — Content & compliance**
8. Privacy policy: add support email, retention periods (B4). Mirror contact on `/terms`.
9. Public docs page (marketing site or help article): what FGAC is, connect steps,
   3+ example prompts w/ expected outcomes, limitations, support contact.
10. Prepare reviewer test account: dedicated Google account, populated inbox + a shared
    spreadsheet, pre-approved connection + proxy key + sample rules, written click-path.

**Phase 3 — Validation**
11. Exercise every tool via MCP Inspector and as a custom connector in Claude.ai
    (the portal makes you attest to this). Verify the 401/`WWW-Authenticate` shape and
    both `.well-known` docs from an external network; confirm token endpoint accepts
    form-urlencoded and responds < 10 s.
12. Run existing QA capability suites against the changed tool surface.

**Phase 4 — Submission**
13. Ensure access to a Claude **Team/Enterprise org** (portal prerequisite — Owner role).
14. Complete the portal (have ready: docs URL, privacy URL, square icon, tagline ≤ 55
    chars, description ≤ 2000 chars, categories, slug — permanent once published —
    test credentials, company info). Data-handling step: FGAC proxies Google's APIs on
    the user's behalf — answer the first-party/proxy question accordingly and be ready
    to justify it; our MCP domain (fgac.ai) matches our service.
15. Track status in the submissions dashboard; fix feedback fast (resubmits requeue).

## Sources

- https://claude.com/docs/connectors/building/submission
- https://claude.com/docs/connectors/building/review-criteria
- https://claude.com/docs/connectors/building/authentication
- https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq
- https://joeir.substack.com/p/submitting-my-mcp-server-as-a-claude
- https://sunpeak.ai/blogs/claude-connector-directory-submission/
- https://tallyfy.com/how-to-list-mcp-server-anthropic-claude-connectors/
- https://medium.com/@TheTechDude/how-to-submit-to-anthropic-connectors-directory-the-full-guide-da0bfed4d21c
