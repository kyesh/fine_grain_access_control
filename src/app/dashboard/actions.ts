"use server";

import { db } from "@/db";
import { users, proxyKeys, emailDelegations, keyEmailAccess, accessRules, keyRuleAssignments } from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { findActiveDelegation } from "@/db/delegationQueries";
import { syncDefaultProfileDelegatedAccess } from "@/db/defaultProfile";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { validateRulePattern, patternKind, assertStorablePattern } from "@/lib/rulePatterns";
import type { ApprovalSearchParams, ApprovalPayload } from "@/lib/approvalLinks";
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

/**
 * Server actions that a modal submits must RETURN their failure, never throw.
 * Next.js redacts thrown server-action messages in production and replaces them
 * with an opaque digest, so a thrown validation error reaches the browser as a
 * blank 500 — which is precisely why the 2026-04-10 pattern regression went
 * unnoticed for four months. A returned value is not redacted.
 */
export type RuleActionResult = { ok: true } | { ok: false; error: string };

/**
 * Rule-save telemetry. The pattern itself is NEVER sent: send_whitelist
 * patterns are real email addresses. Shape and length carry the signal.
 */
async function reportRuleSave(
  clerkUserId: string,
  event: "rule_saved" | "rule_save_failed",
  props: Record<string, unknown>,
) {
  const { captureServerEvent } = await import("@/lib/posthogServer");
  captureServerEvent(clerkUserId, event, props);
}


export async function createRule(formData: FormData): Promise<RuleActionResult> {
  const dbUser = await getDbUser();
  const ruleName = formData.get("ruleName") as string;
  const service = formData.get("service") as string;
  const actionType = formData.get("actionType") as string;
  const rawPattern = formData.get("regexPattern") as string;
  const targetEmail = formData.get("targetEmail") as string || null;
  const keyIds = formData.getAll("keyIds") as string[];

  if (!ruleName || !service || !actionType) {
    console.error("[createRule] Missing required fields:", { ruleName, service, actionType });
    await reportRuleSave(dbUser.clerkUserId, "rule_save_failed", {
      mode: "create", service, action_type: actionType, reason: "missing_fields",
    });
    return { ok: false, error: "Rule name, service and action type are all required." };
  }

  let finalRegexPattern: string | null = null;
  let targetResourceId: string | null = null;

  if (service === 'sheets' || service === 'docs') {
    targetResourceId = rawPattern;
  } else {
    finalRegexPattern = rawPattern;
    if (finalRegexPattern) {
      const check = validateRulePattern(finalRegexPattern);
      if (!check.ok) {
        await reportRuleSave(dbUser.clerkUserId, "rule_save_failed", {
          mode: "create", service, action_type: actionType, reason: check.reason,
          pattern_kind: patternKind(finalRegexPattern),
          pattern_length: finalRegexPattern.length,
        });
        return { ok: false, error: check.message };
      }
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

  await reportRuleSave(dbUser.clerkUserId, "rule_saved", {
    mode: "create", service, action_type: actionType,
    scoped: !!targetEmail, assigned_keys: keyIds.length,
    ...(finalRegexPattern ? {
      pattern_kind: patternKind(finalRegexPattern),
      pattern_length: finalRegexPattern.length,
    } : {}),
  });

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateRule(formData: FormData): Promise<RuleActionResult> {
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
    await reportRuleSave(dbUser.clerkUserId, "rule_save_failed", {
      mode: "update", service, action_type: actionType, reason: "missing_fields",
    });
    return { ok: false, error: "Rule name, service and action type are all required." };
  }

  let finalRegexPattern: string | null = null;
  let targetResourceId: string | null = null;

  if (service === 'sheets' || service === 'docs') {
    targetResourceId = rawPattern;
  } else {
    finalRegexPattern = rawPattern;
    if (finalRegexPattern) {
      const check = validateRulePattern(finalRegexPattern);
      if (!check.ok) {
        await reportRuleSave(dbUser.clerkUserId, "rule_save_failed", {
          mode: "update", service, action_type: actionType, reason: check.reason,
          pattern_kind: patternKind(finalRegexPattern),
          pattern_length: finalRegexPattern.length,
        });
        return { ok: false, error: check.message };
      }
    }
  }

  // Verify ownership
  const rule = await db.select().from(accessRules).where(eq(accessRules.id, ruleId)).limit(1).then(res => res[0]);
  if (!rule || rule.userId !== dbUser.id) {
    await reportRuleSave(dbUser.clerkUserId, "rule_save_failed", {
      mode: "update", service, action_type: actionType, reason: "not_found_or_forbidden",
    });
    return { ok: false, error: "That rule no longer exists, or it is not yours to edit." };
  }

  // Update the rule
  await db.update(accessRules).set({
    ruleName,
    service,
    actionType,
    regexPattern: finalRegexPattern,
    targetResourceId: (service === 'sheets' || service === 'docs') ? targetResourceId : rule.targetResourceId,
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

  await reportRuleSave(dbUser.clerkUserId, "rule_saved", {
    mode: "update", service, action_type: actionType,
    scoped: !!targetEmail, assigned_keys: keyIds.length,
    ...(finalRegexPattern ? {
      pattern_kind: patternKind(finalRegexPattern),
      pattern_length: finalRegexPattern.length,
    } : {}),
  });

  revalidatePath("/dashboard");
  return { ok: true };
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
 * Persist files picked in the Google Picker as access rules (shared by the
 * sheets and docs exposure flows).
 *
 * With a profileId the exposure is scoped to that profile; without one it is
 * global. Existing rules are never narrowed: a global rule stays global, and a
 * profile-scoped rule gains the new assignment instead of replacing the set.
 */
async function exposeFilesFromPicker(
  kind: 'sheet' | 'doc',
  picked: { id: string; name: string }[],
  profileId?: string,
) {
  const { DRIVE_FILE_KINDS } = await import("@/lib/driveFileKinds");
  const d = DRIVE_FILE_KINDS[kind];
  const dbUser = await getDbUser();

  if (profileId) {
    const key = await db.select().from(proxyKeys)
      .where(and(eq(proxyKeys.id, profileId), eq(proxyKeys.userId, dbUser.id)))
      .limit(1).then(res => res[0]);
    if (!key) throw new Error("Unauthorized or profile not found");
  }

  const fallbackNoun = d.noun.charAt(0).toUpperCase() + d.noun.slice(1);
  for (const file of picked) {
    if (!file?.id) continue;
    const name = file.name || `${fallbackNoun} (${file.id.slice(0, 8)})`;

    const existing = await db.select().from(accessRules)
      .where(and(
        eq(accessRules.userId, dbUser.id),
        eq(accessRules.service, d.service),
        eq(accessRules.targetResourceId, file.id),
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
          service: d.service,
          actionType: d.actionTypes.read,
          targetResourceId: file.id,
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

export async function exposeSheetsFromPicker(
  picked: { id: string; name: string }[],
  profileId?: string,
) {
  return exposeFilesFromPicker('sheet', picked, profileId);
}

export async function exposeDocsFromPicker(
  picked: { id: string; name: string }[],
  profileId?: string,
) {
  return exposeFilesFromPicker('doc', picked, profileId);
}

const DOC_ACTION_TYPES = ['doc_read', 'doc_read_write', 'doc_block'] as const;

export async function setSheetRulePermission(ruleId: string, actionType: string) {
  const dbUser = await getDbUser();

  const isSheetType = SHEET_ACTION_TYPES.includes(actionType as typeof SHEET_ACTION_TYPES[number]);
  const isDocType = DOC_ACTION_TYPES.includes(actionType as typeof DOC_ACTION_TYPES[number]);
  if (!isSheetType && !isDocType) {
    throw new Error(`Invalid file permission: ${actionType}`);
  }

  const rule = await db.select().from(accessRules).where(eq(accessRules.id, ruleId)).limit(1).then(res => res[0]);
  if (!rule || rule.userId !== dbUser.id) {
    throw new Error("Unauthorized or Rule not found");
  }
  // The action-type family must match the rule's service — a sheets rule can
  // never end up with doc_* permissions or vice versa.
  if (!(rule.service === 'sheets' && isSheetType) && !(rule.service === 'docs' && isDocType)) {
    throw new Error("Permission type does not match the rule's service");
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

  for (const r of rulesToInsert) {
    assertStorablePattern(r.regexPattern, 'applyRecommendedSecurityRules');
  }
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
    assertStorablePattern('*', 'grantSendToAnyone');
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
      /** Docs twin of needsSheetsGrant (routes to /dashboard/docs-setup). */
      needsDocsGrant?: { documentId: string; resourceName?: string };
      /** Set on successful sheets approvals: the primary spreadsheet a rule
       * was created for. The approve page's success card polls the Google
       * grant for this id before telling the user "the agent can retry now"
       * (drive.file grants are eventually consistent — see sheetsGrantCheck). */
      grantedSpreadsheetId?: string;
      /** Docs twin of grantedSpreadsheetId. */
      grantedDocumentId?: string;
    }
  | {
      ok: false;
      reason: string;
      /** Nothing was written and the user can retry from the same page
       * (e.g. drive.file propagation lag on a just-picked sheet). The
       * approve page must return to the live link URL with this notice —
       * never to a parameter-less "Approval failed" dead end (a user hit
       * exactly that on 2026-08-19: "the link is still valid" on a page
       * that had lost the link). */
      retryable?: boolean;
    };

/**
 * Is the grant a magic-link payload describes currently active for its key?
 *
 * Since single-use was retired (2026-08-25) this is the ONLY replay guard:
 * re-approving an already-active grant writes nothing and reports success,
 * so a double submit cannot duplicate a rule. Re-approving after the grant
 * was REVOKED deliberately re-grants — the URL is permanent by design, and
 * doing so requires the owner's session plus an explicit click on a page
 * naming the grant, the same bar as re-adding the rule in the dashboard.
 */
async function grantActiveForApproval(
  p: { action: string; userId: string; recipient?: string; spreadsheetId?: string; documentId?: string },
  keyId: string,
): Promise<boolean> {
  const assignedOrGlobal = async (ruleId: string): Promise<boolean> => {
    const asgn = await db.select().from(keyRuleAssignments)
      .where(eq(keyRuleAssignments.accessRuleId, ruleId));
    return asgn.length === 0 || asgn.some(a => a.proxyKeyId === keyId);
  };

  if ((p.action === "send_whitelist" && p.recipient) || p.action === "send_all") {
    const escaped = p.recipient?.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const wanted = p.action === "send_all" ? ["*"] : [`^${escaped}$`, "*"];
    const rules = await db.select().from(accessRules).where(and(
      eq(accessRules.userId, p.userId),
      eq(accessRules.service, "gmail"),
      eq(accessRules.actionType, "send_whitelist"),
    ));
    for (const r of rules) {
      if (!r.regexPattern || !wanted.includes(r.regexPattern)) continue;
      if (await assignedOrGlobal(r.id)) return true;
    }
    return false;
  }

  if ((p.action === "sheets_expose" || p.action === "sheets_write") && p.spreadsheetId) {
    const needed = p.action === "sheets_write"
      ? ["sheet_read_write"]
      : ["sheet_read", "sheet_read_write"];
    const rules = await db.select().from(accessRules).where(and(
      eq(accessRules.userId, p.userId),
      eq(accessRules.service, "sheets"),
    ));
    for (const r of rules) {
      if (r.targetResourceId !== p.spreadsheetId || !needed.includes(r.actionType)) continue;
      if (await assignedOrGlobal(r.id)) return true;
    }
    return false;
  }

  if ((p.action === "docs_expose" || p.action === "docs_write") && p.documentId) {
    const needed = p.action === "docs_write"
      ? ["doc_read_write"]
      : ["doc_read", "doc_read_write"];
    const rules = await db.select().from(accessRules).where(and(
      eq(accessRules.userId, p.userId),
      eq(accessRules.service, "docs"),
    ));
    for (const r of rules) {
      if (r.targetResourceId !== p.documentId || !needed.includes(r.actionType)) continue;
      if (await assignedOrGlobal(r.id)) return true;
    }
    return false;
  }

  return false;
}

/**
 * Pre-flight state of an approval link, so the approve page can render the
 * truth at load time instead of letting the user click into an error.
 *
 * Collapsed from five states to three on 2026-08-25. With links no longer
 * single-use or expiring, "used" is neither knowable nor meaningful — the
 * only question that matters is whether the grant it describes is ALREADY
 * ACTIVE. `used_inactive` and `expired` are gone, and with them both dead
 * ends the launch cohort rage-clicked.
 */
export async function resolveApprovalLink(params: ApprovalSearchParams): Promise<
  | { status: "invalid" }
  | { status: "fresh" | "already_granted"; payload: ApprovalPayload }
> {
  const { verifyApprovalParams } = await import("@/lib/approvalLinks");
  const dbUser = await getDbUser();
  const verified = await verifyApprovalParams(dbUser.id, params);
  if (!verified.ok) return { status: "invalid" };
  const p = verified.payload;
  const active = await grantActiveForApproval(p, p.proxyKeyId);
  return { status: active ? "already_granted" : "fresh", payload: p };
}

/**
 * Shared picker-first approval for per-file (sheets/docs) magic links.
 * Extracted from the sheets branch of approveMagicLink when Docs support
 * landed — behavior for sheets is unchanged (same events, same copy).
 *
 * The pick is the real authorization moment — it registers the Google-side
 * drive.file grant AND confirms the file's identity. Rules are created only
 * for picked ids Google confirms the owner's token can reach; the token's id
 * gets NO rule unless it is among them (no phantom rules for ids the agent
 * guessed wrong). drive.file grants are eventually consistent: verifying a
 * pick in the seconds right after a first-time consent (the hottest path for
 * new users) can see "missing" for a file Google IS sharing — same race as
 * the MCP-side grace retries, so the pick gets the same grace instead of
 * failing the user's first approval (observed live 2026-08-19).
 */
async function applyFileGrantApproval(opts: {
  kind: "sheet" | "doc";
  dbUser: { id: string; clerkUserId: string };
  key: { id: string };
  p: { requestId: string; action: string; resourceName?: string };
  fileId: string;
  readWrite: boolean;
  picked?: { id: string; name?: string }[];
  describe: () => string;
}): Promise<MagicApprovalResult> {
  const { kind, dbUser, key, p, fileId, readWrite, picked, describe } = opts;
  const { DRIVE_FILE_KINDS } = await import("@/lib/driveFileKinds");
  const { verifyFileGrant, getOwnerGoogleToken } = await import("@/lib/driveFileGrantCheck");
  const { markApprovalRequestApproved } = await import("@/lib/approvalRequests");
  const { captureServerEvent } = await import("@/lib/posthogServer");
  const d = DRIVE_FILE_KINDS[kind];
  // Kind-specific analytics/copy: sheets keeps its historical event and prop
  // names; the short noun matches the pre-docs sheets copy ("sheet(s)").
  const verificationEvent = kind === "sheet" ? "sheets_grant_verification" : "docs_grant_verification";
  const idProp = kind === "sheet" ? "spreadsheet_id" : "document_id";
  const short = kind === "sheet" ? "sheet" : "document";
  const googleToken = await getOwnerGoogleToken(dbUser.clerkUserId);

  const grantedResult = (grantedId: string, description: string): MagicApprovalResult =>
    kind === "sheet"
      ? { ok: true, description, grantedSpreadsheetId: grantedId }
      : { ok: true, description, grantedDocumentId: grantedId };

  const insertFileRule = async (id: string, name: string | null) => {
    const [rule] = await db.insert(accessRules).values({
      userId: dbUser.id,
      ruleName: `${readWrite ? "Read & Write" : "Read Only"}: ${name || id}`,
      service: d.service,
      actionType: readWrite ? d.actionTypes.readWrite : d.actionTypes.read,
      targetResourceId: id,
      resourceName: name,
    }).returning();
    await db.insert(keyRuleAssignments).values({ proxyKeyId: key.id, accessRuleId: rule.id });
  };

  if (picked && picked.length > 0) {
    const verifyPicks = async () => {
      const out: { id: string; name: string | null }[] = [];
      for (const s of picked.slice(0, 10)) {
        if (typeof s?.id !== "string" || !s.id) continue;
        const check = googleToken
          ? await verifyFileGrant(kind, googleToken, s.id)
          : { state: "missing" as const };
        if (check.state === "ok") {
          out.push({ id: s.id, name: (typeof s.name === "string" && s.name) || ("title" in check ? check.title : null) });
        }
      }
      return out;
    };
    let verified = await verifyPicks();
    for (let attempt = 0; verified.length === 0 && attempt < 2; attempt++) {
      await new Promise(r => setTimeout(r, 3500));
      verified = await verifyPicks();
    }
    if (verified.length === 0) {
      // Read-only failure — the link was NOT consumed; the user can retry.
      return {
        ok: false,
        retryable: true,
        reason: `Google hasn't finished sharing the picked ${short}(s) with FGAC yet. Wait a few seconds and pick again — this link is still valid.`,
      };
    }
    for (const v of verified) await insertFileRule(v.id, v.name);

    const substituted = !verified.some(v => v.id === fileId);
    captureServerEvent(dbUser.clerkUserId, verificationEvent, {
      result: "ok", via: "magic_link", [idProp]: verified[0].id, request_id: p.requestId,
    });
    await markApprovalRequestApproved(p.requestId);
    captureServerEvent(dbUser.clerkUserId, "approval_link_approved", {
      action: p.action, substituted, granted_count: verified.length, request_id: p.requestId,
    });
    revalidatePath("/dashboard");
    const names = verified.map(v => v.name || v.id).join(", ");
    const level = readWrite ? "read & write" : "read-only";
    return grantedResult(
      verified[0].id,
      substituted
        ? `Granted ${level} access to ${names}. That's the ${short} you picked — not the ID the agent originally sent, which you don't appear to have. The agent will find the right ${short} in its permissions.`
        : `Granted ${level} access to ${names}.`,
    );
  }

  // Fallback path (no pick info — verification was inconclusive at page
  // load, or a client without the picker flow). Create the rule, verify
  // the Google half, and route to the recovery page when it's missing —
  // never claim "retry now" for a file Google can't reach (the
  // approve→retry→404 dead end the 2026-08 launch cohort churned on).
  await insertFileRule(fileId, p.resourceName || null);
  const grant = googleToken
    ? await verifyFileGrant(kind, googleToken, fileId)
    : { state: "missing" as const };
  captureServerEvent(dbUser.clerkUserId, verificationEvent, {
    result: grant.state,
    via: "magic_link",
    [idProp]: fileId,
    request_id: p.requestId,
  });
  if (grant.state === "missing") {
    await markApprovalRequestApproved(p.requestId);
    captureServerEvent(dbUser.clerkUserId, "approval_link_approved", { action: p.action, request_id: p.requestId });
    revalidatePath("/dashboard");
    return {
      ok: true,
      description: describe(),
      ...(kind === "sheet"
        ? { needsSheetsGrant: { spreadsheetId: fileId, resourceName: p.resourceName || undefined } }
        : { needsDocsGrant: { documentId: fileId, resourceName: p.resourceName || undefined } }),
    };
  }
  await markApprovalRequestApproved(p.requestId);
  captureServerEvent(dbUser.clerkUserId, "approval_link_approved", { action: p.action, request_id: p.requestId });
  revalidatePath("/dashboard");
  return grantedResult(fileId, describe());
}

/**
 * Verify a deterministic approval link and apply exactly the grant it
 * describes.
 *
 * Security gates, in order:
 *   1. HMAC recomputed with the SIGNED-IN user — a link authored for anyone
 *      else fails to verify, which is what binds the owner without putting a
 *      user id in the URL.
 *   2. The proxy key is looked up LIVE, scoped to that user and not revoked.
 *      This is the real authorization; the signature only proves FGAC
 *      authored the URL.
 *
 * There is no expiry gate and no single-use gate (both retired 2026-08-25).
 * Replay safety now comes from grant-level idempotency below: if the grant is
 * already active, nothing is written and success is reported. Re-approving
 * after a REVOCATION deliberately re-grants — the URL is permanent by design,
 * and doing so needs the owner's session plus an explicit click.
 */
export async function approveMagicLink(
  params: ApprovalSearchParams,
  sheetsWriteChoice?: boolean,
  /** Sheets the user just picked in the Google Picker (picker-first flow).
   * Client-supplied and therefore untrusted: rules are created only for
   * picked ids that verify against Google with the owner's token. */
  pickedSheets?: { id: string; name?: string }[],
): Promise<MagicApprovalResult> {
  const { verifyApprovalParams, describeApproval } = await import("@/lib/approvalLinks");
  const { markApprovalRequestApproved } = await import("@/lib/approvalRequests");
  const { captureServerEvent } = await import("@/lib/posthogServer");

  const dbUser = await getDbUser();

  const verified = await verifyApprovalParams(dbUser.id, params);
  if (!verified.ok) {
    return {
      ok: false,
      reason: "This approval link is not valid for your account. If an agent gave it to you, make sure you are signed in as the account the agent is connected to.",
    };
  }
  const p = verified.payload;

  const key = await db.select().from(proxyKeys)
    .where(and(eq(proxyKeys.id, p.proxyKeyId), eq(proxyKeys.userId, dbUser.id), isNull(proxyKeys.revokedAt)))
    .limit(1).then(r => r[0]);
  if (!key) {
    return { ok: false, reason: "The agent profile this link targets no longer exists or was revoked." };
  }

  // Grant-level idempotency, replacing single-use. Re-approving a grant that
  // is already active writes nothing and reports success, so a double submit
  // cannot create a duplicate rule. The effective action accounts for the
  // read→write upgrade choice, so upgrading an existing read grant is NOT
  // short-circuited as "already approved".
  const wantsWrite = sheetsWriteChoice === true;
  const effectiveAction =
    p.action === "sheets_expose" && wantsWrite ? "sheets_write"
      : p.action === "docs_expose" && wantsWrite ? "docs_write"
        : p.action;
  if (!pickedSheets?.length && await grantActiveForApproval({ ...p, action: effectiveAction }, key.id)) {
    return {
      ok: true,
      description: `${describeApproval(p)} — this was already approved, so nothing changed. The agent can retry its request now.`,
    };
  }

  if (p.action === "send_whitelist" && p.recipient) {
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
    await grantSendToAnyone(dbUser.id, key.id);
  } else if ((p.action === "sheets_expose" || p.action === "sheets_write") && p.spreadsheetId) {
    return applyFileGrantApproval({
      kind: "sheet",
      dbUser, key, p,
      fileId: p.spreadsheetId,
      readWrite: p.action === "sheets_write" || sheetsWriteChoice === true,
      picked: pickedSheets,
      describe: () => describeApproval(p),
    });
  } else if ((p.action === "docs_expose" || p.action === "docs_write") && p.documentId) {
    return applyFileGrantApproval({
      kind: "doc",
      dbUser, key, p,
      fileId: p.documentId,
      readWrite: p.action === "docs_write" || sheetsWriteChoice === true,
      picked: pickedSheets,
      describe: () => describeApproval(p),
    });
  } else {
    return { ok: false, reason: "This approval link is malformed." };
  }

  await markApprovalRequestApproved(p.requestId);
  captureServerEvent(dbUser.clerkUserId, "approval_link_approved", { action: p.action, request_id: p.requestId });
  revalidatePath("/dashboard");
  return { ok: true, description: describeApproval(p) };
}
