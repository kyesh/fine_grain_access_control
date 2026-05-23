# Agent QA: Comprehensive Environment & Distribution Plan (v5)

This plan provides a robust, repeatable QA framework that separates **local functional testing** from **production distribution testing**, while keeping all agent environments strictly isolated.

---

## 1. Workspaces & Isolation Strategy

To prevent agents from clobbering each other or polluting the root repository, all testing will occur in dedicated, isolated workspaces under `test/qa-envs/`. 

```
test/qa-envs/
├── .gitignore                      # Ignores all runtime state below
│
├── hosted-mcp/                     # Workspace for Hosted MCP
│   └── reset.sh                    # Clears token state
│
├── cc-mcp/                         # Workspace for Claude Code MCP
│   ├── reset.sh                    # Wipes dir → creates .mcp.json
│   └── .mcp.json                   # (Runtime config)
│
├── cc-cli/                         # Workspace for Claude Code CLI
│   ├── reset.sh                    # Wipes dir → copies SKILL.md & scripts
│   └── .claude/skills/gmail-fgac/  # (Runtime skill files)
│
└── openclaw/                       # Workspace for OpenClaw Docker (port 18790)
    ├── reset.sh                    # Wipes dir → scaffolds Docker config
    ├── docker-compose.yml          # (Runtime config)
    └── skills/gmail-fgac/          # (Runtime skill files)
```

**Key Principles:**
- Every test session begins by running the agent's `reset.sh` script to guarantee a clean slate.
- Claude Code MUST be launched from within its respective workspace directory (`cd test/qa-envs/cc-mcp` or `cd test/qa-envs/cc-cli`).
- OpenClaw QA runs on port **18790** to avoid conflicting with any real OpenClaw instance on 18789.

---

## 2. Local vs. Production Distinction

It is critical to distinguish what we are testing in local vs. production environments. We have 4 agent environments, served by 3 distribution channels.

| Layer | Goal | Installation Method | API Target |
|-------|------|---------------------|------------|
| **Local** (`agents/`) | Validate new skill features, rules, and access scoping. | Manual (`cp -r` from local repo into workspace). | `localhost:3000` |
| **Production** (`production/`) | Validate the distribution channels themselves (Marketplace, ClawHub) work as expected. | Real distribution tools (`claude mcp add`, `clawhub install`). | `fgac.ai` & `gmail.fgac.ai` |

### The 4 Agents & Their Channels

| Agent | Local Install (`agents/`) | Production Install (`production/`) |
|-------|---------------------------|-------------------------------------|
| **1. Hosted MCP** | Direct HTTP requests | Direct HTTP requests |
| **2. CC MCP** | Create `.mcp.json` pointing to localhost | Claude Code Marketplace: `claude mcp add` |
| **3. CC CLI** | `cp -r` SKILL.md & scripts into workspace | Claude Code Marketplace: Install skill bundle |
| **4. OpenClaw** | `cp -r` skill files into Docker volume | ClawHub Registry: `clawhub skill install` |

*(Note: Claude Code Marketplace distributes TWO packages: an MCP server registration, and a standalone CLI skill bundle.)*

---

## 3. Clear Setup Instructions per Agent

We will rewrite the `agents/*.md` and `production/*.md` docs to include explicit setup instructions. Below are the details for the local functional tests.

### Agent 1: Hosted MCP (`agents/01_hosted_mcp.md`)

**Reset Script** (`test/qa-envs/hosted-mcp/reset.sh`):
```bash
#!/bin/bash
set -euo pipefail
echo "🧹 Resetting Hosted MCP environment..."
rm -f /tmp/fgac_qa_token /tmp/fgac_qa_client_id
echo "✅ Ready. Run the auth setup in the agent doc."
```

**Doc Setup Instructions:**
```markdown
### Environment Setup
1. Run reset: `bash test/qa-envs/hosted-mcp/reset.sh`
2. Ensure dev server is running at `http://localhost:3000`.
3. Proceed to Auth flow (DCR registration via curl).
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

cat > "$SCRIPT_DIR/.mcp.json" << EOF
{
  "mcpServers": {
    "fgac-gmail": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
EOF
echo "✅ Workspace ready at: $SCRIPT_DIR"
```

**Doc Setup Instructions:**
```markdown
### Environment Setup
1. Run reset: `bash test/qa-envs/cc-mcp/reset.sh`
2. Launch Claude Code IN the workspace:
   `tmux new-session -d -s fgac-qa -x 200 -y 50 "cd test/qa-envs/cc-mcp && claude --dangerously-skip-permissions"`
3. Verify Discovery: Enter `/mcp` in Claude Code and confirm `fgac-gmail` is listed.
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

mkdir -p "$SCRIPT_DIR/.claude/skills/gmail-fgac"
cp "$REPO_ROOT/docs/skills/gmail-fgac/SKILL.md" "$SCRIPT_DIR/.claude/skills/gmail-fgac/"
cp -r "$REPO_ROOT/docs/skills/gmail-fgac/scripts" "$SCRIPT_DIR/.claude/skills/gmail-fgac/"
cd "$SCRIPT_DIR/.claude/skills/gmail-fgac/scripts" && npm install --silent

echo "✅ Workspace ready at: $SCRIPT_DIR"
```

**Doc Setup Instructions:**
```markdown
### Environment Setup
1. Run reset: `bash test/qa-envs/cc-cli/reset.sh`
2. Authenticate: 
   `FGAC_ROOT_URL=http://localhost:3000 node test/qa-envs/cc-cli/.claude/skills/gmail-fgac/scripts/auth.js --action login`
3. Launch Claude Code IN the workspace:
   `tmux new-session -d -s fgac-cli-qa -x 200 -y 50 "cd test/qa-envs/cc-cli && claude --dangerously-skip-permissions"`
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

mkdir -p "$SCRIPT_DIR"/{skills,credentials,data}
cp "$REPO_ROOT/test/testclaw/Dockerfile" "$SCRIPT_DIR/Dockerfile"
cp "$REPO_ROOT/test/testclaw/run-qa.sh" "$SCRIPT_DIR/run-qa.sh"
cp -r "$REPO_ROOT/docs/skills/gmail-fgac" "$SCRIPT_DIR/skills/"

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
      - ./skills/gmail-fgac:/home/node/.openclaw/skills/gmail-fgac
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

The docs in `production/*.md` will be updated to explicitly test the distribution channels:

- **production/01_hosted_mcp.md**: Test curl directly against `fgac.ai/api/mcp`.
- **production/02_claude_code_mcp.md**: Test `claude mcp add --transport http fgac-gmail https://fgac.ai/api/mcp`.
- **production/03_claude_code_cli.md**: Test installing the skill from the Claude Code marketplace (simulated or real).
- **production/04_openclaw.md**: Test `clawhub skill install gmail-fgac`.

*Note: There are currently blockers on production testing for CC CLI (missing marketplace bundle) and OpenClaw (not published to ClawHub), which will need to be resolved before full production validation can occur.*

---

## 5. Execution Plan

1. Create `test/qa-envs/` and the 4 `reset.sh` scripts.
2. Add `.gitignore` for the test workspaces.
3. Update `docs/QA_Acceptance_Test/agents/*.md` to use the new setup workflows.
4. Update `docs/QA_Acceptance_Test/production/*.md` to focus strictly on validating the distribution endpoints.
5. Validate the local tests (execute `reset.sh` and perform a quick smoke test).
