/**
 * Agent Connections API — Spike
 *
 * GET  /api/connections          — List all connections for the current user
 * POST /api/connections          — Approve/block/update a connection
 *
 * TODO: Move to proper route structure after spike.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { agentConnections, users, proxyKeys } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Get all connections with their bound proxy key details
  const connections = await db.query.agentConnections.findMany({
    where: eq(agentConnections.userId, user.id),
  });

  // Also get user's proxy keys for the approval dropdown
  const keys = await db.query.proxyKeys.findMany({
    where: eq(proxyKeys.userId, user.id),
  });

  return NextResponse.json({
    connections: connections.map(c => ({
      id: c.id,
      clientId: c.clientId,
      clientName: c.clientName,
      nickname: c.nickname,
      status: c.status,
      proxyKeyId: c.proxyKeyId,
      createdAt: c.createdAt,
      approvedAt: c.approvedAt,
      lastUsedAt: c.lastUsedAt,
    })),
    availableKeys: keys.map(k => ({
      id: k.id,
      label: k.label,
      revokedAt: k.revokedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.clerkUserId, clerkUserId),
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await req.json();
  const { connectionId, action, proxyKeyId, nickname } = body;

  if (!connectionId || !action) {
    return NextResponse.json(
      { error: 'connectionId and action are required' },
      { status: 400 }
    );
  }

  // Verify the connection belongs to this user
  const connection = await db.query.agentConnections.findFirst({
    where: and(
      eq(agentConnections.id, connectionId),
      eq(agentConnections.userId, user.id),
    ),
  });

  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  switch (action) {
    case 'approve': {
      if (!proxyKeyId) {
        return NextResponse.json(
          { error: 'proxyKeyId is required for approval' },
          { status: 400 }
        );
      }

      // Verify the proxy key belongs to this user
      const key = await db.query.proxyKeys.findFirst({
        where: and(
          eq(proxyKeys.id, proxyKeyId),
          eq(proxyKeys.userId, user.id),
        ),
      });
      if (!key) {
        return NextResponse.json(
          { error: 'Proxy key not found' },
          { status: 404 }
        );
      }

      await db.update(agentConnections)
        .set({
          status: 'approved',
          proxyKeyId,
          nickname: nickname || connection.nickname,
          approvedAt: new Date(),
        })
        .where(eq(agentConnections.id, connectionId));

      console.log(`\n=== CONNECTION APPROVED ===`);
      console.log(`Connection: ${connectionId}`);
      console.log(`Client ID: ${connection.clientId}`);
      console.log(`Bound to key: ${key.label} (${proxyKeyId})`);
      console.log(`Nickname: ${nickname || connection.nickname || 'none'}`);
      console.log(`==========================\n`);

      return NextResponse.json({ status: 'approved', proxyKeyId });
    }

    case 'block': {
      await db.update(agentConnections)
        .set({ status: 'blocked', proxyKeyId: null })
        .where(eq(agentConnections.id, connectionId));

      return NextResponse.json({ status: 'blocked' });
    }

    case 'update_nickname': {
      if (!nickname) {
        return NextResponse.json(
          { error: 'nickname is required' },
          { status: 400 }
        );
      }

      await db.update(agentConnections)
        .set({ nickname })
        .where(eq(agentConnections.id, connectionId));

      return NextResponse.json({ status: 'updated', nickname });
    }

    default:
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      );
  }
}
