/**
 * Copy for the approve page's Picker-cancel recovery panel and the pick-first
 * "find it by name" hint (src/app/dashboard/approve/FileApprovalFlow.tsx).
 *
 * Why this exists: a file Google does not share with FGAC yet cannot be
 * resolved by title, so a denial-minted approval link can only show Google's
 * opaque file id — while Google's Picker lists files by NAME. Measured
 * 2026-09-03 → 09-07 (production), 39% of Picker opens on the approve page and
 * dashboard ended in a cancel, and a cancel left the page exactly as it was:
 * no message, no name, no visible way back in. Every observed cancel came from
 * a plain open (not the OAuth return leg), so the hint is unconditional.
 *
 * Pure so it can be unit-tested without React (scripts/test-picker-recovery-copy.ts).
 */

export interface PickerRecoveryInput {
  /** Short noun for the file kind as the approve page uses it: "sheet" / "document". */
  short: string;
  /** Human-readable title when known (request_access resourceName, or a prior pick). */
  title: string | null;
  /** Google file id the agent asked for — the only identifier a denial carries. */
  fileId: string;
}

export interface PickerRecoveryCopy {
  heading: string;
  /** What the agent asked for, rendered emphasised by the caller. */
  target: string;
  hint: string;
  reassurance: string;
  retryLabel: string;
}

/** "the sheet with Google id …" or the quoted title. */
export function describeRequestedFile({ short, title, fileId }: PickerRecoveryInput): string {
  return title ? `"${title}"` : `the ${short} with Google id ${fileId}`;
}

/**
 * One-line hint shown UNDER the pick-first button before any cancel, so the
 * first Picker open already knows to look by name.
 */
export function pickByNameHint({ short, title }: Pick<PickerRecoveryInput, 'short' | 'title'>): string {
  return title
    ? `In the picker, look for "${title}" by name.`
    : `Google's picker lists your ${short}s by name, not by id — pick the one you meant, and this page will confirm it matches.`;
}

export function pickerRecoveryCopy(input: PickerRecoveryInput): PickerRecoveryCopy {
  const { short, title } = input;
  return {
    heading: `You closed Google's picker without choosing a ${short}. Nothing has changed.`,
    target: describeRequestedFile(input),
    hint: title
      ? `Google's picker lists your files by name — search for "${title}" and pick it.`
      : `Google's picker lists your files by name, not by id. If the agent told you the ${short}'s name, search for that; otherwise open the ${short} in Google and check that its web address contains the id above.`,
    reassurance: `You can pick any ${short}. If it isn't the one the agent asked for, this page will say so before anything is approved.`,
    retryLabel: 'Try again — open the picker',
  };
}

/**
 * Normalise an agent-supplied file title before it is stored or rendered:
 * trimmed, whitespace-collapsed, capped. Returns undefined for anything empty
 * so callers can spread it into optional fields.
 */
export const MAX_RESOURCE_NAME_CHARS = 200;

export function cleanResourceName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_RESOURCE_NAME_CHARS).trim();
  return cleaned ? cleaned : undefined;
}
