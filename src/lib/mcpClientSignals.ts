/**
 * Anonymous client signals for the connector install funnel.
 *
 * The pre-OAuth touchpoints (`connector_install_started`) fire with the
 * literal distinct_id 'anonymous-mcp', so PostHog person-space stays clean —
 * but that makes uniq(distinct_id) useless. `installFingerprint` provides the
 * uniqueness key as a PROPERTY instead: a salted hash of ip + user-agent, so
 * `uniq(properties.install_fingerprint)` counts installers without a raw IP
 * ever reaching PostHog.
 *
 * The salt is secret (ANALYTICS_FINGERPRINT_SALT, falling back to
 * CLERK_SECRET_KEY so no new provisioning is required), which is what makes
 * the hash non-reversible: without it, the IPv4 space is small enough to
 * brute-force. Rotating the salt rotates the fingerprint space — uniqueness
 * counts stay valid within a salt era, not across one.
 */
import { createHash } from 'node:crypto';

const MAX_CLIENT_NAME = 128;
const MAX_CLIENT_VERSION = 32;
// initialize requests are a few hundred bytes; anything big is a tool call.
const MAX_PARSE_BYTES = 100_000;

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? '';
}

export function installFingerprint(req: Request): string | undefined {
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent') ?? '';
  if (!ip && !ua) return undefined;
  const salt = process.env.ANALYTICS_FINGERPRINT_SALT
    ?? process.env.CLERK_SECRET_KEY ?? '';
  return createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 32);
}

export interface McpClientInfo {
  name: string;
  version?: string;
}

/**
 * clientInfo from an MCP `initialize` request body, if this request is one.
 *
 * Stateless streamable HTTP builds a fresh McpServer per POST, so the server
 * instance that handles `tools/call` never saw `initialize` and
 * `getClientVersion()` is undefined there — the initialize POST itself is the
 * only place the client self-identifies. Reads a clone, so the body stays
 * available to the MCP handler; size-guarded so tool-call bodies are never
 * parsed twice; never throws.
 */
export async function parseInitializeClientInfo(req: Request): Promise<McpClientInfo | undefined> {
  try {
    if (req.method !== 'POST') return undefined;
    if (!(req.headers.get('content-type') ?? '').includes('application/json')) return undefined;
    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_PARSE_BYTES) return undefined;

    const text = await req.clone().text();
    if (text.length > MAX_PARSE_BYTES) return undefined;
    if (!/"method"\s*:\s*"initialize"/.test(text)) return undefined;

    const body: unknown = JSON.parse(text);
    const messages = Array.isArray(body) ? body : [body];
    for (const msg of messages) {
      const m = msg as { method?: unknown; params?: { clientInfo?: { name?: unknown; version?: unknown } } };
      if (m?.method !== 'initialize') continue;
      const name = m.params?.clientInfo?.name;
      if (typeof name !== 'string' || !name) continue;
      const version = m.params?.clientInfo?.version;
      return {
        name: name.slice(0, MAX_CLIENT_NAME),
        version: typeof version === 'string' ? version.slice(0, MAX_CLIENT_VERSION) : undefined,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
