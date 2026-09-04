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

/**
 * Support-correlation hash for Gmail/Drive resource ids stamped on tool-call
 * events (`message_id_hash`, `resource_id_hash`). Deliberately UNSALTED and
 * truncated: a message id is not a secret (it is meaningless outside the
 * owner's mailbox), and the point is that an operator holding an id from a
 * support email can compute the same hash and find the calls —
 * `sha256(id).slice(0, 16)` — without the raw id ever reaching PostHog.
 */
export function resourceIdHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

export interface McpClientInfo {
  name: string;
  version?: string;
}

export interface RpcEnvelope {
  /** JSON-RPC methods in the body (one, or several for a batch). */
  methods: string[];
  /** `params.name` of the first tools/call in the body, if any. */
  toolName?: string;
  /** True when the body could not be parsed as JSON at all. */
  parseError: boolean;
}

/**
 * Cheap shape of an already-read POST body: which JSON-RPC method(s) it
 * carries and, for tools/call, which tool — the two facts the transport-
 * rejection and input-validation events need to be attributable to a call.
 * Never throws; a non-JSON body reports parseError so the caller can answer
 * with the JSON-RPC parse error the MCP handler itself fails to produce.
 */
export function parseRpcEnvelope(text: string): RpcEnvelope {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { methods: [], parseError: true };
  }
  const messages = Array.isArray(body) ? body : [body];
  const methods: string[] = [];
  let toolName: string | undefined;
  for (const msg of messages) {
    const m = msg as { method?: unknown; params?: { name?: unknown } };
    if (typeof m?.method !== 'string') continue;
    methods.push(m.method.slice(0, 64));
    if (m.method === 'tools/call' && toolName === undefined && typeof m.params?.name === 'string') {
      toolName = m.params.name.slice(0, 64);
    }
  }
  return { methods, toolName, parseError: false };
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
