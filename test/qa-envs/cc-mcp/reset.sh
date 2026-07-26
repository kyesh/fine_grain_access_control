#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🧹 Resetting CC MCP environment..."
tmux kill-session -t fgac-qa 2>/dev/null || true

# Drop the MCP server registration AND its stored OAuth token.
#
# Claude Code's MCP transport uses a stable client ID, so a leftover token from
# a previous cycle silently re-matches to the connection it was approved
# against — and therefore to that cycle's proxy key, which may not be the key
# this run intends to test (see agents/02_claude_code_mcp.md, "Existing
# Connection Re-use"). Removing the server clears the credential with it, so
# every run starts from a genuine unauthenticated state.
#
# Run from SCRIPT_DIR: `claude mcp` resolves local-scope servers by cwd.
(cd "$SCRIPT_DIR" && claude mcp remove fgac-gmail 2>/dev/null) || true

find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true
echo "✅ Workspace ready at: $SCRIPT_DIR"
echo "   Re-add the server with:"
echo "   cd $SCRIPT_DIR && claude mcp add --transport http fgac-gmail http://localhost:3000/api/mcp"
