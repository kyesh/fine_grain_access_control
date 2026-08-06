/**
 * Gmail plumbing for the push-notification subsystem: Clerk-vaulted token
 * lookup, watch arm/stop, history diff, and metadata fetch.
 *
 * Spike-validated constraints (docs/implementation_plans/third-party-handoff-
 * permissions_v4.md):
 *  - The Pub/Sub topic MUST live in the GCP project of the Google OAuth client
 *    behind Clerk's vaulted tokens (GMAIL_PUBSUB_TOPIC env var, per environment).
 *  - Watches expire after ~7 days; Gmail publishes a test notification at watch
 *    time, so zero-diff notifications are normal.
 */
import { clerkClient } from '@clerk/nextjs/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

export function pubsubTopic(): string {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic || !topic.startsWith('projects/')) {
    throw new Error('GMAIL_PUBSUB_TOPIC is not configured (projects/<id>/topics/<name>)');
  }
  return topic;
}

/** Google access token for the OWNER of a mailbox, via Clerk's token vault. */
export async function googleTokenForEmail(targetEmail: string): Promise<string> {
  const owner = await db.query.users.findFirst({
    where: eq(users.email, targetEmail),
  });
  if (!owner || owner.deletedAt) {
    throw new Error(`No live FGAC user owns mailbox ${targetEmail}`);
  }
  const client = await clerkClient();
  const tokens = await client.users.getUserOauthAccessToken(owner.clerkUserId, 'google');
  const token = tokens.data[0]?.token;
  if (!token) throw new Error(`No Google token vaulted for ${targetEmail}`);
  return token;
}

async function gmailFetch(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${GMAIL_API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text.trim() ? JSON.parse(text) : {};
}

/** Arm (or re-arm) the INBOX watch. Returns Gmail's current historyId + expiry. */
export async function armWatch(targetEmail: string): Promise<{ historyId: string; expiration: Date }> {
  const token = await googleTokenForEmail(targetEmail);
  const resp = await gmailFetch(token, 'users/me/watch', {
    method: 'POST',
    body: JSON.stringify({ topicName: pubsubTopic(), labelIds: ['INBOX'] }),
  }) as { historyId: string; expiration: string };
  return { historyId: resp.historyId, expiration: new Date(Number(resp.expiration)) };
}

export async function stopWatch(targetEmail: string): Promise<void> {
  const token = await googleTokenForEmail(targetEmail);
  await gmailFetch(token, 'users/me/stop', { method: 'POST', body: '{}' });
}

/** Message ids added since the given cursor, plus the new cursor to store. */
export async function diffHistory(
  targetEmail: string, startHistoryId: string,
): Promise<{ messageIds: string[]; newHistoryId: string | null }> {
  const token = await googleTokenForEmail(targetEmail);
  const messageIds: string[] = [];
  let newHistoryId: string | null = null;
  let pageToken: string | undefined;

  do {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
      ...(pageToken ? { pageToken } : {}),
    });
    const resp = await gmailFetch(token, `users/me/history?${qs}`) as {
      history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
      historyId?: string;
      nextPageToken?: string;
    };
    for (const h of resp.history ?? []) {
      for (const m of h.messagesAdded ?? []) messageIds.push(m.message.id);
    }
    if (resp.historyId) newHistoryId = resp.historyId;
    pageToken = resp.nextPageToken;
  } while (pageToken);

  return { messageIds: [...new Set(messageIds)], newHistoryId };
}

/** Metadata-only fetch used for rule filtering (labels + headers, no body). */
export async function fetchMessageMetadata(targetEmail: string, messageId: string): Promise<unknown> {
  const token = await googleTokenForEmail(targetEmail);
  return gmailFetch(
    token,
    `users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
  );
}
