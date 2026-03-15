#!/usr/bin/env bash
#
# Add custom domain(s) to Vercel project via CLI
#
# Prerequisites: vercel link (run from project root first)
# Install: npm i -g vercel
#
# Usage:
#   export DOMAIN="yourdomain.com"
#   export PROJECT_NAME="googleapis_fine_grain_access_control"
#   ./scripts/setup-vercel-domain.sh
#
# Or pass domain as argument:
#   ./scripts/setup-vercel-domain.sh yourdomain.com

set -e

PROJECT_NAME="${PROJECT_NAME:-googleapis_fine_grain_access_control}"
DOMAIN="${DOMAIN:-$1}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: export DOMAIN=yourdomain.com && $0"
  echo "   Or: $0 yourdomain.com"
  exit 1
fi

echo "Adding domain(s) to Vercel project: ${PROJECT_NAME}"
echo ""

# Add apex domain
echo "Adding apex domain: ${DOMAIN}"
vercel domains add "$DOMAIN" "$PROJECT_NAME" || true

# Add www subdomain
echo "Adding www subdomain: www.${DOMAIN}"
vercel domains add "www.${DOMAIN}" "$PROJECT_NAME" || true

echo ""
echo "Domain configuration:"
vercel domains inspect "$DOMAIN" 2>/dev/null || echo "Run 'vercel domains inspect $DOMAIN' after propagation"
