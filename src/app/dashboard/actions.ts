"use server";

import { db } from "@/db";
import { users, proxyKeys, connectedEmails, keyEmailAccess, accessRules, keyRuleAssignments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getDbUser() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const dbUser = await db.select().from(users).where(eq(users.clerkUserId, user.id)).limit(1).then(res => res[0]);
  if (!dbUser) throw new Error("User not found in DB");

  return dbUser;
}

// ─── Connected Emails ───────────────────────────────────────────────────────

export async function syncConnectedEmails() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const dbUser = await db.select().from(users).where(eq(users.clerkUserId, user.id)).limit(1).then(res => res[0]);
  if (!dbUser) throw new Error("User not found in DB");

  // Fetch all Google external accounts from Clerk
  const client = await clerkClient();
  const clerkUser = await client.users.getUser(user.id);

  console.log('[syncConnectedEmails] Clerk user:', clerkUser.id, clerkUser.emailAddresses.map(e => e.emailAddress));
  console.log('[syncConnectedEmails] All external accounts:', clerkUser.externalAccounts.map(ea => ({
    id: ea.id, provider: ea.provider, email: ea.emailAddress, status: ea.verification?.status,
  })));

  const googleAccounts = clerkUser.externalAccounts.filter(
    ea => ea.provider === 'oauth_google' || ea.provider === 'google'
  );
  console.log('[syncConnectedEmails] Google accounts found:', googleAccounts.length);

  // Get existing connected emails
  const existing = await db.select().from(connectedEmails).where(eq(connectedEmails.userId, dbUser.id));
  const existingExternalIds = new Set(existing.map(e => e.clerkExternalAccountId));

  // Add any new accounts not yet synced
  for (const ga of googleAccounts) {
    if (!existingExternalIds.has(ga.id)) {
      await db.insert(connectedEmails).values({
        userId: dbUser.id,
        googleEmail: ga.emailAddress,
        clerkExternalAccountId: ga.id,
      });
    }
  }

  // Remove any that no longer exist in Clerk
  const clerkExternalIds = new Set(googleAccounts.map(ga => ga.id));
  for (const e of existing) {
    if (!clerkExternalIds.has(e.clerkExternalAccountId)) {
      await db.delete(connectedEmails).where(eq(connectedEmails.id, e.id));
    }
  }

  revalidatePath("/dashboard");
}

// ─── Proxy Keys ─────────────────────────────────────────────────────────────

export async function createProxyKey(formData: FormData) {
  const dbUser = await getDbUser();
  const label = formData.get("label") as string;
  const emailIds = formData.getAll("emailIds") as string[];

  if (!label) throw new Error("Label is required");

  // Create the key
  const newKey = await db.insert(proxyKeys).values({
    userId: dbUser.id,
    key: `sk_proxy_${crypto.randomUUID().replace(/-/g, '')}`,
    label,
  }).returning().then(res => res[0]);

  // Grant email access
  for (const emailId of emailIds) {
    await db.insert(keyEmailAccess).values({
      proxyKeyId: newKey.id,
      connectedEmailId: emailId,
    });
  }

  revalidatePath("/dashboard");
}

export async function revokeProxyKey(keyId: string) {
  const dbUser = await getDbUser();

  // Verify ownership
  const key = await db.select().from(proxyKeys).where(eq(proxyKeys.id, keyId)).limit(1).then(res => res[0]);
  if (!key || key.userId !== dbUser.id) throw new Error("Unauthorized");

  await db.update(proxyKeys).set({ revokedAt: new Date() }).where(eq(proxyKeys.id, keyId));
  revalidatePath("/dashboard");
}

export async function rollProxyKey(keyId: string) {
  const dbUser = await getDbUser();

  // Verify ownership
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
      connectedEmailId: ea.connectedEmailId,
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

  console.log("[createRule] Received form data:", {
    ruleName, service, actionType, regexPattern, targetEmail,
    keyIds, allKeys: Array.from(formData.keys()),
  });

  if (!ruleName || !service || !actionType || !regexPattern) {
    console.error("[createRule] Missing required fields:", { ruleName, service, actionType, regexPattern });
    // Don't throw — server action throws crash the entire page in Next.js
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

  // If specific keys are selected, create assignments (otherwise it's a global rule)
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
