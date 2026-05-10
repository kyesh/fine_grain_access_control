# Draft Response to TAC Security — SAQ Evidence (Q4, Q15, Q20)

## Email Draft

---

**Subject:** RE: CASA Tier 2 — SAQ Evidence for Q4, Q15, Q20

Dear TAC Security CASA Support Team,

Please find evidence for Q15 and Q20 attached. For Q4, we have a clarification question.

**Q4 — Sensitive data classification:**
Our SAQ response describes our data classification (Critical / Confidential / Public). Could you clarify what additional evidence you're looking for — a data flow diagram, a formal policy document, or a screenshot of a specific configuration?

**Q15 — Automated deployment:**
Attached: Vercel deployment dashboard showing CI/CD-automated deployments triggered by `git push`, with build times under 40 seconds. Database uses Drizzle ORM migrations and Neon's automated backups with point-in-time recovery.

**Q20 — Secure random generation:**
Attached: Source code (`actions.ts`, lines 120–126) showing proxy keys generated via `crypto.randomUUID()` (Node.js CSPRNG) and RSA keypairs via `jose.generateKeyPair('RS256')`.

Best Regards,
Kenneth Yesh
FGAC.ai

---

## Screenshots to capture:

1. **Vercel deployment dashboard** — showing recent deployments with automated triggers (for Q15)
2. **Source code lines 120-126 of actions.ts** — showing `crypto.randomUUID()` and `jose.generateKeyPair('RS256')` (for Q20)
3. Q4 doesn't need a screenshot — the classification is described in the text above
