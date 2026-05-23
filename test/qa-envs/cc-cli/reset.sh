#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "🧹 Resetting CC CLI environment..."
tmux kill-session -t fgac-cli-qa 2>/dev/null || true
rm -rf ~/.openclaw/gmail-fgac/fgac-credentials.json
rm -rf ~/.openclaw/gmail-fgac/dcr-client.json

# Wipe workspace except reset.sh
find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true

# Copy plugin into .claude/skills/ (mimics what /plugin install does)
mkdir -p "$SCRIPT_DIR/.claude/skills/gmail-fgac"
cp "$REPO_ROOT/public/skills/claude-code-cli/skills/gmail-fgac/SKILL.md" \
   "$SCRIPT_DIR/.claude/skills/gmail-fgac/"
cp -r "$REPO_ROOT/public/skills/claude-code-cli/scripts" \
   "$SCRIPT_DIR/.claude/skills/gmail-fgac/"

# Install dependencies
cd "$SCRIPT_DIR/.claude/skills/gmail-fgac/scripts" && npm install --silent

echo "✅ Workspace ready at: $SCRIPT_DIR"
echo "   Skill installed at: $SCRIPT_DIR/.claude/skills/gmail-fgac/"
echo ""
echo "Next steps:"
echo "  1. Start dev server: npm run dev (from repo root)"
echo "  2. Authenticate: FGAC_ROOT_URL=http://localhost:3000 node $SCRIPT_DIR/.claude/skills/gmail-fgac/scripts/auth.js --action login"
echo "  3. Approve connection in dashboard: http://localhost:3000/dashboard?tab=connections"
echo "  4. Launch Claude Code: tmux new-session -d -s fgac-cli-qa -x 200 -y 50 \"cd $SCRIPT_DIR && claude --dangerously-skip-permissions\""
