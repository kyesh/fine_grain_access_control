/**
 * Coarse client classification for the approve page's `approval_link_opened`
 * event (src/app/dashboard/approve/page.tsx).
 *
 * `approval_link_opened` is captured server-side, so it carries no browser
 * user agent of its own; the request's UA is classified here instead. Three
 * classes:
 *
 * - `browser`        — a person in a regular browser.
 * - `claude_desktop` — a person in the Claude desktop app's in-app browser.
 *   Its UA is a normal Chrome string with a `Claude/<build>` token
 *   (e.g. `… (KHTML, like Gecko) Claude/1.46388.4 Chrome/148.0.0.0 Safari/537.36`).
 *   Until 2026-09-09 the bare `/claude/i` test below classified these opens as
 *   `agent_driven: true`, which was wrong: in the 30 days to 2026-09-09 every
 *   such open (19 opens, 7 people) was followed by client-side pageviews and
 *   pick-button clicks from the same person — humans, and the approval
 *   funnel's "agent share of opens" was overstated by them.
 * - `agent`          — an AI agent or script fetching the link (Anthropic's
 *   `Claude-User` fetcher, node/python HTTP clients, headless browsers).
 *
 * Pure so it can be unit-tested (scripts/test-approve-client-class.ts).
 */

export type ApproveClient = 'browser' | 'claude_desktop' | 'agent';

export interface ApproveClientClass {
  client: ApproveClient;
  /** Kept for continuity with pre-2026-09-09 events: true only for `agent`. */
  agent_driven: boolean;
}

/** Claude desktop's embedded Chromium: a `Claude/<build>` token directly before `Chrome/`. */
const CLAUDE_DESKTOP_UA = /\bClaude\/\d[\d.]*\s+Chrome\//;

const AGENT_UA = /claude|anthropic|electron|node-fetch|python-requests|axios|curl|wget|bot\b|crawler|spider|headless/i;

export function classifyApproveClient(userAgent: string): ApproveClientClass {
  const ua = userAgent ?? '';
  if (CLAUDE_DESKTOP_UA.test(ua)) return { client: 'claude_desktop', agent_driven: false };
  if (AGENT_UA.test(ua)) return { client: 'agent', agent_driven: true };
  return { client: 'browser', agent_driven: false };
}
