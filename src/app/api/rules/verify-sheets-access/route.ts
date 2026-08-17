import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { users, accessRules } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifySheetsGrant, getOwnerGoogleToken, SheetsGrantState } from '@/lib/sheetsGrantCheck';
import { captureServerEvent } from '@/lib/posthogServer';

export const dynamic = 'force-dynamic';

/**
 * GET /api/rules/verify-sheets-access[?sid=<spreadsheetId>][&context=recovery]
 *
 * For the signed-in user, checks whether Google actually grants us access to
 * the spreadsheet(s) behind their sheets rules (FGAC rule ≠ Google grant —
 * see sheetsGrantCheck.ts). Without `sid`, verifies every sheets rule and
 * returns a map; with `sid`, verifies just that spreadsheet (it does not need
 * an existing rule — the approval flow verifies before the page settles).
 *
 * `context=recovery` marks a re-check issued by the recovery UI right after a
 * Picker pick; a verified `ok` in that context is the "user completed the
 * recovery loop" signal and fires `sheets_grant_recovered`.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sid = searchParams.get('sid');
    const context = searchParams.get('context');

    const token = await getOwnerGoogleToken(clerkUserId);

    if (sid) {
      const result: SheetsGrantState = token
        ? await verifySheetsGrant(token, sid)
        : { state: 'missing' };
      if (context === 'recovery') {
        // Capture every recovery re-check, not just successes — recovery
        // attempts that stay 'missing' are the funnel's stuck users.
        captureServerEvent(clerkUserId, 'sheets_grant_verification', {
          result: result.state, via: 'recovery', spreadsheet_id: sid,
        });
        if (result.state === 'ok') {
          captureServerEvent(clerkUserId, 'sheets_grant_recovered', { spreadsheet_id: sid });
        }
      }
      // link_open = the approve page checking the grant before showing the
      // flow — the top of the picker-first funnel.
      if (context === 'link_open') {
        captureServerEvent(clerkUserId, 'sheets_grant_verification', {
          result: result.state, via: 'link_open', spreadsheet_id: sid,
        });
      }
      return NextResponse.json({ spreadsheetId: sid, ...result });
    }

    const dbUser = await db.select().from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1).then(r => r[0]);
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const rules = await db.select().from(accessRules).where(
      and(eq(accessRules.userId, dbUser.id), eq(accessRules.service, 'sheets')),
    );

    // Distinct spreadsheet ids only — several rules can share one sheet.
    const ids = [...new Set(rules.map(r => r.targetResourceId).filter((v): v is string => !!v))];
    const entries = await Promise.all(ids.map(async id => {
      const result: SheetsGrantState = token
        ? await verifySheetsGrant(token, id)
        : { state: 'missing' };
      return [id, result] as const;
    }));

    return NextResponse.json({ grants: Object.fromEntries(entries) });
  } catch (error) {
    console.error('Error verifying sheets access:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
