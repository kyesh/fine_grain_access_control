#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🧹 Resetting CC MCP environment..."
tmux kill-session -t fgac-qa 2>/dev/null || true
find "$SCRIPT_DIR" -mindepth 1 ! -name 'reset.sh' -exec rm -rf {} + 2>/dev/null || true
echo "✅ Workspace ready at: $SCRIPT_DIR"
