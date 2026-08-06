/**
 * Gmail rule loading + read-time enforcement, shared by the MCP server, the
 * REST proxy paths that need it, and the push-notification filter. Extracted
 * from src/app/api/mcp/route.ts so notification filtering can never drift from
 * read-time filtering — a message a key cannot read must also never be
 * announced to a partner webhook.
 */
import safeRegex from 'safe-regex';
import { db } from '@/db';
import { accessRules, keyRuleAssignments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { collectLabelIds } from '@/app/api/mcp/googleApiPolicy';

export async function loadApplicableRules(userId: string, proxyKeyId: string, targetEmail: string) {
  const allUserRules = await db.select().from(accessRules)
    .where(eq(accessRules.userId, userId));

  const keyAssignments = await db.select().from(keyRuleAssignments)
    .where(eq(keyRuleAssignments.proxyKeyId, proxyKeyId));

  const assignedRuleIds = new Set(keyAssignments.map(a => a.accessRuleId));
  const allAssignments = await db.select().from(keyRuleAssignments);
  const rulesWithAssignments = new Set(allAssignments.map(a => a.accessRuleId));

  return allUserRules.filter(rule => {
    const isGlobal = !rulesWithAssignments.has(rule.id);
    const isAssignedToThisKey = assignedRuleIds.has(rule.id);
    const emailMatches = !rule.targetEmail ||
      rule.targetEmail.toLowerCase() === targetEmail.toLowerCase();
    return (isGlobal || isAssignedToThisKey) && emailMatches;
  });
}

export type ApplicableRules = Awaited<ReturnType<typeof loadApplicableRules>>;

/**
 * Read-time enforcement, shared by every path that returns message content.
 * Policy: messages may APPEAR in listings, but reading content must respect
 * label blacklists (checked first — precedence), label whitelists, and content
 * read-blacklists — identically on MCP and the raw API proxy.
 *
 * Label rules consider every labelIds array in the response (thread and list
 * responses nest messages). Whitelists only apply when the response carries
 * labels at all — ID-only listings stay visible, matching the policy above.
 * Returns a user-facing restriction message, or null if the read is allowed.
 */
export function checkReadRestrictions(
  rules: ApplicableRules,
  message: unknown,
): string | null {
  const gmailRules = rules.filter(r => r.service === 'gmail');
  const labelIds = collectLabelIds(message);

  for (const rule of gmailRules.filter(r => r.actionType === 'label_blacklist')) {
    if (rule.regexPattern && labelIds.includes(rule.regexPattern)) {
      return `🚫 Access restricted: Email contains blacklisted label '${rule.regexPattern}'.`;
    }
  }

  const whitelists = gmailRules.filter(r => r.actionType === 'label_whitelist' && !!r.regexPattern);
  if (whitelists.length > 0 && labelIds.length > 0 && !whitelists.some(r => labelIds.includes(r.regexPattern!))) {
    return '🚫 Access restricted: Email lacks a required whitelisted label.';
  }

  const bodyStr = JSON.stringify(message);
  for (const rule of gmailRules.filter(r => r.actionType === 'read_blacklist')) {
    if (!rule.regexPattern) continue;
    const regexStr = rule.regexPattern.replace(/\*/g, '.*');
    if (!safeRegex(regexStr)) continue;
    if (new RegExp(regexStr, 'i').test(bodyStr)) {
      return `🚫 Access restricted: Content blocked by rule '${rule.ruleName}'.`;
    }
  }

  return null;
}
