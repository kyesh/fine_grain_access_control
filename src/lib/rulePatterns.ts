/**
 * Access-rule match patterns: the one place that decides what a stored pattern
 * means. Pure — no database, no Next runtime — so `scripts/test-rule-patterns.ts`
 * can exercise it directly, and so the dashboard writers and the three
 * enforcement paths physically cannot compile different strings.
 */
import safeRegex from 'safe-regex';

/**
 * Rule patterns are GLOBS, not raw regexes: `*` is the wildcard, and every
 * enforcement site expands it to `.*` before compiling. Validation must run on
 * the EXPANDED string — checking the raw glob rejects `*` and `*@example.com`
 * (neither compiles as a regex), which is exactly how rule saving broke between
 * 2026-04-10 (`38e5c84`) and this fix while enforcement kept working.
 *
 * Writers and readers both go through these helpers so the two can never again
 * disagree about what string is being compiled.
 */
export function globToRegex(pattern: string): string {
  return pattern.replace(/\*/g, '.*');
}

export type RulePatternCheck =
  | { ok: true; regex: string }
  | { ok: false; reason: 'invalid' | 'unsafe'; message: string };

/**
 * Validate a user-supplied match pattern. Two distinct failures, because they
 * need two distinct things said to the user: a pattern that cannot compile at
 * all, and one that compiles but is a ReDoS risk (the CASA Tier 2 guard).
 */
export function validateRulePattern(pattern: string): RulePatternCheck {
  const regex = globToRegex(pattern);

  try {
    new RegExp(regex);
  } catch {
    return {
      ok: false,
      reason: 'invalid',
      message: `'${pattern}' is not a valid match pattern. Use * as a wildcard — for example *@example.com.`,
    };
  }

  if (!safeRegex(regex)) {
    return {
      ok: false,
      reason: 'unsafe',
      message: `'${pattern}' is too complex and poses a performance risk. Avoid nested quantifiers such as (a+)+.`,
    };
  }

  return { ok: true, regex };
}

/**
 * Enforcement-side companion: the compiled matcher, or null when the stored
 * pattern is unusable. Shares validateRulePattern so the string compiled here
 * is byte-identical to the one the dashboard approved on write.
 */
export function compileRulePattern(pattern: string, flags = 'i'): RegExp | null {
  const check = validateRulePattern(pattern);
  return check.ok ? new RegExp(check.regex, flags) : null;
}

/**
 * Guard for writers that bypass the dashboard form (`grantSendToAnyone`, the
 * recommended-security-rules seed). Storing a pattern the form would reject
 * produces a rule its own owner cannot re-save — the 2026-08 "Send to Anyone"
 * failure. This is a programming error, not user input, so it throws.
 * Deliberately does not include the pattern in the message.
 */
export function assertStorablePattern(pattern: string, where: string): void {
  const check = validateRulePattern(pattern);
  if (!check.ok) {
    throw new Error(
      `[${where}] refusing to store a pattern the dashboard cannot re-save (${check.reason})`,
    );
  }
}

/**
 * Coarse shape of a pattern, for telemetry. Never send the pattern itself to
 * an analytics backend — send_whitelist patterns are real email addresses.
 */
export function patternKind(pattern: string): 'glob' | 'regex' | 'literal' {
  if (pattern.includes('*')) return 'glob';
  return /[[\]().+?^$|{}]/.test(pattern) ? 'regex' : 'literal';
}
