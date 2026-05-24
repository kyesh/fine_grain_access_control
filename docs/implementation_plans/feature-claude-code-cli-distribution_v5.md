# Claude Code CLI Skill — Marketplace Distribution & Validation (v5)

> **Correction from v4**: Two critical mistakes during execution:
> 1. **DB schema never pushed** — `npm run db:branch` created a Neon branch but `npm run db:push` was never run, so tables like `agent_connections` didn't exist. This was **misdiagnosed as a Clerk SDK hang** when in fact the POST to `/api/auth/cli-token` returned 401 correctly, but the auth script's second attempt hit a Turbopack cold-start 404.
> 2. **QA tests skipped** — Only smoke tests were run (script loads, SKILL.md exists). The full `/qa-setup` (3 setup docs) and capability assertions (8 caps × 48 assertions) were never executed.

---

## Distribution Channel

Use the **existing repo** (`kyesh/fine_grain_access_control`) as the Claude Code plugin marketplace:

```bash
/plugin marketplace add kyesh/fine_grain_access_control
/plugin install fgac-gmail@fine_grain_access_control
```

---

## Build Phase — ✅ COMPLETE

All file changes from v4 are correct and committed:
- `.claude-plugin/marketplace.json` at repo root
- `public/skills/claude-code-cli/` plugin structure (plugin.json, SKILL.md, scripts, README)
- Scripts moved from `docs/` → `public/` with symlink
- MCP SKILL.md simplified
- QA docs updated (reset.sh, runbooks)

---

## Local QA Phase — REDO REQUIRED

### Prerequisites (missed in v4)

> [!CAUTION]
> **Step 0: Push DB schema** — After `npm run db:branch`, MUST run `npm run db:push` to apply the schema to the new Neon branch. Without this, all DB queries fail with `relation "X" does not exist`.

> [!IMPORTANT]
> **Use `npm run dev:qa`** — Not `npm run dev`. The QA dev script clears .next/dev cache and uses Webpack (not Turbopack) to prevent memory leaks and cold-start 404s.

### Full Local QA Flow

| Step | What | How |
|------|------|-----|
| 0 | Push DB schema | `npm run db:push` |
| 1 | Pull QA secrets | `bash scripts/qa-secrets.sh` |
| 2 | Start QA dev server | `npm run dev:qa` |
| 3 | Execute `/qa-setup` | Run all 3 setup docs in order via `/browser-agent`: |
| | | `docs/QA_Acceptance_Test/setup/01_signup_and_credential.md` |
| | | `docs/QA_Acceptance_Test/setup/02_multi_account_linking.md` |
| | | `docs/QA_Acceptance_Test/setup/03_rules_configuration.md` |
| 4 | Verify setup checklist | All items from `/qa-setup` step 7 checked |
| 5 | Reset CC CLI env | `bash test/qa-envs/cc-cli/reset.sh` |
| 6 | Auth flow | `FGAC_ROOT_URL=http://localhost:3000 node scripts/auth.js --action login` |
| | | → Browser consent → approve in dashboard → `node auth.js --action status` |
| 7 | Launch Claude Code | `tmux new-session -d -s fgac-cli-qa -x 200 -y 50 "cd test/qa-envs/cc-cli && claude --dangerously-skip-permissions"` |
| 8 | Run ALL capabilities | Execute capabilities via tmux per `agents/03_claude_code_cli.md` |

### Required Capability Coverage

All 8 capabilities must be tested. Every assertion must be accounted for:

| # | Capability | Assertions | Key Tests |
|---|-----------|------------|-----------|
| 01 | Send Whitelist | A1-A2 | Whitelisted send succeeds, blocked send returns 403 |
| 02 | Read Blacklist | A3-A5 | Content-based read blocking, rule names in errors |
| 03 | Multi-Email Scoping | A1-A3 | Key-to-email isolation, power key multi-access |
| 04 | Delegation | A1-A6 | Cross-user delegated email access |
| 05 | Label Access | TBD | Label whitelist/blacklist filtering |
| 06 | Connection Lifecycle | A1-A5 | Pending → approve → block → unblock → nickname |
| 07 | Key Lifecycle | A1-A3 | Revoke, roll, cross-user isolation |
| 08 | Strict Light Mode | A1 | No dark mode leaks (tested via browser, same for all agents) |

### Coverage Report Required

After all capabilities, produce a coverage matrix:
```
| Cap | Assertion | Status | Notes |
|-----|-----------|--------|-------|
| 01  | A1        | ✅/❌/⏭️ |       |
| 01  | A2        | ✅/❌/⏭️ |       |
...
```
All 48 assertions must be accounted for. Any ⏭️ (skipped) must include a reason.

---

## Preview Phase

| Step | What |
|------|------|
| 1 | Push branch & deploy PR via `/deploy-pr-preview` |
| 2 | Test marketplace from feature branch: `/plugin marketplace add kyesh/fine_grain_access_control#feature/claude-code-cli-distribution` |
| 3 | `/plugin install fgac-gmail@fine_grain_access_control` → verify skill installs |
| 4 | Run auth against preview Vercel URL |
| 5 | Run at least one capability against preview endpoints |

> [!IMPORTANT]
> **Two independent systems:**
> - **Marketplace** (GitHub): reads from branch via `#branch-name` ref during preview
> - **API endpoints** (Vercel): uses preview URL for auth + proxy

---

## Production Phase (user must merge)

| Step | What |
|------|------|
| 1 | Merge to main → marketplace live on default branch |
| 2 | `/plugin marketplace add kyesh/fine_grain_access_control` (no branch ref) |
| 3 | Full QA from `production/03_claude_code_cli.md` |

---

## Execution Order (Corrected)

| Phase | Step | What |
|-------|------|------|
| **Build** | ✅ | All file changes committed (2 commits on branch) |
| **Local QA** | 1 | `npm run db:push` — apply schema to Neon branch |
| | 2 | `bash scripts/qa-secrets.sh` — pull QA secrets |
| | 3 | `npm run dev:qa` — start QA-optimized dev server |
| | 4 | Execute `/qa-setup` — 3 setup docs via browser |
| | 5 | `bash test/qa-envs/cc-cli/reset.sh` — install skill |
| | 6 | Auth flow: login → approve → status |
| | 7 | Launch Claude Code via tmux |
| | 8 | Execute ALL 8 capabilities via `agents/03_claude_code_cli.md` |
| | 9 | Generate coverage matrix (48 assertions) |
| **Preview** | 10 | Deploy PR via `/deploy-pr-preview` |
| | 11 | Test marketplace from branch ref |
| | 12 | Auth + capability against preview endpoints |
| **Production** | 13 | User merges PR |
| | 14 | Marketplace test from main |
| | 15 | Full production QA |
