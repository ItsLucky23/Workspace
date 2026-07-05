//? Web-scraper ⇄ AgentRole bridge (Marketing "reach"). Registers a schedulable `scraper` role so a
//? cron WorkspaceTrigger can fetch a configured page and extract the useful bits (what it's about,
//? offerings, lead/contact signals) for outreach — surfaced as a notification via the executor.
//? Non-coding, `mutates:false` (propose-only). A GUARDED fetch: http(s) only, timeout, size-capped,
//? never throws (never breaks the trigger pipeline). Call `registerScraperRole()` once at boot.

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';

//? Naive HTML → text (drops script/style + tags, collapses whitespace). Good enough for a summary.
function stripHtml(html: string): string {
  return html
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

//? Fetch a page's text, guarded. Returns null on anything unsafe/unreachable (never throws).
export async function fetchPageText(url: string): Promise<string | null> {
  const [urlErr, u] = tryCatchSync(() => new URL(url));
  if (urlErr || !u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => { ctrl.abort(); }, 15_000);
  const [err, res] = await tryCatch(() => fetch(url, { signal: ctrl.signal, redirect: 'follow' }));
  clearTimeout(timer);
  if (err || !res?.ok) return null;
  const [textErr, html] = await tryCatch(() => res.text());
  if (textErr || html === null) return null;
  return stripHtml(html.slice(0, 200_000)).slice(0, 8000);
}

export function registerScraperRole(): void {
  registerAgentRole({
    key: 'scraper',
    label: 'Web scraper',
    description: 'Fetches a web page and extracts key info / leads for outreach (schedulable).',
    mutates: false,
    run: async (ctx) => {
      const url = typeof ctx.params.url === 'string' ? ctx.params.url : '';
      if (!url) return { kind: 'scrape-result', title: 'Web scraper', body: 'No URL configured for this task (set params.url).' };
      const text = await fetchPageText(url);
      if (!text) return { kind: 'scrape-result', title: 'Web scraper', body: `Could not fetch ${url} — only reachable http(s) pages are scraped.` };
      const res = await runAiCompletion('scraper', {
        system: 'You extract the most useful facts from a web page for outreach + marketing: what the page/company is about, its key offerings, and any contact or lead signals. Output a short markdown summary — no preamble.',
        prompt: `Summarise this page for outreach (source: ${url}):\n\n${text}`,
        workspaceId: ctx.workspaceId, label: `Scrape · ${url.slice(0, 40)}`, timeoutMs: 120_000,
      });
      return { kind: 'scrape-result', title: `Scraped ${url}`, body: res.ok && res.text.trim().length > 0 ? res.text.trim() : 'Could not summarise the page this run.' };
    },
  });
}
