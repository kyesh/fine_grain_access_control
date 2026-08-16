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
    description: 'List recent Gmail message IDs, optionally filtered by a Gmail search query (e.g. "is:unread"). Works across every connected or delegated Gmail inbox — pass the "account" parameter to target a specific mailbox (see list_accounts).',
    readOnly: true,
  },
  gmail_read: {
    name: 'gmail_read',
    title: 'Read a Gmail message',
    description: 'Read a Gmail message by ID. Returns parsed headers, body text, and attachment metadata. Reading is allowed by default; messages matching the user\'s read-block rules (labels or content patterns), if any, are withheld. Works across every connected or delegated Gmail inbox via the "account" parameter.',
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
    description: 'Send a plain-text email from any connected or delegated account (via the "account" parameter). Recipients must match the user\'s FGAC send whitelist; denied sends include a link the user can use to approve the recipient.',
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
    description: 'Overwrite cell values in a range of a Google Spreadsheet. Requires a Read & Write FGAC rule for the spreadsheet.',
    readOnly: false,
    destructive: true,
  },
  sheets_append_rows: {
    name: 'sheets_append_rows',
    title: 'Append spreadsheet rows',
    description: 'Append rows to a sheet in a Google Spreadsheet without modifying existing cells. Requires a Read & Write FGAC rule for the spreadsheet.',
    readOnly: false,
    destructive: false,
  },
  google_api_get: {
    name: 'google_api_get',
    title: 'Raw Google API read',
    description: 'Perform a read-only GET request against any endpoint of the Gmail API (https://developers.google.com/gmail/api/reference/rest) or Google Sheets API (https://developers.google.com/sheets/api/reference/rest). Access model: Gmail reads are allowed by default and filtered by the user\'s read-block rules if any; Sheets require an explicit per-spreadsheet rule; other Google APIs and batch endpoints are denied.',
    readOnly: true,
    freeformMethods: ['GET'],
  },
  google_api_modify: {
    name: 'google_api_modify',
    title: 'Raw Google API write',
    description: 'Perform a POST, PUT, or PATCH request against supported write endpoints of the Gmail API (https://developers.google.com/gmail/api/reference/rest) or Google Sheets API (https://developers.google.com/sheets/api/reference/rest). Allowed writes: Gmail messages/send (recipients are checked against the user\'s FGAC send whitelist) and Sheets value updates/appends on spreadsheets with Read & Write rules. All other write endpoints are denied. DELETE is never available through FGAC.',
    readOnly: false,
    destructive: true,
    openWorld: true,
    freeformMethods: ['POST', 'PUT', 'PATCH'],
  },
  request_access: {
    name: 'request_access',
    title: 'Request a permission upgrade',
    description: 'Ask the user to grant this agent a specific permission: sending email to a recipient, or read/write access to a Google Spreadsheet. Returns a single-use approval link for the user — calling this tool grants nothing by itself; the user must open the link and approve.',
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
