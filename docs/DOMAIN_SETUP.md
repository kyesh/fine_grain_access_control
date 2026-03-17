# Custom Domain Setup Guide

This guide walks you through configuring your purchased domain for this project using **Cloudflare** (DNS) and **Vercel** (hosting). The architecture uses Cloudflare for DNS management and Vercel for deploying the Next.js application.

## Prerequisites

- Domain purchased and added to your Cloudflare account
- [Vercel CLI](https://vercel.com/docs/cli) installed (`npm i -g vercel`)
- Project already deployed to Vercel (or linked locally)

## Overview

1. **Vercel**: Add your domain(s) to the project and get the required DNS records
2. **Cloudflare**: Add DNS records pointing to Vercel
3. **Verify**: Ensure SSL and domain propagation

---

## Step 1: Install CLI Tools

```bash
# Install Vercel CLI globally
npm i -g vercel

# Cloudflare: We use the Cloudflare API via curl (no separate CLI needed for DNS)
# Optionally install wrangler if you use Cloudflare Workers/Pages elsewhere:
# npm i -g wrangler
```

---

## Step 2: Link Project to Vercel & Add Domain

From your project root:

```bash
# If not already linked, connect to Vercel
vercel link

# Add your domain(s) to the project
# Replace YOUR_DOMAIN with your actual domain (e.g., proxy.yourdomain.com or yourdomain.com)
vercel domains add YOUR_DOMAIN fine_grain_access_control

# If you also want the www subdomain
vercel domains add www.YOUR_DOMAIN fine_grain_access_control
```

### Inspect Domain Configuration

Vercel will tell you which DNS records are required:

```bash
vercel domains inspect YOUR_DOMAIN
```

This shows the exact A record and CNAME targets Vercel expects.

---

## Step 3: Add DNS Records in Cloudflare

### Option A: Use the Setup Script (Recommended)

We provide a script that uses the Cloudflare API to add the required records:

```bash
# 1. Get your Cloudflare Zone ID:
#    - Cloudflare Dashboard → Your domain → Overview → Zone ID (right sidebar)

# 2. Create an API token with "Zone.DNS Edit" permission:
#    - https://dash.cloudflare.com/profile/api-tokens
#    - Create Token → Edit zone DNS template

# 3. Set environment variables and run:
export CLOUDFLARE_ZONE_ID="your_zone_id"
export CLOUDFLARE_API_TOKEN="your_api_token"
export DOMAIN="yourdomain.com"

./scripts/setup-cloudflare-dns.sh
```

### Option B: Manual Setup via Cloudflare Dashboard

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Select your domain → **DNS** → **Records**
2. Add these records:

| Type  | Name | Content              | Proxy Status | TTL  |
|-------|------|----------------------|--------------|------|
| A     | @    | 76.76.21.21          | **DNS only** | Auto |
| CNAME | www  | cname.vercel-dns.com | **DNS only** | Auto |

**Important**: Set both records to **DNS only** (grey cloud), not proxied. Cloudflare's proxy can interfere with Vercel's edge network and SSL.

### Option C: Cloudflare API (curl)

```bash
# Add A record for apex domain
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "A",
    "name": "@",
    "content": "76.76.21.21",
    "ttl": 1,
    "proxied": false
  }'

# Add CNAME for www
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "CNAME",
    "name": "www",
    "content": "cname.vercel-dns.com",
    "ttl": 1,
    "proxied": false
  }'
```

---

## Step 4: Subdomains (e.g., proxy.yourdomain.com)

For your proxy subdomain as mentioned in the architecture:

```bash
# Add to Vercel
vercel domains add proxy.YOUR_DOMAIN fine_grain_access_control
```

Then in Cloudflare, add:

| Type  | Name   | Content              | Proxy Status |
|-------|--------|----------------------|--------------|
| CNAME | proxy  | cname.vercel-dns.com | DNS only     |

---

## Step 5: Verify & Wait for Propagation

```bash
# Check domain status
vercel domains inspect YOUR_DOMAIN

# Test DNS propagation (may take a few minutes to 48 hours)
dig YOUR_DOMAIN +short
# Should return: 76.76.21.21

dig www.YOUR_DOMAIN +short
# Should return: cname.vercel-dns.com (or a CNAME chain)
```

Vercel will automatically provision SSL certificates once DNS propagates. Check your project's **Domains** tab in the Vercel dashboard for verification status.

---

## Troubleshooting

### "Invalid configuration" or SSL issues
- Ensure Cloudflare proxy is **off** (DNS only) for A and CNAME records
- Wait 24–48 hours for full propagation

### Domain already in use
- Use `vercel domains add YOUR_DOMAIN project-name --force` to move from another project

### Cloudflare API errors
- Verify your API token has **Zone.DNS Edit** permission
- Ensure the Zone ID matches the domain you're configuring
