/**
 * Webhook payload signing. Every partner ping carries:
 *   X-FGAC-Signature: sha256=<hex hmac of raw body>
 *   X-FGAC-Timestamp: unix seconds (signed as `${ts}.${body}` to stop replay)
 *   X-FGAC-Delivery-Id: outbox row id (stable across retries for dedup)
 */
import crypto from 'crypto';

export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${mac}`;
}

export function verifyWebhookSignature(
  secret: string, timestamp: number, body: string, signature: string,
): boolean {
  const expected = signWebhookBody(secret, timestamp, body);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
