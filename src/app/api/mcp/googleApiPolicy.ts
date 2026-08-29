/**
 * Pure classification + parsing helpers for the raw Google API tools
 * (google_api_get / google_api_modify).
 *
 * Enforced families (Gmail, Sheets, Docs) are mapped onto FGAC rule
 * enforcement; batch endpoints and unrecognized Gmail writes are refused
 * before any network call. Unknown Google API families pass through with the
 * account's token (2026-08-19 posture change: classify usage, don't block it —
 * Google's OAuth scopes are the backstop) and are stamped for analytics.
 *
 * No db/env imports: unit-testable via `npx tsx scripts/test-google-api-policy.ts`.
 */

export type RawCallClass =
  | { kind: 'sheets'; spreadsheetId: string; isMutating: boolean }
  | { kind: 'sheets_create' }
  | { kind: 'docs'; documentId: string; isMutating: boolean }
  | { kind: 'docs_create' }
  | { kind: 'gmail_read' }
  | { kind: 'gmail_send' }
  | { kind: 'file_comments'; fileId: string; isMutating: boolean }
  | { kind: 'passthrough'; family: string; isMutating: boolean }
  | { kind: 'denied'; reason: string; code: DenialCode; family?: string };

/** Machine-readable denial reasons, stamped onto $mcp_tool_call as `denial_code`. */
export type DenialCode =
  | 'raw_api_batch_unsupported'
  | 'raw_api_family_unsupported'
  | 'gmail_write_unsupported';

/**
 * Google API families FGAC's OAuth grant can never authorize. The grant is
 * exactly gmail.modify + drive.file, so these fail at Google no matter how the
 * path is spelled — and because most of them aren't even served from
 * www.googleapis.com, the agent sees a bare routing 404, retries a different
 * path spelling, and fails again (observed: People and Slides probes retried
 * as `v1/…` variants, doubling the public error count). Answering with a 🚫
 * denial names the real cause once and stops the loop. Keyed by the path
 * segment that identifies the family; values are the human API name used in
 * the denial text.
 */
const UNSUPPORTED_GOOGLE_APIS: Record<string, string> = {
  people: 'People (Contacts)',
  contacts: 'Contacts',
  calendar: 'Calendar',
  tasks: 'Tasks',
  youtube: 'YouTube',
  chat: 'Google Chat',
  admin: 'Admin SDK',
  classroom: 'Classroom',
  photoslibrary: 'Photos Library',
  meet: 'Google Meet',
  groups: 'Google Groups',
};

export function extractSheetsSpreadsheetId(path: string): string | null {
  const match = path.match(/(?:v4\/spreadsheets|sheets\/v4\/spreadsheets|spreadsheets)\/([^/?:#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function extractDocsDocumentId(path: string): string | null {
  const match = path.match(/(?:v1\/documents|docs\/v1\/documents|documents)\/([^/?:#]+)/);
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

  // Never-can-work families are refused before any network call. The family
  // segment may come first (`people/v1/…`) or after a bare version segment
  // (`v1/people:createContact`), and may carry a `:verb` suffix — check the
  // verb-stripped base of the first two segments.
  for (const seg of segments.slice(0, 2)) {
    const base = seg.split(':')[0];
    const apiName = UNSUPPORTED_GOOGLE_APIS[base];
    if (apiName) {
      return {
        kind: 'denied',
        code: 'raw_api_family_unsupported',
        family: base,
        reason: `🚫 Not available: the Google ${apiName} API is outside FGAC's Google grant. ` +
          `FGAC's OAuth grant covers Gmail plus per-file Drive access (Sheets, Docs, Slides, and Drive files the user picked or this agent created) — ` +
          `it holds no ${apiName} scope, so no retry, alternate path spelling, or different method can make this call succeed. ` +
          `STOP calling ${base} endpoints. If the user needs ${apiName} access, tell them FGAC does not currently support it.`,
      };
    }
  }

  const isMutating = method !== 'GET';

  if (segments.includes('spreadsheets')) {
    const spreadsheetId = extractSheetsSpreadsheetId(path);
    if (!spreadsheetId) {
      // POST v4/spreadsheets = create. Creation is allowed (2026-08-19 posture
      // change): the Sheets policy exists to keep agents out of the user's
      // EXISTING sheets, not to stop them making new ones. The route handler
      // auto-grants the created id to the calling key so the agent can keep
      // working on what it made. Anything else id-less is nonsense Google
      // will reject itself — forward it rather than inventing a denial.
      if (isMutating) return { kind: 'sheets_create' };
      return { kind: 'passthrough', family: 'spreadsheets', isMutating };
    }
    return { kind: 'sheets', spreadsheetId, isMutating };
  }

  if (segments.includes('documents')) {
    const documentId = extractDocsDocumentId(path);
    if (!documentId) {
      // POST v1/documents = create. Same posture as sheets_create: the Docs
      // policy keeps agents out of the user's EXISTING documents, not out of
      // making new ones — the route handler auto-grants the created id to
      // the calling key. Anything else id-less is nonsense Google rejects.
      if (isMutating) return { kind: 'docs_create' };
      return { kind: 'passthrough', family: 'documents', isMutating };
    }
    return { kind: 'docs', documentId, isMutating };
  }

  if (segments[0] === 'gmail') {
    if (!isMutating) return { kind: 'gmail_read' };
    if (segments[segments.length - 1] === 'send' && segments[segments.length - 2] === 'messages') {
      return { kind: 'gmail_send' };
    }
    // family kept on the denial: which Gmail writes agents reach for (drafts,
    // labels, trash, …) is roadmap-prioritization signal, same as the
    // unsupported-family denials — raw_api_endpoint carries the exact path.
    return { kind: 'denied', code: 'gmail_write_unsupported', family: 'gmail', reason: '🚫 Access Denied: This Gmail write endpoint is not permitted through FGAC. The only supported Gmail write is messages/send (recipients are checked against the send whitelist).' };
  }

  // Slides rides drive.file exactly like Sheets/Docs (creates and app-created
  // or user-picked presentations), but per-file Slides policy is the stubbed
  // `slide` kind in driveFileKinds.ts — a separate feature. Until it ships,
  // Slides is scope-backstop passthrough; classifying it here (both
  // `slides/v1/…` and the bare `v1/presentations` spelling agents fall back
  // to) is what lets the route send it to slides.googleapis.com instead of
  // www.googleapis.com, which does not serve Slides and 404s every call.
  if (segments.some(s => s.split(':')[0] === 'presentations')) {
    return { kind: 'passthrough', family: 'slides', isMutating };
  }

  // Comments on a Drive file (which is how Docs/Sheets comments are
  // addressed) are content reads/writes on that file, so they inherit the
  // file's per-file rule instead of falling through to scope-only
  // passthrough — a read-only or blocked doc must not accept comment writes.
  const commentsMatch = path.match(/^drive\/v3\/files\/([^/?#]+)\/comments(\/|$)/i);
  if (commentsMatch) {
    return { kind: 'file_comments', fileId: decodeURIComponent(commentsMatch[1]), isMutating };
  }

  // Unknown API families pass through (2026-08-19 posture change: classify
  // usage instead of blocking it — enforcement gets built when demand shows
  // up). Google's own OAuth scopes are the backstop: the token can only reach
  // what the user's grant covers. The family lands on the tool-call event as
  // `raw_api_family` so we can see what people actually reach for.
  return { kind: 'passthrough', family: segments.slice(0, 2).join('/') || 'unknown', isMutating };
}

// Resource collections whose next path segment is a caller-supplied
// identifier (message id, spreadsheet id, file id, …).
const ID_PARENT_SEGMENTS = new Set([
  'spreadsheets', 'documents', 'messages', 'threads', 'drafts', 'labels',
  'attachments', 'files', 'calendars', 'events', 'tasklists', 'tasks', 'contacts',
]);

// Literal API subresources that follow an id-parent segment without being
// ids themselves. Without this, `messages/send` templated as `messages/{id}`
// and send-body 400s were indistinguishable from message-modify probes in
// the endpoint breakdown.
const LITERAL_SUBRESOURCES = new Set(['send']);

/**
 * Id-strip a raw Google API path into a low-cardinality endpoint template for
 * analytics (`raw_api_endpoint`), e.g.
 * `gmail/v1/users/me/messages/18c8f2ab91` → `gmail/v1/users/me/messages/{id}`,
 * `v4/spreadsheets/1BxiM…/values/Sheet1!A1:B2:append` →
 * `v4/spreadsheets/{id}/values/{range}:append`.
 * Identifiers can be customer data (and explode GROUP BY cardinality), so they
 * must never land on events; API-surface verbs (`:append`, `:batchUpdate`)
 * are kept because they carry the action semantics.
 */
export function templateGoogleApiPath(rawPath: string): string {
  const path = rawPath.replace(/^\/+/, '').split(/[?#]/)[0];
  const segments = path.split('/').filter(Boolean);
  return segments.map((seg, i) => {
    // A trailing `:verb` (letters only, ≥4 chars) is API surface, not data —
    // the length floor keeps range colons like `A:B` from parsing as verbs.
    const verbMatch = seg.match(/^(.*?):([A-Za-z]{4,})$/);
    const base = verbMatch ? verbMatch[1] : seg;
    const verb = verbMatch ? `:${verbMatch[2]}` : '';
    const prev = i > 0 ? segments[i - 1].toLowerCase().replace(/:.*$/, '') : '';
    let decoded = base;
    try { decoded = decodeURIComponent(base); } catch { /* keep raw */ }

    if (prev === 'values') return `{range}${verb}`;
    if (ID_PARENT_SEGMENTS.has(prev) && !LITERAL_SUBRESOURCES.has(decoded.toLowerCase())) {
      return `{id}${verb}`;
    }
    // Fallback for families without a known parent: long or digit-bearing
    // segments and anything email-shaped are identifiers.
    if (decoded.length >= 25 || (decoded.length >= 10 && /\d/.test(decoded)) || decoded.includes('@')) {
      return `{id}${verb}`;
    }
    return seg;
  }).join('/');
}

/**
 * The Google product family a classified raw call belongs to, stamped as
 * `raw_api_family`. Known kinds map to their product; passthrough keeps the
 * family the classifier derived from the path; denials return null (their
 * `denial_code` already identifies them).
 */
export function rawApiFamily(cls: RawCallClass): string | null {
  switch (cls.kind) {
    case 'sheets':
    case 'sheets_create':
      return 'spreadsheets';
    case 'docs':
    case 'docs_create':
      return 'documents';
    case 'gmail_read':
    case 'gmail_send':
      return 'gmail';
    case 'file_comments':
      return 'drive_comments';
    case 'passthrough':
      return cls.family;
    case 'denied':
      // Family-unsupported denials keep their family visible so per-family
      // demand for un-granted APIs still shows up in analytics; other denial
      // kinds are identified by denial_code alone.
      return cls.family ?? null;
  }
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

// ─── Google error-body parsing ──────────────────────────────────────────────

/**
 * Google's error body carries the only field that distinguishes the several
 * unrelated conditions it multiplexes onto one HTTP status — most importantly
 * 403, which covers both "your OAuth grant is missing a scope" and "you are
 * being rate limited". Only the numeric status used to survive, so the 403
 * remediation asserted the scope cause unconditionally and told rate-limited
 * callers to tear down a working Google connection.
 *
 * `reason`/`domain` are Google-defined enum strings (`rateLimitExceeded`,
 * `usageLimits`, …) and `status` is its canonical code (`PERMISSION_DENIED`)
 * — none of them are customer data, so they are safe to put on events.
 */
export type GoogleErrorReason = { reason?: string; domain?: string; status?: string };

export function extractGoogleErrorReason(data: unknown): GoogleErrorReason {
  const err = (data as {
    error?: {
      errors?: Array<{ reason?: string; domain?: string }>;
      status?: string;
      details?: Array<{ reason?: unknown; domain?: unknown }>;
    };
  })?.error;
  if (!err || typeof err !== 'object') return {};
  const first = Array.isArray(err.errors) ? err.errors[0] : undefined;
  // gRPC-transcoded APIs (Sheets v4, Docs v1, Slides v1, People v1) don't
  // send the legacy `errors[]` array at all — their reason/domain live in
  // `error.details[]` ErrorInfo entries. Before this fallback, every error
  // from those APIs landed with a null `error_reason` and the 403 remediation
  // could not tell a missing drive.file scope from throttling.
  const info = Array.isArray(err.details)
    ? err.details.find(d => d && typeof d === 'object' && typeof d.reason === 'string')
    : undefined;
  return {
    reason: typeof first?.reason === 'string' ? first.reason
      : typeof info?.reason === 'string' ? info.reason : undefined,
    domain: typeof first?.domain === 'string' ? first.domain
      : typeof info?.domain === 'string' ? info.domain : undefined,
    status: typeof err.status === 'string' ? err.status : undefined,
  };
}

// ─── Per-file denial → approval action (magic links) ────────────────────────

export type FileDenialKind = 'not_exposed' | 'blocked' | 'read_only';
export type SheetsDenialKind = FileDenialKind;

/**
 * Which grant a denied per-file operation should request. The action must
 * match the access level the DENIED OPERATION requires — a write denied on an
 * unexposed file must request write access; minting a read-only exposure
 * there sends the user through an approval that cannot satisfy the retry
 * (tester finding, 2026-08-15). Explicit blocks never mint an action:
 * weakening a deliberate block stays a dashboard act.
 */
function fileApprovalLevel(denial: FileDenialKind, isMutating: boolean): 'expose' | 'write' | null {
  if (denial === 'blocked') return null;
  if (denial === 'read_only') return 'write';
  return isMutating ? 'write' : 'expose';
}

export function sheetsApprovalAction(
  denial: SheetsDenialKind,
  spreadsheetId: string,
  isMutating: boolean,
): { action: 'sheets_expose' | 'sheets_write'; spreadsheetId: string } | null {
  const level = fileApprovalLevel(denial, isMutating);
  if (!level) return null;
  return { action: level === 'write' ? 'sheets_write' : 'sheets_expose', spreadsheetId };
}

export function docsApprovalAction(
  denial: FileDenialKind,
  documentId: string,
  isMutating: boolean,
): { action: 'docs_expose' | 'docs_write'; documentId: string } | null {
  const level = fileApprovalLevel(denial, isMutating);
  if (!level) return null;
  return { action: level === 'write' ? 'docs_write' : 'docs_expose', documentId };
}
