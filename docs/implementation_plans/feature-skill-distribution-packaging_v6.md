# Agent Profile Binding: User-Controlled Alternatives

## The Problem

The `select_profile` MCP tool approach is **fundamentally broken** because it lets the agent choose its own permissions. A malicious or confused agent could pick the most permissive profile. FGAC.ai's entire value proposition is that the **user** controls what the agent can access — never the agent itself.

This also applies to third-party agents. If a user gives FGAC.ai credentials to a custom agent built by someone else, they need to trust that the agent can't escalate its own access.

## Constraints

From the spike, we know:
- Clerk's consent page is built-in — we can't replace it
- OAuth tokens contain `userId` (sub) + `client_id` — no custom claims
- DCR creates a **unique `client_id`** per agent instance
- Each `client_id` is persistent — the same agent reconnecting gets the same one

## The Key Insight

**`client_id` is the agent's fingerprint.** Each agent that does DCR gets a unique, persistent `client_id`. We can use this as the binding key:

```
client_id  ──(user binds)──►  agent_profile
```

Once bound, every OAuth session from that `client_id` automatically inherits the profile's permissions. The binding is **one-time** — the user does it once, and it persists.

---

## Alternative Approaches

### Option A: Dashboard Pairing (Your Suggestion)

```
Agent connects → OAuth → Token issued → MCP tools return "pending approval"
User visits Dashboard → Sees new unbound connection → Names it, assigns profile
Agent retries → Works with assigned permissions
```

**Pros:**
- Full user control at every step
- User can see exactly what connected and when
- Works for any agent type (MCP, CLI, third-party)
- Deny-by-default: unbound connections can't do anything

**Cons:**
- Requires user to visit dashboard after first connection (friction)
- Agent is blocked until user acts — could be confusing for first-time users
- No in-flow guidance (user might not know to go to dashboard)

**UX: ⭐⭐⭐** | **Security: ⭐⭐⭐⭐⭐** | **Complexity: Low**

---

### Option B: Post-Auth Dashboard Redirect

```
Agent connects → OAuth → Clerk consent → REDIRECT to FGAC Dashboard
Dashboard shows: "New connection from [app]. Select profile:" → User picks
Redirect back to agent with bound token
```

**Pros:**
- In-flow experience — user makes the decision right after OAuth
- No need to visit dashboard separately
- Feels like a natural part of the setup

**Cons:**
- Only works for browser-based OAuth flows (not headless agents)
- Breaks the MCP client's expected redirect (it expects to get the code back, not a detour)
- MCP spec expects the callback to return the authorization code, not redirect elsewhere

**UX: ⭐⭐⭐⭐** | **Security: ⭐⭐⭐⭐⭐** | **Complexity: Medium**

---

### Option C: Device Authorization / Pairing Code (like TV Login)

```
Agent requests auth → Gets a pairing code (e.g., "FGAC-7X3K")
Agent displays: "Visit fgac.ai/pair and enter code FGAC-7X3K"
User visits fgac.ai/pair → Enters code → Signs in → Selects profile
Agent polls until approved → Starts working with permissions
```

**Pros:**
- Works for headless/CLI agents with no browser
- User has full control — they go to fgac.ai on their own device
- Familiar pattern (Netflix, GitHub CLI, VS Code)

**Cons:**
- Not standard MCP OAuth flow (would need a separate auth path)
- Two-device setup adds friction
- Polling adds complexity

**UX: ⭐⭐⭐** | **Security: ⭐⭐⭐⭐⭐** | **Complexity: High**

---

### Option D: Pre-Registered Agent Slots (Dashboard-First)

```
User visits Dashboard → Creates "Agent Slot" with profile + permissions
Dashboard generates an install command:
  claude mcp add --transport http fgac-gmail https://gmail.fgac.ai/mcp?slot=abc123
Agent uses the slot URL → OAuth → Auto-bound to that slot's profile
```

**Pros:**
- Dashboard-first: user sets up permissions BEFORE the agent connects
- Zero-friction for the agent — it just uses the URL it was given
- The slot URL acts as a pre-authorization token
- Works great for third-party agents — give them a slot URL, they can't exceed its permissions

**Cons:**
- User must create the slot before the agent can connect (setup order)
- Slot URL in the MCP config could be leaked (though it still requires OAuth)
- Doesn't work for spontaneous connections (agent connects without prior setup)

**UX: ⭐⭐⭐⭐** | **Security: ⭐⭐⭐⭐⭐** | **Complexity: Medium**

---

### Option E: Pending Approval + Dashboard Binding (RECOMMENDED)

```
Agent connects → OAuth → Token issued → Agent calls MCP tools
↓
MCP returns structured "pending_approval" response:
{
  "status": "pending_approval",
  "connection_id": "conn_abc123",
  "message": "This connection is awaiting approval. Ask the user to visit their FGAC dashboard.",
  "dashboard_url": "https://fgac.ai/dashboard/connections"
}
↓
Dashboard shows notification: "🔔 New Agent Connection"
┌────────────────────────────────────────────────────┐
│  New Connection                                     │
│                                                    │
│  App: fgac-spike-test                              │
│  Connected: 2 minutes ago                          │
│  Client ID: dGd3hVEbAbMZNBbK                       │
│                                                    │
│  Nickname: [                    ]                   │
│  Assign to Profile: [▼ Select Profile           ]  │
│                                                    │
│       [Approve]              [Block]               │
└────────────────────────────────────────────────────┘
↓
User approves with profile selection
↓
Agent retries → MCP tools work with that profile's permissions
Future sessions from same client_id auto-inherit (no re-approval)
```

**Pros:**
- **Deny-by-default:** Unbound connections can't access anything
- **User controls everything:** Profile assignment, nickname, approval/denial
- **One-time setup:** Same `client_id` reconnecting auto-inherits (persisted binding)
- **Third-party safe:** Give a third-party agent your FGAC URL, they connect, you approve with specific permissions
- **Agent gets clear feedback:** Structured response tells the agent (and the human user) exactly what to do
- **Dashboard notification:** User doesn't need to manually check — they see "1 pending connection"
- **Audit trail:** Every connection attempt is logged with timestamp, client metadata

**Cons:**
- First connection requires user action in dashboard (one-time friction)
- Agent is blocked until approval (but this IS the security feature)

**UX: ⭐⭐⭐⭐** | **Security: ⭐⭐⭐⭐⭐** | **Complexity: Medium**

---

## Recommendation: Option E (Pending Approval)

Option E is the best balance. Here's why:

1. **It's the GitHub App model** — Install the app, then configure its repository access in your settings. Users already understand this pattern.

2. **It works for third parties** — A user can give `https://gmail.fgac.ai/mcp` to any agent. The agent connects, the user approves with specific permissions. The agent can't escalate.

3. **One-time friction** — After initial approval, reconnections are seamless. The `client_id` binding persists.

4. **The "blocked" state is the feature** — The agent telling the user "I need you to approve me in the FGAC dashboard" is exactly the right UX for a security product.

### Combined with Option D for Power Users

For users who want to pre-authorize agents, we can ALSO offer Agent Slots:
- Dashboard → "Create Agent Slot" → generates a slot-specific URL
- Agent uses that URL → auto-approved with the slot's profile

This gives two paths:
- **Spontaneous:** Agent connects → pending → user approves (Option E)
- **Pre-authorized:** User creates slot → gives URL to agent → auto-bound (Option D)

---

## Schema for Pending Approval

```sql
-- New table: tracks OAuth client connections and their profile bindings
agent_connections (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  client_id     TEXT NOT NULL,          -- from DCR registration
  client_name   TEXT,                   -- from DCR metadata ("fgac-spike-test")
  nickname      TEXT,                   -- user-assigned label
  profile_id    UUID REFERENCES agent_profiles(id),  -- NULL = pending
  status        TEXT NOT NULL DEFAULT 'pending',      -- 'pending', 'approved', 'blocked'
  created_at    TIMESTAMP DEFAULT NOW(),
  approved_at   TIMESTAMP,
  last_used_at  TIMESTAMP,
  UNIQUE(user_id, client_id)
)
```

### MCP Authorization Flow

```typescript
// In MCP tool handler:
async function authorizeRequest(authInfo: AuthInfo) {
  const userId = authInfo.extra?.userId;
  const clientId = authInfo.clientId;
  
  // Find or create connection record
  let connection = await db.query.agentConnections.findFirst({
    where: and(eq(userId), eq(clientId))
  });
  
  if (!connection) {
    // First time this client connected — create pending record
    connection = await db.insert(agentConnections).values({
      userId, clientId, 
      clientName: /* from DCR metadata */,
      status: 'pending'
    });
  }
  
  if (connection.status === 'pending') {
    return { 
      authorized: false, 
      reason: 'pending_approval',
      dashboard_url: 'https://fgac.ai/dashboard/connections'
    };
  }
  
  if (connection.status === 'blocked') {
    return { authorized: false, reason: 'blocked' };
  }
  
  // Approved — resolve profile and return permissions
  const profile = await resolveProfile(connection.profileId);
  return { authorized: true, profile };
}
```

---

## Spike Plan: Validate Pending Approval Flow

### What to Build

1. **`agent_connections` table** — Store connection → profile bindings
2. **Dashboard UI** — "Connections" tab showing pending/approved/blocked connections
3. **MCP authorization check** — Return `pending_approval` for unbound connections
4. **Approval API** — `POST /api/connections/:id/approve` with profile selection

### Spike Steps

```bash
# 1. Schema change
npm run db:branch
# Add agent_connections table to schema.ts
npm run db:push

# 2. Create API endpoints
# POST /api/connections/:id/approve  { profileId, nickname }
# POST /api/connections/:id/block
# GET  /api/connections              (list all for current user)

# 3. Update MCP spike endpoint
# Check agent_connections before allowing tool calls
# Return structured pending_approval response for unbound connections

# 4. Test flow
# - Connect via OAuth (reuse existing spike infrastructure)
# - Verify MCP returns pending_approval
# - Call approve API
# - Verify MCP now works with profile permissions

# 5. Dashboard UI (minimal)
# - Add "Connections" section to /dashboard
# - Show pending connections with approve/block buttons
# - Profile selector dropdown
# - Nickname text input
```

### Success Criteria
- [ ] Unbound connection gets `pending_approval` response
- [ ] User can approve connection via API with profile assignment
- [ ] After approval, MCP tools work with that profile's permissions
- [ ] Same `client_id` reconnecting (new OAuth session) auto-inherits approval
- [ ] User can block a connection
- [ ] User can change a connection's profile assignment
- [ ] User can nickname a connection
