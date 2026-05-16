#!/bin/bash
# Pull QA test secrets from 1Password vault "FGAC"
# Requires: op CLI installed + desktop app integration enabled
#   1Password app → Settings → Developer → "Integrate with 1Password CLI"
#
# Usage: bash scripts/qa-secrets.sh
#   or:  npm run qa:secrets

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📦 Pulling QA secrets from 1Password vault 'FGAC'..."

# Verify op CLI is available
if ! command -v op &> /dev/null; then
  echo "❌ 1Password CLI (op) not found. Install: https://developer.1password.com/docs/cli/get-started/"
  exit 1
fi

# Verify op can authenticate (desktop app integration)
if ! op vault list &> /dev/null; then
  echo "❌ Cannot authenticate with 1Password. Enable desktop app integration:"
  echo "   1Password app → Settings → Developer → 'Integrate with 1Password CLI'"
  exit 1
fi

# Inject test email accounts
TEMPLATE="$REPO_ROOT/.qa_test_emails.json.template"
OUTPUT="$REPO_ROOT/.qa_test_emails.json"

if [ ! -f "$TEMPLATE" ]; then
  echo "❌ Template not found: $TEMPLATE"
  exit 1
fi

op inject -i "$TEMPLATE" -o "$OUTPUT" --force
echo "✅ .qa_test_emails.json populated"

# Verify it's not the example/template content
if grep -q "op://" "$OUTPUT"; then
  echo "❌ Injection failed — output still contains op:// references"
  exit 1
fi

echo ""
echo "📧 Test accounts:"
cat "$OUTPUT"
echo ""
echo "🎉 All QA secrets populated. Ready for testing."
