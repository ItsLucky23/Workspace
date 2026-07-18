/** @docs owner ItsLucky23 */
//? DESIGN_DOCS_PROGRAM 3.5 — web DISCOVERY of design-reference sites. From a plain-language brief the
//? designer FINDS candidate sites to capture (previously the user had to already have a URL). Discovery uses
//? a static-fetchable search endpoint (DuckDuckGo's html endpoint returns result links with NO JS), following
//? the established scraper egress pattern (AbortController timeout + withRetry + protocol/size guards). The
//? found URLs are then captured with the existing chromium container (captureUrlScreenshot) + vision-extracted.
//?
//? SWAP SEAM: a headless-browser backend (Playwright/chromium driving a search page) can replace `fetchSearch`
//? without touching callers — kept behind this one function so discovery stays swappable (owner chose a
//? browser backend; the puppeteer-in-container path is unreliable on this host, so the static endpoint is the
//? working default until a browser backend is wired).

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { withRetry } from '../util/retry';

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

//? Fetch the search results HTML (the swappable step). Static endpoint → plain fetch, guarded like the scraper.
async function fetchSearch(query: string): Promise<string | null> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, SEARCH_TIMEOUT_MS);
  const [err, html] = await tryCatch(async () => {
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src -- server-side external egress (design discovery), guarded + capped
    const res = await withRetry(() => fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; WorkspacesBot/1.0)' } }));
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, MAX_HTML);
  });
  clearTimeout(timer);
  return err ? null : (html ?? null);
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

//? Discover up to `limit` candidate reference sites for a design brief. Returns [] on any failure (never throws).
export async function discoverReferenceSites(query: string, limit = 6): Promise<DiscoveredSite[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const html = await fetchSearch(q);
  if (!html) return [];
  return parseSearchResults(html, limit);
}
