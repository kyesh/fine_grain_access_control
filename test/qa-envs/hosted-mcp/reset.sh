#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🧹 Resetting Hosted MCP environment..."
rm -f "$SCRIPT_DIR/state.json"
echo "✅ Ready. Run the auth setup in the agent doc."
