import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { users, accessRules, keyRuleAssignments, proxyKeys } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// GET /api/rules/grant-sheets-access - List all sheets rules for current user
export async function GET(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1)
      .then(res => res[0]);

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rules = await db
      .select()
      .from(accessRules)
      .where(
        and(
          eq(accessRules.userId, dbUser.id),
          eq(accessRules.service, 'sheets')
        )
      );

    // Fetch key assignments for each rule
    const ruleAssignments = await db.select().from(keyRuleAssignments);
    const rulesWithKeys = rules.map(rule => {
      const assignedKeyIds = ruleAssignments
        .filter(a => a.accessRuleId === rule.id)
        .map(a => a.proxyKeyId);
      return {
        ...rule,
        assignedKeyIds
      };
    });

    return NextResponse.json({ sheetsRules: rulesWithKeys });
  } catch (error) {
    console.error('Error fetching sheets rules:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/rules/grant-sheets-access - Create or update a sheets access rule
export async function POST(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1)
      .then(res => res[0]);

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { targetResourceId, resourceName, actionType, proxyKeyIds } = body;

    if (!targetResourceId) {
      return NextResponse.json({ error: 'targetResourceId (spreadsheetId) is required' }, { status: 400 });
    }

    const validActionTypes = ['sheet_read', 'sheet_read_write', 'sheet_block'];
    const chosenActionType = validActionTypes.includes(actionType) ? actionType : 'sheet_read';

    // Check if rule for this spreadsheetId already exists for this user
    const existingRule = await db
      .select()
      .from(accessRules)
      .where(
        and(
          eq(accessRules.userId, dbUser.id),
          eq(accessRules.service, 'sheets'),
          eq(accessRules.targetResourceId, targetResourceId)
        )
      )
      .limit(1)
      .then(res => res[0]);

    let ruleId: string;

    if (existingRule) {
      ruleId = existingRule.id;
      await db
        .update(accessRules)
        .set({
          ruleName: resourceName || existingRule.ruleName,
          resourceName: resourceName || existingRule.resourceName,
          actionType: chosenActionType,
          updatedAt: new Date()
        })
        .where(eq(accessRules.id, ruleId));
    } else {
      const [newRule] = await db
        .insert(accessRules)
        .values({
          userId: dbUser.id,
          ruleName: resourceName || `Spreadsheet ${targetResourceId.slice(0, 8)}...`,
          service: 'sheets',
          actionType: chosenActionType,
          targetResourceId,
          resourceName: resourceName || `Spreadsheet (${targetResourceId.slice(0, 8)})`
        })
        .returning();
      ruleId = newRule.id;
    }

    // Sync Key Rule Assignments if proxyKeyIds provided
    if (Array.isArray(proxyKeyIds)) {
      // Clear existing assignments for this rule
      await db.delete(keyRuleAssignments).where(eq(keyRuleAssignments.accessRuleId, ruleId));

      if (proxyKeyIds.length > 0) {
        // Filter valid proxy keys belonging to user
        const userKeys = await db
          .select()
          .from(proxyKeys)
          .where(
            and(
              eq(proxyKeys.userId, dbUser.id),
              inArray(proxyKeys.id, proxyKeyIds)
            )
          );
        
        const validKeyIds = userKeys.map(k => k.id);
        if (validKeyIds.length > 0) {
          await db.insert(keyRuleAssignments).values(
            validKeyIds.map(keyId => ({
              proxyKeyId: keyId,
              accessRuleId: ruleId
            }))
          );
        }
      }
    }

    return NextResponse.json({ success: true, ruleId });
  } catch (error) {
    console.error('Error saving sheets rule:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/rules/grant-sheets-access - Delete a sheets access rule
export async function DELETE(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbUser = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1)
      .then(res => res[0]);

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get('ruleId');

    if (!ruleId) {
      return NextResponse.json({ error: 'ruleId parameter is required' }, { status: 400 });
    }

    await db
      .delete(accessRules)
      .where(
        and(
          eq(accessRules.id, ruleId),
          eq(accessRules.userId, dbUser.id)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting sheets rule:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
