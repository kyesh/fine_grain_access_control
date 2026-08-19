/**
 * Pure classification + parsing helpers for the raw Google API tools
 * (google_api_get / google_api_modify).
 *
 * Deny-by-default: only path families we can map onto FGAC rule enforcement
 * are forwarded. Everything else — unknown Google APIs, batch endpoints,
 * unrecognized Gmail writes — is refused before any network call.
 *
 * No db/env imports: unit-testable via `npx tsx scripts/test-google-api-policy.ts`.
 */

export type RawCallClass =
  | { kind: 'sheets'; spreadsheetId: string; isMutating: boolean }
  | { kind: 'gmail_read' }
  | { kind: 'gmail_send' }
  | { kind: 'denied'; reason: string; code: DenialCode };

/** Machine-readable denial reasons, stamped onto $mcp_tool_call as `denial_code`. */
export type DenialCode =
  | 'raw_api_batch_unsupported'
  | 'sheets_create_unsupported'
  | 'gmail_write_unsupported'
  | 'raw_api_not_exposed';

export function extractSheetsSpreadsheetId(path: string): string | null {
  const match = path.match(/(?:v4\/spreadsheets|sheets\/v4\/spreadsheets|spreadsheets)\/([^/?:#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Classify a raw Google API call. `rawPath` is the caller-supplied path
 * (query string allowed); `method` is the HTTP method the tool forwards.
 */
export function classifyGoogleApiCall(rawPath: string, method: string): RawCallClass {
  const path = rawPath.replace(/^\/+/, '').split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean).map(s => s.toLowerCase());

  // Google batch endpoints multiplex many sub-requests (each with its own
  // method and path) inside one POST body, which would smuggle reads past
  // read-restriction checks and writes past the deny-by-default policy.
  if (segments.includes('batch') || segments.some(s => s.startsWith('batch'))) {
    return { kind: 'denied', code: 'raw_api_batch_unsupported', reason: '🚫 Access Denied: Google batch endpoints are not supported through FGAC. Call individual endpoints instead.' };
  }

  const isMutating = method !== 'GET';

  if (segments.includes('spreadsheets')) {
    const spreadsheetId = extractSheetsSpreadsheetId(path);
    if (!spreadsheetId) {
      return { kind: 'denied', code: 'sheets_create_unsupported', reason: '🚫 Access Denied: A spreadsheet ID is required — FGAC Sheets rules are granted per spreadsheet. Creating spreadsheets is not supported through FGAC: the user must create the sheet themselves (e.g. sheets.new), then grant access to it via request_access or the approval link a denial returns.' };
    }
    return { kind: 'sheets', spreadsheetId, isMutating };
  }

  if (segments[0] === 'gmail') {
    if (!isMutating) return { kind: 'gmail_read' };
    if (segments[segments.length - 1] === 'send' && segments[segments.length - 2] === 'messages') {
      return { kind: 'gmail_send' };
    }
    return { kind: 'denied', code: 'gmail_write_unsupported', reason: '🚫 Access Denied: This Gmail write endpoint is not permitted through FGAC. The only supported Gmail write is messages/send (recipients are checked against the send whitelist).' };
  }

  return { kind: 'denied', code: 'raw_api_not_exposed', reason: '🚫 Access Denied: This Google API is not exposed through FGAC. Supported paths: Gmail ("gmail/v1/users/...") and Google Sheets ("v4/spreadsheets/{id}/...").' };
}

/**
 * Extract all recipient addresses (To/Cc/Bcc) from a Gmail messages/send
 * request body ({ raw: <base64url RFC 2822 message> }).
 * Returns null when recipients cannot be determined — callers must deny.
 */
export function extractSendRecipients(body: unknown): string[] | null {
  let raw: string | undefined;
  try {
    const obj = typeof body === 'string' ? JSON.parse(body) : body;
    if (obj && typeof obj === 'object' && typeof (obj as { raw?: unknown }).raw === 'string') {
      raw = (obj as { raw: string }).raw;
    }
  } catch {
    return null;
  }
  if (!raw) return null;

  let message: string;
  try {
    message = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  // Header section ends at the first blank line. Unfold continuation lines.
  const headerSection = message.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  const recipients: string[] = [];
  for (const line of headerSection.split(/\r?\n/)) {
    if (/^(to|cc|bcc):/i.test(line)) {
      const found = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
      if (found) recipients.push(...found);
    }
  }
  return recipients.length > 0 ? recipients : null;
}

/**
 * Collect every `labelIds` array reachable in a Gmail API response.
 * Thread and list responses nest messages, so label-based read rules must
 * consider the union — not just the top-level object.
 */
export function collectLabelIds(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) out.push(...collectLabelIds(item, depth + 1));
    return out;
  }
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.labelIds)) {
    out.push(...obj.labelIds.filter((l): l is string => typeof l === 'string'));
  }
  for (const key of Object.keys(obj)) {
    if (key === 'labelIds') continue;
    out.push(...collectLabelIds(obj[key], depth + 1));
  }
  return out;
}

// ─── Sheets denial → approval action (magic links) ──────────────────────────

export type SheetsDenialKind = 'not_exposed' | 'blocked' | 'read_only';

/**
 * Which grant a denied Sheets operation should request. The action must match
 * the access level the DENIED OPERATION requires — a write denied on an
 * unexposed sheet must request write access; minting a read-only exposure
 * there sends the user through an approval that cannot satisfy the retry
 * (tester finding, 2026-08-15). Explicit blocks never mint an action:
 * weakening a deliberate block stays a dashboard act.
 */
export function sheetsApprovalAction(
  denial: SheetsDenialKind,
  spreadsheetId: string,
  isMutating: boolean,
): { action: 'sheets_expose' | 'sheets_write'; spreadsheetId: string } | null {
  if (denial === 'blocked') return null;
  if (denial === 'read_only') return { action: 'sheets_write', spreadsheetId };
  return { action: isMutating ? 'sheets_write' : 'sheets_expose', spreadsheetId };
}
