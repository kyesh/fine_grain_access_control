# Agent QA: Self-Contained Environments (v3)

## The 4 Agents vs 3 Production Channels

> [!IMPORTANT]
> There are **4 local test agents** but only **3 production distribution channels**. CC CLI is a local dev/fallback mode, not a production install path.

| # | Agent | Local Test | Production Channel | Production Install |
|---|-------|-----------|-------------------|-------------------|
| 1 | **Hosted MCP** | `curl` → `localhost:3000/api/mcp` | Direct HTTP | `curl` → `fgac.ai/api/mcp` |
| 2 | **CC MCP** | `.mcp.json` → `localhost:3000/api/mcp` | Plugin Marketplace | `claude mcp add` → `fgac.ai/api/mcp` |
| 3 | **CC CLI** | `cp -r` SKILL.md + scripts from repo | ⛔ **Not a production channel** | N/A — users use CC MCP in production |
| 4 | **OpenClaw** | `cp -r` skill from repo into Docker | ClawHub Registry | `clawhub skill install gmail-fgac` |

**Why CC CLI isn't a production channel**: In production, Claude Code users run `claude mcp add` (CC MCP). The "Option B: Local Scripts" in the SKILL.md is for developers who want to modify/extend the scripts — it's a power-user fallback, not a distribution channel we test in production.

### What local testing validates vs production testing

| Layer | What it tests | Install source | API target |
|-------|-------------|----------------|------------|
| **Local** (agents/) | Skill **functionality** — do the rules, scoping, and lifecycle work? | `cp -r` from repo | `localhost:3000` |
| **Production** (production/) | **Distribution channel** — can users actually install from marketplace/registry? + functionality against prod | Marketplace / ClawHub | `fgac.ai` / `gmail.fgac.ai` |

---

## Design Decisions

| Question | Decision |
|----------|----------|
| Reset scripts | Per-agent `reset.sh` at `test/qa-envs/{agent}/reset.sh`, referenced from agent doc |
| Local install | `cp -r` from repo (matches what a production install would place on disk) |
| Production install | Marketplace/registry only — no file copying |
| OpenClaw QA port | **18790** (avoids conflict with production OpenClaw on 18789) |

---

## Workspace Layout

```
test/qa-envs/
├── .gitignore                      # Ignore all runtime state
│
├── hosted-mcp/
│   └── reset.sh                    # Clear stale tokens
│
├── cc-mcp/                         # Claude Code MCP workspace
│   ├── reset.sh                    # Wipe → create .mcp.json
│   └── .mcp.json                   # (created by reset.sh)
│
├── cc-cli/                         # Claude Code CLI workspace
│   ├── reset.sh                    # Wipe → install SKILL.md + scripts from repo
│   └── .claude/skills/gmail-fgac/  # (created by reset.sh)
│
└── openclaw/                       # OpenClaw Docker workspace (port 18790)
    ├── reset.sh                    # Wipe → scaffold Docker env from repo
    ├── docker-compose.yml          # (created by reset.sh, port 18790)
    └── skills/gmail-fgac/          # (created by reset.sh)
```

---

## Agent Docs: Environment Setup Sections

### Agent 1: Hosted MCP (`agents/01_hosted_mcp.md`)

```markdown
## Environment Setup

### Reset
```bash
bash test/qa-envs/hosted-mcp/reset.sh
# Clears stale token/client state
```

### Prerequisites
- Dev server running at `http://localhost:3000`
- `/qa-setup` completed (keys + rules in dashboard)

### Verification
```bash
curl -sf http://localhost:3000/.well-known/oauth-authorization-server | jq .issuer
# Expected: returns issuer URL
```
```

No changes to capability tests — they already use curl correctly.

---

### Agent 2: CC MCP (`agents/02_claude_code_mcp.md`)

```markdown
## Environment Setup

### Reset
```bash
bash test/qa-envs/cc-mcp/reset.sh
# Creates test/qa-envs/cc-mcp/.mcp.json → localhost:3000/api/mcp
```

### Launch Claude Code
```bash
# Claude Code MUST be launched from the workspace directory
tmux new-session -d -s fgac-qa -x 200 -y 50 \
  "cd $(pwd)/test/qa-envs/cc-mcp && claude --dangerously-skip-permissions"
```

### Verify MCP Discovery
```bash
until tmux capture-pane -t fgac-qa -p | grep -q '❯'; do sleep 2; done
tmux send-keys -t fgac-qa "/mcp" Enter
sleep 3
tmux capture-pane -t fgac-qa -p | grep "fgac-gmail"
```
- [ ] `fgac-gmail` listed in MCP server menu
```

---

### Agent 3: CC CLI (`agents/03_claude_code_cli.md`)

```markdown
## Environment Setup

> ⚠️ This agent tests Claude Code discovering and invoking scripts via SKILL.md.
> Do NOT run `node gmail.js` directly — that bypasses Claude Code entirely.

### Reset
```bash
bash test/qa-envs/cc-cli/reset.sh
# Copies SKILL.md + scripts from docs/skills/gmail-fgac/ into workspace
# Installs npm dependencies
```

### Authenticate
```bash
FGAC_ROOT_URL=http://localhost:3000 \
  node test/qa-envs/cc-cli/.claude/skills/gmail-fgac/scripts/auth.js --action login
# → Complete OAuth in browser → Approve connection in dashboard
```

### Launch Claude Code
```bash
# Claude Code MUST be launched from the workspace directory
tmux new-session -d -s fgac-cli-qa -x 200 -y 50 \
  "cd $(pwd)/test/qa-envs/cc-cli && claude --dangerously-skip-permissions"
```

### Verify Skill Discovery
```bash
until tmux capture-pane -t fgac-cli-qa -p | grep -q '❯'; do sleep 2; done
tmux send-keys -t fgac-cli-qa "What skills do you have available?" Enter
sleep 8
tmux capture-pane -t fgac-cli-qa -p | grep -i "gmail"
```
- [ ] Claude mentions gmail-fgac from SKILL.md
```

---

### Agent 4: OpenClaw (`agents/04_openclaw.md`)

```markdown
## Environment Setup

### Prerequisites
```bash
# Verify openclaw:local Docker image exists
docker image inspect openclaw:local > /dev/null 2>&1 \
  && echo "✅ openclaw:local found" \
  || echo "❌ Build from OpenClaw repo first: cd ~/GitRepos/openclaw && docker build -t openclaw:local ."
```

### Reset
```bash
bash test/qa-envs/openclaw/reset.sh
# Scaffolds Docker env, copies skill files, generates docker-compose.yml (port 18790)
```

### Build and Start
```bash
cd test/qa-envs/openclaw
docker compose build
FGAC_ROOT_URL=http://localhost:3000 docker compose up -d
until curl -sf http://localhost:18790/health; do sleep 2; done
echo "✅ QA OpenClaw gateway ready on port 18790"
```

### Authenticate
```bash
docker exec qa-openclaw-testclaw-1 \
  FGAC_ROOT_URL=http://localhost:3000 \
  node /home/node/.openclaw/skills/gmail-fgac/scripts/auth.js --action login
# → Complete OAuth in browser → Approve connection in dashboard
```
```

---

## Production Test Docs

Production tests live in `production/` and test the **real distribution channels**, not local file copies.

### `production/01_hosted_mcp.md` — curl against `fgac.ai`

```markdown
## Install
No install needed — direct curl.

## Test
```bash
# Same DCR + PKCE flow as local, but against production
curl -sf https://fgac.ai/.well-known/oauth-authorization-server | jq .
```
```

### `production/02_claude_code_mcp.md` — Plugin Marketplace

```markdown
## Install from Production
```bash
claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp
```
- [ ] `claude mcp list` shows `fgac-gmail` → `https://fgac.ai/api/mcp`
- [ ] `/mcp` in Claude Code shows fgac-gmail available
- [ ] OAuth flow opens against `fgac.ai` (not localhost)
- [ ] Connection appears in production dashboard at `fgac.ai/dashboard`
```

### `production/03_claude_code_cli.md`

> [!WARNING]
> CC CLI is NOT a production distribution channel. This file should either be:
> - **Removed** — CC CLI is local-only, production users use CC MCP
> - **Redirected** — "For production, use CC MCP: `claude mcp add ...`"

### `production/04_openclaw.md` — ClawHub

```markdown
## Install from Production
```bash
clawhub skill install gmail-fgac
```
- [ ] Skill appears at `~/.openclaw/skills/gmail-fgac/`
- [ ] SKILL.md present with `gmail.fgac.ai` endpoint
- [ ] `node scripts/auth.js --action login` opens browser to `fgac.ai`
- [ ] Gateway discovers and invokes skill via natural language prompt
```

---

## Production Blockers

| Channel | Status | What's Needed |
|---------|--------|--------------|
| Hosted MCP (curl → fgac.ai) | ✅ Ready | Nothing |
| CC MCP (plugin marketplace) | ⚠️ Needs verification | Confirm `claude mcp add` works against `fgac.ai/api/mcp` |
| OpenClaw (ClawHub) | ❌ Not published | Run `clawhub skill publish docs/skills/gmail-fgac/` |

### Documentation Drift Detected

| File | Issue |
|------|-------|
| `public/skills/claude-code/SKILL.md` | "Option B: CLI Mode" tells users to `cp -r` scripts — this is dev-only, not a distribution channel |
| `public/skills/open-claw/SKILL.md` | Instructions-only stub, not the real `docs/skills/gmail-fgac/SKILL.md` with scripts |
| `public/skills/open-claw/openclaw.json` | References `FGAC_PROXY_KEY` credential but doesn't match the real skill's OAuth DCR flow |
| `production/03_claude_code_cli.md` | Describes a production channel that doesn't exist — CC CLI is local-only |

---

## Execution Order

1. **Create reset scripts** — `test/qa-envs/{agent}/reset.sh` (4 scripts)
2. **Create `.gitignore`** — `test/qa-envs/.gitignore`
3. **Rewrite agent docs** — Environment Setup sections in all 4 `agents/*.md` files
4. **Clean up production docs** — Remove/redirect `production/03_claude_code_cli.md`
5. **Fix public/skills drift** — Align `public/skills/` with actual distribution architecture (separate task)
6. **Test locally** — Run reset → setup → capabilities for each agent
7. **Publish to ClawHub** — Enable production OpenClaw testing (separate task)
