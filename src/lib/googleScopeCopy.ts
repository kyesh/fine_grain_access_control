/**
 * Copy for the dashboard's "Google access is incomplete" card, derived from
 * which scopes the live token actually carries (googleAccess.ts).
 *
 * Pure and client-safe (no Clerk import) so the card and its unit test share
 * one decision table. The card once said "you have not granted access to
 * your Gmail" to users whose Gmail was fine and whose Drive permission had
 * just been reset by a Google sign-in — the copy must name the scope that is
 * missing and, for drive.file, the reason it goes missing.
 */

export type GoogleAccessLike = { gmail: boolean; driveFile: boolean };

export type MissingGoogleScope = 'gmail' | 'drive_file';

export type GoogleWarningCopy = {
  title: string;
  body: string;
  button: string;
  missing: MissingGoogleScope[];
};

export function describeMissingGoogleAccess(
  access: GoogleAccessLike,
  /** The user has Sheets/Docs rules — drive.file is load-bearing for them. */
  needsDriveFile: boolean,
): GoogleWarningCopy | null {
  if (access.gmail && access.driveFile) return null;

  if (access.gmail && !access.driveFile) {
    return {
      title: 'Action Required: Grant Google Drive file access',
      body: needsDriveFile
        ? 'Gmail is connected, but the Google Drive file permission (drive.file) that your Sheets and Docs rules depend on is missing — every Sheets and Docs call fails until it is restored. ' +
          'This usually happens after signing in with Google again: a sign-in resets the Drive permission on the current token (it normally returns on its own within an hour). Reconnect to restore it now.'
        : 'Gmail is connected, but the Google Drive file permission (drive.file) is missing, so Sheets and Docs tools will fail. ' +
          'Reconnect Google and leave the Drive checkbox checked.',
      button: 'Reconnect Google',
      missing: ['drive_file'],
    };
  }

  if (!access.gmail && access.driveFile) {
    return {
      title: 'Action Required: Grant Gmail access',
      body: 'Google Drive file access is connected, but Gmail access (gmail.modify) is missing — most likely the Gmail checkbox was left unchecked on Google\'s consent screen. ' +
        'Every Gmail tool fails until you reconnect and approve Gmail.',
      button: 'Reconnect Google',
      missing: ['gmail'],
    };
  }

  return {
    title: 'Action Required: Connect Google Account',
    body: 'FGAC has no usable Google access for this account. Connect your Google account and approve both Gmail and Google Drive file access to enable API access.',
    button: 'Sign in with Google',
    missing: ['gmail', 'drive_file'],
  };
}
