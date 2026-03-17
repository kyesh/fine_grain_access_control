#!/usr/bin/env bash
#
# Setup Cloudflare DNS records for Vercel deployment
#
# Usage:
#   export CLOUDFLARE_ZONE_ID="your_zone_id"
#   export CLOUDFLARE_API_TOKEN="your_api_token"
#   export DOMAIN="yourdomain.com"           # e.g., example.com (without www)
#   export ADD_WWW=true                      # optional, default: true
#   ./scripts/setup-cloudflare-dns.sh
#
# Get Zone ID: Cloudflare Dashboard → Your domain → Overview → Zone ID
# Create API token: https://dash.cloudflare.com/profile/api-tokens
#   Use "Edit zone DNS" template with Zone.DNS Edit permission

set -e

# Vercel's IP for A records (apex domain)
VERCEL_A_RECORD="76.76.21.21"
VERCEL_CNAME="cname.vercel-dns.com"

# Cloudflare proxy must be OFF when using with Vercel
PROXY="false"

# Required env vars
if [[ -z "$CLOUDFLARE_ZONE_ID" ]]; then
  echo "Error: CLOUDFLARE_ZONE_ID is not set"
  echo "Get it from: Cloudflare Dashboard → Your domain → Overview → Zone ID"
  exit 1
fi

if [[ -z "$CLOUDFLARE_API_TOKEN" ]]; then
  echo "Error: CLOUDFLARE_API_TOKEN is not set"
  echo "Create one at: https://dash.cloudflare.com/profile/api-tokens"
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  echo "Error: DOMAIN is not set"
  echo "Example: export DOMAIN=example.com"
  exit 1
fi

ADD_WWW="${ADD_WWW:-true}"
API_BASE="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records"

echo "Setting up DNS for ${DOMAIN} in Cloudflare zone ${CLOUDFLARE_ZONE_ID}"
echo ""

# Add A record for apex (@)
echo "Adding A record: @ -> ${VERCEL_A_RECORD}"
resp=$(curl -s -X POST "$API_BASE" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"A\",
    \"name\": \"@\",
    \"content\": \"${VERCEL_A_RECORD}\",
    \"ttl\": 1,
    \"proxied\": ${PROXY}
  }")

if echo "$resp" | grep -q '"success":true'; then
  echo "  ✓ A record added"
else
  if echo "$resp" | grep -q 'already exists'; then
    echo "  → A record already exists (skipping)"
  else
    echo "  ✗ Failed: $resp"
    exit 1
  fi
fi

# Add CNAME for www (optional)
if [[ "$ADD_WWW" == "true" ]]; then
  echo "Adding CNAME record: www -> ${VERCEL_CNAME}"
  resp=$(curl -s -X POST "$API_BASE" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"CNAME\",
      \"name\": \"www\",
      \"content\": \"${VERCEL_CNAME}\",
      \"ttl\": 1,
      \"proxied\": ${PROXY}
    }")

  if echo "$resp" | grep -q '"success":true'; then
    echo "  ✓ CNAME record added"
  else
    if echo "$resp" | grep -q 'already exists'; then
      echo "  → CNAME record already exists (skipping)"
    else
      echo "  ✗ Failed: $resp"
      exit 1
    fi
  fi
fi

echo ""
echo "Done! Next steps:"
echo "  1. Add domain in Vercel: vercel domains add ${DOMAIN} fine_grain_access_control"
echo "  2. Verify: vercel domains inspect ${DOMAIN}"
echo "  3. DNS propagation may take up to 48 hours"
