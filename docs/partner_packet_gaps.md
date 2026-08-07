# Partner packet gaps — findings from the DDJS pilot integration

> **Resolution status (2026-08-06):** all six gaps addressed in
> `partner_integration_guide.md` / `partner_onboarding_runbook.md` in the same
> change that committed this file. Gap 1 is mitigated with a prominent warning
> in the guide (§2); the durable fix — serving the FGAC interstitial as the
> advertised `authorization_endpoint` without breaking the MCP/DCR channel —
> is tracked as backlog. Gap 4's stated behavior (mid-handoff bootstrap via
> Google sign-up, automatic account creation) reflects implemented behavior;
> DDJS should still confirm empirically during live validation as planned.

> **Source:** DDJS (first external-style partner integration, 2026-08-06) built
> its integration harness against `partner_integration_guide.md` ONLY, then
> audited every piece of knowledge it needed against where that knowledge
> actually came from. This file lists what a real partner could NOT have known
> from the guide alone, so the packet can be fixed before the next partner.

## Verdict

The technical core of the guide is self-sufficient: endpoints, PKCE parameters,
token-exchange shapes, refresh rotation, proxy-key exchange, Gmail proxy call
shapes, status handling, and the §4 checklist were all buildable with no
internal knowledge. The gaps below are onboarding-process holes and one
documentation trap.

## Gap 1 (trap, fix first): the discovery document contradicts the guide

`https://fgac.ai/.well-known/oauth-authorization-server` advertises:

```
"authorization_endpoint": "https://clerk.fgac.ai/oauth/authorize"
```

but the guide (§3.1) requires starting the handoff at
`https://fgac.ai/oauth/authorize` — and §5 explains that driving the Clerk
endpoint directly yields a **pending** connection whose API calls all refuse.

Any partner who feeds the discovery URL to a standards-compliant OAuth client
library (RFC 8414 auto-configuration — the default in many stacks) will silently
bypass the FGAC consent interstitial and ship a broken integration with
confusing symptoms (handoff "succeeds", every API call refuses). DDJS only
avoided this because the guide's literal URL was used instead of discovery.

**Packet fix options (either works):**
- Add a warning box to §2: "Use the discovery document for `token_endpoint`
  and `jwks_uri` ONLY. The `authorization_endpoint` it advertises is the
  underlying IdP and must not be used — always start at
  `https://fgac.ai/oauth/authorize`."
- Better: serve a discovery document whose `authorization_endpoint` is the
  FGAC interstitial, so auto-configuration does the right thing.

## Gap 2: §1 says "send us" — but not where, or what happens next

The registration table lists what to send but the packet never says:

- **Where** to send it (email address? form? portal?).
- **Turnaround expectation** for registration.
- **How credentials arrive** ("over a secure channel" — §2 — but which one?
  Partners will ask; deciding it per-partner in email threads won't scale).
- **Who to contact when stuck** (§6 says "your FGAC contact" — a partner who
  arrived via the public guide has no contact yet).

**Packet fix:** one short "How to register" paragraph with a real channel and
SLA, and make §6's support path reachable for not-yet-registered partners.

## Gap 3: no sandbox/dev environment offer

Internally, dev and prod are separate Clerk instances and a partner must be
registered in each — but the guide never mentions a sandbox. A partner reading
the packet doesn't know they can (or should) get dev credentials before
touching their production registration, or that localhost redirect URIs
("your dev builds", §1) imply a second registration rather than a flag on the
prod one.

**Packet fix:** state explicitly whether FGAC offers a sandbox registration,
that credentials are per-environment, and that partners should request both.

## Gap 4: user-precondition for the consent screen is unstated

§3.1 says the user "picks which mailbox to share". The guide never says what
must be true of that user beforehand: do they need an existing FGAC account?
Must the mailbox already be connected to FGAC (Google OAuth completed) before
the partner handoff, or does the consent flow bootstrap it? A partner building
their "Connect Gmail" onboarding needs this to write accurate UX copy and to
know what an un-onboarded user will experience mid-handoff.

*(DDJS will confirm the actual behavior empirically during live validation and
this section should then be updated with the answer — the point is the packet
must state it.)*

## Gap 5: retry cadence expectation is vaguer than reality

§3.3 gives a backoff ladder (1m → 5m → … → 24h) with the caveat "retry timing
may be coarser depending on platform scheduling." In the current deployment,
failed-delivery retries are batched into a **daily** drain — that is not a
slightly-coarser ladder, it is a different SLO. A partner designing recovery
logic (e.g. "if we 500, the retry lands within minutes") will be misled.

**Packet fix:** state the current real cadence plainly ("first delivery is
immediate; retries of failed deliveries are currently batched daily") and
treat the ladder as aspirational/plan-dependent.

## Gap 6 (minor): no rate limits or quotas documented

The guide is silent on request rate limits for the Gmail proxy and token
endpoints, and on any cap for backfill-style bursts (a new partner's most
likely first workload is "list and read the whole mailbox"). Even a
placeholder ("no enforced limits today; be gentle; ask us before bulk
backfills") prevents the partner from having to guess.

## Non-gaps (things that worked from the guide alone)

For completeness — all verified live against production by DDJS with no
internal knowledge: authorize URL parameter set incl. PKCE S256 and state;
deny-path shape; token exchange body; refresh-token rotation semantics;
partner-token exchange request/response; Gmail REST proxy call shape and SDK
endpoint-override examples; blocked/pending status semantics; webhook payload,
signature scheme, timestamp check, and dedup key documentation (receiver
implemented from §3.3 without questions).
