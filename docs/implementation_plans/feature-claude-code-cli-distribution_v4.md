# Claude Code CLI Skill — Marketplace Distribution & Validation (v3)

Focus on Package #4 (Claude Code CLI). Get one distribution channel working end-to-end: build → local QA → publish marketplace → production QA.

## Distribution Channel

Use the **existing repo** (`kyesh/fine_grain_access_control`) as the Claude Code plugin marketplace. Users install via:

```bash
/plugin marketplace add kyesh/fine_grain_access_control
/plugin install fgac-gmail@fine_grain_access_control
```

No separate repo needed — `.claude-plugin/marketplace.json` at the repo root catalogs the plugin, and Claude Code ignores all non-plugin files.

---

## Proposed Changes

### 1. Add marketplace manifest at repo root

#### [NEW] `.claude-plugin/marketplace.json`

```json
{
  "name": "fine_grain_access_control",
  "owner": {
    "name": "FGAC.ai",
    "email": "support@fgac.ai"
  },
  "metadata": {
    "description": "Official FGAC.ai plugins for Claude Code — secure Gmail access with fine-grained access control",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "fgac-gmail",
      "source": "./public/skills/claude-code-cli",
      "description": "Secure Gmail access via FGAC.ai proxy with fine-grained access control"
    }
  ]
}
```

---

### 2. Create self-contained plugin at `public/skills/claude-code-cli/`

Move canonical scripts from `docs/skills/gmail-fgac/scripts/` → `public/skills/claude-code-cli/scripts/` and structure as a Claude Code plugin:

#### [NEW] `public/skills/claude-code-cli/.claude-plugin/plugin.json`

```json
{
  "name": "fgac-gmail",
  "version": "2.0.0",
  "description": "Secure Gmail access for Claude Code via FGAC.ai — fine-grained access control for AI agents",
  "author": {
    "name": "fgac-ai",
    "email": "support@fgac.ai"
  },
  "license": "MIT-0",
  "keywords": ["gmail", "email", "security", "fgac"]
}
```

#### [NEW] `public/skills/claude-code-cli/skills/gmail-fgac/SKILL.md`

Focused CLI-mode skill instructions for Claude — how to invoke `auth.js`, `gmail.js`, `accounts.js`. Replaces the dual-mode (MCP + CLI) approach in the current `public/skills/claude-code/SKILL.md`.

#### [MOVE] `docs/skills/gmail-fgac/scripts/*` → `public/skills/claude-code-cli/scripts/*`

Files moved:
- `auth.js`, `gmail.js`, `accounts.js`, `shared.js`, `setup.js`
- `package.json`, `package-lock.json`

#### [NEW] `public/skills/claude-code-cli/README.md`

Human-readable install & usage docs.

---

### 3. Update OpenClaw skill to reference new script location

#### [MODIFY] [docs/skills/gmail-fgac/](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/)

Replace the scripts directory with a symlink or a README redirect:

```
docs/skills/gmail-fgac/
├── SKILL.md                    ← Keep (OpenClaw frontmatter)
└── scripts → ../../public/skills/claude-code-cli/scripts/  ← Symlink
```

If symlinks cause issues with OpenClaw distribution, keep a copy and add a sync note at the top of each file.

---

### 4. Simplify the MCP-only SKILL.md

#### [MODIFY] [public/skills/claude-code/SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)

Remove Option B (CLI). Keep only Option A (MCP). Add a note:

```markdown
> For CLI-based access (local scripts), install the `fgac-gmail` plugin:
> `/plugin marketplace add kyesh/fine_grain_access_control`
> then `/plugin install fgac-gmail@fine_grain_access_control`
```

---

### 5. Fix CC CLI test environment

#### [MODIFY] [test/qa-envs/cc-cli/reset.sh](file:///home/kyesh/GitRepos/fine_grain_access_control/test/qa-envs/cc-cli/reset.sh)

```bash
#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "🧹 Resetting CC CLI environment..."
tmux kill-session -t fgac-cli-qa 2>/dev/null || true
rm -rf ~/.openclaw/gmail-fgac/fgac-credentials.json

# Wipe workspace except reset.sh
find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true

# Copy plugin into .claude/skills/ (mimics marketplace install)
mkdir -p "$SCRIPT_DIR/.claude/skills/gmail-fgac"
cp "$REPO_ROOT/public/skills/claude-code-cli/skills/gmail-fgac/SKILL.md" \
   "$SCRIPT_DIR/.claude/skills/gmail-fgac/"
cp -r "$REPO_ROOT/public/skills/claude-code-cli/scripts" \
   "$SCRIPT_DIR/.claude/skills/gmail-fgac/"

# Install dependencies
cd "$SCRIPT_DIR/.claude/skills/gmail-fgac/scripts" && npm install --silent

echo "✅ Workspace ready at: $SCRIPT_DIR"
echo "   Skill installed at: $SCRIPT_DIR/.claude/skills/gmail-fgac/"
```

#### [MODIFY] [agents/03_claude_code_cli.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/03_claude_code_cli.md)

Update the QA runbook:
- Remove `--plugin-dir` flag
- Launch Claude Code from `test/qa-envs/cc-cli/` where `.claude/skills/gmail-fgac/` has been installed by `reset.sh`
- Use tmux for interactive session
- Fix auth command paths to use the installed skill's script directory:
  ```bash
  FGAC_ROOT_URL=http://localhost:3000 \
    node test/qa-envs/cc-cli/.claude/skills/gmail-fgac/scripts/auth.js --action login
  ```
- Launch command:
  ```bash
  tmux new-session -d -s fgac-cli-qa -x 200 -y 50 \
    "cd $REPO_ROOT/test/qa-envs/cc-cli && claude --dangerously-skip-permissions"
  ```

---

### 6. Update production distribution doc

#### [MODIFY] [production/03_claude_code_cli.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/production/03_claude_code_cli.md)

```markdown
## Install from Distribution Channel

1. Add the FGAC marketplace:
   ```
   /plugin marketplace add kyesh/fine_grain_access_control
   ```

2. Install the Gmail skill:
   ```
   /plugin install fgac-gmail@fine_grain_access_control
   ```

3. Verify install:
   - [ ] `/plugin list` shows `fgac-gmail`
   - [ ] `.claude/skills/gmail-fgac/SKILL.md` exists
   - [ ] `node .claude/skills/gmail-fgac/scripts/gmail.js --help` works
```

---

## Execution Order

| Phase | Step | What |
|-------|------|------|
| **Build** | 1 | Create `.claude-plugin/marketplace.json` at repo root |
| | 2 | Create `public/skills/claude-code-cli/` plugin structure |
| | 3 | Move scripts from `docs/skills/gmail-fgac/scripts/` → `public/skills/claude-code-cli/scripts/` |
| | 4 | Create new CLI-focused `SKILL.md` in `public/skills/claude-code-cli/skills/gmail-fgac/` |
| | 5 | Update `docs/skills/gmail-fgac/scripts/` to symlink or reference new location |
| | 6 | Simplify `public/skills/claude-code/SKILL.md` to MCP-only |
| **Local QA** | 7 | Fix `test/qa-envs/cc-cli/reset.sh` |
| | 8 | Update `agents/03_claude_code_cli.md` runbook |
| | 9 | Run local QA: `reset.sh` → auth → Claude discovers skill → run capabilities via tmux |
| **Preview** | 10 | Push branch & deploy PR via `/deploy-pr-preview` |
| | 11 | Test marketplace from feature branch: `/plugin marketplace add kyesh/fine_grain_access_control#feature/claude-code-cli-distribution` |
| | 12 | `/plugin install fgac-gmail@fine_grain_access_control` → verify skill installs |
| | 13 | Run auth against preview Vercel URL → verify scripts work against preview API endpoints |
| **Production** | 14 | Merge to main → marketplace goes live on default branch |
| | 15 | Test marketplace from main: `/plugin marketplace add kyesh/fine_grain_access_control` (no branch ref needed) |
| | 16 | Full QA from `production/03_claude_code_cli.md` against `fgac.ai` / `gmail.fgac.ai` |

> [!IMPORTANT]
> **Two independent systems at play:**
> - **Marketplace** (GitHub-based): `/plugin marketplace add` clones from GitHub. During preview, we must use `#branch-name` to point at the feature branch. After merge, the default branch works.
> - **API endpoints** (Vercel-based): `auth.js` and `gmail.js` talk to the FGAC server. During preview, scripts must use the preview Vercel URL. After merge, they default to `fgac.ai`.

---

## Verification Plan

### Local Testing (scripts + skill discovery)
1. `bash test/qa-envs/cc-cli/reset.sh` completes without errors
2. `node test/qa-envs/cc-cli/.claude/skills/gmail-fgac/scripts/gmail.js --help` exits 0
3. Claude Code launched via tmux from workspace discovers `gmail-fgac` skill
4. Auth flow completes: `FGAC_ROOT_URL=http://localhost:3000 node scripts/auth.js --action login`
5. Full capability run through tmux (interactive, per QA flow)

### Preview Testing (marketplace install + preview API)
6. Push branch, deploy PR via `/deploy-pr-preview`
7. Test marketplace from feature branch:
   ```
   /plugin marketplace add kyesh/fine_grain_access_control#feature/claude-code-cli-distribution
   /plugin install fgac-gmail@fine_grain_access_control
   ```
8. Verify skill files are installed correctly (`.claude/skills/gmail-fgac/` populated)
9. Auth against preview URL: `FGAC_ROOT_URL=https://<preview-url> node scripts/auth.js --action login`
10. Run at least one capability (e.g., list emails) against preview endpoints

### Production Testing (marketplace from main + prod API)
11. After merge to main:
    ```
    /plugin marketplace add kyesh/fine_grain_access_control
    /plugin install fgac-gmail@fine_grain_access_control
    ```
12. Auth against production: `node scripts/auth.js --action login` (defaults to `fgac.ai`)
13. Full QA run from `production/03_claude_code_cli.md` against `fgac.ai` / `gmail.fgac.ai`
