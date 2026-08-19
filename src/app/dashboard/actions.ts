"use server";

import { db } from "@/db";
import { users, proxyKeys, emailDelegations, keyEmailAccess, accessRules, keyRuleAssignments } from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { findActiveDelegation } from "@/db/delegationQueries";
import { syncDefaultProfileDelegatedAccess } from "@/db/defaultProfile";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import safeRegex from "safe-regex";
import * as jose from "jose";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getDbUser() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const dbUser = await db.select().from(users).where(eq(users.clerkUserId, user.id)).limit(1).then(res => res[0]);
  if (!dbUser) throw new Error("User not found in DB");

  return dbUser;
}

// ─── Email Delegations ──────────────────────────────────────────────────────

/**
 * Create a delegation: the current user (owner) grants another user (delegate)
 * permission to create API keys that access the owner's Gmail.
 */
export async function createDelegation(formData: FormData) {
  const dbUser = await getDbUser();
  const delegateEmail = (formData.get("delegateEmail") as string)?.trim().toLowerCase();

  // These throw rather than returning silently: the caller renders the message,
  // and a quiet return made the form close as if the delegation had succeeded.
  if (!delegateEmail) {
    throw new Error("Enter the email address of the person you want to delegate to.");
  }

  // Can't delegate to yourself
  if (delegateEmail === dbUser.email.toLowerCase()) {
    throw new Error("You already have full access to your own mailbox.");
  }

  // Find the delegate user in our DB. Tombstoned rows (Clerk account deleted)
  // are excluded — delegating to a retired identity would grant access nobody
  // can exercise, and would be resurrected if that address signed up again.
  // Newest first, since historical data contains duplicate rows per email.
  const delegateUser = await db.select().from(users)
    .where(and(eq(users.email, delegateEmail), isNull(users.deletedAt)))
    .orderBy(desc(users.createdAt))
    .limit(1).then(res => res[0]);

  if (!delegateUser) {
    // There is deliberately no invite flow — the delegate must already have an
    // FGAC account. Say so, instead of closing the form as if it worked.
    throw new Error(`No FGAC account found for ${delegateEmail}. Ask them to sign up at fgac.ai with that Google account first.`);
  }

  // Check for existing active delegation
  const existing = await db.select().from(emailDelegations)
    .where(and(
      eq(emailDelegations.ownerUserId, dbUser.id),
      eq(emailDelegations.delegateUserId, delegateUser.id),
    ))
    .limit(1).then(res => res[0]);

  if (existing && existing.status === 'active') {
    console.log("[createDelegation] Delegation already active");
    // Self-heal: re-materialize onto the delegate's Default Profile in case a
    // prior sync was missed (e.g. the profile didn't exist yet).
    await syncDefaultProfileDelegatedAccess(delegateUser.email);
    revalidatePath("/dashboard");
    return;
  }

  if (existing && existing.status === 'revoked') {
    // Re-activate the existing delegation. Revocation deleted the
    // key_email_access rows, so the default-profile sync below must re-add them.
    await db.update(emailDelegations).set({
      status: 'active',
      revokedAt: null,
    }).where(eq(emailDelegations.id, existing.id));
  } else {
    // Create new delegation
    await db.insert(emailDelegations).values({
      ownerUserId: dbUser.id,
      delegateUserId: delegateUser.id,
      status: 'active',
    });
  }

  // The delegate's Default Profile gets the mailbox immediately — delegation is
  // the owner's explicit grant, and instant-start connections run on the
  // default key. Custom profiles remain per-mailbox opt-in.
  await syncDefaultProfileDelegatedAccess(delegateUser.email);

  const { captureServerEvent } = await import("@/lib/posthogServer");
  captureServerEvent(dbUser.clerkUserId, "delegation_created", {
    delegate_email: delegateEmail,
    reactivated: existing?.status === 'revoked',
  });

  revalidatePath("/dashboard");
}

/**
 * Revoke a delegation. Only the owner can revoke.
 */
export async function revokeDelegation(delegationId: string) {
  const dbUser = await getDbUser();

  const delegation = await db.select().from(emailDelegations)
    .where(eq(emailDelegations.id, delegationId))
    .limit(1).then(res => res[0]);

  if (!delegation || delegation.ownerUserId !== dbUser.id) {
    throw new Error("Unauthorized");
  }

  await db.update(emailDelegations).set({
    status: 'revoked',
    revokedAt: new Date(),
  }).where(eq(emailDelegations.id, delegationId));

  // Tear down the access this delegation granted. Flipping the status alone left
  // the delegate's key_email_access rows in place, and the proxy authorises on
  // those rows — so "revoked" delegations kept working. The proxy now re-checks
  // the delegation too, but the rows should not linger regardless.
  await db.delete(keyEmailAccess).where(eq(keyEmailAccess.delegationId, delegationId));

  revalidatePath("/dashboard");
}

// ─── Proxy Keys ─────────────────────────────────────────────────────────────

export async function createProxyKey(formData: FormData) {
  const dbUser = await getDbUser();
  const label = formData.get("label") as string;
  const emailAddresses = formData.getAll("emails") as string[];

  if (!label) throw new Error("Label is required");

  // Generate RSA Keypair for Service Account compatibility
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const publicKeyPem = await jose.exportSPKI(publicKey);
  const privateKeyPem = await jose.exportPKCS8(privateKey);

  // Create the key
  const proxyKeyString = `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`;
  const newKey = await db.insert(proxyKeys).values({
    userId: dbUser.id,
    key: proxyKeyString,
    publicKey: publicKeyPem,
    label,
  }).returning().then(res => res[0]);

  // Grant email access — every non-own address must be backed by an ACTIVE
  // delegation, recorded on the row so revocation can tear it down again.
  for (const email of emailAddresses) {
    let delegationId: string | null = null;

    if (email.toLowerCase() !== dbUser.email.toLowerCase()) {
      // Matched on both emails: the previous `.limit(1)` lookup of the owner
      // row picked arbitrarily among duplicate rows for the same address, so a
      // real delegation could come back empty.
      const delegation = await findActiveDelegation(email, dbUser.email);

      if (!delegation) {
        // Previously this fell through and inserted the row with a null
        // delegationId — granting access that no delegation backed, that
        // revocation could not remove, and that looked like the user's own
        // mailbox to every downstream check.
        throw new Error(`No active delegation grants you access to ${email}.`);
      }

      delegationId = delegation.id;
    }

    await db.insert(keyEmailAccess).values({
      proxyKeyId: newKey.id,
      delegationId,
      targetEmail: email,
    });

    const { captureServerEvent } = await import("@/lib/posthogServer");
    captureServerEvent(dbUser.clerkUserId, "account_linked", {
      target_email: email,
      delegated: !!delegationId,
      via: "create_key",
    });
  }

  revalidatePath("/dashboard");

  // We return the private key and proxy key string so the UI can construct the generated JSON
  return {
    proxyKey: proxyKeyString,
    privateKey: privateKeyPem,
  };
}

export async function revokeProxyKey(keyId: string) {
  const dbUser = await getDbUser();

  const key = await db.select().from(proxyKeys).where(eq(proxyKeys.id, keyId)).limit(1).then(res => res[0]);
  if (!key || key.userId !== dbUser.id) throw new Error("Unauthorized");

  await db.update(proxyKeys).set({ revokedAt: new Date() }).where(eq(proxyKeys.id, keyId));
  revalidatePath("/dashboard");
}

export async function rollProxyKey(keyId: string) {
  const dbUser = await getDbUser();

  const oldKey = await db.select().from(proxyKeys).where(eq(proxyKeys.id, keyId)).limit(1).then(res => res[0]);
  if (!oldKey || oldKey.userId !== dbUser.id) throw new Error("Unauthorized");

  // Get old key's email access
  const oldEmailAccess = await db.select().from(keyEmailAccess).where(eq(keyEmailAccess.proxyKeyId, keyId));

  // Get old key's rule assignments
  const oldRuleAssignments = await db.select().from(keyRuleAssignments).where(eq(keyRuleAssignments.proxyKeyId, keyId));

  // Create new key with same label
  const newKey = await db.insert(proxyKeys).values({
    userId: dbUser.id,
    key: `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`,
    label: oldKey.label,
  }).returning().then(res => res[0]);

  // Copy email access
  for (const ea of oldEmailAccess) {
    await db.insert(keyEmailAccess).values({
      proxyKeyId: newKey.id,
      delegationId: ea.delegationId,
      targetEmail: ea.targetEmail,
    });
  }

  // Copy rule assignments
  for (const ra of oldRuleAssignments) {
    await db.insert(keyRuleAssignments).values({
      proxyKeyId: newKey.id,
      accessRuleId: ra.accessRuleId,
    });
  }

  // Revoke old key
  await db.update(proxyKeys).set({ revokedAt: new Date() }).where(eq(proxyKeys.id, keyId));

  revalidatePath("/dashboard");
}

// ─── Access Rules ───────────────────────────────────────────────────────────

export async function createRule(formData: FormData) {
  const dbUser = await getDbUser();
  const ruleName = formData.get("ruleName") as string;
  const service = formData.get("service") as string;
  const actionType = formData.get("actionType") as string;
  const rawPattern = formData.get("regexPattern") as string;
  const targetEmail = formData.get("targetEmail") as string || null;
  const keyIds = formData.getAll("keyIds") as string[];

  if (!ruleName || !service || !actionType) {
    console.error("[createRule] Missing required fields:", { ruleName, service, actionType });
    revalidatePath("/dashboard");
    return;
  }

  let finalRegexPattern: string | null = null;
  let targetResourceId: string | null = null;

  if (service === 'sheets') {
    targetResourceId = rawPattern;
  } else {
    finalRegexPattern = rawPattern;
    if (finalRegexPattern && !safeRegex(finalRegexPattern)) {
      throw new Error(`The provided regular expression '${finalRegexPattern}' is too complex and poses a performance risk.`);
    }
  }

  const newRule = await db.insert(accessRules).values({
    userId: dbUser.id,
    ruleName,
    service,
    actionType,
    regexPattern: finalRegexPattern,
    targetResourceId,
    targetEmail: targetEmail || null,
  }).returning().then(res => res[0]);

  for (const keyId of keyIds) {
    await db.insert(keyRuleAssignments).values({
      proxyKeyId: keyId,
      accessRuleId: newRule.id,
    });
  }

  revalidatePath("/dashboard");
}

export async function updateRule(formData: FormData) {
  const dbUser = await getDbUser();
  const ruleId = formData.get("ruleId") as string;
  const ruleName = formData.get("ruleName") as string;
  const service = formData.get("service") as string;
  const actionType = formData.get("actionType") as string;
  const rawPattern = formData.get("regexPattern") as string;
  const targetEmail = formData.get("targetEmail") as string || null;
  const keyIds = formData.getAll("keyIds") as string[];

  if (!ruleId || !ruleName || !service || !actionType) {
    console.error("[updateRule] Missing required fields");
    revalidatePath("/dashboard");
    return;
  }

  let finalRegexPattern: string | null = null;
  let targetResourceId: string | null = null;

  if (service === 'sheets') {
    targetResourceId = rawPattern;
  } else {
    finalRegexPattern = rawPattern;
    if (finalRegexPattern && !safeRegex(finalRegexPattern)) {
      throw new Error(`The provided regular expression '${finalRegexPattern}' is too complex and poses a performance risk.`);
    }
  }

  // Verify ownership
  const rule = await db.select().from(accessRules).where(eq(accessRules.id, ruleId)).limit(1).then(res => res[0]);
  if (!rule || rule.userId !== dbUser.id) {
    throw new Error("Unauthorized or Rule not found");
  }

  // Update the rule
  await db.update(accessRules).set({
    ruleName,
    service,
    actionType,
    regexPattern: finalRegexPattern,
    targetResourceId: service === 'sheets' ? targetResourceId : rule.targetResourceId,
    targetEmail: targetEmail || null,
  }).where(eq(accessRules.id, ruleId));

  // Reconcile key assignments: remove old, add new
  await db.delete(keyRuleAssignments).where(eq(keyRuleAssignments.accessRuleId, ruleId));
  for (const keyId of keyIds) {
    await db.insert(keyRuleAssignments).values({
      proxyKeyId: keyId,
      accessRuleId: ruleId,
    });
  }

  revalidatePath("/dashboard");
}

export async function deleteRule(id: string) {
  const dbUser = await getDbUser();

  const rule = await db.select().from(accessRules).where(eq(accessRules.id, id)).limit(1).then(res => res[0]);
  if (!rule || rule.userId !== dbUser.id) {
    throw new Error("Unauthorized or Rule not found");
  }

  await db.delete(accessRules).where(eq(accessRules.id, id));
  revalidatePath("/dashboard");
}

const SHEET_ACTION_TYPES = ['sheet_read', 'sheet_read_write', 'sheet_block'] as const;

/**
 * Change the permission level on a Google Sheets rule in place.
 *
 * 'sheet_block' intentionally keeps the underlying file grant while denying
 * access, so a sheet can be suspended and restored without re-running the
 * Google Picker flow.
 */
/**
 * Persist sheets picked in the Google Picker as access rules.
 *
 * With a profileId the exposure is scoped to that profile; without one it is
 * global. Existing rules are never narrowed: a global rule stays global, and a
 * profile-scoped rule gains the new assignment instead of replacing the set.
 */
export async function exposeSheetsFromPicker(
  picked: { id: string; name: string }[],
  profileId?: string,
) {
  const dbUser = await getDbUser();

  if (profileId) {
    const key = await db.select().from(proxyKeys)
      .where(and(eq(proxyKeys.id, profileId), eq(proxyKeys.userId, dbUser.id)))
      .limit(1).then(res => res[0]);
    if (!key) throw new Error("Unauthorized or profile not found");
  }

  for (const sheet of picked) {
    if (!sheet?.id) continue;
    const name = sheet.name || `Spreadsheet (${sheet.id.slice(0, 8)})`;

    const existing = await db.select().from(accessRules)
      .where(and(
        eq(accessRules.userId, dbUser.id),
        eq(accessRules.service, 'sheets'),
        eq(accessRules.targetResourceId, sheet.id),
      ))
      .limit(1).then(res => res[0]);

    if (existing) {
      await db.update(accessRules)
        .set({ ruleName: name, resourceName: name, updatedAt: new Date() })
        .where(eq(accessRules.id, existing.id));

      if (profileId) {
        const assignments = await db.select().from(keyRuleAssignments)
          .where(eq(keyRuleAssignments.accessRuleId, existing.id));
        const alreadyGlobal = assignments.length === 0;
        const alreadyAssigned = assignments.some(a => a.proxyKeyId === profileId);
        if (!alreadyGlobal && !alreadyAssigned) {
          await db.insert(keyRuleAssignments)
            .values({ accessRuleId: existing.id, proxyKeyId: profileId });
        }
      }
    } else {
      const [rule] = await db.insert(accessRules)
        .values({
          userId: dbUser.id,
          ruleName: name,
          service: 'sheets',
          actionType: 'sheet_read',
          targetResourceId: sheet.id,
          resourceName: name,
        })
        .returning();

      if (profileId) {
        await db.insert(keyRuleAssignments)
          .values({ accessRuleId: rule.id, proxyKeyId: profileId });
      }
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/accounts");
}

export async function setSheetRulePermission(ruleId: string, actionType: string) {
  const dbUser = await getDbUser();

  if (!SHEET_ACTION_TYPES.includes(actionType as typeof SHEET_ACTION_TYPES[number])) {
    throw new Error(`Invalid sheet permission: ${actionType}`);
  }

  const rule = await db.select().from(accessRules).where(eq(accessRules.id, ruleId)).limit(1).then(res => res[0]);
  if (!rule || rule.userId !== dbUser.id) {
    throw new Error("Unauthorized or Rule not found");
  }
  if (rule.service !== 'sheets') {
    throw new Error("Not a Google Sheets rule");
  }

  await db.update(accessRules)
    .set({ actionType, updatedAt: new Date() })
    .where(eq(accessRules.id, ruleId));

  revalidatePath("/dashboard");
}

/**
 * Attach existing rules to one agent profile without touching their other
 * assignments. Used by the "Apply a rule" popover, which reuses rules across
 * profiles rather than duplicating them.
 */
export async function assignRulesToKey(keyId: string, ruleIds: string[]) {
  const dbUser = await getDbUser();

  const key = await db.select().from(proxyKeys).where(eq(proxyKeys.id, keyId)).limit(1).then(res => res[0]);
  if (!key || key.userId !== dbUser.id) {
    throw new Error("Unauthorized or Profile not found");
  }

  for (const ruleId of ruleIds) {
    const rule = await db.select().from(accessRules).where(eq(accessRules.id, ruleId)).limit(1).then(res => res[0]);
    if (!rule || rule.userId !== dbUser.id) {
      throw new Error("Unauthorized or Rule not found");
    }

    // The (proxy_key_id, access_rule_id) unique index makes a repeat click a
    // no-op rather than an error.
    await db.insert(keyRuleAssignments)
      .values({ proxyKeyId: keyId, accessRuleId: ruleId })
      .onConflictDoNothing();
  }

  revalidatePath("/dashboard");
}

/**
 * Detach one rule from one profile. The rule itself survives — it may still be
 * assigned elsewhere. Note that removing the LAST assignment turns the rule
 * global (applies to every key), which is why the UI warns before doing it.
 */
export async function unassignRuleFromKey(keyId: string, ruleId: string) {
  const dbUser = await getDbUser();

  const rule = await db.select().from(accessRules).where(eq(accessRules.id, ruleId)).limit(1).then(res => res[0]);
  if (!rule || rule.userId !== dbUser.id) {
    throw new Error("Unauthorized or Rule not found");
  }

  await db.delete(keyRuleAssignments).where(and(
    eq(keyRuleAssignments.proxyKeyId, keyId),
    eq(keyRuleAssignments.accessRuleId, ruleId),
  ));

  revalidatePath("/dashboard");
}

export async function applyRecommendedSecurityRules() {
  const dbUser = await getDbUser();

  // Guard: skip if user already has read_blacklist rules (prevents duplicates
  // when the "Quick Add 2FA Block" button is clicked multiple times)
  const existing = await db.select().from(accessRules)
    .where(and(
      eq(accessRules.userId, dbUser.id),
      eq(accessRules.actionType, 'read_blacklist'),
    ));
  if (existing.length > 0) {
    revalidatePath("/dashboard");
    return;
  }

  const rulesToInsert = [
    {
      userId: dbUser.id,
      ruleName: "Block 2FA Codes",
      service: "gmail",
      actionType: "read_blacklist",
      regexPattern: "2FA Code"
    },
    {
      userId: dbUser.id,
      ruleName: "Block Password Resets",
      service: "gmail",
      actionType: "read_blacklist",
      regexPattern: "Password Reset"
    },
    {
      userId: dbUser.id,
      ruleName: "Block Sign In Alerts",
      service: "gmail",
      actionType: "read_blacklist",
      regexPattern: "Sign In"
    },
    {
      userId: dbUser.id,
      ruleName: "Block Verification Codes",
      service: "gmail",
      actionType: "read_blacklist",
      regexPattern: "Verification Code"
    }
  ];

  await db.insert(accessRules).values(rulesToInsert);
  const { captureServerEvent } = await import("@/lib/posthogServer");
  captureServerEvent(dbUser.clerkUserId, "shield_enabled", { rules: rulesToInsert.length });
  revalidatePath("/dashboard");
}

// ─── Send to Anyone ────────────────────────────────────────────────────────

/**
 * Grant a profile an all-recipients send whitelist ('*' pattern). Shared by
 * the dashboard one-click button and the send_all magic link.
 *
 * Reuses an existing '*' rule only when it already has assignments — adding
 * an assignment to a GLOBAL rule (zero assignments) would silently narrow it
 * to this one key, revoking sending everywhere else. Returns false when the
 * key already has the grant (directly or via a global rule).
 */
async function grantSendToAnyone(dbUserId: string, keyId: string): Promise<boolean> {
  const candidates = await db.select().from(accessRules).where(and(
    eq(accessRules.userId, dbUserId),
    eq(accessRules.service, 'gmail'),
    eq(accessRules.actionType, 'send_whitelist'),
    eq(accessRules.regexPattern, '*'),
  ));

  let reusable: typeof candidates[number] | null = null;
  for (const rule of candidates) {
    const assignments = await db.select().from(keyRuleAssignments)
      .where(eq(keyRuleAssignments.accessRuleId, rule.id));
    if (assignments.length === 0) return false; // global — already covers this key
    if (assignments.some(a => a.proxyKeyId === keyId)) return false; // already granted
    reusable = reusable ?? rule;
  }

  let rule = reusable;
  if (!rule) {
    [rule] = await db.insert(accessRules).values({
      userId: dbUserId,
      ruleName: 'Send to Anyone',
      service: 'gmail',
      actionType: 'send_whitelist',
      regexPattern: '*',
    }).returning();
  }

  await db.insert(keyRuleAssignments).values({ proxyKeyId: keyId, accessRuleId: rule.id });
  return true;
}

/**
 * One-click "let this profile email anyone" — the escape hatch for users who
 * don't want to whitelist recipients one at a time. Deliberately per-profile
 * (surfaced on the Default Profile in the UI) and reversible by deleting the
 * 'Send to Anyone' rule.
 */
export async function enableSendToAnyone(keyId: string) {
  const dbUser = await getDbUser();

  const key = await db.select().from(proxyKeys)
    .where(and(eq(proxyKeys.id, keyId), eq(proxyKeys.userId, dbUser.id), isNull(proxyKeys.revokedAt)))
    .limit(1).then(r => r[0]);
  if (!key) throw new Error("Unauthorized");

  const granted = await grantSendToAnyone(dbUser.id, key.id);
  if (granted) {
    const { captureServerEvent } = await import("@/lib/posthogServer");
    captureServerEvent(dbUser.clerkUserId, "send_all_enabled", { source: "dashboard" });
  }
  revalidatePath("/dashboard");
}

// ─── Magic-Link Approvals (connector-growth Phase C) ───────────────────────

export type MagicApprovalResult =
  | {
      ok: true;
      description: string;
      /** Set when the FGAC rule was created but Google has no drive.file
       * grant for the sheet yet — the approve page must route the user into
       * the Picker recovery flow instead of claiming the agent can retry. */
      needsSheetsGrant?: { spreadsheetId: string; resourceName?: string };
      /** Set on successful sheets approvals: the primary spreadsheet a rule
       * was created for. The approve page's success card polls the Google
       * grant for this id before telling the user "the agent can retry now"
       * (drive.file grants are eventually consistent — see sheetsGrantCheck). */
      grantedSpreadsheetId?: string;
    }
  | { ok: false; reason: string };

/**
 * Consume a signed approval link and apply exactly the grant it describes.
 * Security gates, in order: valid signature + not expired; the SIGNED-IN user
 * is the user the token was minted for; the key belongs to them and is live;
 * single-use (jti recorded in approval_consumptions — the PK makes replays
 * impossible even under race).
 */
export async function approveMagicLink(
  token: string,
  sheetsWriteChoice?: boolean,
  /** Sheets the user just picked in the Google Picker (picker-first flow).
   * Client-supplied and therefore untrusted: rules are created only for
   * picked ids that verify against Google with the owner's token. */
  pickedSheets?: { id: string; name?: string }[],
): Promise<MagicApprovalResult> {
  const { verifyApprovalToken, describeApproval } = await import("@/lib/approvalLinks");
  const { approvalConsumptions } = await import("@/db/schema");
  const { captureServerEvent } = await import("@/lib/posthogServer");

  const dbUser = await getDbUser();

  const verified = await verifyApprovalToken(token);
  if (!verified.ok) {
    return {
      ok: false,
      reason: verified.reason === "expired"
        ? "This approval link has expired (links last 15 minutes). Ask the agent to request access again."
        : "This approval link is invalid.",
    };
  }
  const p = verified.payload;

  if (p.userId !== dbUser.id) {
    return { ok: false, reason: "This approval link belongs to a different account." };
  }

  const key = await db.select().from(proxyKeys)
    .where(and(eq(proxyKeys.id, p.proxyKeyId), eq(proxyKeys.userId, dbUser.id), isNull(proxyKeys.revokedAt)))
    .limit(1).then(r => r[0]);
  if (!key) {
    return { ok: false, reason: "The agent profile this link targets no longer exists or was revoked." };
  }

  // Single-use: the PK on jti turns a replay into a unique violation.
  // Consumption is deferred per-branch so read-only pre-checks (Google grant
  // verification in the picker-first sheets path) can fail WITHOUT burning
  // the link — only a branch that is about to write rules consumes it.
  const consume = async (): Promise<boolean> => {
    try {
      await db.insert(approvalConsumptions).values({ jti: p.jti, userId: dbUser.id });
      return true;
    } catch {
      return false;
    }
  };
  const alreadyUsed = {
    ok: false as const,
    reason: "This approval link was already used. Each link works exactly once.",
  };

  if (p.action === "send_whitelist" && p.recipient) {
    if (!(await consume())) return alreadyUsed;
    const escaped = p.recipient.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const [rule] = await db.insert(accessRules).values({
      userId: dbUser.id,
      ruleName: `Allow sending to ${p.recipient}`,
      service: "gmail",
      actionType: "send_whitelist",
      regexPattern: `^${escaped}$`,
    }).returning();
    await db.insert(keyRuleAssignments).values({ proxyKeyId: key.id, accessRuleId: rule.id });
  } else if (p.action === "send_all") {
    if (!(await consume())) return alreadyUsed;
    // Idempotent: an already-granted key still consumes the token and reports
    // success — the agent's retry will work either way.
    await grantSendToAnyone(dbUser.id, key.id);
  } else if ((p.action === "sheets_expose" || p.action === "sheets_write") && p.spreadsheetId) {
    const readWrite = p.action === "sheets_write" || sheetsWriteChoice === true;
    const { verifySheetsGrant, getOwnerGoogleToken } = await import("@/lib/sheetsGrantCheck");
    const googleToken = await getOwnerGoogleToken(dbUser.clerkUserId);

    const insertSheetRule = async (id: string, name: string | null) => {
      const [rule] = await db.insert(accessRules).values({
        userId: dbUser.id,
        ruleName: `${readWrite ? "Read & Write" : "Read Only"}: ${name || id}`,
        service: "sheets",
        actionType: readWrite ? "sheet_read_write" : "sheet_read",
        targetResourceId: id,
        resourceName: name,
      }).returning();
      await db.insert(keyRuleAssignments).values({ proxyKeyId: key.id, accessRuleId: rule.id });
    };

    if (pickedSheets && pickedSheets.length > 0) {
      // Picker-first path. The pick is the real authorization moment — it
      // registers the Google-side drive.file grant AND confirms the file's
      // identity. Rules are created only for picked ids Google confirms the
      // owner's token can reach; the token's id gets NO rule unless it is
      // among them (no phantom rules for ids the agent guessed wrong).
      const verified: { id: string; name: string | null }[] = [];
      for (const s of pickedSheets.slice(0, 10)) {
        if (typeof s?.id !== "string" || !s.id) continue;
        const check = googleToken
          ? await verifySheetsGrant(googleToken, s.id)
          : { state: "missing" as const };
        if (check.state === "ok") {
          verified.push({ id: s.id, name: (typeof s.name === "string" && s.name) || ("title" in check ? check.title : null) });
        }
      }
      if (verified.length === 0) {
        // Read-only failure — the link was NOT consumed; the user can retry.
        return {
          ok: false,
          reason: "Google hasn't finished sharing the picked sheet(s) with FGAC yet. Wait a few seconds and try the pick again — the link is still valid.",
        };
      }
      if (!(await consume())) return alreadyUsed;
      for (const v of verified) await insertSheetRule(v.id, v.name);

      const substituted = !verified.some(v => v.id === p.spreadsheetId);
      captureServerEvent(dbUser.clerkUserId, "sheets_grant_verification", {
        result: "ok", via: "magic_link", spreadsheet_id: verified[0].id, link_id: p.jti,
      });
      captureServerEvent(dbUser.clerkUserId, "approval_link_approved", {
        action: p.action, substituted, granted_count: verified.length, link_id: p.jti,
      });
      revalidatePath("/dashboard");
      const names = verified.map(v => v.name || v.id).join(", ");
      const level = readWrite ? "read & write" : "read-only";
      return {
        ok: true,
        grantedSpreadsheetId: verified[0].id,
        description: substituted
          ? `Granted ${level} access to ${names}. That's the sheet you picked — not the ID the agent originally sent, which you don't appear to have. The agent will find the right sheet in its permissions.`
          : `Granted ${level} access to ${names}.`,
      };
    }

    // Fallback path (no pick info — verification was inconclusive at page
    // load, or a client without the picker flow). Create the rule, verify
    // the Google half, and route to the recovery page when it's missing —
    // never claim "retry now" for a sheet Google can't reach (the
    // approve→retry→404 dead end the 2026-08 launch cohort churned on).
    if (!(await consume())) return alreadyUsed;
    await insertSheetRule(p.spreadsheetId, p.resourceName || null);
    const grant = googleToken
      ? await verifySheetsGrant(googleToken, p.spreadsheetId)
      : { state: "missing" as const };
    captureServerEvent(dbUser.clerkUserId, "sheets_grant_verification", {
      result: grant.state,
      via: "magic_link",
      spreadsheet_id: p.spreadsheetId,
      link_id: p.jti,
    });
    if (grant.state === "missing") {
      captureServerEvent(dbUser.clerkUserId, "approval_link_approved", { action: p.action, link_id: p.jti });
      revalidatePath("/dashboard");
      return {
        ok: true,
        description: describeApproval(p),
        needsSheetsGrant: {
          spreadsheetId: p.spreadsheetId,
          resourceName: p.resourceName || undefined,
        },
      };
    }
    captureServerEvent(dbUser.clerkUserId, "approval_link_approved", { action: p.action, link_id: p.jti });
    revalidatePath("/dashboard");
    return { ok: true, description: describeApproval(p), grantedSpreadsheetId: p.spreadsheetId };
  } else {
    return { ok: false, reason: "This approval link is malformed." };
  }

  captureServerEvent(dbUser.clerkUserId, "approval_link_approved", { action: p.action, link_id: p.jti });
  revalidatePath("/dashboard");
  return { ok: true, description: describeApproval(p) };
}
