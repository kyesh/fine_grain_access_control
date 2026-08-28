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
    description: 'Retrieve an email attachment by message ID plus either attachment ID or filename (allowed unless the parent message matches a read-block rule). Gmail attachment ids go stale when a message is re-indexed — stale ids are healed automatically when unambiguous, and filenames never go stale. Returns Gmail\'s base64url-encoded data (URL-safe alphabet, padded with "=") — decode with a base64url decoder, not standard base64.',
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
    description: 'Overwrite cell values in a range of a Google Spreadsheet. Requires a Read & Write FGAC rule for the spreadsheet. Values only — for formatting, charts, or structural changes use sheets_edit; the same rule authorizes both.',
    readOnly: false,
    destructive: true,
  },
  sheets_append_rows: {
    name: 'sheets_append_rows',
    title: 'Append spreadsheet rows',
    description: 'Append rows to a sheet in a Google Spreadsheet without modifying existing cells. Requires a Read & Write FGAC rule for the spreadsheet. Values only — for formatting or structural changes use sheets_edit; the same rule authorizes both.',
    readOnly: false,
    destructive: false,
  },
  sheets_edit: {
    name: 'sheets_edit',
    title: 'Edit a Google Spreadsheet (batchUpdate)',
    description: 'Apply Google Sheets batchUpdate requests to a spreadsheet — the full Sheets structural surface: cell and number formatting, conditional formats, charts, adding/renaming/deleting sheet tabs, merges, borders, filters, data validation, protected ranges (https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/batchUpdate). For plain cell values prefer sheets_update_range / sheets_append_rows (simpler A1 ranges). Requires a Read & Write FGAC rule for the spreadsheet. Spreadsheet comments live in the Drive API — use comments_read / comments_add. To create a new spreadsheet, use google_api_modify (POST v4/spreadsheets).',
    readOnly: false,
    destructive: true,
  },
  docs_read_document: {
    name: 'docs_read_document',
    title: 'Read a Google Doc',
    description: 'Read a Google Docs document exposed by the user\'s FGAC rules. Returns the raw Docs API document resource (title, body content as structured JSON). Large documents can be trimmed with the optional "fields" mask (e.g. "title,body.content") — use it if a full read is too big. To edit the document use docs_edit; comments live in the Drive API — use comments_read.',
    readOnly: true,
  },
  docs_edit: {
    name: 'docs_edit',
    title: 'Edit a Google Doc (batchUpdate)',
    description: 'Apply Google Docs batchUpdate requests to a document — the full Docs editing surface: insert or delete text, tables, text styles, headings, images, page breaks, positional edits (https://developers.google.com/docs/api/reference/rest/v1/documents/batchUpdate). Examples: append text {"insertText":{"endOfSegmentLocation":{},"text":"..."}}; insert a 3x3 table {"insertTable":{"rows":3,"columns":3,"endOfSegmentLocation":{}}}; replace every occurrence {"replaceAllText":{"containsText":{"text":"old","matchCase":true},"replaceText":"new"}}. Requires a Read & Write FGAC rule for the document. Doc comments live in the Drive API — use comments_read / comments_add. To create a new document, use google_api_modify (POST v1/documents).',
    readOnly: false,
    destructive: true,
  },
  comments_read: {
    name: 'comments_read',
    title: 'Read file comments',
    description: 'List the comments on a Google Docs document or Google Sheets spreadsheet — content, resolution state, author names, quoted anchor text, and replies — via the Drive API comments endpoint (https://developers.google.com/drive/api/reference/rest/v3/comments). Works for any file exposed by an FGAC rule.',
    readOnly: true,
  },
  comments_add: {
    name: 'comments_add',
    title: 'Add a comment or reply',
    description: 'Add a comment to a Google Docs document or Google Sheets spreadsheet, or reply to an existing comment (pass commentId; set resolve to also mark it resolved), via the Drive API (https://developers.google.com/drive/api/reference/rest/v3/replies). Requires a Read & Write FGAC rule for the file. New comments are file-level (unanchored); anchoring to a specific range is not supported.',
    readOnly: false,
    destructive: false,
  },
  google_api_get: {
    name: 'google_api_get',
    title: 'Raw Google API read',
    description: 'Perform a read-only GET request against any Google API endpoint by path — the full read surface behind the typed convenience tools. Gmail (https://developers.google.com/gmail/api/reference/rest): messages, threads, drafts, labels, history, settings — reads are allowed by default and filtered by the user\'s read-block rules if any. Google Sheets (https://developers.google.com/sheets/api/reference/rest) and Google Docs (https://developers.google.com/docs/api/reference/rest): require a per-file FGAC rule. Other Google APIs (e.g. Drive drive/v3 for file listing, metadata, export, revisions) are forwarded subject to the Google OAuth scopes the user granted — with the standard grant, Drive is limited by drive.file to files the user picked or this agent created. Exception: comment paths (drive/v3/files/{id}/comments) follow the file\'s FGAC rule — comments_read is the shortcut. Batch endpoints are denied. Use this whenever no typed read tool covers the endpoint you need.',
    readOnly: true,
    freeformMethods: ['GET'],
  },
  google_api_modify: {
    name: 'google_api_modify',
    title: 'Raw Google API write',
    description: 'Perform a POST, PUT, or PATCH request against a Google API endpoint by path — the full write surface behind the typed convenience tools. Docs (https://developers.google.com/docs/api/reference/rest): v1/documents/{id}:batchUpdate supports tables, text styles, headings, images, and positional edits on documents with a Read & Write rule — e.g. body {"requests":[{"insertTable":{"rows":3,"columns":3,"endOfSegmentLocation":{}}}]} inserts a table. Sheets (https://developers.google.com/sheets/api/reference/rest): every write endpoint on spreadsheets with a Read & Write rule, including v4/spreadsheets/{id}:batchUpdate for formatting, charts, and sheet management. Creating files is allowed and auto-granted to this connection: POST v1/documents or POST v4/spreadsheets. Gmail (https://developers.google.com/gmail/api/reference/rest): the only supported write is messages/send with a base64url raw RFC 2822 body (HTML/MIME/threaded replies supported; recipients are checked against the user\'s send whitelist); other Gmail writes are denied. Comment writes (drive/v3/files/{id}/comments) require a Read & Write rule for the file — comments_add is the shortcut. Writes to other Google APIs are forwarded subject to the user\'s granted OAuth scopes. Batch endpoints are denied; DELETE is never available through FGAC. Denied calls return a one-click approval link for the user.',
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
