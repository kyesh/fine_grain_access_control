/**
 * QA Pub/Sub bridge — Pub/Sub cannot push to localhost, so this drains the dev
 * PULL subscription and re-POSTs each notification to the local receiver
 * exactly as Google's push would (same envelope), authenticated with the
 * QA_BRIDGE_SECRET header the receiver accepts outside production.
 *
 * Usage:
 *   npx tsx scripts/qa-pubsub-bridge.ts [--once] [--endpoint http://localhost:3000/api/webhooks/gmail]
 *
 * Requires: gcloud authed to the dev project; QA_BRIDGE_SECRET +
 * GMAIL_PUBSUB_TOPIC in .env.local (written by scripts/setup-gmail-push.ts).
 */
import { config } from 'dotenv';
import { execFileSync } from 'child_process';

config({ path: '.env.local' });

const args = process.argv.slice(2);
const once = args.includes('--once');
const epIdx = args.indexOf('--endpoint');
const ENDPOINT = epIdx >= 0 ? args[epIdx + 1] : 'http://localhost:3000/api/webhooks/gmail';

const topic = process.env.GMAIL_PUBSUB_TOPIC;
const secret = process.env.QA_BRIDGE_SECRET;
if (!topic || !secret) {
  console.error('GMAIL_PUBSUB_TOPIC / QA_BRIDGE_SECRET missing from .env.local — run scripts/setup-gmail-push.ts first.');
  process.exit(1);
}
const BRIDGE_SECRET: string = secret!;
// "projects/<project>/topics/<name>"
const [, project, , topicShort] = topic!.split('/');
const pullSub = `${topicShort}-dev-pull`;

async function drainOnce(): Promise<number> {
  const out = execFileSync('gcloud', [
    'pubsub', 'subscriptions', 'pull', pullSub,
    '--project', project, '--limit', '10', '--auto-ack', '--format=json',
  ], { encoding: 'utf8' });
  const messages = JSON.parse(out || '[]') as Array<{
    message: { data: string; messageId: string; publishTime: string };
  }>;

  for (const m of messages) {
    const envelope = {
      message: {
        data: m.message.data,
        messageId: m.message.messageId,
        publishTime: m.message.publishTime,
      },
      subscription: `projects/${project}/subscriptions/${pullSub}`,
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-qa-bridge-secret': BRIDGE_SECRET },
      body: JSON.stringify(envelope),
    });
    const bodyText = await res.text();
    console.log(`[Bridge] ${m.message.messageId} → ${ENDPOINT} → ${res.status} ${bodyText.slice(0, 200)}`);
  }
  return messages.length;
}

async function main() {
  console.log(`[Bridge] Draining ${pullSub} (project ${project}) → ${ENDPOINT}${once ? ' (single pass)' : ' every 5s'}`);
  do {
    try {
      await drainOnce();
    } catch (err) {
      console.error('[Bridge] drain failed:', err instanceof Error ? err.message : err);
    }
    if (!once) await new Promise(r => setTimeout(r, 5000));
  } while (!once);
}

main();
