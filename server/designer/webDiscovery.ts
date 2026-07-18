/** @docs owner ItsLucky23 */
//? DESIGN_DOCS_PROGRAM 3.5 — web DISCOVERY of design-reference sites. From a plain-language brief the
//? designer FINDS candidate sites to capture (previously the user had to already have a URL). Discovery uses
//? a static-fetchable search endpoint (DuckDuckGo's html endpoint returns result links with NO JS), through
//? the central DNS-pinned outbound policy (per-hop validation + timeout/size caps). Candidate URLs are returned
//? for research; remote Chromium capture stays fail-closed until isolated filtered browser egress exists.
//?
//? SWAP SEAM: a headless-browser backend (Playwright/chromium driving a search page) can replace `fetchSearch`
//? without touching callers — kept behind this one function so discovery stays swappable (owner chose a
//? browser backend; the puppeteer-in-container path is unreliable on this host, so the static endpoint is the
//? working default until a browser backend is wired).

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { runAiCompletion } from '../ai/registry';
import { safeHttpRequest, type SafeHttpDependencies } from '../security/safeHttp';

export interface DiscoveredSite { url: string; title: string }

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_HTML = 300_000;

//? Decode DuckDuckGo's `/l/?uddg=<encoded>` redirect wrapper to the real destination URL.
function resolveDdgHref(href: string): string | null {
  let h = href;
  if (h.startsWith('//')) h = `https:${h}`;
  const [, uddg] = /[?&]uddg=([^&]+)/.exec(h) ?? [];
  if (uddg) { const [err, dec] = tryCatchSync(() => decodeURIComponent(uddg)); return err ? null : dec; }
  return /^https?:\/\//.test(h) ? h : null;
}

//? The hostname of a URL, or null if it doesn't parse.
function hostOf(url: string): string | null {
  const [err, u] = tryCatchSync(() => new URL(url));
  return err || u === null ? null : u.hostname.replace(/^www\./, '');
}

//? Fetch the search results HTML (the swappable step) through the central DNS-pinned policy.
export async function fetchSearch(query: string, dependencies: SafeHttpDependencies = {}): Promise<string | null> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const result = await safeHttpRequest(url, {
    ...dependencies,
    allowInsecureHttp: true,
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; WorkspacesBot/1.0)' },
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxRedirects: 3,
    maxResponseBytes: MAX_HTML,
  });
  if (!result.ok || result.response.status < 200 || result.response.status >= 300) return null;
  return result.response.body.toString('utf8');
}

//? Parse the search-results HTML into de-duped candidate sites (pure + exported for tests — no network).
//? DDG html results: <a ... class="result__a" href="...">Title</a>; drops the engine's own + dup hosts.
export function parseSearchResults(html: string, limit = 6): DiscoveredSite[] {
  const out: DiscoveredSite[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null && out.length < limit) {
    const dest = resolveDdgHref(m[1] ?? '');
    const host = dest ? hostOf(dest) : null;
    if (dest && host && host.length > 0 && !host.includes('duckduckgo.com') && !seen.has(host)) {
      seen.add(host);
      const title = (m[2] ?? '').replaceAll(/<[^>]+>/g, '').replaceAll(/\s+/g, ' ').trim().slice(0, 120) || host;
      out.push({ url: dest, title });
    }
    m = re.exec(html);
  }
  return out;
}

//? Parse the AI's suggested sites (one "url — title" per line, or a JSON array) into candidates. Pure + exported.
export function parseAiSites(text: string, limit = 6): DiscoveredSite[] {
  const out: DiscoveredSite[] = [];
  const seen = new Set<string>();
  //? Accept both a JSON array of {url,title} and plain "https://… — Title" lines.
  const [, arr] = tryCatchSync(() => { const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text); const s = fenced?.[1] ?? text; const j = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)) as unknown; return Array.isArray(j) ? j : null; });
  const push = (rawUrl: string, rawTitle: string): void => {
    const url = rawUrl.trim();
    if (!/^https?:\/\//.test(url)) return;
    const host = hostOf(url);
    if (!host || host.length === 0 || seen.has(host) || out.length >= limit) return;
    seen.add(host);
    out.push({ url, title: rawTitle.trim().slice(0, 120) || host });
  };
  if (Array.isArray(arr)) {
    for (const it of arr) { if (it && typeof it === 'object') { const r = it as Record<string, unknown>; if (typeof r.url === 'string') push(r.url, typeof r.title === 'string' ? r.title : ''); } }
  }
  if (out.length === 0) {
    for (const line of text.split('\n')) {
      const m = /(https?:\/\/[^\s)]+)(?:\s*[—:-]\s*(.*))?/.exec(line.trim());
      if (m) push(m[1] ?? '', m[2] ?? '');
    }
  }
  return out;
}

//? AI-backed discovery (the reliable default): the model suggests real, well-designed reference sites for the
//? brief. Uses the pluggable AI layer (feature `scraper`), so the backend is a per-workspace config choice.
async function discoverViaAi(query: string, workspaceId: string | undefined, limit: number): Promise<DiscoveredSite[]> {
  const system = 'You are a design researcher. Given a design brief, suggest real, existing, well-designed websites/products that exemplify it (their PUBLIC marketing/app pages). Output ONLY a JSON array of objects {"url": string (a real https URL), "title": string (site name + why it fits, short)}. No prose. Prefer distinct hosts.';
  const prompt = `Design brief: "${query}"\n\nSuggest ${String(limit)} reference sites as a JSON array.`;
  const [err, res] = await tryCatch(() => runAiCompletion('scraper', { prompt, system, timeoutMs: 60_000, ...(workspaceId ? { workspaceId, label: `Design discovery · ${query.slice(0, 40)}` } : {}) }));
  if (err || !res?.ok) return [];
  return parseAiSites(res.text, limit);
}

//? Discover up to `limit` candidate reference sites for a design brief. Primary path = AI suggestion (reliable,
//? uses the working provider layer); falls back to the static search-endpoint scrape. Returns [] on failure.
export async function discoverReferenceSites(query: string, limit = 6, workspaceId?: string, dependencies: SafeHttpDependencies = {}): Promise<DiscoveredSite[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const viaAi = await discoverViaAi(q, workspaceId, limit);
  if (viaAi.length > 0) return viaAi;
  const html = await fetchSearch(q, dependencies);
  return html ? parseSearchResults(html, limit) : [];
}
