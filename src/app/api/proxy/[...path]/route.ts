import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, proxyKeys, emailDelegations, keyEmailAccess, accessRules, keyRuleAssignments } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { clerkClient } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

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

    // Fetch the owning user (the delegate / key creator)
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

    // Resolve 'me' to the key owner's primary email, or use the specific email from the path
    let targetEmail: string;
    if (gmailUserId === 'me') {
      targetEmail = dbUser.email;
    } else {
      targetEmail = gmailUserId;
    }

    // ─── 3. Check Key ↔ Email Access ────────────────────────────────────────
    const emailAccess = await db
      .select()
      .from(keyEmailAccess)
      .where(
        and(
          eq(keyEmailAccess.proxyKeyId, dbKey.id),
          eq(keyEmailAccess.targetEmail, targetEmail.toLowerCase()),
        )
      )
      .limit(1)
      .then(res => res[0]);

    // Also try case-insensitive match
    const emailAccessFallback = emailAccess || await db
      .select()
      .from(keyEmailAccess)
      .where(eq(keyEmailAccess.proxyKeyId, dbKey.id))
      .then(rows => rows.find(r => r.targetEmail.toLowerCase() === targetEmail.toLowerCase()));

    if (!emailAccessFallback) {
      return NextResponse.json({
        error: `This API key does not have access to '${targetEmail}'.`
      }, { status: 403 });
    }

    // ─── 4. Load Applicable Rules ───────────────────────────────────────────
    const allUserRules = await db
      .select()
      .from(accessRules)
      .where(eq(accessRules.userId, dbUser.id));

    const keyAssignments = await db
      .select()
      .from(keyRuleAssignments)
      .where(eq(keyRuleAssignments.proxyKeyId, dbKey.id));

    const assignedRuleIds = new Set(keyAssignments.map(a => a.accessRuleId));

    const allAssignments = await db.select().from(keyRuleAssignments);
    const rulesWithAssignments = new Set(allAssignments.map(a => a.accessRuleId));

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

    // ─── 7. Resolve the token owner's Clerk user ID ─────────────────────────
    // If the target email is the key owner's own email, use their Clerk ID.
    // If it's a delegated email, look up the email owner's Clerk ID.
    let tokenOwnerClerkUserId: string;

    if (targetEmail.toLowerCase() === dbUser.email.toLowerCase()) {
      // Own email — use the key owner's token
      tokenOwnerClerkUserId = dbUser.clerkUserId;
    } else {
      // Delegated email — find the email owner
      const emailOwner = await db.select().from(users)
        .where(eq(users.email, targetEmail))
        .limit(1)
        .then(res => res[0]);

      if (!emailOwner) {
        return NextResponse.json({
          error: `Email '${targetEmail}' owner not found in system.`
        }, { status: 403 });
      }

      // Verify there's an active delegation
      const delegation = await db.select().from(emailDelegations)
        .where(and(
          eq(emailDelegations.ownerUserId, emailOwner.id),
          eq(emailDelegations.delegateUserId, dbUser.id),
          eq(emailDelegations.status, 'active'),
        ))
        .limit(1)
        .then(res => res[0]);

      if (!delegation) {
        return NextResponse.json({
          error: `Access to '${targetEmail}' has been revoked or is not delegated to you.`
        }, { status: 403 });
      }

      tokenOwnerClerkUserId = emailOwner.clerkUserId;
    }

    // ─── 8. Fetch Real Google Token from Clerk ──────────────────────────────
    const client = await clerkClient();
    const tokenResponse = await client.users.getUserOauthAccessToken(tokenOwnerClerkUserId, 'oauth_google');
    const realGoogleToken = tokenResponse.data?.[0]?.token;

    if (!realGoogleToken) {
      return NextResponse.json({
        error: `Could not fetch Google access token for '${targetEmail}'. The account owner may need to reconnect their Google account.`
      }, { status: 403 });
    }

    // ─── 8. Forward to Google ───────────────────────────────────────────────
    // For list queries, inject label filtering if rules exist
    let finalQueryString = request.nextUrl.search;
    if (request.method === 'GET' && fullPath.includes('messages') && !fullPath.match(/messages\/[^/]+$/)) {
      const urlParams = new URLSearchParams(request.nextUrl.searchParams);
      let existingQ = urlParams.get('q') || '';
      
      const labelBlacklists = applicableRules.filter(r => r.service === 'gmail' && r.actionType === 'label_blacklist');
      const labelWhitelists = applicableRules.filter(r => r.service === 'gmail' && r.actionType === 'label_whitelist');
      
      for (const rule of labelBlacklists) {
        existingQ += ` -label:${rule.regexPattern}`;
      }
      
      if (labelWhitelists.length > 0) {
        const whitelistQuery = labelWhitelists.map(r => `label:${r.regexPattern}`).join(' OR ');
        existingQ += ` {${whitelistQuery}}`;
      }
      
      if (existingQ.trim() !== '') {
        urlParams.set('q', existingQ.trim());
      }
      finalQueryString = urlParams.toString() ? `?${urlParams.toString()}` : '';
    }

    const googleUrl = `https://www.googleapis.com/${fullPath}${finalQueryString}`;
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
      const labelBlacklistRules = applicableRules.filter(r => r.service === 'gmail' && r.actionType === 'label_blacklist');
      const labelWhitelistRules = applicableRules.filter(r => r.service === 'gmail' && r.actionType === 'label_whitelist');

      let parsedBody: any = null;
      try { parsedBody = JSON.parse(returnBody); } catch (e) { }

      if (parsedBody && parsedBody.labelIds && Array.isArray(parsedBody.labelIds)) {
        // 1. Check Label Blacklists First (Precedence)
        for (const rule of labelBlacklistRules) {
          if (parsedBody.labelIds.includes(rule.regexPattern)) {
             return NextResponse.json({
               error: `Access restricted: Email contains blacklisted label '${rule.regexPattern}'.`
             }, { status: 403 });
          }
        }

        // 2. Check Label Whitelists
        if (labelWhitelistRules.length > 0) {
           let hasWhitelistedLabel = false;
           for (const rule of labelWhitelistRules) {
             if (parsedBody.labelIds.includes(rule.regexPattern)) {
               hasWhitelistedLabel = true;
               break;
             }
           }
           if (!hasWhitelistedLabel) {
             return NextResponse.json({
               error: `Access restricted: Email lacks a required whitelisted label.`
             }, { status: 403 });
           }
        }
      }

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
