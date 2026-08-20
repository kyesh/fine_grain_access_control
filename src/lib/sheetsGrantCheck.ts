/**
 * Back-compat shim: the sheets-specific grant check generalized into
 * driveFileGrantCheck when Google Docs support landed. Import from
 * '@/lib/driveFileGrantCheck' in new code.
 */
export {
  verifySheetsGrant,
  getOwnerGoogleToken,
  type SheetsGrantState,
} from '@/lib/driveFileGrantCheck';
