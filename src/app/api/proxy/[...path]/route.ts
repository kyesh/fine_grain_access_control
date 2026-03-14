import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, proxyKeys, connectedEmails, keyEmailAccess, accessRules, keyRuleAssignments } from '@/db/schema';
import { eq, and, isNull, or } from 'drizzle-orm';
import { clerkClient } from '@clerk/nextjs/server';

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxyRequest(request, await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxyRequest(request, await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handleProxyRequest(request, await params);
}

/**
 * Extract the Gmail userId from the API path.
 * Gmail API paths look like: gmail/v1/users/{userId}/messages/...
 * Returns the userId segment, or 'me' if not found.
 */
function extractGmailUserId(fullPath: string): string {
  const match = fullPath.match(/gmail\/v1\/users\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : 'me';
}

async function handleProxyRequest(request: NextRequest, params: { path: string[] }) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const keyValue = authHeader.split(' ')[1];
    const fullPath = params.path.join('/');

    // ─── 1. Authenticate Proxy Key ──────────────────────────────────────────
    const dbKey = await db
      .select()
      .from(proxyKeys)
      .where(eq(proxyKeys.key, keyValue))
      .limit(1)
      .then(res => res[0]);

    if (!dbKey) {
      return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
    }

    // Check revocation
    if (dbKey.revokedAt) {
      return NextResponse.json({ error: 'This API key has been revoked.' }, { status: 401 });
    }

    // Check expiration
    if (dbKey.expiresAt && dbKey.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This API key has expired.' }, { status: 401 });
    }

    // Fetch the owning user
    const dbUser = await db
      .select()
      .from(users)
      .where(eq(users.id, dbKey.userId))
      .limit(1)
      .then(res => res[0]);

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 401 });
    }

    // ─── 2. Resolve Target Email ────────────────────────────────────────────
    const gmailUserId = extractGmailUserId(fullPath);

    // Get all connected emails the user has
    const userConnectedEmails = await db
      .select()
      .from(connectedEmails)
      .where(eq(connectedEmails.userId, dbUser.id));

    // Resolve 'me' to the user's primary email, or use the specific email from the path
    let targetEmail: string;
    if (gmailUserId === 'me') {
      targetEmail = dbUser.email;
    } else {
      targetEmail = gmailUserId;
    }

    // Find the connected email record
    const connectedEmail = userConnectedEmails.find(
      ce => ce.googleEmail.toLowerCase() === targetEmail.toLowerCase()
    );

    if (!connectedEmail) {
      return NextResponse.json({
        error: `Email '${targetEmail}' is not connected to your account.`
      }, { status: 403 });
    }

    // ─── 3. Check Key ↔ Email Access ────────────────────────────────────────
    const emailAccess = await db
      .select()
      .from(keyEmailAccess)
      .where(
        and(
          eq(keyEmailAccess.proxyKeyId, dbKey.id),
          eq(keyEmailAccess.connectedEmailId, connectedEmail.id)
        )
      )
      .limit(1)
      .then(res => res[0]);

    if (!emailAccess) {
      return NextResponse.json({
        error: `This API key does not have access to '${targetEmail}'.`
      }, { status: 403 });
    }

    // ─── 4. Load Applicable Rules ───────────────────────────────────────────
    // Fetch all rules for this user
    const allUserRules = await db
      .select()
      .from(accessRules)
      .where(eq(accessRules.userId, dbUser.id));

    // Fetch key-specific rule assignments for this key
    const keyAssignments = await db
      .select()
      .from(keyRuleAssignments)
      .where(eq(keyRuleAssignments.proxyKeyId, dbKey.id));

    const assignedRuleIds = new Set(keyAssignments.map(a => a.accessRuleId));

    // Also check which rules have ANY assignments at all (to distinguish global vs key-specific)
    const allAssignments = await db.select().from(keyRuleAssignments);
    const rulesWithAssignments = new Set(allAssignments.map(a => a.accessRuleId));

    // A rule applies if:
    // 1. It has NO assignments anywhere (global rule), OR
    // 2. It is specifically assigned to THIS key
    // AND: targetEmail matches rule.targetEmail (or rule.targetEmail is NULL = all emails)
    const applicableRules = allUserRules.filter(rule => {
      const isGlobal = !rulesWithAssignments.has(rule.id);
      const isAssignedToThisKey = assignedRuleIds.has(rule.id);
      const emailMatches = !rule.targetEmail ||
        rule.targetEmail.toLowerCase() === targetEmail.toLowerCase();
      return (isGlobal || isAssignedToThisKey) && emailMatches;
    });

    // ─── 5. Evaluate Send / Outbound Rules ──────────────────────────────────
    if (request.method === 'POST' && fullPath.includes('messages/send')) {
      const body = await request.clone().json().catch(() => ({}));

      let toAddress = null;
      if (body.raw) {
        try {
          const decoded = Buffer.from(body.raw, 'base64url').toString('utf8');
          const toMatch = decoded.match(/^To:\s*(.+)$/im);
          if (toMatch) {
            toAddress = toMatch[1].trim();
          }
        } catch {
          // Ignore decode errors
        }
      }

      if (toAddress) {
        const sendRules = applicableRules.filter(r => r.service === 'gmail' && r.actionType === 'send_whitelist');

        if (sendRules.length > 0) {
          let isWhitelisted = false;
          for (const rule of sendRules) {
            const regexStr = rule.regexPattern.replace(/\*/g, '.*');
            const regex = new RegExp(regexStr, 'i');
            if (regex.test(toAddress)) {
              isWhitelisted = true;
              break;
            }
          }
          if (!isWhitelisted) {
            return NextResponse.json({
              error: `Unauthorized email address. Please ask your user to add '${toAddress}' to the sending whitelist.`
            }, { status: 403 });
          }
        } else {
          return NextResponse.json({
            error: `Unauthorized email address. Please ask your user to add '${toAddress}' to the sending whitelist. Default access is DENIED.`
          }, { status: 403 });
        }
      }
    }

    // ─── 6. Evaluate Deletion Rules ─────────────────────────────────────────
    if (request.method === 'DELETE') {
      if (fullPath.includes('messages/trash') || fullPath.includes('emptyTrash')) {
        return NextResponse.json({
          error: "Action Denied: Global safeguard prevents permanent deletion of all emails."
        }, { status: 403 });
      }
    }

    // ─── 7. Fetch Real Google Token from Clerk ──────────────────────────────
    const client = await clerkClient();

    const tokenResponse = await client.users.getUserOauthAccessToken(dbUser.clerkUserId, 'oauth_google');

    // Find the token matching this specific connected email
    const matchingToken = tokenResponse.data.find(
      t => t.externalAccountId === connectedEmail.clerkExternalAccountId
    );

    const realGoogleToken = matchingToken?.token;

    if (!realGoogleToken) {
      return NextResponse.json({
        error: `Could not fetch Google access token for '${targetEmail}'. The user may need to reconnect this account.`
      }, { status: 403 });
    }

    // ─── 8. Forward to Google ───────────────────────────────────────────────
    const googleUrl = `https://www.googleapis.com/${fullPath}${request.nextUrl.search}`;
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${realGoogleToken}`);
    headers.delete('host');

    let requestBody: ArrayBuffer | undefined = undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      requestBody = await request.clone().arrayBuffer();
    }

    const googleResponse = await fetch(googleUrl, {
      method: request.method,
      headers,
      body: requestBody,
    });

    const returnBody = await googleResponse.text();
    const isJson = googleResponse.headers.get('content-type')?.includes('application/json');

    // ─── 9. Evaluate Read / Inbound Rules ───────────────────────────────────
    if (request.method === 'GET' && fullPath.includes('messages') && isJson) {
      const readBlacklistRules = applicableRules.filter(r => r.service === 'gmail' && r.actionType === 'read_blacklist');

      if (readBlacklistRules.length > 0) {
        for (const rule of readBlacklistRules) {
          const regexStr = rule.regexPattern.replace(/\*/g, '.*');
          const regex = new RegExp(regexStr, 'i');
          if (regex.test(returnBody)) {
            return NextResponse.json({
              error: `Access restricted: Email content blocked by rule '${rule.ruleName}'.`
            }, { status: 403 });
          }
        }
      }
    }

    const responseHeaders = new Headers(googleResponse.headers);
    responseHeaders.delete('content-encoding');

    return new NextResponse(returnBody, {
      status: googleResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Proxy Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
