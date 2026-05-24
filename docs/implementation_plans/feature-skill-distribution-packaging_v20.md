# Agent QA: Comprehensive Environment & Distribution Plan (v7)

This plan provides a robust, repeatable QA framework that separates **local functional testing** from **production distribution testing**, while keeping all agent environments strictly isolated.

---

## 1. Workspaces & Live Code Strategy

To prevent agents from clobbering each other or polluting the root repository, all testing occurs in dedicated, isolated workspaces under `test/qa-envs/`. 

We will NOT copy files (`cp -r`) for local testing. Copying introduces drift. Instead, we use native tooling to load the live `docs/skills/` code directly:
- **Claude Code CLI** uses the `--plugin-dir <path>` flag on launch.
- **OpenClaw** uses a direct Docker volume mount to the local repository path, **mounted as read-only (`:ro`)** to prevent the agent from accidentally mutating the source code.

```
test/qa-envs/
├── .gitignore                      # Ignores all runtime state below
│
├── hosted-mcp/                     # Workspace for Hosted MCP
│   ├── reset.sh                    # Clears token state in this dir
│   └── state.json                  # Runtime token storage
│
├── cc-mcp/                         # Workspace for Claude Code MCP
│   ├── reset.sh                    # Wipes dir
│   └── .mcp.json                   # (Created via `claude mcp add`)
│
├── cc-cli/                         # Workspace for Claude Code CLI
│   └── reset.sh                    # Wipes dir (Skill loaded via --plugin-dir)
│
└── openclaw/                       # Workspace for OpenClaw Docker (port 18790)
    ├── reset.sh                    # Wipes dir → scaffolds Docker config
    ├── docker-compose.yml          # Configured to mount local repo (READ-ONLY)
    ├── credentials/                # Runtime credentials
    └── data/                       # OpenClaw runtime state
```

---

## 2. Local vs. Production Distinction

| Layer | Goal | Installation Method | API Target | Capabilities Tested |
|-------|------|---------------------|------------|---------------------|
| **Local** (`agents/`) | Validate new skill features, rules, and access scoping. | Native local loading (`--plugin-dir`, `:ro` volume mounts, `claude mcp add localhost`). | `localhost:3000` | Full Suite (List, Read, Send, Block, etc.) |
| **Production** (`production/`) | Validate the distribution channels AND end-to-end plumbing. | Real distribution tools (`claude mcp add fgac.ai`, `clawhub install`). | `fgac.ai` & `gmail.fgac.ai` | Full Suite (Identical matrix) |

---

## 3. Clear Setup Instructions per Agent

We will rewrite the `agents/*.md` and `production/*.md` docs to include explicit setup instructions. Below are the details for the local functional tests.

### Agent 1: Hosted MCP (`agents/01_hosted_mcp.md`)

**Reset Script** (`test/qa-envs/hosted-mcp/reset.sh`):
```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🧹 Resetting Hosted MCP environment..."
rm -f "$SCRIPT_DIR/state.json"
echo "✅ Ready. Run the auth setup in the agent doc."
```

**Doc Setup Instructions:**
```markdown
### Environment Setup
1. Run reset: `bash test/qa-envs/hosted-mcp/reset.sh`
2. Ensure dev server is running at `http://localhost:3000`.
3. Proceed to Auth flow (DCR registration via curl, saving tokens to `test/qa-envs/hosted-mcp/state.json`).
```

---

### Agent 2: CC MCP (`agents/02_claude_code_mcp.md`)

**Reset Script** (`test/qa-envs/cc-mcp/reset.sh`):
```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🧹 Resetting CC MCP environment..."
tmux kill-session -t fgac-qa 2>/dev/null || true
find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true
echo "✅ Workspace ready at: $SCRIPT_DIR"
```

**Doc Setup Instructions:**
```markdown
### Environment Setup
1. Run reset: `bash test/qa-envs/cc-mcp/reset.sh`
2. Configure MCP Server using the Claude CLI:
   `cd test/qa-envs/cc-mcp && claude mcp add --transport http fgac-gmail http://localhost:3000/api/mcp`
3. Launch Claude Code IN the workspace:
   `tmux new-session -d -s fgac-qa -x 200 -y 50 "cd test/qa-envs/cc-mcp && claude --dangerously-skip-permissions"`
4. Verify Discovery: Enter `/mcp` in Claude Code and confirm `fgac-gmail` is listed.
```

---

### Agent 3: CC CLI (`agents/03_claude_code_cli.md`)

**Reset Script** (`test/qa-envs/cc-cli/reset.sh`):
```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
echo "🧹 Resetting CC CLI environment..."
tmux kill-session -t fgac-cli-qa 2>/dev/null || true
rm -rf ~/.openclaw/gmail-fgac/fgac-credentials.json
find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true

# Ensure dependencies are installed in the original repo directory
cd "$REPO_ROOT/docs/skills/gmail-fgac/scripts" && npm install --silent
echo "✅ Workspace ready at: $SCRIPT_DIR"
```

**Doc Setup Instructions:**
```markdown
### Environment Setup
1. Run reset: `bash test/qa-envs/cc-cli/reset.sh`
2. Authenticate the local skill: 
   `FGAC_ROOT_URL=http://localhost:3000 node docs/skills/gmail-fgac/scripts/auth.js --action login`
3. Launch Claude Code IN the workspace using the `--plugin-dir` flag:
   `tmux new-session -d -s fgac-cli-qa -x 200 -y 50 "cd test/qa-envs/cc-cli && claude --dangerously-skip-permissions --plugin-dir ../../../docs/skills/gmail-fgac"`
4. Verify Discovery: Ask Claude "What skills do you have available?" and confirm `gmail-fgac` is listed.
```

---

### Agent 4: OpenClaw (`agents/04_openclaw.md`)

**Reset Script** (`test/qa-envs/openclaw/reset.sh`):
```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
QA_PORT=18790
echo "🧹 Resetting OpenClaw environment..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down -v 2>/dev/null || true
find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true

mkdir -p "$SCRIPT_DIR"/{credentials,data}
cp "$REPO_ROOT/test/testclaw/Dockerfile" "$SCRIPT_DIR/Dockerfile"
cp "$REPO_ROOT/test/testclaw/run-qa.sh" "$SCRIPT_DIR/run-qa.sh"

cat > "$SCRIPT_DIR/docker-compose.yml" << EOF
services:
  testclaw:
    build: .
    hostname: qa-claw
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_PORT: "$QA_PORT"
      FGAC_ROOT_URL: \${FGAC_ROOT_URL:-http://localhost:3000}
    volumes:
      - ./data:/home/node/.openclaw
      # Mount the live repo skill directory as READ-ONLY to prevent agent mutation
      - $REPO_ROOT/docs/skills/gmail-fgac:/home/node/.openclaw/skills/gmail-fgac:ro
      - ./credentials:/home/node/.openclaw/gmail-fgac
    network_mode: host
    init: true
EOF
echo "✅ Workspace ready at: $SCRIPT_DIR (Port $QA_PORT)"
```

**Doc Setup Instructions:**
```markdown
### Environment Setup
1. Run reset: `bash test/qa-envs/openclaw/reset.sh`
2. Ensure base image exists: `docker image inspect openclaw:local`
3. Build & Start:
   `cd test/qa-envs/openclaw && docker compose build`
   `FGAC_ROOT_URL=http://localhost:3000 docker compose up -d`
4. Authenticate: Run `auth.js --action login` via `docker exec`.
```

---

## 4. Production Testing Instructions

The docs in `production/*.md` validate both the **distribution channels** and the **end-to-end functionality**. After installing via the production channel, each agent must execute the *exact same capability checklist* (Send whitelist, Read blacklist, Multi-email scoping, etc.) as the local testing to ensure all plumbing works flawlessly.

- **production/01_hosted_mcp.md**: Test curl directly against `fgac.ai/api/mcp` → Run full capability matrix.
- **production/02_claude_code_mcp.md**: Test `claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp` → Run full capability matrix.
- **production/03_claude_code_cli.md**: Test installing the skill from the Claude Code marketplace → Run full capability matrix.
- **production/04_openclaw.md**: Test `clawhub skill install gmail-fgac` → Run full capability matrix.

*Note: There are currently blockers on production testing for CC CLI (missing marketplace bundle) and OpenClaw (not published to ClawHub), which will need to be resolved before full production validation can occur.*

---

## 5. Execution Plan

1. Create `test/qa-envs/` and the 4 `reset.sh` scripts.
2. Add `.gitignore` for the test workspaces.
3. Update `docs/QA_Acceptance_Test/agents/*.md` to use the new setup workflows natively loading local code.
4. Update `docs/QA_Acceptance_Test/production/*.md` to mandate full functional capability testing post-installation.
5. Validate the local tests (execute `reset.sh` and perform a quick smoke test).
