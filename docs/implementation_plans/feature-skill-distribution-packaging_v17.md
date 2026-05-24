# Agent QA: Self-Contained Environments (v4)

## Distribution Architecture

3 distribution endpoints serve 4 agent packages:

```
┌─────────────────────────────┐
│    Claude Code Marketplace  │──→ CC MCP package (MCP server registration)
│                             │──→ CC CLI package (SKILL.md + scripts bundle)
└─────────────────────────────┘
┌─────────────────────────────┐
│         ClawHub             │──→ OpenClaw package (SKILL.md + scripts)
└─────────────────────────────┘
┌─────────────────────────────┐
│      Direct HTTP            │──→ Hosted MCP (curl against /api/mcp)
└─────────────────────────────┘
```

| # | Agent | Distribution Endpoint | Production Install Command |
|---|-------|----------------------|---------------------------|
| 1 | Hosted MCP | Direct HTTP | `curl fgac.ai/api/mcp` |
| 2 | CC MCP | Claude Code Marketplace | `claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp` |
| 3 | CC CLI | Claude Code Marketplace | Marketplace install → SKILL.md + scripts placed in `.claude/skills/` |
| 4 | OpenClaw | ClawHub Registry | `clawhub skill install gmail-fgac` |

All 4 are valid production channels. All 4 get tested locally AND in production.

### Local vs Production

| Layer | Install source | API target | What it validates |
|-------|---------------|------------|-------------------|
| **Local** (`agents/`) | `cp -r` from repo | `localhost:3000` | Skill functionality |
| **Production** (`production/`) | Marketplace / ClawHub / direct | `fgac.ai` | Distribution channel + functionality |

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Reset mechanism | Per-agent `reset.sh` at `test/qa-envs/{agent}/reset.sh` |
| Local install method | `cp -r` from repo (matches what marketplace places on disk) |
| Production install method | Marketplace / ClawHub only — no file copying |
| OpenClaw QA port | 18790 |

---

## Workspace Layout

```
test/qa-envs/
├── .gitignore
├── hosted-mcp/reset.sh
├── cc-mcp/reset.sh            # Creates .mcp.json → localhost:3000
├── cc-cli/reset.sh            # Installs SKILL.md + scripts from repo
└── openclaw/reset.sh          # Scaffolds Docker env (port 18790)
```

Each `reset.sh` wipes its directory clean and rebuilds from scratch. Claude Code agents launch from their respective workspace directory.

---

## Agent Doc Rewrites

Each agent doc gets 3 sections at the top:

1. **Environment Setup** — references `reset.sh`, exact launch commands
2. **Auth Flow** — OAuth + dashboard approval
3. **Capability Tests** — the actual assertions (unchanged)

### Agent 1: Hosted MCP

**reset.sh**: Clears `/tmp/fgac_qa_*` state files.
**Setup**: Just needs dev server + DCR registration via curl.
**No workspace directory** needed — curl runs from anywhere.

### Agent 2: CC MCP

**reset.sh**: Wipes workspace → creates `.mcp.json` pointing to `$FGAC_ROOT_URL/api/mcp`.
**Setup**: Launch Claude Code FROM `test/qa-envs/cc-mcp/`. Verify `/mcp` shows `fgac-gmail`. Complete OAuth. Approve in dashboard.
**Key detail**: Claude Code discovers tools via MCP protocol (JSON-RPC). No scripts involved.

### Agent 3: CC CLI

**reset.sh**: Wipes workspace → copies `docs/skills/gmail-fgac/SKILL.md` + `scripts/` into `.claude/skills/gmail-fgac/` → runs `npm install`.
**Setup**: Run `auth.js --action login` with `FGAC_ROOT_URL`. Launch Claude Code FROM `test/qa-envs/cc-cli/`. Verify Claude discovers the skill from SKILL.md.
**Key detail**: Claude Code discovers tools by reading SKILL.md, then invokes `node scripts/gmail.js`. Tests must go through Claude's natural language → script invocation path.

### Agent 4: OpenClaw

**reset.sh**: Wipes workspace → copies Dockerfile, docker-compose.yml (port 18790), run-qa.sh from `test/testclaw/` → copies skill from `docs/skills/gmail-fgac/`.
**Setup**: `docker compose build && docker compose up -d`. Wait for gateway health on 18790. Run `auth.js` inside container. Approve in dashboard.
**Key detail**: Tests go through the OpenClaw gateway API (`localhost:18790/api/chat`), not direct script calls.

---

## Production Test Docs

### `production/01_hosted_mcp.md`
- **Install**: None — direct curl
- **Test**: Same DCR flow against `fgac.ai/api/mcp`

### `production/02_claude_code_mcp.md`
- **Install**: `claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp`
- **Verify**: `claude mcp list` shows fgac-gmail
- **Test**: OAuth against production → approve in production dashboard → run capabilities

### `production/03_claude_code_cli.md`
- **Install**: Install SKILL.md + scripts from Claude Code Marketplace
- **Verify**: `.claude/skills/gmail-fgac/SKILL.md` present, scripts runnable
- **Test**: Claude discovers skill → invokes scripts against `gmail.fgac.ai` (default, no override)

### `production/04_openclaw.md`
- **Install**: `clawhub skill install gmail-fgac`
- **Verify**: `~/.openclaw/skills/gmail-fgac/` contains SKILL.md + scripts
- **Test**: Gateway discovers skill → processes prompts against `gmail.fgac.ai`

---

## Production Blockers

| Channel | Status | Blocker |
|---------|--------|---------|
| Hosted MCP | ✅ Ready | — |
| CC MCP (marketplace) | ⚠️ Verify | Confirm `claude mcp add` resolves against `fgac.ai` |
| CC CLI (marketplace) | ❌ Blocked | SKILL.md + scripts bundle not published to marketplace yet |
| OpenClaw (ClawHub) | ❌ Blocked | Skill not published to ClawHub yet |

### `public/skills/` Drift

| File | Issue |
|------|-------|
| `public/skills/claude-code/SKILL.md` | Describes both MCP (Option A) and CLI (Option B) in one file — should these be separate marketplace packages? |
| `public/skills/open-claw/SKILL.md` | Instructions-only stub, not the real skill with scripts |
| `public/skills/open-claw/openclaw.json` | References `FGAC_PROXY_KEY` but real flow uses OAuth DCR |

---

## Execution Order

1. Create `test/qa-envs/` with `.gitignore` and 4 `reset.sh` scripts
2. Rewrite all 4 `agents/*.md` Environment Setup sections
3. Update `production/*.md` to reference correct marketplace install commands
4. Test locally: run each reset.sh → follow agent doc → run capabilities
5. Fix `public/skills/` drift (separate task)
6. Publish to ClawHub + marketplace (separate task)
