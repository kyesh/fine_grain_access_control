"use server";

import { db } from "@/db";
import { users, proxyKeys, emailDelegations, keyEmailAccess, accessRules, keyRuleAssignments } from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { findActiveDelegation } from "@/db/delegationQueries";
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
    revalidatePath("/dashboard");
    return;
  }

  if (existing && existing.status === 'revoked') {
    // Re-activate the existing delegation
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
  revalidatePath("/dashboard");
}
