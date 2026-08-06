/**
 * Partner app manifest — the app-declared "agent role" copied into concrete
 * keys/rules at consent time. Kept deliberately small; anything not expressible
 * here is not grantable through the partner handoff.
 */
export interface PartnerRuleTemplate {
  service: 'gmail' | 'sheets';
  actionType: string;      // e.g. 'send_whitelist', 'label_blacklist'
  ruleName: string;
  regexPattern?: string;
}

export interface PartnerManifest {
  services: Array<'gmail' | 'sheets'>;
  // 'read_only' needs no templates: send is deny-by-default absent a
  // send_whitelist rule, and DELETE is never exposed.
  access: 'read_only' | 'scoped_write';
  rule_templates?: PartnerRuleTemplate[];
  notifications?: { trigger: 'new_email' };
}

export function parseManifest(raw: unknown): PartnerManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!Array.isArray(m.services) || m.services.length === 0) return null;
  if (m.access !== 'read_only' && m.access !== 'scoped_write') return null;
  return raw as PartnerManifest;
}

/** Human-readable permission summary rendered on the consent screen.
 * Registry data only — never client-supplied request params. */
export function describeManifest(m: PartnerManifest): string[] {
  const lines: string[] = [];
  if (m.services.includes('gmail')) {
    lines.push(m.access === 'read_only'
      ? 'Read your email (read-only — cannot send, modify, or delete)'
      : 'Read your email and send within an approved recipient list');
  }
  if (m.services.includes('sheets')) {
    lines.push('Access spreadsheets you explicitly share');
  }
  if (m.notifications?.trigger === 'new_email') {
    lines.push('Be notified when new email arrives (message IDs only — content stays behind your rules)');
  }
  return lines;
}
