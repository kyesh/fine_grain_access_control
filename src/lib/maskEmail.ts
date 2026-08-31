/**
 * Mask an email address for display to someone who may not own it:
 * "kenyesh@gmail.com" → "k•••••h@gmail.com". The first and last characters
 * of the local part plus the full domain are enough for the right person to
 * recognize their own address without disclosing it to anyone else (the
 * wrong-account approval card shows this to whoever opened the link).
 *
 * Pure module — imported by server actions and client components alike.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 2) return `${local[0]}•••@${domain}`;
  const dots = '•'.repeat(Math.min(local.length - 2, 6));
  return `${local[0]}${dots}${local[local.length - 1]}@${domain}`;
}
