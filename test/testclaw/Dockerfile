# TestClaw — Lightweight OpenClaw container for FGAC QA testing
# Simplified from DemoClaw: no Tailscale, no GOG CLI
# Purpose: Run automated QA tests against FGAC (local dev or Vercel preview)

FROM openclaw:local

USER root

# Install curl + jq for QA script assertions
RUN apt-get update && apt-get install -y --no-install-recommends curl jq && \
    rm -rf /var/lib/apt/lists/*

# Pre-install the gmail-fgac skill
COPY skills/gmail-fgac /home/node/.openclaw/skills/gmail-fgac

# Copy FGAC credentials (pre-provisioned OAuth tokens + proxy key)
# These get volume-mounted at runtime for flexibility
RUN mkdir -p /home/node/.openclaw/gmail-fgac

# Copy QA test runner
COPY run-qa.sh /home/node/run-qa.sh
RUN chmod +x /home/node/run-qa.sh

USER node
WORKDIR /home/node

ENV OPENCLAW_PORT=18789
ENV FGAC_ROOT_URL=http://localhost:3000

EXPOSE 18789

# Default: start OpenClaw gateway, then run QA
CMD ["/home/node/run-qa.sh"]
