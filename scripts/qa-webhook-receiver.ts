/**
 * QA webhook receiver — stands in for a partner's notification endpoint during
 * capability 12 runs. Records every ping (headers, body, HMAC validity) to
 * qa-webhook-log.json (gitignored) for the runner to assert against.
 *
 * Usage:
 *   FGAC_WEBHOOK_SECRET=<partner webhook_secret> npx tsx scripts/qa-webhook-receiver.ts [--port 4571]
 *
 * Failure injection (assertion A7 — retry/backoff/suspend): create a file
 * named `qa-webhook-fail` in the repo root and the receiver returns 500 until
 * it is removed. No restart needed.
 */
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 4571;
const LOG_FILE = 'qa-webhook-log.json';
const FAIL_FLAG = 'qa-webhook-fail';
const SECRET = process.env.FGAC_WEBHOOK_SECRET ?? '';

interface LogEntry {
  receivedAt: string;
  status: number;
  deliveryId: string | null;
  timestamp: string | null;
  signatureValid: boolean | null;
  body: unknown;
}

function appendLog(entry: LogEntry) {
  const log: LogEntry[] = fs.existsSync(LOG_FILE)
    ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'))
    : [];
  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const failing = fs.existsSync(FAIL_FLAG);
    const status = failing ? 500 : 200;

    const sig = req.headers['x-fgac-signature'] as string | undefined;
    const ts = req.headers['x-fgac-timestamp'] as string | undefined;
    let signatureValid: boolean | null = null;
    if (SECRET && sig && ts) {
      const expected = `sha256=${crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')}`;
      try {
        signatureValid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
      } catch { signatureValid = false; }
    }

    let body: unknown = raw;
    try { body = JSON.parse(raw); } catch { /* keep raw */ }

    appendLog({
      receivedAt: new Date().toISOString(),
      status,
      deliveryId: (req.headers['x-fgac-delivery-id'] as string) ?? null,
      timestamp: ts ?? null,
      signatureValid,
      body,
    });

    console.log(`[Receiver] ${new Date().toISOString()} → ${status}${failing ? ' (FAIL_FLAG active)' : ''} sig=${signatureValid} delivery=${req.headers['x-fgac-delivery-id'] ?? '-'}`);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: !failing }));
  });
}).listen(PORT, () => {
  console.log(`[Receiver] QA webhook receiver on http://localhost:${PORT} (log: ${LOG_FILE}, fail flag: ${FAIL_FLAG})`);
});
