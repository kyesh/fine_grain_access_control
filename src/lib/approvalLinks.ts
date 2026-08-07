/**
 * Signed magic approval links (connector-growth Phase C).
 *
 * A denial (or the request_access tool) mints a stateless, signed, expiring
 * JWT describing exactly one grant. The owning user opens the link, a confirm
 * page shows precisely what is being granted, and approval both applies the
 * grant and consumes the token (single-use via approval_consumptions.jti).
 *
 * Security properties (QA capability 12):
 *   - HMAC-signed; any tampering invalidates the token
 *   - 15-minute expiry
 *   - single-use (jti recorded on consumption)
 *   - approval requires the OWNING user's signed-in session — the token
 *     carries the FGAC userId and the approve path re-checks it
 *   - minting grants nothing; only the human approval writes rules
 *
 * The signing key is derived from CLERK_SECRET_KEY so no new secret needs to
 * be provisioned; rotating the Clerk secret invalidates outstanding links,
 * which is acceptable (they live 15 minutes).
 */
import * as jose from 'jose';

export const APPROVAL_LINK_TTL_SECONDS = 15 * 60;

export type ApprovalAction =
  | { action: 'send_whitelist'; recipient: string }
  | { action: 'sheets_expose'; spreadsheetId: string; resourceName?: string }
  | { action: 'sheets_write'; spreadsheetId: string; resourceName?: string };

export interface ApprovalPayload {
  jti: string;
  userId: string;      // FGAC users.id that must approve
  proxyKeyId: string;  // profile/key the grant is scoped to
  action: ApprovalAction['action'];
  recipient?: string;
  spreadsheetId?: string;
  resourceName?: string;
}

async function signingKey(): Promise<Uint8Array> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error('CLERK_SECRET_KEY missing — cannot sign approval links');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`fgac-approval-links:${secret}`),
  );
  return new Uint8Array(digest);
}

export async function mintApprovalToken(
  userId: string,
  proxyKeyId: string,
  action: ApprovalAction,
  ttlSeconds: number = APPROVAL_LINK_TTL_SECONDS, // overridable for tests only
): Promise<string> {
  const key = await signingKey();
  return new jose.SignJWT({ userId, proxyKeyId, ...action })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function mintApprovalUrl(
  baseUrl: string,
  userId: string,
  proxyKeyId: string,
  action: ApprovalAction,
): Promise<string> {
  const token = await mintApprovalToken(userId, proxyKeyId, action);
  return `${baseUrl}/dashboard/approve?token=${encodeURIComponent(token)}`;
}

export type VerifyResult =
  | { ok: true; payload: ApprovalPayload }
  | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyApprovalToken(token: string): Promise<VerifyResult> {
  try {
    const key = await signingKey();
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ['HS256'] });
    const { jti, userId, proxyKeyId, action, recipient, spreadsheetId, resourceName } =
      payload as Record<string, unknown>;
    if (
      typeof jti !== 'string' || typeof userId !== 'string' ||
      typeof proxyKeyId !== 'string' || typeof action !== 'string' ||
      !['send_whitelist', 'sheets_expose', 'sheets_write'].includes(action)
    ) {
      return { ok: false, reason: 'invalid' };
    }
    return {
      ok: true,
      payload: {
        jti, userId, proxyKeyId,
        action: action as ApprovalPayload['action'],
        recipient: typeof recipient === 'string' ? recipient : undefined,
        spreadsheetId: typeof spreadsheetId === 'string' ? spreadsheetId : undefined,
        resourceName: typeof resourceName === 'string' ? resourceName : undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof jose.errors.JWTExpired ? 'expired' : 'invalid',
    };
  }
}

/** Human-readable one-line description of what approving would grant. */
export function describeApproval(p: ApprovalPayload): string {
  switch (p.action) {
    case 'send_whitelist':
      return `Allow this agent to send email to ${p.recipient}`;
    case 'sheets_expose':
      return `Give this agent read-only access to spreadsheet ${p.resourceName || p.spreadsheetId}`;
    case 'sheets_write':
      return `Give this agent read & write access to spreadsheet ${p.resourceName || p.spreadsheetId}`;
  }
}
