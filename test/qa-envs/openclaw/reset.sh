#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
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
      - $REPO_ROOT/docs/skills/fgac:/home/node/.openclaw/skills/fgac:ro
      - ./credentials:/home/node/.openclaw/fgac
    network_mode: host
    init: true
EOF
echo "✅ Workspace ready at: $SCRIPT_DIR (Port $QA_PORT)"
