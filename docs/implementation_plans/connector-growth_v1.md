# Connector Growth: Discoverability & First-Run Usability (v1)

Branch: `claude/connector-growth` · Date: 2026-08-06
Builds on: `connector-approval-audit_v2.md` (directory readiness, shipped) and
`docs/connector_submission/` (listing copy + reviewer runbook, shipped).

## Why these two problems are one problem

Connector search ("Let Claude search the directory and surface relevant
connectors") matches **conversation context against listing metadata** — name,
tagline, description, categories, and the portal's use-cases answers. Tool
descriptions matter only after install. Meanwhile **directory rank is usage**:
distinct Claude accounts messaging the server over a rolling 30 days
("Trending" = top-10 recent growth), and the public health badge flips to
Degraded when the 30-day disconnect rate exceeds 5%.

So: discoverability = (listing says what users actually say) × (users who
connect, stay). First-run friction is a rank penalty and a public badge
penalty, not just a UX papercut. Our two differentiators — **multiple Gmail
accounts behind one connector** and **writable Google Sheets** — must appear
in the exact phrases users type, and the first session must succeed without a
dashboard field trip.

## Decision log

| Decision | Choice | Rationale / revisit trigger |
|---|---|---|
| Sensitive-mail shield default | **OFF** (user decision, 2026-08-06) | Shield rules (2FA/password-reset/financial patterns) aren't confident enough to ship as silent defaults. Mitigation: the OAuth landing page offers one-click enable, top position. Revisit once shield precision is validated on real traffic (Phase E funnel data + rule-match telemetry). |
| Default profile Gmail access | Read-only; **no send**, no Sheets | Sending/editing stays impossible until an explicit grant. |
| Delegated inboxes | Never auto-attached | Delegation always requires the inbox owner's explicit action. |
| Subsequent connections (2nd, 3rd client) | Also auto-attach to Default profile + notify | Simpler mental model; every connection is per-client OAuth-consented. Revisit if abuse appears. |
| Ship default-attach before or after directory submission | **Before** | Review then tests final behavior (and gets simpler — no dashboard detour). Requires docs/runbook/listing updated in the same release. |

## Phase A — Listing & metadata rewrite (pre-submission, no product risk)

1. **Keyword-first listing copy** (`docs/connector_submission/listing_copy.md` v2).
   Rewrite tagline/description/use-cases so match-surface text contains the
   phrases users actually type. Working keyword table:

   | User phrase | Where it must appear |
   |---|---|
   | "multiple Gmail accounts" / "work and personal email" | tagline + first description sentence + use case 1 |
   | "check my other inbox" / "team inbox" / "boss's inbox" | description (delegation bullet) + use case 4 |
   | "update my Google Sheet" / "add rows to a spreadsheet" | tagline or sentence 2 + use case 3 |
   | "log data to a sheet" / "tracking spreadsheet" | use case 3 |
   | "email assistant" / "triage my inbox" | use case 1 |
   | "can't read my 2FA codes" / "safe email access" | description (guardrails paragraph — second, not first) |

   Tagline direction: `Multiple Gmail accounts & editable Sheets, safely`
   (48 chars). Capability keywords lead; the security story follows.
2. **Use-cases portal step**: four concrete scenarios (two-inbox triage,
   whitelisted-team sending, sheet logging, delegated-EA workflow) — each a
   distinct search-phrase cluster.
3. **Tool-description multi-account phrasing** (`toolDefs.ts`): `gmail_list`,
   `gmail_read`, `gmail_send` descriptions state they work "across every
   connected or delegated Gmail inbox via the `account` parameter". Today the
   multi-account story is invisible until Claude calls `list_accounts`.
   (Descriptions stay factual — mcp-tool-lint's prompt-injection checks apply.)
4. **SEO landing pages**: `/use-cases/multiple-gmail-accounts` and
   `/use-cases/google-sheets-agent`, cross-linked from `/docs`. Target the
   searches that precede "is there a connector for this?".
5. **Off-directory listings**: publish to the official MCP registry
   (registry.modelcontextprotocol.io); PR into the community
   awesome-claude-connectors list once the directory listing is live.

## Phase B — Safe instant-start (default profile + auto-attach)

Goal: a brand-new user's entire journey is *click connector → pick Google
account → first tool call succeeds*. No dashboard visit required.

1. **Default profile seeding.** When `resolveConnection` auto-creates a user
   (existing path), also create a **Default profile**: proxy key + Gmail
   read-only posture — meaning NO send-whitelist rule (sending impossible by
   default), no Sheets exposures, shield preset **off** per decision log.
2. **Auto-attach.** New `agent_connections` rows bind to the Default profile
   with status `approved` instead of `pending`, for the connection's own
   OAuth-ed user only. Pending remains for: delegated-access grants and any
   future org/team contexts.
3. **Connect notification.** On each auto-attach, notify the user (dashboard
   banner at minimum; email later): "New agent connected with safe defaults —
   review or block." One-click block stays one click.
4. **OAuth landing page.** The post-consent redirect becomes onboarding:
   "✅ Connected. Claude can read your mail. It cannot send, edit, or delete."
   with (a) one-click **enable sensitive-mail shield** as the top CTA,
   (b) upgrade paths for send whitelist and Sheets exposure, (c) link to the
   dashboard.
5. **Consistency sweep** (same release): `/docs` limitations ("new connections
   start Pending" → new wording), `docs/connector_submission/reviewer_runbook.md`
   (reviewer flow loses the approval detour), listing copy "what users need
   first" (→ "nothing — sign in with Google during connect; read-only defaults
   applied automatically"), capability doc 06 (connection lifecycle assertions
   A3-A5 change semantics: pending → auto-attached-read-only), and a new/updated
   QA capability for default-profile behavior. `qa-coverage-check` inventory
   changes accordingly.

Security note (recorded, not blocking): auto-attach means completing Google
OAuth for a client grants that client read access to non-delegated mail with
no second approval. The OAuth consent *is* per-client user consent, so this
holds up — but with the shield off by default, a first-session agent can read
2FA codes and bank mail. The landing-page shield CTA is the mitigation until
the shield earns default-on status.

## Phase C — Actionable denials (magic links)

Every FGAC denial returns a deep link that pre-fills the fix, so permission
upgrades happen at the moment of need:

- `gmail_send` denial → `/dashboard/approve?action=whitelist&recipient=…&key=…`
  → one-click "Whitelist alex@example.com for this agent?"
- Sheets denial → same pattern with `spreadsheetId` (+ Read-only vs R&W choice).
- Label/content-blocked reads do NOT get magic links (weakening a block should
  stay a deliberate dashboard act).

Links are signed, single-purpose, expire (~15 min), and require the owning
user's session — an agent can mint the *request*, only the human can approve.

## Phase D — `request_access` tool

The conversational version of Phase C: agent calls
`request_access(capability)` → FGAC returns a magic approval link → Claude
presents it → user clicks → agent retries and succeeds. Registered with
`readOnlyHint: true` (it grants nothing itself — it mints a request the human
must approve). New QA capability doc required. This is also a listing story:
"the agent asks; you approve in one click."

## Phase E — Funnel instrumentation

Server-side PostHog events already exist in the MCP route (shipped separately);
extend to a funnel: `connection_created` → `first_tool_success` →
`first_denial` → `upgrade_via_magic_link` → week-2 retention, plus
per-rule-match telemetry for shield rules (feeds the shield default-on
revisit). Watch the directory dashboard's disconnect rate against our own
funnel to find where users still bail.

## Sequencing

1. **A** (listing rewrite + tool descriptions + SEO pages) — no risk, gates
   submission wording. Ship immediately.
2. **B** (instant-start) — before directory submission, with the consistency
   sweep in the same PR.
3. **C** (magic links) — highest-leverage post-launch usability; can land
   right after B.
4. **E** starts with B (events are cheap; add them as flows are built).
5. **D** after C reuses its approval-link machinery.

## QA impact summary

- Capability 06 assertions change (auto-attach replaces pending for own-user
  connections) — update doc + rerun.
- New capability docs: default-profile posture; magic-link approvals (C);
  request_access (D).
- Existing capabilities 01/02/05/09/10 unaffected in semantics; re-run
  hosted-MCP suite after B.
