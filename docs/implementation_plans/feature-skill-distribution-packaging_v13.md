# Agent Environment Setup: Audit & Fix Plan

## The Problem

Every agent doc says things like:
- *"Prerequisites: `fgac-gmail` configured in `.claude.json`"* — but never shows HOW
- *"Prerequisites: `openclaw:local` image built"* — but never shows HOW
- *"FGAC skill scripts installed locally"* — but never shows HOW

The docs describe **what to test** but skip **how to build the environment**. This is why CC MCP and OpenClaw were blocked and CC CLI was tested incorrectly (running scripts directly instead of through Claude Code).

---

## Agent-by-Agent Audit

### 1. Hosted MCP (curl) — [01_hosted_mcp.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/01_hosted_mcp.md)

#### What the doc says
> **Prerequisites**: Dev server running, fresh DCR client registered

#### What actually exists
- Auth setup section with DCR registration commands ✅
- OAuth flow instructions ✅
- curl-based capability tests ✅

#### What's missing
- Nothing critical — this is the **only doc that works end-to-end** because it uses `curl` directly against the MCP endpoint. No skill installation needed.

#### Verdict: ✅ Adequate (minor polish needed)

---

### 2. Claude Code MCP (tmux) — [02_claude_code_mcp.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/02_claude_code_mcp.md)

#### What the doc says
> **Prerequisites**: `fgac-gmail` configured in `.claude.json` pointing to `http://localhost:3000/api/mcp`

#### What actually exists
- **No `.mcp.json`** in the workspace
- **No `.claude.json`** with MCP server config
- **No instructions** on how to create either file
- The auth setup assumes Claude Code already knows about `fgac-gmail` — but it doesn't

#### What SHOULD be in the doc

**Infrastructure Setup** (before any auth/testing):
```bash
# Step 1: Create .mcp.json in workspace root
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "fgac-gmail": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
EOF

# Step 2: Verify Claude Code can see it
tmux new-session -d -s fgac-qa -x 200 -y 50 "claude --dangerously-skip-permissions"
sleep 5
tmux send-keys -t fgac-qa "/mcp" Enter
sleep 2
# Verify output shows "fgac-gmail" in the server list
tmux capture-pane -t fgac-qa -p | grep "fgac-gmail"
```

> [!WARNING]
> Without `.mcp.json`, Claude Code has NO knowledge of the fgac-gmail server. The `/mcp` command won't show anything to connect to.

#### What makes this different from Hosted MCP
- **Hosted MCP**: We call the MCP endpoint directly with `curl`. We control everything.
- **CC MCP**: Claude Code discovers the MCP server via `.mcp.json`, connects via its built-in MCP client, and the user interacts via natural language prompts. Claude decides when to call tools.

#### Verdict: ❌ **Broken** — missing the most critical setup step

---

### 3. Claude Code CLI (Local Scripts) — [03_claude_code_cli.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/03_claude_code_cli.md)

#### What the doc says
> **Prerequisites**: FGAC skill scripts installed locally (from `docs/skills/gmail-fgac/scripts/`)

#### What actually exists
- The scripts exist at `docs/skills/gmail-fgac/scripts/` ✅
- The doc tells Claude Code to run them via `tmux send-keys` ✅

#### What's WRONG

> [!CAUTION]
> **The CC CLI test I ran was calling `node gmail.js` directly from the terminal — NOT through Claude Code.** This tests the scripts work, but does NOT test Claude Code's ability to discover and invoke them as a skill.

The whole point of this agent is: Claude Code reads SKILL.md → understands what scripts are available → decides which script to call based on natural language prompts → executes the script → interprets the output.

**What SHOULD be in the doc:**

```bash
# Step 1: Install SKILL.md into Claude Code's skills directory
mkdir -p .claude/skills/gmail-fgac
cp docs/skills/gmail-fgac/SKILL.md .claude/skills/gmail-fgac/SKILL.md

# Step 2: Verify the scripts directory is accessible
# The SKILL.md references "scripts/" relative to itself.
# Option A: Symlink scripts (best for dev)
ln -sf $(pwd)/docs/skills/gmail-fgac/scripts .claude/skills/gmail-fgac/scripts

# Option B: Copy scripts (matches production install)
cp -r docs/skills/gmail-fgac/scripts .claude/skills/gmail-fgac/scripts

# Step 3: Install npm dependencies in the scripts directory
cd .claude/skills/gmail-fgac/scripts && npm install && cd -

# Step 4: Authenticate the skill
FGAC_ROOT_URL=http://localhost:3000 node .claude/skills/gmail-fgac/scripts/auth.js --action login
# → Complete OAuth in browser → Approve connection in dashboard

# Step 5: Start Claude Code
tmux new-session -d -s fgac-cli-qa -x 200 -y 50 "claude --dangerously-skip-permissions"
```

Then the tests should verify Claude reads the SKILL.md and invokes scripts based on prompts:
```bash
tmux send-keys -t fgac-cli-qa "List my recent emails" Enter
# Expected: Claude reads SKILL.md, runs: node scripts/gmail.js --action list
# NOT: we call node gmail.js ourselves
```

#### What makes this different from CC MCP
| | CC MCP | CC CLI |
|---|---|---|
| **How Claude finds tools** | `.mcp.json` → MCP server discovery | `.claude/skills/*/SKILL.md` → reads instructions |
| **How Claude calls tools** | JSON-RPC to MCP server | `node scripts/gmail.js` (shell command) |
| **Auth** | MCP OAuth (DCR+PKCE) | REST proxy key via `auth.js` |
| **API endpoint** | `/api/mcp` (JSON-RPC) | `/api/proxy` (REST, rootUrl override) |

#### Verdict: ❌ **Broken** — no skill installation step, and my test bypassed Claude entirely

---

### 4. OpenClaw (Docker) — [04_openclaw.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/04_openclaw.md)

#### What the doc says
> **Prerequisites**: Docker installed, `openclaw:local` image built

#### What actually exists
- `test/testclaw/Dockerfile` — builds from `openclaw:local`, installs `gmail-fgac` skill ✅
- `test/testclaw/docker-compose.yml` — mounts skill + credentials ✅
- `test/testclaw/run-qa.sh` — QA runner script ✅
- `test/testclaw/credentials/` — credential mount dir ✅

#### What's WRONG

1. **`openclaw:local` image doesn't exist** — the doc says "Prerequisites: `openclaw:local` image built" but never explains how to get it
2. **No instructions to build the testclaw image** (`docker compose build`)
3. **No instructions to provision credentials** before starting the container
4. **The `skills/gmail-fgac` directory referenced in Dockerfile line 14 doesn't exist** inside `test/testclaw/`

**What SHOULD be in the doc:**

```bash
# Step 1: Ensure openclaw:local image exists
# Option A: Build from OpenClaw repo
cd ~/GitRepos/openclaw && docker build -t openclaw:local .

# Option B: Use the running production image
docker tag openclaw-openclaw-gateway-1-image openclaw:local

# Step 2: Create the skills directory referenced by the Dockerfile
mkdir -p test/testclaw/skills
cp -r docs/skills/gmail-fgac test/testclaw/skills/gmail-fgac

# Step 3: Build the testclaw image
cd test/testclaw && docker compose build

# Step 4: Pre-provision credentials (or run auth.js inside container after start)
mkdir -p test/testclaw/credentials
# Copy existing credentials or run auth.js after container starts

# Step 5: Start the container
FGAC_ROOT_URL=http://localhost:3000 docker compose up -d

# Step 6: Wait for gateway health
until curl -sf http://localhost:18789/health; do sleep 2; done

# Step 7: If no credentials: run OAuth inside container
docker exec testclaw-testclaw-1 \
  FGAC_ROOT_URL=http://host.docker.internal:3000 \
  node /home/node/.openclaw/skills/gmail-fgac/scripts/auth.js --action login

# Step 8: Approve connection in dashboard
```

#### Verdict: ❌ **Broken** — container never builds, no skill copy step, no credential provisioning

---

## Proposed Solution

### New file: `setup/00_infrastructure.md`

A new setup doc that runs BEFORE `01_signup_and_credential.md`. It bootstraps all 4 agent environments:

```
docs/QA_Acceptance_Test/setup/
├── 00_infrastructure.md          # [NEW] Build all 4 environments
├── 01_signup_and_credential.md   # Sign up, link Google, create first key
├── 02_multi_account_linking.md   # Delegation setup
└── 03_rules_configuration.md    # Access rules
```

### Content outline for `00_infrastructure.md`

```markdown
# Setup: Agent Infrastructure

> Must run before any agent capability tests.
> Sets up all 4 test environments with real skill installations.

## Common Prerequisites
- Node.js 20+, Docker, tmux, Chrome w/ remote debugging (port 9222)
- Dev server running: `npm run dev`
- QA secrets populated: `npm run qa:secrets`

## Environment 1: Hosted MCP (curl)
No additional setup needed. Uses curl directly against /api/mcp.

## Environment 2: Claude Code MCP
1. Create .mcp.json in workspace root
2. Verify: start Claude Code, run /mcp, see fgac-gmail listed

## Environment 3: Claude Code CLI (SKILL.md)
1. Install SKILL.md + scripts into .claude/skills/gmail-fgac/
2. Install npm dependencies
3. Run auth.js --action login
4. Verify: start Claude Code, ask "what skills do you have?", see gmail-fgac

## Environment 4: OpenClaw (Docker)
1. Verify openclaw:local image exists
2. Copy skills into test/testclaw/skills/
3. docker compose build
4. docker compose up -d
5. Verify gateway health
6. Run auth.js inside container or provision credentials
```

### Updates to each agent doc

Each agent doc's **Prerequisites** section gets replaced with:
- Reference to `setup/00_infrastructure.md` environment section
- Verification command to confirm the environment is ready
- No more "X should be installed" without install steps

---

## Summary of Gaps

| Agent | Infrastructure Doc | Skill Installation | Auth Flow | Capability Tests |
|-------|:---:|:---:|:---:|:---:|
| **Hosted MCP** | ✅ N/A | ✅ N/A | ✅ DCR + PKCE | ✅ curl commands |
| **CC MCP** | ❌ No `.mcp.json` creation | ❌ Missing entirely | ⚠️ Assumes server exists | ✅ tmux prompts |
| **CC CLI** | ❌ No SKILL.md install | ❌ Missing entirely | ⚠️ Tests bypass Claude | ⚠️ Runs scripts directly |
| **OpenClaw** | ❌ No image build | ❌ No skill copy | ❌ No credential provision | ✅ Gateway prompts |

### Critical Fix: CC CLI must go through Claude

The CC CLI test MUST verify that **Claude Code reads SKILL.md and decides to call the scripts**. The test prompt should be natural language like "List my recent emails" — and the proof should be Claude's TUI output showing it found the skill and ran `node scripts/gmail.js --action list`.

If we just call `node gmail.js` ourselves, we're testing the **script** (which is the same as the Hosted MCP REST proxy test), not the **Claude Code skill distribution channel**.
