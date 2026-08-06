/**
 * Direct verification of Clerk-issued OAuth JWTs against the instance JWKS.
 * Shared by partner-facing endpoints (/api/auth/partner-token). Fails closed
 * unless the token's issuer is exactly our Clerk instance.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export function expectedClerkIssuer(): string | null {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!pk) return null;
  try {
    const domain = Buffer.from(pk.replace(/^pk_(test|live)_/, ''), 'base64')
      .toString('utf8')
      .replace(/\$$/, '');
    return domain ? `https://${domain}` : null;
  } catch {
    return null;
  }
}

export async function verifyClerkOauthToken(
  token: string,
): Promise<{ userId: string; clientId: string } | null> {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const rawPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    const issuer = rawPayload.iss;

    const expected = expectedClerkIssuer();
    if (!expected || issuer !== expected) {
      console.error(`[PartnerAuth] Rejecting token from issuer '${issuer}' (expected '${expected ?? 'unavailable'}')`);
      return null;
    }

    const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    const { payload: verified } = await jwtVerify(token, JWKS, { issuer, clockTolerance: 30 });
    const sub = verified.sub;
    const cid = (verified as Record<string, unknown>).client_id as string | undefined;
    if (!sub || !cid) return null;
    return { userId: sub, clientId: cid };
  } catch (err) {
    console.error('[PartnerAuth] JWT verification failed:', err);
    return null;
  }
}
