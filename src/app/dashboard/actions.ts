"use server";

import { db } from "@/db";
import { users, accessRules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

async function getDbUser() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");
  
  const dbUser = await db.select().from(users).where(eq(users.clerkUserId, user.id)).limit(1).then(res => res[0]);
  if (!dbUser) throw new Error("User not found in DB");
  
  return dbUser;
}

export async function createRule(formData: FormData) {
  const dbUser = await getDbUser();
  const ruleName = formData.get("ruleName") as string;
  const service = formData.get("service") as string;
  const actionType = formData.get("actionType") as string;
  const regexPattern = formData.get("regexPattern") as string;

  if (!ruleName || !service || !actionType || !regexPattern) {
    throw new Error("Missing required fields");
  }

  await db.insert(accessRules).values({
    userId: dbUser.id,
    ruleName,
    service,
    actionType,
    regexPattern,
  });

  revalidatePath("/dashboard");
}

export async function deleteRule(id: string) {
  const dbUser = await getDbUser();
  
  // Verify ownership before deleting
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
