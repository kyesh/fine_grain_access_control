/**
 * Growth prospecting digest — FINDS conversations worth a human reply.
 *
 *   npm run growth:prospects                       # default: since last run (min 2d), max 7d
 *   npm run growth:prospects -- --window 14d       # explicit lookback
 *   npm run growth:prospects -- --sources hn,feeds # subset (hn | reddit | github | feeds)
 *   npm run growth:prospects -- --dry-run          # don't touch .growth/seen.json
 *   npm run growth:prospects -- --print            # also echo the digest to stdout
 *
 * It never posts, comments, DMs, or emails. It reads public, keyless endpoints
 * (HN Algolia, Reddit search, GitHub search, a handful of Atom/RSS feeds),
 * scores what it finds, dedupes against .growth/seen.json, and writes a dated
 * markdown digest to .growth/digests/YYYY-MM-DD.md. Ken replies by hand.
 * Everything under .growth/ is gitignored — the repo is public and a lead
 * list is not something to publish.
 *
 * Optional env: GITHUB_TOKEN (raises the search limit from 10 to 30 req/min
 * and the core limit from 60 to 5000 req/h; read-only, no scopes needed).
 *
 * Adding a keyword or source: edit the CONFIG block below — nothing else
 * needs to change. See docs/growth-prospecting.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const USER_AGENT =
  'fgac-growth-prospects/0.1 (+https://github.com/kyesh/fine_grain_access_control; read-only digest, no posting)';
// Reddit wants the platform:app:version (by /u/name) shape and returns 403 to
// generic agents. This one is descriptive, not impersonation.
const REDDIT_USER_AGENT = 'macos:ai.fgac.growth-prospects:v0.1 (by /u/fgac_ai)';

const STATE_DIR = '.growth';
const DIGEST_DIR = join(STATE_DIR, 'digests');
const STATE_FILE = join(STATE_DIR, 'seen.json');

// Attribution: every manual reply carries one of these so PostHog's UTM funnel
// (utm_source=<channel>, utm_campaign=prospecting) attributes the signup.
// Slugs are minted with `npm run links` — see docs/growth-prospecting.md.
const ATTRIBUTION: Record<string, string> = {
  hn: 'https://fgac.ai/go/hn',
  reddit: 'https://fgac.ai/go/rd',
  github: 'https://fgac.ai/go/gh',
  x: 'https://fgac.ai/go/x',
};

// Hacker News (Algolia). Each entry is one search; the terms are what Algolia
// matches, the scorer then re-checks the text for STRONG/CONTEXT terms.
const HN_QUERIES = [
  'claude gmail',
  'mcp gmail',
  'chatgpt gmail',
  'agent email access',
  'give ai access to my email',
  'prompt injection gmail',
  'prompt injection email',
  'lethal trifecta',
  // competitors
  'gatelet', 'scopegate', 'agentport', 'archestra', 'mcptotal',
];

// Reddit: one request per query across all subreddits (multi-sub search
// keeps the request count — and therefore the 429s — low).
const REDDIT_SUBREDDITS = ['ClaudeAI', 'mcp', 'AI_Agents', 'OpenAI', 'selfhosted'];
const REDDIT_QUERIES = [
  '"connect gmail" OR "gmail mcp"',
  '"read my email" OR "email access"',
  '"gmail" AND ("claude" OR "mcp" OR "agent")',
];

// GitHub: people stuck on credentials.json / OAuth for a Gmail MCP server are
// FGAC's ICP mid-pain. Repo-scoped queries catch the big servers' new issues;
// the free-text queries catch the long tail.
const GITHUB_GMAIL_MCP_REPOS = [
  'taylorwilsdon/google_workspace_mcp',
  'GongRzhe/Gmail-MCP-Server',
  'jasonsum/gmail-mcp-server',
  'aaronsb/google-workspace-mcp',
];
const GITHUB_ISSUE_QUERIES = [
  'gmail mcp credentials in:title,body is:issue',
  'gmail mcp oauth in:title,body is:issue',
  'gmail mcp "credentials.json" in:title,body is:issue',
];
// Star deltas are recorded run-over-run in seen.json.
const COMPETITOR_REPOS = [
  'hannesill/Gatelet',
  'alifanov/scopegate',
  'yakkomajuri/agentport',
  'archestra-ai/archestra',
  'taylorwilsdon/google_workspace_mcp',
  'GongRzhe/Gmail-MCP-Server',
];

// Feeds. `incident: true` = every new item is an incident flag (the feed IS the
// topic). Otherwise an item must match STRONG/CONTEXT terms to be kept.
const FEEDS: Array<{ name: string; url: string; incident: boolean }> = [
  { name: "Simon Willison — exfiltration-attacks", url: 'https://simonwillison.net/tags/exfiltration-attacks.atom', incident: true },
  { name: 'Simon Willison — prompt-injection', url: 'https://simonwillison.net/tags/prompt-injection.atom', incident: false },
  { name: 'Embrace The Red (Johann Rehberger)', url: 'https://embracethered.com/blog/index.xml', incident: false },
  { name: 'Promptfoo blog', url: 'https://www.promptfoo.dev/blog/rss.xml', incident: false },
];

// Scoring vocabulary. STRONG = the mailbox/data side of the trifecta;
// CONTEXT = the agent side. A lead needs one of each to be reply-worthy.
const STRONG_TERMS = ['gmail', 'email', 'e-mail', 'inbox', 'mailbox', 'google workspace', 'google account', 'sheets', 'google docs', 'drive'];
// The product-specific subset: a bare "email" in a comment about smartphones
// is not a lead; "gmail" almost always is.
const SPECIFIC_TERMS = ['gmail', 'inbox', 'mailbox', 'google workspace', 'google account', 'workspace mcp'];
const CONTEXT_TERMS = ['claude', 'mcp', 'chatgpt', 'openai', 'agent', 'llm', 'copilot', 'gemini', 'assistant', 'connector'];
const PAIN_TERMS = ['credentials', 'credentials.json', 'oauth', 'token', 'consent', 'permission', 'scope', 'access', 'read-only', 'readonly', 'safe', 'safely', 'trust', 'prompt injection', 'exfiltrat', 'leak', 'deleted my', 'deleted all', 'wiped'];
const COMPETITOR_TERMS = ['gatelet', 'scopegate', 'agentport', 'archestra', 'mcptotal', 'composio', 'nango', 'pipedream', 'zapier mcp'];
const NOISE_PATTERNS = [
  /who wants to be hired/i, /who is hiring/i, /freelancer\? seeking/i,
  /digest \d{4}-\d{2}-\d{2}/i, /日报/, /newsletter #\d+/i,
];

// ─── args & time ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PRINT = args.includes('--print');
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}
const SOURCES = new Set((flag('sources') ?? 'hn,reddit,github,feeds').split(',').map((s) => s.trim()));

const DAY = 86_400_000;
function parseWindow(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+)([dh])$/.exec(s);
  if (!m) throw new Error(`--window must look like 7d or 36h, got "${s}"`);
  return Number(m[1]) * (m[2] === 'd' ? DAY : 3_600_000);
}

// ─── state ───────────────────────────────────────────────────────────────────

type SeenEntry = { firstSeen: string; source: string };
type State = {
  version: 1;
  lastRunAt?: string;
  seen: Record<string, SeenEntry>;
  stars: Record<string, { count: number; at: string }>;
};

function loadState(): State {
  if (!existsSync(STATE_FILE)) return { version: 1, seen: {}, stars: {} };
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
}
function saveState(state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

// ─── http ────────────────────────────────────────────────────────────────────

const lastHit: Record<string, number> = {};
async function polite(host: string, minGapMs: number): Promise<void> {
  const wait = (lastHit[host] ?? 0) + minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit[host] = Date.now();
}

async function get(url: string, opts: { headers?: Record<string, string>; minGapMs?: number; retries?: number } = {}): Promise<Response> {
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    await polite(host, opts.minGapMs ?? 1500);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...(opts.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 429 && res.status !== 403 && res.status < 500) return res;
    if (attempt++ >= (opts.retries ?? 1)) return res;
    // Honour Retry-After when present; otherwise back off 15s, 30s, 45s…
    // (Reddit's RSS 429s clear in roughly that range).
    const retryAfter = Number(res.headers.get('retry-after'));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000 * attempt;
    await new Promise((r) => setTimeout(r, Math.min(backoff, 60_000)));
  }
}

// ─── leads ───────────────────────────────────────────────────────────────────

type Kind = 'incident' | 'thread' | 'prospect' | 'competitor';
type Lead = {
  kind: Kind;
  source: 'hn' | 'reddit' | 'github' | 'feed';
  sourceLabel: string;
  url: string;
  title: string;
  summary: string;
  author?: string;
  createdAt: Date;
  engagement: string;
  terms: { strong: string[]; context: string[]; pain: string[]; competitor: string[]; specific: string[]; titleStrong: string[] };
  score: number;
};

function findTerms(text: string, terms: string[]): string[] {
  const t = text.toLowerCase();
  return terms.filter((k) => t.includes(k));
}

function unescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function strip(html: string): string {
  // Feed bodies arrive as escaped HTML (&lt;div&gt;…) — unescape, drop tags,
  // then unescape the entities that were inside the text.
  return unescape(unescape(html).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function oneLine(s: string, max = 200): string {
  const t = strip(s);
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function recencyScore(d: Date, now: number): number {
  const ageDays = (now - d.getTime()) / DAY;
  if (ageDays < 1) return 3;
  if (ageDays < 3) return 2;
  if (ageDays < 7) return 1;
  return 0;
}

function score(lead: Omit<Lead, 'score'>, now: number, engagementBoost = 0): number {
  const { strong, context, pain, competitor, specific, titleStrong } = lead.terms;
  let s = recencyScore(lead.createdAt, now);
  s += Math.min(strong.length, 2) * 2 + Math.min(context.length, 2) + Math.min(pain.length, 2);
  if (strong.length && context.length) s += 3; // both sides of the trifecta present
  if (specific.length) s += 3; // gmail/inbox/workspace, not just "email"
  if (titleStrong.length) s += 2; // the mailbox is the subject, not an aside
  if (competitor.length) s += 2;
  if (lead.kind === 'incident') s += 4;
  if (lead.kind === 'prospect') s += 1;
  s += engagementBoost;
  return s;
}

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(text));
}

function build(base: Omit<Lead, 'terms' | 'score'>, text: string, now: number, engagementBoost = 0): Lead | null {
  if (isNoise(text)) return null;
  const terms = {
    strong: findTerms(text, STRONG_TERMS),
    context: findTerms(text, CONTEXT_TERMS),
    pain: findTerms(text, PAIN_TERMS),
    competitor: findTerms(text, COMPETITOR_TERMS),
    specific: findTerms(text, SPECIFIC_TERMS),
    titleStrong: findTerms(base.title, STRONG_TERMS),
  };
  // Reply-worthy = both sides of the trifecta, AND the mailbox is either
  // product-specific (gmail/inbox/…) or the subject of the thread — a stray
  // "email" in an unrelated discussion is the main noise source.
  const relevant =
    base.kind === 'incident' ||
    terms.competitor.length > 0 ||
    (terms.strong.length > 0 && terms.context.length > 0 && (terms.specific.length > 0 || terms.titleStrong.length > 0));
  if (!relevant) return null;
  const lead = { ...base, terms };
  return { ...lead, score: score(lead, now, engagementBoost) };
}

// ─── suggested angle ─────────────────────────────────────────────────────────
// Factual, never salesy. The reply itself is Ken's; this is only the hook.

function angle(lead: Lead): string {
  const { pain, competitor } = lead.terms;
  const has = (k: string) => pain.some((p) => p.includes(k));
  if (lead.kind === 'incident') {
    return 'Incident material. Write the same-week teardown: what the agent could reach, what a proxy-enforced per-label/per-recipient rule would and would NOT have stopped. Submit as analysis, not as a product post.';
  }
  if (lead.kind === 'competitor' || competitor.length) {
    return `Mentions ${competitor.join(', ') || 'a gateway tool'}. Only reply if the thread asks for alternatives; the honest distinction is Google-Workspace-specific rules (labels, recipients, files) enforced at the proxy, hosted and free. Disclose affiliation.`;
  }
  if (has('credentials') || has('oauth') || has('token') || has('consent') || has('scope')) {
    return 'Setup pain (credentials/OAuth). If they are stuck, help with the actual problem first; a hosted proxy that holds the Google OAuth grant and exposes one MCP endpoint is a legitimate second option to mention, once.';
  }
  if (has('prompt injection') || has('exfiltrat') || has('leak') || has('delete')) {
    return 'Safety question. Lead with the mechanism: rules enforced outside the model survive prompt injection and context compaction; a prompt-level "only read label X" does not. Mention the open-source enforcement code if trust comes up.';
  }
  if (has('read-only') || has('readonly') || has('permission') || has('access') || has('safe')) {
    return 'Scoping question ("read-only", "just this label"). Answer the question as asked; the FGAC-specific point is that Gmail\'s OAuth scopes are coarse and per-label/per-recipient limits need a layer that enforces them per request.';
  }
  return 'General "connect an agent to Gmail" thread. Participate on the merits; mention FGAC only if someone asks how to limit what the agent can do once connected.';
}

function attribution(lead: Lead): string {
  if (lead.kind === 'incident') return `${ATTRIBUTION.hn} (HN submission) · ${ATTRIBUTION.x} (X)`;
  if (lead.source === 'hn') return ATTRIBUTION.hn;
  if (lead.source === 'reddit') return ATTRIBUTION.reddit;
  return ATTRIBUTION.github;
}

// ─── sources ─────────────────────────────────────────────────────────────────

type Report = { source: string; ok: boolean; note: string; fetched: number };

async function hackerNews(sinceMs: number, now: number, report: Report[]): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seenIds = new Set<string>();
  let fetched = 0;
  for (const q of HN_QUERIES) {
    const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
    url.searchParams.set('query', q);
    url.searchParams.set('tags', '(story,comment)');
    url.searchParams.set('hitsPerPage', '30');
    url.searchParams.set('numericFilters', `created_at_i>${Math.floor(sinceMs / 1000)}`);
    const res = await get(url.toString(), { minGapMs: 1200 });
    if (!res.ok) { report.push({ source: 'hn', ok: false, note: `HTTP ${res.status} on "${q}"`, fetched }); return leads; }
    const data = (await res.json()) as { hits: Array<Record<string, unknown>> };
    fetched += data.hits.length;
    for (const h of data.hits) {
      const id = String(h.objectID);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const isComment = (h._tags as string[]).includes('comment');
      const title = String(h.title ?? h.story_title ?? '');
      const body = String(h.comment_text ?? h.story_text ?? '');
      const text = `${title} ${body} ${String(h.url ?? '')}`;
      const points = Number(h.points ?? 0);
      const comments = Number(h.num_comments ?? 0);
      const lead = build(
        {
          kind: COMPETITOR_TERMS.some((c) => text.toLowerCase().includes(c)) ? 'competitor' : 'thread',
          source: 'hn',
          sourceLabel: isComment ? 'HN comment' : 'HN story',
          url: `https://news.ycombinator.com/item?id=${id}`,
          title: title || '(comment)',
          summary: oneLine(body || String(h.url ?? '')),
          author: String(h.author ?? ''),
          createdAt: new Date(String(h.created_at)),
          engagement: isComment ? `in "${oneLine(String(h.story_title ?? ''), 60)}"` : `${points} pts · ${comments} comments`,
        },
        text,
        now,
        Math.min(Math.floor((points + comments) / 10), 3),
      );
      if (lead) leads.push(lead);
    }
  }
  report.push({ source: 'hn', ok: true, note: `${HN_QUERIES.length} queries`, fetched });
  return leads;
}

// Reddit blocks most non-browser clients on the JSON endpoint (403) and
// rate-limits the RSS one aggressively (429). Try JSON, fall back to RSS, and
// if both fail skip the source and say so in the digest — never hammer it.
async function reddit(sinceMs: number, now: number, report: Report[]): Promise<Lead[]> {
  const leads: Lead[] = [];
  const subs = REDDIT_SUBREDDITS.join('+');
  let fetched = 0;
  let failures = 0;
  for (const q of REDDIT_QUERIES) {
    const params = new URLSearchParams({ q, restrict_sr: '1', sort: 'new', t: 'month', limit: '25' });
    const base = `https://www.reddit.com/r/${subs}/search`;
    const headers = { 'User-Agent': REDDIT_USER_AGENT, Accept: 'application/json, application/atom+xml;q=0.9, */*;q=0.5' };
    let items: Array<{ url: string; title: string; body: string; author: string; createdAt: Date; sub: string; engagement: string }> = [];
    const jsonRes = await get(`${base}.json?${params}`, { headers, minGapMs: 10_000, retries: 0 });
    if (jsonRes.ok) {
      const data = (await jsonRes.json()) as { data: { children: Array<{ data: Record<string, unknown> }> } };
      items = data.data.children.map(({ data: d }) => ({
        url: `https://www.reddit.com${d.permalink}`,
        title: String(d.title ?? ''),
        body: String(d.selftext ?? ''),
        author: String(d.author ?? ''),
        createdAt: new Date(Number(d.created_utc) * 1000),
        sub: String(d.subreddit ?? ''),
        engagement: `${d.score} pts · ${d.num_comments} comments`,
      }));
    } else {
      const rssRes = await get(`${base}.rss?${params}`, { headers, minGapMs: 10_000, retries: 2 });
      if (!rssRes.ok) { failures++; continue; }
      items = parseFeed(await rssRes.text()).map((e) => ({
        url: e.link,
        title: e.title,
        body: e.content,
        author: e.author.replace(/^\/u\//, ''),
        createdAt: e.date,
        sub: e.category,
        engagement: 'via RSS (no vote counts)',
      }));
    }
    fetched += items.length;
    for (const it of items) {
      if (it.createdAt.getTime() < sinceMs) continue;
      const text = `${it.title} ${it.body}`;
      const lead = build(
        {
          kind: COMPETITOR_TERMS.some((c) => text.toLowerCase().includes(c)) ? 'competitor' : 'thread',
          source: 'reddit',
          sourceLabel: `r/${it.sub}`,
          url: it.url,
          title: it.title,
          summary: oneLine(it.body),
          author: it.author,
          createdAt: it.createdAt,
          engagement: it.engagement,
        },
        text,
        now,
      );
      if (lead) leads.push(lead);
    }
  }
  report.push({
    source: 'reddit',
    ok: failures < REDDIT_QUERIES.length,
    note: failures ? `${failures}/${REDDIT_QUERIES.length} queries refused (403/429) — Reddit throttles this client; partial results` : `${REDDIT_QUERIES.length} queries`,
    fetched,
  });
  return leads;
}

async function github(sinceMs: number, now: number, state: State, report: Report[]): Promise<{ leads: Lead[]; competitors: string[] }> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Unauthenticated search is 10 req/min — space the searches out.
  const searchGap = token ? 2500 : 7000;
  const since = new Date(sinceMs).toISOString().slice(0, 10);
  const leads: Lead[] = [];
  const seen = new Set<string>();
  let fetched = 0;

  const queries = [
    `${GITHUB_GMAIL_MCP_REPOS.map((r) => `repo:${r}`).join(' ')} is:issue created:>${since}`,
    ...GITHUB_ISSUE_QUERIES.map((q) => `${q} created:>${since}`),
  ];
  for (const q of queries) {
    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'created');
    url.searchParams.set('per_page', '30');
    const res = await get(url.toString(), { headers, minGapMs: searchGap, retries: 1 });
    if (!res.ok) { report.push({ source: 'github', ok: false, note: `HTTP ${res.status} on search (${token ? 'token' : 'unauthenticated'})`, fetched }); break; }
    const data = (await res.json()) as { items: Array<Record<string, unknown>> };
    fetched += data.items.length;
    for (const it of data.items) {
      const url = String(it.html_url);
      if (seen.has(url)) continue;
      seen.add(url);
      const repo = url.split('/').slice(3, 5).join('/');
      const title = String(it.title ?? '');
      const body = String(it.body ?? '');
      const login = String((it.user as { login?: string } | undefined)?.login ?? '');
      const known = GITHUB_GMAIL_MCP_REPOS.includes(repo);
      if (!known) {
        // Long-tail hits are dominated by people's own planning issues whose
        // bodies mention gmail/oauth in passing. A prospect is someone filing
        // on a Gmail/Workspace server they use — not its owner — and the
        // mailbox has to be the subject (title or repo name), not a footnote.
        const owner = repo.split('/')[0].toLowerCase();
        if (/\[bot\]$|-bot$/i.test(login) || login.toLowerCase() === owner) continue;
        const subject = `${repo} ${title}`.toLowerCase();
        if (!/gmail|e-?mail|inbox|mail|google.?workspace|workspace.?mcp/.test(subject)) continue;
      }
      const text = `${repo} ${title} ${body}`;
      const lead = build(
        {
          kind: 'prospect',
          source: 'github',
          sourceLabel: repo,
          url,
          title,
          summary: oneLine(body, 160),
          author: login,
          createdAt: new Date(String(it.created_at)),
          engagement: `${it.comments} comments`,
        },
        text,
        now,
        // Issues on the known Gmail MCP servers are on-target by construction.
        known ? 2 : 0,
      );
      if (lead) leads.push(lead);
    }
  }

  // Competitor star deltas (core API: 60/h unauthenticated — six calls).
  const competitors: string[] = [];
  for (const repo of COMPETITOR_REPOS) {
    const res = await get(`https://api.github.com/repos/${repo}`, { headers, minGapMs: 1200, retries: 0 });
    if (!res.ok) { competitors.push(`- ${repo}: HTTP ${res.status}`); continue; }
    const d = (await res.json()) as { stargazers_count: number; open_issues_count: number; pushed_at: string };
    const prev = state.stars[repo];
    const delta = prev ? d.stargazers_count - prev.count : null;
    const deltaStr = delta === null ? 'first observation' : `${delta >= 0 ? '+' : ''}${delta} since ${prev!.at.slice(0, 10)}`;
    competitors.push(`- [${repo}](https://github.com/${repo}) — ${d.stargazers_count} ★ (${deltaStr}), ${d.open_issues_count} open issues, last push ${d.pushed_at.slice(0, 10)}`);
    if (!DRY_RUN) state.stars[repo] = { count: d.stargazers_count, at: new Date(now).toISOString() };
  }
  if (!report.some((r) => r.source === 'github')) {
    report.push({ source: 'github', ok: true, note: `${queries.length} searches, ${COMPETITOR_REPOS.length} repos (${token ? 'GITHUB_TOKEN' : 'unauthenticated'})`, fetched });
  }
  return { leads, competitors };
}

type FeedEntry = { title: string; link: string; content: string; author: string; date: Date; category: string };

// Minimal Atom/RSS reader — enough for the feeds above, no dependency.
function parseFeed(xml: string): FeedEntry[] {
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>|<item[\s>][\s\S]*?<\/item>/g) ?? [];
  const tag = (b: string, name: string): string => {
    const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(b);
    return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim() : '';
  };
  return blocks.map((b) => {
    const atomLink = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? /<link[^>]*href="([^"]+)"/i.exec(b)?.[1];
    const link = atomLink ?? tag(b, 'link') ?? tag(b, 'guid');
    const date = tag(b, 'published') || tag(b, 'updated') || tag(b, 'pubDate') || tag(b, 'dc:date');
    return {
      title: strip(tag(b, 'title')),
      link: strip(link),
      content: tag(b, 'content') || tag(b, 'summary') || tag(b, 'description') || tag(b, 'content:encoded'),
      author: strip(tag(b, 'name') || tag(b, 'author') || tag(b, 'dc:creator')),
      date: new Date(date),
      category: /<category[^>]*term="([^"]+)"/i.exec(b)?.[1] ?? strip(tag(b, 'category')),
    };
  });
}

async function feeds(sinceMs: number, now: number, report: Report[]): Promise<Lead[]> {
  const leads: Lead[] = [];
  let fetched = 0;
  const failed: string[] = [];
  for (const f of FEEDS) {
    const res = await get(f.url, { minGapMs: 1000 });
    if (!res.ok) { failed.push(`${f.name} (HTTP ${res.status})`); continue; }
    const entries = parseFeed(await res.text());
    fetched += entries.length;
    for (const e of entries) {
      if (Number.isNaN(e.date.getTime()) || e.date.getTime() < sinceMs || !e.link) continue;
      const text = `${e.title} ${e.content}`;
      const lead = build(
        {
          kind: f.incident || /exfiltrat|prompt injection|lethal trifecta|deleted|data leak|hijack/i.test(text) ? 'incident' : 'thread',
          source: 'feed',
          sourceLabel: f.name,
          url: e.link,
          title: e.title,
          summary: oneLine(e.content),
          author: e.author,
          createdAt: e.date,
          engagement: '',
        },
        text,
        now,
      );
      if (lead) leads.push(lead);
    }
  }
  report.push({ source: 'feeds', ok: failed.length < FEEDS.length, note: failed.length ? `failed: ${failed.join(', ')}` : `${FEEDS.length} feeds`, fetched });
  return leads;
}

// ─── digest ──────────────────────────────────────────────────────────────────

function fmtLead(l: Lead): string {
  const who = l.author ? ` · ${l.author}` : '';
  const eng = l.engagement ? ` · ${l.engagement}` : '';
  const terms = [...l.terms.pain, ...l.terms.competitor].slice(0, 4).join(', ');
  return [
    `- **[${l.title || l.url}](${l.url})** — ${l.sourceLabel}${who} · ${l.createdAt.toISOString().slice(0, 10)}${eng} · score ${l.score}${terms ? ` · _${terms}_` : ''}`,
    l.summary ? `  - ${l.summary}` : '',
    `  - **Angle:** ${angle(l)}`,
    `  - **Link to use:** ${attribution(l)}`,
  ].filter(Boolean).join('\n');
}

function section(title: string, items: Lead[], empty: string): string {
  const body = items.length ? items.map(fmtLead).join('\n') : `_${empty}_`;
  return `## ${title}\n\n${body}\n`;
}

async function main() {
  const now = Date.now();
  const state = loadState();
  const explicit = parseWindow(flag('window'));
  // Default: since the last run, but at least 2 days (thread half-life on HN
  // and Reddit is ~48h, so anything older is rarely worth a reply) and at
  // most 7 (first run / long gap).
  const sinceLast = state.lastRunAt ? now - new Date(state.lastRunAt).getTime() : 7 * DAY;
  const windowMs = explicit ?? Math.min(Math.max(sinceLast, 2 * DAY), 7 * DAY);
  const sinceMs = now - windowMs;
  const today = new Date(now).toISOString().slice(0, 10);

  console.error(`growth-prospects: window ${(windowMs / DAY).toFixed(1)}d (since ${new Date(sinceMs).toISOString()}), sources ${[...SOURCES].join(',')}${DRY_RUN ? ', DRY RUN' : ''}`);

  const report: Report[] = [];
  const all: Lead[] = [];
  let competitors: string[] = [];
  const run = async (name: string, fn: () => Promise<Lead[]>) => {
    if (!SOURCES.has(name)) return;
    try {
      all.push(...(await fn()));
    } catch (e) {
      report.push({ source: name, ok: false, note: `error: ${(e as Error).message}`, fetched: 0 });
    }
  };
  await run('feeds', () => feeds(sinceMs, now, report));
  await run('hn', () => hackerNews(sinceMs, now, report));
  await run('github', async () => { const r = await github(sinceMs, now, state, report); competitors = r.competitors; return r.leads; });
  await run('reddit', () => reddit(sinceMs, now, report));

  // Dedupe: within this run (same URL from two queries) and against history.
  const byUrl = new Map<string, Lead>();
  for (const l of all) {
    const key = l.url.replace(/#.*$/, '').replace(/\/$/, '');
    if (state.seen[key]) continue;
    const prev = byUrl.get(key);
    if (!prev || l.score > prev.score) byUrl.set(key, { ...l, url: key });
  }
  const fresh = [...byUrl.values()].sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime());
  const MIN_SCORE = 9;
  const kept = fresh.filter((l) => l.kind === 'incident' || l.score >= MIN_SCORE);
  const dropped = fresh.length - kept.length;

  const incidents = kept.filter((l) => l.kind === 'incident');
  const threads = kept.filter((l) => l.kind === 'thread');
  const prospects = kept.filter((l) => l.kind === 'prospect');
  const compLeads = kept.filter((l) => l.kind === 'competitor');

  const lines = [
    `# Growth prospects — ${today}`,
    '',
    `Window: ${new Date(sinceMs).toISOString().slice(0, 16)}Z → ${new Date(now).toISOString().slice(0, 16)}Z · ${kept.length} new lead(s), ${dropped} below threshold, ${Object.keys(state.seen).length} previously surfaced.`,
    '',
    incidents.length
      ? `> **INCIDENT — write the teardown this week.** ${incidents.length} new item(s) below.`
      : '> No new incidents in the security feeds.',
    '',
    '**Reply rules:** participate first, disclose affiliation, one FGAC mention max, never the same text twice. The link column is the attribution link to paste; nothing here is posted automatically.',
    '',
    section('Incidents', incidents, 'none'),
    section('Reply-worthy threads', threads, 'nothing new above threshold'),
    section('Prospects on GitHub', prospects, 'no new matching issues'),
    `## Competitor movement\n\n${[...compLeads.map(fmtLead), ...competitors].join('\n') || '_no data (github source skipped)_'}\n`,
    '## Sources',
    '',
    ...report.map((r) => `- ${r.ok ? '✓' : '✗'} ${r.source}: ${r.note} (${r.fetched} items fetched)`),
    '',
  ];
  const digest = lines.join('\n');

  mkdirSync(DIGEST_DIR, { recursive: true });
  let outPath = join(DIGEST_DIR, `${today}.md`);
  if (existsSync(outPath)) outPath = join(DIGEST_DIR, `${today}-${new Date(now).toISOString().slice(11, 16).replace(':', '')}.md`);
  writeFileSync(outPath, digest);

  if (!DRY_RUN) {
    for (const l of kept) state.seen[l.url] = { firstSeen: today, source: l.source };
    state.lastRunAt = new Date(now).toISOString();
    saveState(state);
  }

  if (PRINT) console.log(digest);
  console.error(`growth-prospects: wrote ${outPath} — ${incidents.length} incident(s), ${threads.length} thread(s), ${prospects.length} prospect(s), ${compLeads.length} competitor mention(s)`);
  for (const r of report.filter((r) => !r.ok)) console.error(`growth-prospects: source ${r.source} degraded — ${r.note}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
