# Draft Response to TAC Security — Data Storage Clarification

## Email Draft

---

**Subject:** RE: CASA Tier 2 — Data Storage Clarification

Dear TAC Security CASA Support Team,

Thank you for the update.

We store Google users' **email addresses only** (for account identity and access control routing). We do not store any Gmail content — no message bodies, subjects, attachments, or data from Google API responses. All Gmail content passes through memory only and is never persisted.

Google OAuth tokens are managed by our authentication provider **Clerk** (SOC 2 Type II certified) and are not stored in our database.

Our database is **Neon Serverless PostgreSQL** on AWS, which encrypts all data at rest using **AES-256** with keys managed by **AWS KMS**. All connections use TLS 1.2+ (`sslmode=require`).

Attached: Screenshot of Neon's security documentation confirming AES-256 encryption at rest.

Regarding a screenshot of encrypted data: Neon manages encryption at the infrastructure level (via AWS KMS), so we do not have direct access to the encrypted storage layer to provide a screenshot.

Please let us know if you need anything else.

Best Regards,
Kenneth Yesh
FGAC.ai

---

## Verified Evidence (from Neon API)

### Neon Project Configuration
```
Project Name:     neon-fine-grain-access-control
Project ID:       young-lake-60767275
Platform:         AWS
Region:           aws-us-east-1
PostgreSQL:       v17
Proxy Host:       c-2.us-east-1.aws.neon.tech
Endpoint:         ep-young-rain-adze6m3c.c-2.us-east-1.aws.neon.tech
SSL Mode:         sslmode=require (enforced in connection string)
Compute:          0.25 CU (autoscaling)
```

### Encryption Confirmation (from Neon official documentation)

| Layer | Algorithm | Key Management | Source |
|-------|-----------|---------------|--------|
| **Data at rest** | AES-256 (NVMe SSD hardware encryption) | AWS KMS with automatic key rotation | [Neon Security Docs](https://neon.tech/docs/security/security-overview) |
| **Data in transit** | TLS 1.2+ | Neon-managed certificates | `sslmode=require` in connection string |
| **Compliance** | SOC 2 Type II, ISO 27001, ISO 27701, GDPR, CCPA | — | [Neon Trust Center](https://neon.tech/docs/security/security-overview) |

### Database Schema — What We Store

| Table | Columns | Google User Data? | Details |
|-------|---------|-------------------|--------|
| `users` | id, clerk_user_id, **email**, created_at, updated_at | ⚠️ **Email address only** | The user's Google email from OAuth consent. No names, profile photos, or other profile data. |
| `proxy_keys` | id, user_id, key, public_key, label, revoked_at, expires_at, created_at | ❌ None | API key metadata for agent auth |
| `access_rules` | id, user_id, **target_email**, rule_name, service, action_type, regex_pattern, created_at, updated_at | ⚠️ **Email address only** | The email an access rule applies to |
| `key_email_access` | id, proxy_key_id, delegation_id, **target_email** | ⚠️ **Email address only** | Which emails a key can access |
| `email_delegations` | id, owner_user_id, delegate_user_id, status, created_at, revoked_at | ❌ None | Cross-user delegation grants (references user IDs, not emails) |
| `key_rule_assignments` | id, proxy_key_id, access_rule_id | ❌ None | Key-to-rule join table |
| `waitlist` | id, email, pricing preferences, status, timestamps | ❌ None | Waitlist signups (not Google data) |

> **Summary:** The only Google user data we persist is email addresses (for identity and access control routing). We store zero Gmail content — no message bodies, subjects, attachments, labels, contacts, or any Google API response data.

---

## Notes for Kenneth

### Screenshots to gather before sending:

1. **Neon Dashboard → Project Settings** — Shows the AWS region and project config (I've already captured the API data above, but a screenshot adds visual proof)

2. **Neon Dashboard → Tables view** — Screenshot showing the tables with their columns visible. The schema table above proves there are no columns storing email content/bodies/attachments, but a visual screenshot reinforces this.

3. **(Optional) Neon Security Docs link** — Include https://neon.tech/docs/security/security-overview in your email as a reference

### Key talking points if they follow up:
- The proxy is **stateless** for Google data — request in, response out, nothing persisted
- The only "user data" we store is the user's email address (for identity) which they provided via Google OAuth consent
- Clerk (our auth provider) holds the OAuth tokens, not us — and Clerk is SOC 2 Type II certified
- Our Neon database uses AWS-managed encryption keys (AES-256) with automatic key rotation via AWS KMS
- Neon is SOC 2 Type II and ISO 27001 certified independently
