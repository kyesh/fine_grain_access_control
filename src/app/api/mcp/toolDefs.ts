/**
 * MCP tool definitions — names, titles, descriptions, and safety annotations.
 *
 * This module is intentionally pure (no db/env imports) so that
 * `scripts/mcp-tool-lint.ts` can import it and enforce the Anthropic
 * Connectors Directory invariants in CI:
 *   - every tool has a `title` and a readOnlyHint/destructiveHint
 *   - tool names are ≤ 64 characters
 *   - no tool forwards both safe and unsafe HTTP methods
 *   - freeform-path tools name/link the target API in their description
 *   - convenience tools reference their raw-API fallback in the description
 *     (google_api_get / google_api_modify are the full surface; typed tools
 *     are shortcuts — every dead end must point at the escape hatch)
 */

export interface FgacToolDef {
  name: string;
  title: string;
  description: string;
  /** true → readOnlyHint: true; false → destructiveHint must be set */
  readOnly: boolean;
  /** Only meaningful when readOnly is false. */
  destructive?: boolean;
  /** Tool interacts with entities outside the user's accounts (e.g. sends email). */
  openWorld?: boolean;
  /** HTTP methods a freeform-path tool forwards. Lint forbids mixing GET with writes. */
  freeformMethods?: readonly string[];
}

export const TOOL_DEFS = {
  list_accounts: {
    name: 'list_accounts',
    title: 'List accessible email accounts',
    description: 'Lists the email accounts this connection can access through FGAC.',
    readOnly: true,
  },
  gmail_list: {
    name: 'gmail_list',
    title: 'List Gmail messages',
    description: 'List recent Gmail message IDs, optionally filtered by a Gmail search query (e.g. "is:unread"). Works across every connected or delegated Gmail inbox — pass the "account" parameter to target a specific mailbox (see list_accounts). Other Gmail read endpoints (threads, drafts, history, settings) are available via google_api_get.',
    readOnly: true,
  },
  gmail_read: {
    name: 'gmail_read',
    title: 'Read a Gmail message',
    description: 'Read a Gmail message by ID. Returns parsed headers, body text, and attachment metadata. Reading is allowed by default; messages matching the user\'s read-block rules (labels or content patterns), if any, are withheld. Works across every connected or delegated Gmail inbox via the "account" parameter. For a full thread use google_api_get with gmail/v1/users/me/threads/{id}.',
    readOnly: true,
  },
  gmail_get_attachment: {
    name: 'gmail_get_attachment',
    title: 'Download a Gmail attachment',
    description: 'Retrieve an email attachment by message ID and attachment ID (allowed unless the parent message matches a read-block rule). Returns Gmail\'s base64url-encoded data (URL-safe alphabet, padded with "=") — decode with a base64url decoder, not standard base64.',
    readOnly: true,
  },
  gmail_send: {
    name: 'gmail_send',
    title: 'Send an email',
    description: 'Send a plain-text email from any connected or delegated account (via the "account" parameter). Recipients must match the user\'s FGAC send whitelist; denied sends include a link the user can use to approve the recipient. Plain text only — for HTML, attachments, or threaded replies, use google_api_modify with Gmail messages/send and a raw RFC 2822 MIME body; the same whitelist applies.',
    readOnly: false,
    destructive: true,
    openWorld: true,
  },
  gmail_labels: {
    name: 'gmail_labels',
    title: 'List Gmail labels',
    description: 'List all Gmail labels for an accessible account.',
    readOnly: true,
  },
  sheets_get_spreadsheet: {
    name: 'sheets_get_spreadsheet',
    title: 'Get spreadsheet metadata',
    description: 'Get metadata and sheet tabs for a Google Spreadsheet exposed by the user\'s FGAC rules.',
    readOnly: true,
  },
  sheets_read_range: {
    name: 'sheets_read_range',
    title: 'Read spreadsheet cells',
    description: 'Read cell values from a sheet tab or range in a Google Spreadsheet exposed by the user\'s FGAC rules.',
    readOnly: true,
  },
  sheets_update_range: {
    name: 'sheets_update_range',
    title: 'Update spreadsheet cells',
    description: 'Overwrite cell values in a range of a Google Spreadsheet. Requires a Read & Write FGAC rule for the spreadsheet. Values only — for formatting, charts, adding or renaming sheet tabs, or any other Sheets operation, use google_api_modify with the Sheets batchUpdate endpoint; the same rule authorizes both.',
    readOnly: false,
    destructive: true,
  },
  sheets_append_rows: {
    name: 'sheets_append_rows',
    title: 'Append spreadsheet rows',
    description: 'Append rows to a sheet in a Google Spreadsheet without modifying existing cells. Requires a Read & Write FGAC rule for the spreadsheet. Values only — for formatting or structural changes use google_api_modify with the Sheets batchUpdate endpoint; the same rule authorizes both.',
    readOnly: false,
    destructive: false,
  },
  docs_read_document: {
    name: 'docs_read_document',
    title: 'Read a Google Doc',
    description: 'Read a Google Docs document exposed by the user\'s FGAC rules. Returns the raw Docs API document resource (title, body content as structured JSON). Large documents can be trimmed with the optional "fields" mask (e.g. "title,body.content") — use it if a full read is too big.',
    readOnly: true,
  },
  docs_append_text: {
    name: 'docs_append_text',
    title: 'Append text to a Google Doc',
    description: 'Append plain text at the end of a Google Docs document without modifying existing content. Requires a Read & Write FGAC rule for the document. Plain text only — for tables, text styles, headings, images, or edits at a specific position, use google_api_modify with the Docs batchUpdate endpoint; the same rule authorizes both.',
    readOnly: false,
    destructive: false,
  },
  docs_replace_text: {
    name: 'docs_replace_text',
    title: 'Replace text in a Google Doc',
    description: 'Replace every occurrence of a text string in a Google Docs document (Docs API replaceAllText). Requires a Read & Write FGAC rule for the document. Note: a Read & Write rule on a document permits full-document editing. For any richer edit (tables, styles, positional changes), use google_api_modify with the Docs batchUpdate endpoint; the same rule authorizes both.',
    readOnly: false,
    destructive: true,
  },
  google_api_get: {
    name: 'google_api_get',
    title: 'Raw Google API read',
    description: 'Perform a read-only GET request against any Google API endpoint by path — the full read surface behind the typed convenience tools. Gmail (https://developers.google.com/gmail/api/reference/rest): messages, threads, drafts, labels, history, settings — reads are allowed by default and filtered by the user\'s read-block rules if any. Google Sheets (https://developers.google.com/sheets/api/reference/rest) and Google Docs (https://developers.google.com/docs/api/reference/rest): require a per-file FGAC rule. Other Google APIs (e.g. Drive drive/v3 for file listing, metadata, export, comments, revisions) are forwarded subject to the Google OAuth scopes the user granted — with the standard grant, Drive is limited by drive.file to files the user picked or this agent created. Batch endpoints are denied. Use this whenever no typed read tool covers the endpoint you need.',
    readOnly: true,
    freeformMethods: ['GET'],
  },
  google_api_modify: {
    name: 'google_api_modify',
    title: 'Raw Google API write',
    description: 'Perform a POST, PUT, or PATCH request against a Google API endpoint by path — the full write surface behind the typed convenience tools. Docs (https://developers.google.com/docs/api/reference/rest): v1/documents/{id}:batchUpdate supports tables, text styles, headings, images, and positional edits on documents with a Read & Write rule — e.g. body {"requests":[{"insertTable":{"rows":3,"columns":3,"endOfSegmentLocation":{}}}]} inserts a table. Sheets (https://developers.google.com/sheets/api/reference/rest): every write endpoint on spreadsheets with a Read & Write rule, including v4/spreadsheets/{id}:batchUpdate for formatting, charts, and sheet management. Creating files is allowed and auto-granted to this connection: POST v1/documents or POST v4/spreadsheets. Gmail (https://developers.google.com/gmail/api/reference/rest): the only supported write is messages/send with a base64url raw RFC 2822 body (HTML/MIME/threaded replies supported; recipients are checked against the user\'s send whitelist); other Gmail writes are denied. Writes to other Google APIs are forwarded subject to the user\'s granted OAuth scopes. Batch endpoints are denied; DELETE is never available through FGAC. Denied calls return a one-click approval link for the user.',
    readOnly: false,
    destructive: true,
    openWorld: true,
    freeformMethods: ['POST', 'PUT', 'PATCH'],
  },
  request_access: {
    name: 'request_access',
    title: 'Request a permission upgrade',
    description: 'Ask the user to grant this agent a specific permission: sending email to a recipient, or read/write access to a Google Spreadsheet or Google Docs document. Returns a single-use approval link for the user — calling this tool grants nothing by itself; the user must open the link and approve.',
    readOnly: true,
  },
  get_my_permissions: {
    name: 'get_my_permissions',
    title: 'Show my permissions',
    description: 'Shows the access rules, accessible accounts, proxy key, and default access posture (including implicit Gmail read access) that apply to this connection.',
    readOnly: true,
  },
} as const satisfies Record<string, FgacToolDef>;

export type ToolName = keyof typeof TOOL_DEFS;

/** MCP ToolAnnotations for a definition. */
export function toolAnnotations(def: FgacToolDef) {
  return {
    title: def.title,
    ...(def.readOnly
      ? { readOnlyHint: true as const }
      : { destructiveHint: def.destructive ?? true }),
    ...(def.openWorld !== undefined ? { openWorldHint: def.openWorld } : {}),
  };
}
