# FGAC.ai Skill Distribution & Low-Friction Packaging

Make FGAC.ai trivially installable for both OpenClaw and Claude Code users, through native distribution channels that provide organic discoverability. Clean up completed CASA Tier 2 artifacts.

## User Review Required

> [!IMPORTANT]
> **MCP Server Scope Decision**: Building a full MCP server endpoint (`/mcp`) is the highest-impact item for Claude Code users, but it's also the largest engineering effort. We can ship the ClawHub publication and improved install UX first, then build the MCP server as a fast-follow. **Do you want MCP in this PR or a separate branch?**

> [!IMPORTANT]
> **CASA Archive Strategy**: Should we move the CASA docs to a `docs/archive/casa-tier-2/` subdirectory (preserving history) or delete them entirely? I recommend archiving — the evidence may be useful if Google re-audits.

> [!WARNING]
> **ClawHub Account**: Publishing to ClawHub requires a GitHub-authenticated account. Do you have a ClawHub account, or should we create one during this work?

## Open Questions

1. **MCP Server Tool Scope**: Should the MCP server expose all 6 actions (list, read, send, forward, labels, attachment) or start with a read-only subset (list, read, labels)?
2. **Naming**: The current ClawHub skill name is `gmail-fgac`. Should we keep this, or rebrand to something more discoverable like `fgac-gmail-proxy` or `secure-gmail-agent`?
3. **env var standardization**: The OpenClaw skill uses `FGAC_ROOT_URL` and a token JSON file. The Claude Code skill uses `FGAC_PROXY_KEY`. Should we unify to a single env var pattern across all platforms?

---

## Proposed Changes

### Phase 1: ClawHub Publication (OpenClaw Distribution)

#### [MODIFY] [SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/SKILL.md)
- Add required `signature` field to frontmatter
- Add `when_to_use` field with semantic-search-optimized trigger phrases
- Add `license` field
- Improve `metadata` with `version` and `author`
- Add `allowed-tools` for ClawHub security scanning
- Enhance description for ClawHub vector search discoverability

#### [MODIFY] [setup.js](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/scripts/setup.js)
- Add interactive setup flow: prompt for proxy key, write token JSON, validate key against proxy
- Make the post-install experience seamless after `openclaw skills install gmail-fgac`

#### [NEW] `docs/skills/gmail-fgac/README.md`
- ClawHub best practices require a README alongside SKILL.md
- Include quick-start, screenshots from dashboard, and link to fgac.ai

---

### Phase 2: Claude Code MCP Server

#### [NEW] `src/app/api/mcp/route.ts`
- Implement MCP-compliant JSON-RPC 2.0 endpoint over HTTP
- Expose tools: `list_emails`, `read_email`, `send_email`, `forward_email`, `list_labels`, `download_attachment`
- Auth via existing `sk_proxy_` key in Authorization header
- Reuse existing proxy logic (the MCP server calls the same internal proxy pipeline)

#### [NEW] `public/.mcp.json` (downloadable template)
- Pre-configured `.mcp.json` that users can drop into any project
- Uses `${FGAC_PROXY_KEY}` env var interpolation

---

### Phase 3: Setup Page & Install UX Overhaul

#### [MODIFY] [page.tsx (setup)](file:///home/kyesh/GitRepos/fine_grain_access_control/src/app/setup/page.tsx)
- Add **one-line install commands** for each platform (copy-to-clipboard)
  - OpenClaw: `openclaw skills install gmail-fgac`
  - Claude Code MCP: `claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp --header "Authorization: Bearer YOUR_KEY"`
  - Claude Code Skill: `mkdir -p .claude/skills/fgac && curl -o .claude/skills/fgac/SKILL.md https://fgac.ai/skills/claude-code/SKILL.md`
- Remove or simplify the manual download links (keep as fallback)
- Add MCP as a fourth card in the agent setup grid
- Show the user's actual key in the install commands (if authenticated)

#### [MODIFY] [SKILL.md (claude-code)](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)
- Add Node.js code example (currently Python-only)
- Add cURL example for tool-use agents
- Improve error handling instructions

#### [MODIFY] [SKILL.md (open-claw public)](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/open-claw/SKILL.md)
- Align with the full `docs/skills/gmail-fgac/SKILL.md` content
- Add `signature` and `when_to_use` frontmatter

---

### Phase 4: CASA Tier 2 Cleanup

#### [DELETE] CASA Documentation (archive to `docs/archive/casa-tier-2/`)
Move these files:
- `docs/CASA_Dispute_Response.md`
- `docs/CASA_SAQ_Answers.md`
- `docs/CASA_TAC_Data_Storage_Response.md`
- `docs/CASA_TAC_SAQ_Evidence_Response.md`
- `docs/CASA_Evidence/` (entire directory)

#### [DELETE] CASA Scripts & Scan Artifacts
Move to archive or delete:
- `scripts/fill_saq.sh`
- Root-level scan artifacts: `zap.yaml`, `zap_output.txt`, `zap_report.html`, `fluidattacks-config.yaml`, `run_zap.sh`, `semgrep_results.txt`, `trivy_results.txt`, `npm_audit_results.txt`
- `Open_TAC_Security_ReportFirst_Scan_2026_1776828032.pdf`

#### [KEEP] Security Headers
- `next.config.ts` security headers stay — they're production best practices regardless of CASA

#### [DELETE] CASA Implementation Plans
Move to archive:
- `docs/implementation_plans/feature-casa-tier-2-prep_v*.md` (4 files)
- `docs/implementation_plans/feature-casa-universe-merged_v*.md` (2 files)
- `docs/implementation_plans/fix-casa-dast-remediation_v1.md`

---

### Phase 5: Documentation & Discoverability

#### [MODIFY] [README.md](file:///home/kyesh/GitRepos/fine_grain_access_control/README.md)
- Add install badges (ClawHub, MCP compatible)
- Add quick-install section with one-liners for each platform
- Improve SEO-relevant keywords for GitHub search

#### [MODIFY] [user_guide.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/user_guide.md)
- Update "Ready-Made Agent Skills" section (line 115-119) to reflect new install methods
- Add MCP server documentation
- Remove references to manual file download

#### [MODIFY] [architecture_and_strategy.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/architecture_and_strategy.md)
- Update Section 4 (MCP) to reflect that we now have an MCP endpoint
- Add distribution strategy as Section 5

---

## Verification Plan

### Automated Tests
- `clawhub skill validate docs/skills/gmail-fgac/` — validates SKILL.md frontmatter
- `curl https://preview-url/skills/claude-code/SKILL.md` — verify public download works
- `curl -X POST https://preview-url/api/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'` — verify MCP endpoint responds
- Build succeeds: `npm run build`

### Manual Verification
- Install skill via `openclaw skills install gmail-fgac` on a test instance
- Run `claude mcp add --transport http fgac-gmail <preview-url>/mcp` and verify tool discovery
- Walk through updated setup page in preview deployment
- Verify CASA files are properly archived and not broken links
