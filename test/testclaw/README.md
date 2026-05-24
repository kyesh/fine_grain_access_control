# TestClaw — FGAC QA Testing Container

Lightweight OpenClaw container for automated FGAC skill distribution QA testing. Simplified from DemoClaw — no Tailscale, no GOG CLI.

## Quick Start

```bash
# 1. Ensure local dev server is running
npm run dev  # from the FGAC repo root

# 2. Copy credentials
mkdir -p test/testclaw/credentials
cp ~/.openclaw/gmail-fgac/fgac-credentials.json test/testclaw/credentials/

# 3. Build and run
cd test/testclaw
docker compose up --build

# Tests run automatically, exit 0 on pass, 1 on fail
```

## What It Tests

| Test | Description |
|------|-------------|
| Discovery | `.well-known` OAuth endpoints return valid metadata |
| Auth 401 | Unauthenticated MCP requests are rejected |
| Gmail List | `gmail.js --action list` returns data through FGAC proxy |
| Auth Status | `auth.js --action status` reports connection state correctly |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `FGAC_ROOT_URL` | `http://host.docker.internal:3000` | FGAC server URL |
| `OPENCLAW_GATEWAY_TOKEN` | `test-token` | OpenClaw gateway token |

## Targeting Vercel Preview

```bash
FGAC_ROOT_URL=https://your-preview.vercel.app docker compose up --build
```
