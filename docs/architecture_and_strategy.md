# Fine-Grained Access Control for Google APIs: Architecture & Strategy

## 1. Problem Statement
When giving AI agents access to Google APIs (like Gmail) on behalf of users, standard OAuth scopes (like `https://mail.google.com/`) provide overly broad access. This creates a "Rogue Agent" or "Confused Deputy" risk, where an agent could maliciously or accidentally delete important files, read sensitive emails, or perform destructive actions outside its intended scope.

The goal is to provide a proxy or gateway that intercepts agent requests to Google APIs, validates them against fine-grained rules (e.g., "Agent can only read files within Folder X", "Agent cannot use HTTP DELETE"), and forwards valid requests to Google. Crucially, we want to allow developers to use **off-the-shelf Google SDKs** with minimal friction.

## 2. Key Findings & Constraints

1. **Service Accounts vs. Proxies**: For Google Workspace APIs like Drive and Calendar, sharing specific resources directly with a Service Account is heavily underutilized but provides native, perfect isolation without needing a proxy. However, this model breaks down completely for Gmail (which requires Domain-Wide Delegation and grants full inbox access). To secure Gmail, a custom proxy is required.
2. **Tokens and Bypassing**: Giving self-modifying agents real Google Access Tokens is dangerous. An agent could simply rewrite its code to bypass our proxy and talk directly to `googleapis.com`. We must issue "Fake" tokens from a **Token Vault** that standard SDKs will pass to our proxy. If the agent tries to use the fake token directly with Google, it receives a 401 Unauthorized.
3. **The "Zero Code" Myth**: It is architecturally impossible to securely reroute official Google SDK HTTP traffic to a proxy using *only* a custom credential file. The developer must make a code configuration change (specifying an API endpoint override) or the deployment environment must enforce traffic routing via proxy variables/hijacking.

> **Note (April 2026):** We tested Google's `universe_domain` feature as a potential workaround to the Zero Code constraint. It does not work for Google Workspace APIs (Gmail, Calendar, Drive). The `googleapis` npm package and `google-api-python-client` hardcode API endpoints to `*.googleapis.com` regardless of `universe_domain`. See [ADR-001](adr/001_universe_domain_rejection.md) for full technical evidence.

## 3. The 3-Pronged Go-To-Market Strategy

To balance developer experience (DX) and perfect security across our target markets, we will pursue the following structured approach:

### Prong 1: Developer API Endpoint Override (PLG)
**Target**: Individual developers, startups, and open-source agent tinkerers.
**Approach**: We issue developers a fake `proxy_credentials.json` file. The developer uses the standard Google SDK but adds a single line of configuration to override the default root URL.

> **Note:** Each Google SDK uses a different parameter to override the API base URL, and the values differ:
> - **Python `api_endpoint`** replaces `rootUrl + servicePath`. You must include the service path (e.g., `/gmail/v1`).
> - **Node.js `rootUrl`** replaces only the domain. The SDK appends the service path automatically. Any path in `rootUrl` is stripped.

*   **Python Example**: `client_options={'api_endpoint': 'https://gmail.proxy.ourdomain.com/gmail/v1'}`
*   **Node.js Example**: `rootUrl: 'https://gmail.proxy.ourdomain.com/'`
*   **cURL Example**: `curl https://gmail.proxy.ourdomain.com/gmail/v1/users/me/messages`

**Pros**: Low friction, uses official SDKs, completely prevents agent bypass (via the fake token).
**Flaws & Risks**:
*   **The "Leaky Abstraction"**: Google's client libraries are finicky about pagination and file uploads when using custom endpoints. If an agent tries to upload an attachment to an email, the SDK might attempt to hit a specialized upload URI (like `https://www.googleapis.com/upload/gmail/v1/...` instead of the standard REST URI). The proxy must be engineered to catch and correctly map **all** varieties of Google's endpoint structures, or the standard code will mysteriously crash.

### Prong 2: Wrapper SDKs (Mid-Market)
**Target**: Application developers wanting a completely "zero-thought" integration.
**Approach**: We publish thin wrapper libraries (e.g., `npm install @ourcompany/google-api-proxy`). The developer changes their import statement, and we handle the authentication, fake token injection, and endpoint overriding dynamically behind the scenes.

**Pros**: Easiest developer experience; literally just changing an import statement.
**Flaws & Risks**:
*   **Maintenance Hell**: Google's API surface is massive and changes weekly. Attempting to write a wrapper that perfectly mimics every single Google method will fail.
*   **The Mitigation**: The wrapper SDK must be incredibly "dumb." It should only act as a custom factory/initializer that authenticates and immediately returns the *official*, unmodified Google Service Object (with the `api_endpoint` cleanly injected into it).

### Prong 3: HTTPS Proxy & MITM (Enterprise B2B)
**Target**: Enterprise IT Admins, CISOs, Corporate deployments.
**Approach**: We provide a containerized gateway. IT Admins deploy it in their VPC, install our custom Root CA on their Corporate infrastructure, and set the system `HTTPS_PROXY` environment variable.

**Pros**: The Holy Grail of B2B. Zero code changes required for the agents. IT guarantees compliance and safety across the entire organization.
**Flaws & Risks**:
*   **Certificate Pinning**: Some modern HTTP clients or specialized agent frameworks hardcode (pin) Google's actual TLS certificates into their source code to explicitly prevent MITM attacks. If an agent uses a pinned HTTP client, the MITM proxy will be violently rejected, even if the IT admin installed the Root CA.
*   **Support Overhead**: Debugging Enterprise TLS/SSL issues is notoriously expensive. A rock-solid diagnostic tool must be built into the proxy to prove "It's your firewall, not us."
*   **Latency & Compliance (SOC2/HIPAA)**: Decrypting, inspecting, and re-encrypting every payload adds latency. Furthermore, the proxy will temporarily hold highly sensitive corporate data (emails) in its memory. Enterprise customers will demand strict SOC2/HIPAA compliance proving the proxy doesn't log decrypted payloads.

## 4. MCP Server — Agent Connection & Pending Approval

### Overview
In addition to the REST proxy (Prong 1), we now operate a production MCP server at `/api/mcp`. This enables native integration with MCP-compatible clients (Claude Code, OpenClaw via remote MCP).

### Architecture
```
Agent (Claude Code) → OAuth via Clerk → MCP Server → Pending Approval → Proxy Key → Gmail API
```

**Key components:**
- **`/api/mcp/route.ts`** — Production MCP handler with Gmail tools
- **`agent_connections` table** — Tracks OAuth client connections per user
- **`/.well-known/oauth-*`** — RFC 9728 discovery endpoints (via Clerk)

### Pending Approval Flow
1. Agent authenticates via OAuth (Clerk handles DCR + consent)
2. MCP server creates a `pending` connection record
3. All tool calls return "pending approval" with a dashboard link
4. User approves in dashboard, assigns a proxy key (agent profile)
5. Subsequent tool calls use that key's email access and rules

### Permission Chain
```
OAuth Token → userId + clientId → agent_connections → proxy_key →
  key_email_access → Clerk Google Token → Gmail API
```

### Multi-Email Support
Each proxy key can access multiple email accounts (via `key_email_access`):
- Own email: always accessible if mapped to the key
- Delegated emails: resolved via `email_delegations` table
- Google tokens: fetched from Clerk for the email owner

### Distribution Channels
| Channel | Method | Best For |
|---------|--------|----------|
| Claude Code | Remote MCP server (`claude mcp add`) | Native MCP clients |
| OpenClaw | Local scripts + REST proxy API | Code flexibility, full API surface |
| CLI | `npx fgac auth login` (separate npm package) | Power users, headless flows |
| Direct API | `Bearer sk_proxy_...` to `gmail.fgac.ai` | Custom integrations |
