/**
 * Idempotent GCP infrastructure for Gmail push notifications. The SAME script
 * provisions dev and prod — that is what keeps them in sync (plan v6, "Dev→Prod
 * Infrastructure Sync").
 *
 * Creates/verifies, in the given project:
 *   1. Pub/Sub topic  (default: fgac-gmail-watch)
 *   2. gmail-api-push@system.gserviceaccount.com → roles/pubsub.publisher
 *   3. (--push-endpoint) OIDC push subscription → https://<host>/api/webhooks/gmail
 *      with a dedicated invoker service account
 *   4. (dev only) writes GMAIL_PUBSUB_TOPIC (+ QA_BRIDGE_SECRET if absent) into
 *      .env.local — mirroring how db:branch manages neon__POSTGRES_URL
 *
 * Constraint (spike-verified): the topic MUST live in the GCP project of the
 * Google OAuth client behind the environment's Clerk instance.
 *   dev  → dev-fgac-ai
 *   prod → fine-grain-access-control (verified 2026-08-06, plan v5)
 *
 * Usage:
 *   npx tsx scripts/setup-gmail-push.ts --project dev-fgac-ai
 *   npx tsx scripts/setup-gmail-push.ts --project fine-grain-access-control \
 *     --push-endpoint https://fgac.ai/api/webhooks/gmail --prod --apply
 *
 * Without --apply it only PRINTS the plan. Prod additionally requires --prod.
 */
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const PROD_PROJECT = 'fine-grain-access-control';
const project = opt('project');
const topicName = opt('topic') ?? 'fgac-gmail-watch';
const pushEndpoint = opt('push-endpoint');
const apply = flag('apply');

if (!project) {
  console.error('Required: --project <gcp-project-id> [--topic name] [--push-endpoint url] [--prod] [--apply]');
  process.exit(1);
}
if (project === PROD_PROJECT && !flag('prod')) {
  console.error(`Project ${PROD_PROJECT} is PRODUCTION — pass --prod (and --apply) explicitly.`);
  process.exit(1);
}
if (flag('prod') && !apply) {
  console.error('--prod requires --apply. Without --apply this is a dry run anyway; add both to touch prod.');
  process.exit(1);
}

function gcloud(gcArgs: string[], allowFail = false): { ok: boolean; out: string } {
  try {
    const out = execFileSync('gcloud', [...gcArgs, '--project', project!], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string };
    if (!allowFail) {
      console.error(e.stderr ?? String(err));
      process.exit(1);
    }
    return { ok: false, out: (e.stderr ?? '') + (e.stdout ?? '') };
  }
}

const GMAIL_SA = 'gmail-api-push@system.gserviceaccount.com';
const topicPath = `projects/${project}/topics/${topicName}`;
const invokerSa = `fgac-push-invoker@${project}.iam.gserviceaccount.com`;

const plan: string[] = [];
const actions: Array<() => void> = [];

// 1. Topic
const topicExists = gcloud(['pubsub', 'topics', 'describe', topicName], true).ok;
if (topicExists) {
  plan.push(`✔ topic ${topicPath} exists`);
} else {
  plan.push(`+ create topic ${topicPath}`);
  actions.push(() => gcloud(['pubsub', 'topics', 'create', topicName]));
}

// 2. Publisher binding
const iam = gcloud(['pubsub', 'topics', 'get-iam-policy', topicName, '--format=json'], true);
const hasBinding = iam.ok && iam.out.includes(GMAIL_SA) && iam.out.includes('roles/pubsub.publisher');
if (hasBinding) {
  plan.push(`✔ ${GMAIL_SA} has roles/pubsub.publisher`);
} else {
  plan.push(`+ grant roles/pubsub.publisher to ${GMAIL_SA}`);
  actions.push(() => gcloud([
    'pubsub', 'topics', 'add-iam-policy-binding', topicName,
    `--member=serviceAccount:${GMAIL_SA}`, '--role=roles/pubsub.publisher',
  ]));
}

// 3. Push subscription (only when an endpoint is given — dev QA uses pull)
if (pushEndpoint) {
  const subName = `${topicName}-push`;
  const saExists = gcloud(['iam', 'service-accounts', 'describe', invokerSa], true).ok;
  if (!saExists) {
    plan.push(`+ create invoker service account ${invokerSa}`);
    actions.push(() => gcloud([
      'iam', 'service-accounts', 'create', 'fgac-push-invoker',
      '--display-name=FGAC PubSub push OIDC identity',
    ]));
  } else {
    plan.push(`✔ invoker service account ${invokerSa} exists`);
  }
  const subExists = gcloud(['pubsub', 'subscriptions', 'describe', subName], true).ok;
  if (!subExists) {
    plan.push(`+ create push subscription ${subName} → ${pushEndpoint} (OIDC as ${invokerSa})`);
    actions.push(() => gcloud([
      'pubsub', 'subscriptions', 'create', subName,
      `--topic=${topicName}`,
      `--push-endpoint=${pushEndpoint}`,
      `--push-auth-service-account=${invokerSa}`,
      `--push-auth-token-audience=${pushEndpoint}`,
      '--ack-deadline=60',
    ]));
  } else {
    plan.push(`✔ push subscription ${subName} exists`);
  }
  plan.push(`  → set on Vercel for this environment (no quotes):`);
  plan.push(`      GMAIL_PUBSUB_TOPIC=${topicPath}`);
  plan.push(`      PUBSUB_PUSH_AUDIENCE=${pushEndpoint}`);
  plan.push(`      PUBSUB_PUSH_SA_EMAIL=${invokerSa}`);
}

// 4. Dev pull subscription for the QA bridge + local env wiring
if (!flag('prod')) {
  const pullSub = `${topicName}-dev-pull`;
  const pullExists = gcloud(['pubsub', 'subscriptions', 'describe', pullSub], true).ok;
  if (pullExists) {
    plan.push(`✔ dev pull subscription ${pullSub} exists`);
  } else {
    plan.push(`+ create dev pull subscription ${pullSub} (QA bridge drains this)`);
    actions.push(() => gcloud(['pubsub', 'subscriptions', 'create', pullSub, `--topic=${topicName}`]));
  }

  if (fs.existsSync('.env.local')) {
    plan.push(`+ ensure GMAIL_PUBSUB_TOPIC/QA_BRIDGE_SECRET in .env.local (script-managed, like db:branch)`);
    actions.push(() => {
      let env = fs.readFileSync('.env.local', 'utf8');
      const setVar = (key: string, value: string) => {
        if (new RegExp(`^${key}=`, 'm').test(env)) {
          env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
        } else {
          env += `${env.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
        }
      };
      setVar('GMAIL_PUBSUB_TOPIC', topicPath);
      if (!/^QA_BRIDGE_SECRET=/m.test(env)) {
        setVar('QA_BRIDGE_SECRET', crypto.randomBytes(24).toString('hex'));
      }
      fs.writeFileSync('.env.local', env);
    });
  }
}

console.log(`\nGmail push setup plan for project '${project}':\n`);
for (const line of plan) console.log(`  ${line}`);

if (!apply) {
  console.log('\nDry run (no --apply). Nothing changed.');
  process.exit(0);
}

for (const action of actions) action();
console.log(`\n✅ Applied. Topic: ${topicPath}`);
