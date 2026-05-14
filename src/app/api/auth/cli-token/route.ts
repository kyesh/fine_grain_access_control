/**
 * CLI Token Endpoint — /api/auth/cli-token
 *
 * Used by local scripts (OpenClaw skill, Claude Code CLI) to:
 * 1. Exchange a Clerk OAuth token for connection status
 * 2. Retrieve the assigned proxy key after dashboard approval
 *
 * Flow:
 *   Script does Clerk OAuth (DCR + PKCE) → gets access_token
 *   Script POSTs here with Bearer token
 *   → If new: creates pending connection, returns dashboard URL
 *   → If pending: returns dashboard URL
 *   → If approved: returns proxy key + accessible emails
 *   → If blocked: returns blocked status
 */
import { verifyClerkToken } from '@clerk/mcp-tools/next';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import {
  agentConnections, users, proxyKeys, keyEmailAccess,
} from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  // --- Auth: verify Clerk OAuth token ---
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { status: 'error', message: 'Missing Authorization header' },
      { status: 401 }
    );
  }

  const bearerToken = authHeader.slice(7);
  let userId: string | undefined;
  let clientId: string | undefined;

  try {
    const clerkAuth = await auth({ acceptsToken: 'oauth_token' });
    const authInfo = verifyClerkToken(clerkAuth, bearerToken);
    userId = authInfo?.extra?.userId as string | undefined;
    clientId = (authInfo as Record<string, unknown>)?.clientId as string | undefined;
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Invalid or expired token. Re-run auth.' },
      { status: 401 }
    );
  }

  if (!userId) {
    return NextResponse.json(
      { status: 'error', message: 'Token missing userId claim' },
      { status: 401 }
    );
  }

  if (!clientId) {
    return NextResponse.json(
      { status: 'error', message: 'Token missing clientId claim. Use DCR OAuth.' },
      { status: 400 }
    );
  }

  // --- Resolve user ---
  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, userId),
  });

  if (!user) {
    return NextResponse.json(
      { status: 'error', message: 'User not found. Sign up at the dashboard first.' },
      { status: 404 }
    );
  }

  // --- Find or create agent connection ---
  let connection = await db.query.agentConnections.findFirst({
    where: and(
      eq(agentConnections.userId, user.id),
      eq(agentConnections.clientId, clientId),
    ),
  });

  // Parse client_name from request body if provided
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientName = (body.client_name as string) || clientId;

  if (!connection) {
    const [newConn] = await db.insert(agentConnections).values({
      userId: user.id,
      clientId,
      clientName,
      status: 'pending',
    }).returning();
    connection = newConn;

    console.log(`[CLI-Token] New connection: user=${user.email} client=${clientId} conn=${connection.id} status=PENDING`);
  }

  // Update last used
  await db.update(agentConnections)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentConnections.id, connection.id));

  // --- Return based on status ---
  if (connection.status === 'pending') {
    const dashboardUrl = `${DASHBOARD_URL}/dashboard?tab=connections&highlight=${connection.id}`;
    return NextResponse.json({
      status: 'pending',
      message: '⚠️ This connection has not been approved yet.',
      dashboard_url: dashboardUrl,
      instructions: [
        'Ask the user to visit their FGAC dashboard to approve this connection.',
        'Once approved, re-run this auth command to retrieve your proxy key.',
      ],
    });
  }

  if (connection.status === 'blocked') {
    return NextResponse.json({
      status: 'blocked',
      message: '🚫 This connection has been blocked by the user.',
    }, { status: 403 });
  }

  // --- Approved: return proxy key + emails ---
  if (!connection.proxyKeyId) {
    return NextResponse.json({
      status: 'approved_no_key',
      message: 'Connection approved but no proxy key assigned. Ask user to assign one in the dashboard.',
      dashboard_url: `${DASHBOARD_URL}/dashboard?tab=connections`,
    });
  }

  const proxyKey = await db.query.proxyKeys.findFirst({
    where: eq(proxyKeys.id, connection.proxyKeyId),
  });

  if (!proxyKey) {
    return NextResponse.json({
      status: 'error',
      message: 'Assigned proxy key not found.',
    }, { status: 500 });
  }

  // Get accessible emails
  const emailAccess = await db.query.keyEmailAccess.findMany({
    where: eq(keyEmailAccess.proxyKeyId, proxyKey.id),
  });

  return NextResponse.json({
    status: 'approved',
    proxy_key: proxyKey.key,
    key_label: proxyKey.label,
    nickname: connection.nickname,
    emails: emailAccess.map((e) => e.targetEmail),
    proxy_endpoint: DASHBOARD_URL.replace('://fgac.ai', '://gmail.fgac.ai').replace('://localhost:3000', '://localhost:3000'),
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/auth/cli-token',
    description: 'Exchange a Clerk OAuth token for FGAC proxy key credentials.',
    usage: 'POST with Authorization: Bearer <clerk_oauth_token>',
  });
}
