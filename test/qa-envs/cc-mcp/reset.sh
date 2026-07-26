#!/bin/bash
# Reset the Claude Code *MCP* QA workspace.
#
# Unlike cc-cli, this package has no skill files to install — Claude Code talks
# to FGAC over the HTTP MCP transport. What needs resetting is the tmux session
# and the stored MCP OAuth credentials, because Claude Code reuses a stable
# client ID: a leftover token silently re-binds to whatever proxy key the
# previous cycle approved (see agents/02_claude_code_mcp.md).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

FGAC_URL="${FGAC_ROOT_URL:-http://localhost:3000}"

echo "🧹 Resetting CC MCP environment..."
tmux kill-session -t fgac-qa 2>/dev/null || true

# Wipe workspace except reset.sh
find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true

# Drop any previously registered server so `claude mcp add` starts clean.
(cd "$SCRIPT_DIR" && claude mcp remove fgac-gmail 2>/dev/null) || true

echo "✅ Workspace ready at: $SCRIPT_DIR"
echo ""
echo "Next steps:"
echo "  1. cd $SCRIPT_DIR && claude mcp add --transport http fgac-gmail $FGAC_URL/api/mcp"
echo "  2. tmux new-session -d -s fgac-qa -x 200 -y 50 \"cd $SCRIPT_DIR && claude --dangerously-skip-permissions\""
echo "  3. tmux send-keys -t fgac-qa '/mcp' Enter   # then Authenticate"
echo "  4. Approve the pending connection in the dashboard UI (never via DB writes)"
