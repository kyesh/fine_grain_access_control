/**
 * Drive-file kind descriptor — the one place that knows what makes a
 * spreadsheet a spreadsheet and a document a document.
 *
 * Everything FGAC does per-file (per-file rules, Google Picker exposure,
 * drive.file grant verification, grant-recovery pages, approval links)
 * is file-type-agnostic EXCEPT for the values in this table. Adding a new
 * Google file type (Slides is expected next) means adding a descriptor
 * entry plus its MCP tool definitions/registrations and QA docs — shared
 * code must key off this descriptor, never off `if (kind === 'doc')`
 * branches.
 *
 * Pure module (no db/env imports) so policy unit tests can import it.
 */

export type DriveFileKind = 'sheet' | 'doc' | 'slide'; // 'slide' stubbed until Slides ships

export interface DriveFileKindDescriptor {
  /** access_rules.service value for this kind's rules. */
  service: 'sheets' | 'docs' | 'slides';
  /** Rule actionType values: [read, readWrite, block]. */
  actionTypes: { read: string; readWrite: string; block: string };
  /** Approval-link action names: exposing (read) and write-upgrading. */
  approvalActions: { expose: string; write: string };
  /** google.picker.ViewId key for exposing this kind. */
  pickerViewId: 'SPREADSHEETS' | 'DOCUMENTS' | 'PRESENTATIONS';
  /** API host+path prefix for this kind's endpoint family. */
  apiBase: string;
  /** Cheap authenticated probe that verifies a drive.file grant exists. */
  verifyUrl: (id: string) => string;
  /** Dashboard grant-recovery page (Picker walkthrough) for this kind. */
  setupPath: string;
  /** Query param carrying the file id on the setup page (sheets shipped as `sid`). */
  setupIdParam: string;
  /** Human noun for copy: "spreadsheet" / "document" / "presentation". */
  noun: string;
  /** Title shown on the Google Picker dialog when exposing this kind. */
  pickerTitle: string;
}

export const DRIVE_FILE_KINDS: Record<DriveFileKind, DriveFileKindDescriptor> = {
  sheet: {
    service: 'sheets',
    actionTypes: { read: 'sheet_read', readWrite: 'sheet_read_write', block: 'sheet_block' },
    approvalActions: { expose: 'sheets_expose', write: 'sheets_write' },
    pickerViewId: 'SPREADSHEETS',
    apiBase: 'https://sheets.googleapis.com/v4/spreadsheets',
    verifyUrl: (id: string) =>
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=properties.title`,
    setupPath: '/dashboard/sheets-setup',
    setupIdParam: 'sid',
    noun: 'spreadsheet',
    pickerTitle: 'Select Google Sheets to Expose in FGAC',
  },
  doc: {
    service: 'docs',
    actionTypes: { read: 'doc_read', readWrite: 'doc_read_write', block: 'doc_block' },
    approvalActions: { expose: 'docs_expose', write: 'docs_write' },
    pickerViewId: 'DOCUMENTS',
    apiBase: 'https://docs.googleapis.com/v1/documents',
    verifyUrl: (id: string) =>
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?fields=title`,
    setupPath: '/dashboard/docs-setup',
    setupIdParam: 'did',
    noun: 'document',
    pickerTitle: 'Select Google Docs to Expose in FGAC',
  },
  // Stub: not reachable anywhere yet (no tools, no rules, no picker entry).
  // Present so the type system and shared plumbing are three-kind-shaped
  // from day one; wiring it up is the Slides feature, not this table.
  slide: {
    service: 'slides',
    actionTypes: { read: 'slide_read', readWrite: 'slide_read_write', block: 'slide_block' },
    approvalActions: { expose: 'slides_expose', write: 'slides_write' },
    pickerViewId: 'PRESENTATIONS',
    apiBase: 'https://slides.googleapis.com/v1/presentations',
    verifyUrl: (id: string) =>
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(id)}?fields=title`,
    setupPath: '/dashboard/slides-setup',
    setupIdParam: 'pid',
    noun: 'presentation',
    pickerTitle: 'Select Google Slides to Expose in FGAC',
  },
};

/** Kinds a user can actually expose today (excludes stubs). */
export const ACTIVE_DRIVE_FILE_KINDS: DriveFileKind[] = ['sheet', 'doc'];

/** Look up the kind that owns an access_rules.service value. */
export function kindForService(service: string): DriveFileKind | null {
  for (const kind of ACTIVE_DRIVE_FILE_KINDS) {
    if (DRIVE_FILE_KINDS[kind].service === service) return kind;
  }
  return null;
}
