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
 *   - short expiry: 15 minutes, except sheets grants get 30 — approving a
 *     sheet can include a Google Picker pick plus a first-time drive.file
 *     consent round-trip, which real users don't finish in 15
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
export const SHEETS_APPROVAL_LINK_TTL_SECONDS = 30 * 60;

/** Link lifetime in minutes for user-facing copy — keep messages honest. */
export function approvalLinkMinutes(action: ApprovalAction['action']): number {
  return action.startsWith('sheets') ? SHEETS_APPROVAL_LINK_TTL_SECONDS / 60 : APPROVAL_LINK_TTL_SECONDS / 60;
}

export type ApprovalAction =
  | { action: 'send_whitelist'; recipient: string }
  | { action: 'send_all' }
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
  ttlSecondsOverride?: number, // for tests only
  jti: string = crypto.randomUUID(),
): Promise<string> {
  const ttlSeconds = ttlSecondsOverride
    ?? (action.action.startsWith('sheets') ? SHEETS_APPROVAL_LINK_TTL_SECONDS : APPROVAL_LINK_TTL_SECONDS);
  const key = await signingKey();
  return new jose.SignJWT({ userId, proxyKeyId, ...action })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

/**
 * Mint a link AND return its jti, which doubles as the analytics `link_id`
 * joining approval_link_minted → approval_link_opened → approval_link_approved
 * into a per-link funnel.
 */
export async function mintApprovalLink(
  baseUrl: string,
  userId: string,
  proxyKeyId: string,
  action: ApprovalAction,
): Promise<{ url: string; jti: string }> {
  // Env-sourced base URLs have shipped with a trailing newline before (a
  // pasted Vercel env var), which breaks every link at the client — most
  // clients truncate at the newline and land on the site root. Sanitize here
  // so every caller is covered, whatever the env value looks like.
  const origin = baseUrl.trim().replace(/\/+$/, '');
  const jti = crypto.randomUUID();
  const token = await mintApprovalToken(userId, proxyKeyId, action, undefined, jti);
  return { url: `${origin}/dashboard/approve?token=${encodeURIComponent(token)}`, jti };
}

export async function mintApprovalUrl(
  baseUrl: string,
  userId: string,
  proxyKeyId: string,
  action: ApprovalAction,
): Promise<string> {
  return (await mintApprovalLink(baseUrl, userId, proxyKeyId, action)).url;
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
      !['send_whitelist', 'send_all', 'sheets_expose', 'sheets_write'].includes(action)
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

/**
 * Analytics-only peek at a token that failed verification (expired links most
 * of all): decodes WITHOUT signature checking so approval_link_opened can
 * still carry link_id/action. Never use the result for authorization.
 */
export function peekApprovalToken(token: string): { jti?: string; action?: string } {
  try {
    const payload = jose.decodeJwt(token);
    return {
      jti: typeof payload.jti === 'string' ? payload.jti : undefined,
      action: typeof payload.action === 'string' ? payload.action : undefined,
    };
  } catch {
    return {};
  }
}

/** Human-readable one-line description of what approving would grant. */
export function describeApproval(p: ApprovalPayload): string {
  switch (p.action) {
    case 'send_whitelist':
      return `Allow this agent to send email to ${p.recipient}`;
    case 'send_all':
      return 'Allow this agent to send email to ANY recipient, from every mailbox on its profile';
    case 'sheets_expose':
      return `Give this agent read-only access to spreadsheet ${p.resourceName || p.spreadsheetId}`;
    case 'sheets_write':
      return `Give this agent read & write access to spreadsheet ${p.resourceName || p.spreadsheetId}`;
  }
}
