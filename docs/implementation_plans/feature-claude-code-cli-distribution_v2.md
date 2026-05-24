# Claude Code CLI Skill — Marketplace Distribution & Validation (v2)

Focus on Package #4 (Claude Code CLI) from the distribution architecture. Narrowing scope from all 4 distribution channels to get this one working end-to-end: build → local QA → publish marketplace → production QA.

## Problem Statement

The Claude Code CLI skill (Package #4) lets Claude Code users install a SKILL.md + local scripts bundle for Gmail via the FGAC.ai proxy. The scripts exist in `docs/skills/gmail-fgac/scripts/` and work for OpenClaw, but:

1. **No distribution channel** — No marketplace repo exists. Claude Code supports `/plugin marketplace add owner/repo` for GitHub-hosted plugin marketplaces, but we haven't created one.
2. **No plugin manifest** — Claude Code expects `.claude-plugin/plugin.json` and `skills/*/SKILL.md` structure. Our scripts don't follow this format.
3. **The CC CLI QA test is broken** — `reset.sh` doesn't copy skills into `.claude/skills/`, and the runbook uses `--plugin-dir` which may not work with the current Claude Code version.
4. **Scripts live in the wrong place** — `docs/skills/gmail-fgac/scripts/` is for the OpenClaw skill. The Claude Code CLI needs its own self-contained bundle.

## Proposed Changes

### 1. Move canonical scripts & create Claude Code plugin structure

#### [NEW] `public/skills/claude-code-cli/` — Self-contained plugin

Move the canonical scripts from `docs/skills/gmail-fgac/scripts/` to `public/skills/claude-code-cli/scripts/` and structure as a proper Claude Code plugin:

```
public/skills/claude-code-cli/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── skills/
│   └── gmail-fgac/
│       └── SKILL.md             # Skill instructions for Claude
├── scripts/
│   ├── auth.js                  # OAuth DCR+PKCE flow
│   ├── gmail.js                 # Gmail API operations
│   ├── accounts.js              # Account listing
│   ├── shared.js                # Shared utilities
│   ├── setup.js                 # Setup helper
│   └── package.json             # Dependencies (googleapis)
└── README.md                    # Human-readable docs
```

**plugin.json**:
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

**SKILL.md** (inside `skills/gmail-fgac/`): Simplified version focused exclusively on CLI mode — how Claude should invoke the scripts, auth flow, tool usage.

#### [MODIFY] [docs/skills/gmail-fgac/SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/skills/gmail-fgac/SKILL.md)

Update to reference the new canonical location. The OpenClaw skill will still work — it references scripts by relative path. We'll either:
- Keep a copy of scripts in `docs/skills/gmail-fgac/scripts/` for OpenClaw (since OpenClaw installs from a different path), OR
- Symlink `docs/skills/gmail-fgac/scripts/` → `public/skills/claude-code-cli/scripts/`

> [!IMPORTANT]
> OpenClaw still needs `docs/skills/gmail-fgac/scripts/` for its own distribution. Since the scripts are shared, we should keep them in ONE place and have the other reference it. The canonical location will be `public/skills/claude-code-cli/scripts/` and `docs/skills/gmail-fgac/scripts/` will contain a symlink or redirect notice pointing to it.

---

### 2. Create GitHub marketplace repo

#### [NEW] GitHub repo: `kyesh/fgac-marketplace`

A Claude Code marketplace repository following the standard format:

```
fgac-marketplace/
├── .claude-plugin/
│   └── marketplace.json         # Marketplace catalog
├── plugins/
│   └── fgac-gmail/              # Symlink or copy of public/skills/claude-code-cli/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── skills/
│       │   └── gmail-fgac/
│       │       └── SKILL.md
│       ├── scripts/
│       │   ├── auth.js
│       │   ├── gmail.js
│       │   ├── accounts.js
│       │   ├── shared.js
│       │   ├── setup.js
│       │   └── package.json
│       └── README.md
└── README.md                    # How to add this marketplace
```

**marketplace.json**:
```json
{
  "name": "fgac-marketplace",
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
      "source": "./plugins/fgac-gmail",
      "description": "Secure Gmail access via FGAC.ai proxy with fine-grained access control"
    }
  ]
}
```

**User install flow**:
```bash
# Add the FGAC marketplace (one-time)
/plugin marketplace add kyesh/fgac-marketplace

# Install the Gmail skill
/plugin install fgac-gmail@fgac-marketplace
```

---

### 3. Fix the CC CLI test environment

#### [MODIFY] [reset.sh](file:///home/kyesh/GitRepos/fine_grain_access_control/test/qa-envs/cc-cli/reset.sh)

Update to:
1. Wipe the workspace clean
2. Copy the plugin from `public/skills/claude-code-cli/` into the workspace's `.claude/skills/gmail-fgac/` directory (mimicking what `/plugin install` does)
3. Run `npm install` in the copied scripts directory
4. Clear any stale auth credentials

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
- Remove `--plugin-dir` (not the right mechanism)
- Launch Claude Code FROM `test/qa-envs/cc-cli/` where `.claude/skills/gmail-fgac/` exists
- Use `tmux` for interactive session (as the existing QA flow does)
- Fix auth command paths to reference the skill's scripts directory
- Update launch command:
  ```bash
  tmux new-session -d -s fgac-cli-qa -x 200 -y 50 \
    "cd $REPO_ROOT/test/qa-envs/cc-cli && claude --dangerously-skip-permissions"
  ```

---

### 4. Update production distribution docs

#### [MODIFY] [production/03_claude_code_cli.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/production/03_claude_code_cli.md)

Update to use the marketplace install flow:

```markdown
## Install from Distribution Channel

1. Add the FGAC marketplace:
   ```
   /plugin marketplace add kyesh/fgac-marketplace
   ```

2. Install the Gmail skill:
   ```
   /plugin install fgac-gmail@fgac-marketplace
   ```

3. Verify install:
   ```
   /plugin list
   ```
   - `[ ]` `fgac-gmail` appears in the list
   - `[ ]` `.claude/skills/gmail-fgac/SKILL.md` exists
   - `[ ]` `node .claude/skills/gmail-fgac/scripts/gmail.js --help` works
```

---

### 5. Clean up the unified SKILL.md

#### [MODIFY] [public/skills/claude-code/SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)

Simplify to MCP-only (Option A). Add a note pointing CLI users to the marketplace:

```markdown
> For CLI-based access (local scripts instead of MCP), install the `fgac-gmail`
> plugin: `/plugin marketplace add kyesh/fgac-marketplace` then
> `/plugin install fgac-gmail@fgac-marketplace`
```

---

## Execution Order

| Phase | Step | What |
|-------|------|------|
| **Build** | 1 | Move scripts to `public/skills/claude-code-cli/scripts/` |
| | 2 | Create plugin structure (`.claude-plugin/plugin.json`, `skills/gmail-fgac/SKILL.md`) |
| | 3 | Update `docs/skills/gmail-fgac/` to reference new canonical location |
| | 4 | Simplify `public/skills/claude-code/SKILL.md` to MCP-only |
| **Local QA** | 5 | Fix `test/qa-envs/cc-cli/reset.sh` |
| | 6 | Update `agents/03_claude_code_cli.md` runbook |
| | 7 | Run local QA: `reset.sh` → auth → Claude discovers skill → run capabilities via tmux |
| **Publish** | 8 | Create `kyesh/fgac-marketplace` GitHub repo |
| | 9 | Populate with plugin files (copy from `public/skills/claude-code-cli/`) |
| | 10 | Test: `/plugin marketplace add kyesh/fgac-marketplace` → `/plugin install fgac-gmail@fgac-marketplace` |
| **Preview** | 11 | Deploy PR to preview via `/deploy-pr-preview` |
| | 12 | Verify marketplace install works with preview API endpoints |
| **Production** | 13 | Update `production/03_claude_code_cli.md` |
| | 14 | Validate production install from marketplace → capabilities against `gmail.fgac.ai` |

## User Review Required

> [!IMPORTANT]
> **GitHub repo ownership**: Plan uses `kyesh/fgac-marketplace`. Should this be under a different org (e.g., `fgac-ai/marketplace`)? The marketplace URL is user-visible in install commands.

> [!WARNING]
> **Script dual-location**: Both OpenClaw and Claude Code CLI need the same scripts. Plan moves the canonical copy to `public/skills/claude-code-cli/scripts/` and updates `docs/skills/gmail-fgac/scripts/` to reference it. This means the OpenClaw skill path changes. Is that acceptable, or should we maintain both copies?

## Verification Plan

### Local Testing
1. `bash test/qa-envs/cc-cli/reset.sh` completes without errors
2. `node .claude/skills/gmail-fgac/scripts/gmail.js --help` exits 0 from the workspace
3. Claude Code launched via tmux discovers `gmail-fgac` skill
4. Auth flow: `FGAC_ROOT_URL=http://localhost:3000 node scripts/auth.js --action login` completes
5. Full capability run through tmux (interactive, per existing QA flow)

### Preview Testing
6. Deploy to preview via `/deploy-pr-preview`
7. Marketplace install works: `/plugin marketplace add kyesh/fgac-marketplace` → install succeeds
8. Scripts run against preview deployment endpoints

### Production Testing
9. Full QA run from `production/03_claude_code_cli.md` against `fgac.ai` / `gmail.fgac.ai`
