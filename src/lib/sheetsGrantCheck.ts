import { clerkClient } from '@clerk/nextjs/server';

/**
 * Sheets access has two halves: the FGAC rule (our database) and the
 * Google-side grant. The app never requests a Sheets OAuth scope — API access
 * rides on per-file `drive.file` grants, which Google registers ONLY when the
 * user picks the file in the Google Picker with our appId. An FGAC rule whose
 * sheet was never picked passes policy but 403/404s at Google, which is
 * exactly the trap the 2026-08 connector-launch cohort fell into (approve →
 * retry → generic error → churn). This module is the single source of truth
 * for "does Google actually let us reach this spreadsheet right now?".
 */
export type SheetsGrantState =
  | { state: 'ok'; title: string | null }
  // 403/404 from Google: no drive.file grant for this file (or the id is
  // wrong — indistinguishable from outside, and the Picker fixes both).
  | { state: 'missing' }
  // Network error / 5xx / 429: verification could not run. Callers must
  // degrade to "no warning", never alarm the user on Google's bad day.
  | { state: 'unknown'; status?: number };

export async function verifySheetsGrant(
  token: string,
  spreadsheetId: string,
): Promise<SheetsGrantState> {
  let res: Response;
  try {
    res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    return { state: 'unknown' };
  }

  if (res.ok) {
    const data = await res.json().catch(() => null) as { properties?: { title?: string } } | null;
    return { state: 'ok', title: data?.properties?.title ?? null };
  }
  if (res.status === 403 || res.status === 404) return { state: 'missing' };
  return { state: 'unknown', status: res.status };
}

/**
 * The signed-in owner's Google access token (same token the MCP path uses for
 * the owner's own mailbox). Null when Google is not connected — for grant
 * verification purposes that reads as `missing`, since the Picker flow is
 * also the fix for a not-yet-connected account (it triggers consent first).
 */
export async function getOwnerGoogleToken(clerkUserId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    // Un-prefixed provider id — the `oauth_` form is deprecated (see
    // googleAccess.ts).
    const tokens = await client.users.getUserOauthAccessToken(clerkUserId, 'google');
    return tokens.data?.[0]?.token || null;
  } catch {
    return null;
  }
}
