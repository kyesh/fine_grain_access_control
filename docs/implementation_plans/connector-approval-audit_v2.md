# Anthropic Connectors Directory — FGAC MCP Audit & Submission Plan (v2)

Branch: `claude/connector-approval-audit-4bf125` · Date: 2026-07-27

Supersedes v1. Two design decisions changed after further research and discussion:

1. **`raw_google_api_call` is split, not dropped.** The full-API-surface passthrough is
   core product value. The directory rule only forbids *mixing* safe and unsafe HTTP
   methods in one tool; freeform-path "custom query tools" are explicitly allowed when
   the description names/links the target API. We keep the power via a read/write pair.
2. **No dual MCP endpoints.** Server-side updates to a listed connector deploy live with
   no per-release re-review; only *listing* edits go through reviewer approval. The
   listed URL must simply be our stable prod deployment. Iteration continues on Vercel
   previews (as custom connectors), promotion via `/deploy-prod` — the existing
   pipeline. The consequence is that review criteria become standing invariants on
   `main`, enforced in CI, because prod is permanently "in review."

## How the process works (2026)

- Submission happens in the **Claude.ai submission portal**
  (`claude.ai/admin-settings/directory/submissions/new`). Requires a **Team or
  Enterprise Claude organization**; only Owners (or Enterprise custom roles with
  Directory management) can submit. 11 portal steps: Connection → Tools → Listing →
  Use cases → Company → Authentication → Data handling → Test & launch → Compliance
  (7 acknowledgments) → Review.
- On submit, an **automated policy scan** runs; passing lists the server as a
  **community connector**. Anthropic may escalate popular listings to **verified
  review** (humans functionally test every tool). Same criteria either way.
- **Timelines are unpublished.** Community reports: ~2 weeks to months. Resubmissions
  requeue at the back, so one missing item costs a week+. Escalations:
  `mcp-review@anthropic.com`.
- The connector keeps working as a **custom connector** throughout — the directory adds
  discovery, not functionality.

## Update / release model (new in v2)

- The listing is **metadata + our server URL**. Claude syncs `tools/list` from the
  live server; there is no artifact upload and **no per-release review gate**. New
  tools, behavior changes, and bug fixes reach all connected users on deploy.
- **Listing edits** (tagline, description, doc/privacy links, icon, company details)
  are submitted via the dashboard and stay *pending until a reviewer approves*.
  Changing the **display name requires full re-review**. The **URL slug is permanent**.
- Compliance is **ongoing, not per-update**: the Software Directory Policy provides for
  "initial and ongoing reviews," and the dashboard continuously reports health (30-day
  disconnect rate ≤ 5% = Healthy), error rates (request-level 4xx/5xx + `isError`
  results), latency, and per-tool usage. A non-compliant deploy risks delisting rather
  than a blocked release.
- **Operational consequences:**
  - The listed URL = production (`fgac.ai/api/mcp`). Never point the listing at
    anything we churn. Preview deployments remain the iteration surface, connected as
    custom connectors during QA.
  - Add a CI/lint gate on the MCP tool registry enforcing: every tool has `title` +
    `readOnlyHint`/`destructiveHint`; no tool accepts both safe and unsafe HTTP
    methods; names ≤ 64 chars. This makes the standing review invariants unbreakable
    by future tool additions.
  - Watch the dashboard error-rate metric post-publication: tool results returning
    `isError: true` and 5xxs count against health, which strengthens the case for the
    Q1 error-handling work below.

## Hard requirements (each missing item = rejection)

1. Every tool: `title` + `readOnlyHint: true` (reads) or `destructiveHint: true`
   (writes).
2. No single tool mixing safe (GET/HEAD/OPTIONS) and unsafe (POST/PUT/PATCH/DELETE)
   methods. Read/write must be separate tools; per-action splits are recommended, not
   required. Freeform-path tools are allowed if the description names/links the API.
3. OAuth 2.0 with PKCE S256; DCR or CIMD or Anthropic-held credentials; token endpoint
   accepts `application/x-www-form-urlencoded`; 401 + `WWW-Authenticate: Bearer
   resource_metadata=…` on every unauthenticated request including `initialize`;
   RFC 9728 / RFC 8414 discovery reachable from Anthropic egress `160.79.104.0/21`
   (WAF/bot protection in front of MCP *or* the IdP is a common silent failure).
4. Published HTTPS **privacy policy** covering collection, usage, storage/retention,
   third-party sharing, and a real contact. Missing/incomplete = immediate rejection.
5. **Public documentation** by publish date: product summary, setup + auth steps, ≥3
   example prompts with expected outcomes, limitations, support contact. A reviewer
   should succeed in ~10 minutes.
6. **Fully populated test account** with credentials + step-by-step instructions.
7. Functional quality: valid params → success; actionable (not generic) errors;
   right-sized, token-frugal responses; no conversation-data collection.
8. Tool descriptions narrow and factual; no prompt-injection patterns.
9. First-party API ownership: MCP domain should match the service (fgac.ai does).
10. Streamable HTTP transport (SSE deprecated). Tool names ≤ 64 chars.
11. No financial-transaction or AI-media-generation use cases (FGAC is fine).

## Raw passthrough strategy (revised B2)

The auto-reject pattern is one tool with a `method` enum spanning GET→DELETE. The
replacement preserves the full Google API surface in two tools:

- **`google_api_get`** — freeform `path`, GET only, `readOnlyHint: true`.
  Description names and links the Gmail API
  (developers.google.com/gmail/api/reference/rest) and Sheets API
  (developers.google.com/sheets/api/reference/rest) and states that FGAC access rules
  govern every call.
- **`google_api_modify`** — freeform `path`, method ∈ {POST, PUT, PATCH},
  `destructiveHint: true`. Same doc links and rule statement.
- **DELETE is not exposed.** We already hard-block trash/emptyTrash; "FGAC never
  deletes" becomes an explicit safety property of the listing.
- Dedicated convenience tools (`gmail_*`, `sheets_*`) remain the primary interface;
  the raw pair is the documented long-tail escape hatch.

Why this passes AND helps the pitch: Claude's permission model keys off the
annotations — `readOnlyHint` tools auto-run without per-call confirmation, destructive
tools always prompt. A raw read tool that is provably safe because FGAC rules gate it
is the product thesis; say so in the Use-cases step.

**Enforcement parity is a prerequisite** (was B6): the raw path currently skips
read-restriction checks on message fetches, checks only that send rules *exist* (not
that the recipient matches), and passes non-Gmail/Sheets Google APIs through
unchecked. Centralize rule evaluation on **path + method classification** so the raw
pair gives identical guarantees to the dedicated tools, **deny-by-default** for any
path family the classifier doesn't recognize. Also deny Google's **batch endpoints**
(`/batch/...`, multipart bodies): batch rides on a single POST, so it would land in
`google_api_modify` yet can smuggle both reads that bypass read-restrictions and
unclassified writes inside its body.

## Audit findings (unchanged from v1 except B2/B6)

### Blockers

- **B1 — No tool annotations.** None of the 11 tools has `title`, `readOnlyHint`, or
  `destructiveHint`; the portal's Tools step flags this pre-submission. Installed SDK
  supports annotations (code change only). Mapping: `list_accounts`, `gmail_list`,
  `gmail_read`, `gmail_get_attachment`, `gmail_labels`, `sheets_get_spreadsheet`,
  `sheets_read_range`, `get_my_permissions`, `google_api_get` → `readOnlyHint: true`;
  `gmail_send`, `sheets_update_range`, `sheets_append_rows`, `google_api_modify` →
  `destructiveHint: true` (`openWorldHint: true` on `gmail_send`).
- **B2 — `raw_google_api_call` mixes methods** → replace with the
  `google_api_get`/`google_api_modify` pair per the strategy above.
- **B3 — Unauthenticated `GET`/`DELETE` exports.** Only `POST` is wrapped in
  `experimental_withMcpAuth`; wrap all verbs to honor the 401 + `WWW-Authenticate`
  contract (~30% of rejections per one firsthand guide).
- **B4 — Privacy policy gaps.** `/privacy` ends with "contact support" (no actual
  channel) and lacks retention periods for logs/metadata during account life. Add a
  real support email; mirror it in the listing's support-contact field and `/terms`.

### Security

- **B5 — `verifyClerkJwtDirect` trusts the token's own `iss`.** JWKS URL is derived
  from the attacker-controlled `iss` claim, so any issuer can mint a passing token.
  Blast radius limited (connections start `pending`) but pin the expected Clerk
  issuer before fetching JWKS.
- **B6 — folded into the raw passthrough strategy above** (enforcement parity +
  deny-by-default + batch-endpoint block).

### Quality

- **Q1 — No Google API error handling.** `gmailFetch`/`sheetsFetch` ignore HTTP
  status; expired tokens/scope errors surface as raw dumps or throws. Map to
  actionable messages. Post-publication this also protects the dashboard error-rate
  health metric.
- **Q2 — Oversized responses.** `gmail_read` dumps `format=full`;
  `gmail_get_attachment` returns unbounded base64; `gmail_list` re-dumps raw JSON.
  Trim to parsed headers + text body by default; cap attachment size with a clear
  over-limit message; summarize listings.
- **Q3 — Description hygiene.** Remove "Guarantees access to any API endpoint"
  phrasing; keep descriptions factual. Rephrase the pending-approval response to plain
  data ("This connection is awaiting approval. Approve at: <url>").
- **Q4 — `serverInfo` polish.** Add `title`, website URL, honest version.

### Already in good shape

- Clerk MCP tooling: DCR + PKCE S256, RFC 8414/9728 metadata with CORS,
  `resourceMetadataPath` wired on POST. HTTPS + streamable HTTP on Vercel. `/terms`
  exists. No prohibited use cases. Rule-scoped behavior is what the directory rewards.
- Watch: Vercel WAF must not block `160.79.104.0/21`; verify discovery externally.
- Watch: DCR registers a client per fresh connection; at directory scale prefer CIMD
  or Anthropic-held credentials later (launching on DCR is acceptable).

## Plan

**Phase 1 — Code changes (this repo)**
1. Add `title` + `readOnlyHint`/`destructiveHint`/`openWorldHint` to all tools (B1).
2. Centralize FGAC rule enforcement on path+method classification with deny-by-default
   and batch-endpoint blocking; bring the raw path to parity with dedicated tools (B6).
3. Replace `raw_google_api_call` with `google_api_get` + `google_api_modify` (no
   DELETE), descriptions linking Gmail/Sheets API docs (B2). Depends on step 2.
4. Wrap GET and DELETE exports in `experimental_withMcpAuth` (B3).
5. Pin the Clerk issuer in `verifyClerkJwtDirect` (B5).
6. Add Google API error handling with actionable messages (Q1).
7. Right-size `gmail_read` / `gmail_get_attachment` / `gmail_list` responses (Q2).
8. Clean descriptions, pending-approval copy, `serverInfo` (Q3/Q4).
9. Add a CI/lint check over the tool registry: annotations present, no mixed-method
   tools, names ≤ 64 chars — the standing invariants for post-listing deploys.

**Phase 2 — Content & compliance**
10. Privacy policy: real support email + retention periods (B4); mirror on `/terms`.
11. Public docs page: what FGAC is, connect steps, ≥3 example prompts with expected
    outcomes (include one exercising `google_api_get` to document the escape hatch),
    limitations, support contact.
12. Reviewer test account: dedicated Google account, populated inbox + shared
    spreadsheet, pre-approved connection + proxy key + sample rules demonstrating both
    an allow and a deny, written click-path.

**Phase 3 — Validation**
13. Exercise every tool via MCP Inspector and as a custom connector in Claude.ai
    (portal attestation). Verify 401/`WWW-Authenticate` shape and both `.well-known`
    docs from an external network; token endpoint form-urlencoded, < 10 s.
14. Run existing QA capability suites against the changed tool surface (raw-API
    capability docs need updating for the new tool pair first).

**Phase 4 — Submission & operations**
15. Ensure access to a Claude **Team/Enterprise org** (Owner) — the portal gate.
16. Complete the portal (docs URL, privacy URL, square icon, tagline ≤ 55 chars,
    description ≤ 2000 chars, categories, permanent slug, test credentials, company
    info). Data handling: FGAC proxies Google's APIs on the user's own OAuth grant —
    answer the proxy question accordingly. Point the Connection step at production
    `fgac.ai/api/mcp` only.
17. Track the submissions dashboard; fix feedback fast (resubmits requeue).
18. Post-publication: monitor health/error metrics in the dashboard; treat review
    criteria as `main` invariants (CI gate from step 9); route listing-metadata edits
    through the dashboard knowing they pend on reviewer approval; never rename the
    display name casually (full re-review) — the slug is permanent either way.

## Sources

- https://claude.com/docs/connectors/building/submission
- https://claude.com/docs/connectors/building/review-criteria
- https://claude.com/docs/connectors/building/authentication
- https://claude.com/docs/connectors/building/managing-your-listing
- https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq
- https://joeir.substack.com/p/submitting-my-mcp-server-as-a-claude
- https://sunpeak.ai/blogs/claude-connector-directory-submission/
- https://tallyfy.com/how-to-list-mcp-server-anthropic-claude-connectors/
- https://medium.com/@TheTechDude/how-to-submit-to-anthropic-connectors-directory-the-full-guide-da0bfed4d21c
