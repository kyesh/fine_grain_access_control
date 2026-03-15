"use server";

import { db } from "@/db";
import { users, proxyKeys, emailDelegations, keyEmailAccess, accessRules, keyRuleAssignments } from "@/db/schema";
import { eq, and, or } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

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

  if (!delegateEmail) {
    console.error("[createDelegation] Missing delegate email");
    revalidatePath("/dashboard");
    return;
  }

  // Can't delegate to yourself
  if (delegateEmail === dbUser.email.toLowerCase()) {
    console.error("[createDelegation] Cannot delegate to yourself");
    revalidatePath("/dashboard");
    return;
  }

  // Find the delegate user in our DB
  const delegateUser = await db.select().from(users)
    .where(eq(users.email, delegateEmail))
    .limit(1).then(res => res[0]);

  if (!delegateUser) {
    console.error("[createDelegation] Delegate user not found:", delegateEmail);
    revalidatePath("/dashboard");
    return;
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

  revalidatePath("/dashboard");
}

// ─── Proxy Keys ─────────────────────────────────────────────────────────────

export async function createProxyKey(formData: FormData) {
  const dbUser = await getDbUser();
  const label = formData.get("label") as string;
  const emailAddresses = formData.getAll("emails") as string[];

  if (!label) throw new Error("Label is required");

  // Create the key
  const newKey = await db.insert(proxyKeys).values({
    userId: dbUser.id,
    key: `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`,
    label,
  }).returning().then(res => res[0]);

  // Grant email access — look up delegation for each email
  for (const email of emailAddresses) {
    // Check if this is the user's own email or a delegated email
    let delegationId: string | null = null;

    if (email.toLowerCase() !== dbUser.email.toLowerCase()) {
      // This is a delegated email — find the active delegation
      const ownerUser = await db.select().from(users)
        .where(eq(users.email, email))
        .limit(1).then(res => res[0]);

      if (ownerUser) {
        const delegation = await db.select().from(emailDelegations)
          .where(and(
            eq(emailDelegations.ownerUserId, ownerUser.id),
            eq(emailDelegations.delegateUserId, dbUser.id),
            eq(emailDelegations.status, 'active'),
          ))
          .limit(1).then(res => res[0]);

        if (delegation) {
          delegationId = delegation.id;
        }
      }
    }

    await db.insert(keyEmailAccess).values({
      proxyKeyId: newKey.id,
      delegationId,
      targetEmail: email,
    });
  }

  revalidatePath("/dashboard");
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
  const regexPattern = formData.get("regexPattern") as string;
  const targetEmail = formData.get("targetEmail") as string || null;
  const keyIds = formData.getAll("keyIds") as string[];

  if (!ruleName || !service || !actionType || !regexPattern) {
    console.error("[createRule] Missing required fields:", { ruleName, service, actionType, regexPattern });
    revalidatePath("/dashboard");
    return;
  }

  const newRule = await db.insert(accessRules).values({
    userId: dbUser.id,
    ruleName,
    service,
    actionType,
    regexPattern,
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

export async function deleteRule(id: string) {
  const dbUser = await getDbUser();

  const rule = await db.select().from(accessRules).where(eq(accessRules.id, id)).limit(1).then(res => res[0]);
  if (!rule || rule.userId !== dbUser.id) {
    throw new Error("Unauthorized or Rule not found");
  }

  await db.delete(accessRules).where(eq(accessRules.id, id));
  revalidatePath("/dashboard");
}

export async function applyRecommendedSecurityRules() {
  const dbUser = await getDbUser();

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
