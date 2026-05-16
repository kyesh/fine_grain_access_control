#!/bin/bash
# One-time 1Password vault setup for FGAC QA
# Prerequisites: 1Password desktop app open and unlocked
set -euo pipefail

echo "🔧 FGAC 1Password Setup"
echo ""

# Check op connectivity
if ! op vault list &>/dev/null; then
  echo "❌ Cannot connect to 1Password."
  echo "   1. Open the 1Password desktop app"
  echo "   2. Unlock it"
  echo "   3. Settings → Developer → Enable 'Integrate with 1Password CLI'"
  echo "   4. Re-run this script"
  exit 1
fi

# 1. Delete ALL existing FGAC vaults (cleanup duplicates)
echo "🗑️  Cleaning up any existing FGAC vaults..."
EXISTING=$(op vault list --format json | python3 -c "import json,sys; [print(v['id']) for v in json.load(sys.stdin) if v['name']=='FGAC']" 2>/dev/null || true)
for vid in $EXISTING; do
  echo "   Deleting vault $vid"
  op vault delete "$vid" || true
done

# 2. Create one clean vault
echo "📦 Creating FGAC vault..."
VAULT_ID=$(op vault create FGAC --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
echo "   ✅ Vault ID: $VAULT_ID"

# 3. Create the test-emails item
echo "📧 Creating test-emails item..."
op item create \
  --vault "$VAULT_ID" \
  --category Login \
  --title "test-emails" \
  "user-a=kenyesh2@gmail.com" \
  "user-b=kyesh@umich.edu" > /dev/null

# 4. Verify
echo ""
echo "✅ Verifying item..."
op item get test-emails --vault "$VAULT_ID" --fields user-a,user-b
echo ""

# 5. Run qa:secrets to populate .qa_test_emails.json
echo "📦 Populating .qa_test_emails.json..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/qa-secrets.sh"
