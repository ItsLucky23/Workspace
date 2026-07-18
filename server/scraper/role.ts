//? Web-scraper ⇄ AgentRole bridge (Marketing "reach"). Registers a schedulable `scraper` role so a
//? cron WorkspaceTrigger can fetch a configured page and extract the useful bits (what it's about,
//? offerings, lead/contact signals) for outreach — surfaced as a notification via the executor.
//? Non-coding, `mutates:false` (propose-only). A GUARDED fetch: http(s) only, timeout, size-capped,
//? never throws (never breaks the trigger pipeline). Call `registerScraperRole()` once at boot.

import { getPrismaClient } from '@luckystack/core';

import { registerAgentRole } from '../automation/agentRoles';
import { runAiCompletion } from '../ai/registry';
import { recordWatchSnapshot, pruneWatchSnapshots } from './watch';
import { safeHttpRequest, type SafeHttpDependencies } from '../security/safeHttp';
import { renderUntrustedContext, UNTRUSTED_CONTEXT_POLICY } from '../ai/untrustedContext';

//? Naive HTML → text (drops script/style + tags, collapses whitespace). Good enough for a summary.
function stripHtml(html: string): string {
  return html
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

//? Fetch a page's text through the central DNS-pinned policy. Returns null on an unsafe target or
//? redirect hop, timeout, oversized body or non-2xx response (never throws).
export async function fetchPageText(url: string, dependencies: SafeHttpDependencies = {}): Promise<string | null> {
  const result = await safeHttpRequest(url, {
    ...dependencies,
    allowInsecureHttp: true,
    timeoutMs: 15_000,
    maxRedirects: 4,
    maxResponseBytes: 200_000,
  });
  if (!result.ok || result.response.status < 200 || result.response.status >= 300) return null;
  return stripHtml(result.response.body.toString('utf8')).slice(0, 8000);
}

export function buildScraperPrompt(url: string, text: string): string {
  return [
    renderUntrustedContext({ provenance: `external web page: ${url}`, content: text, maxChars: 8000 }),
    UNTRUSTED_CONTEXT_POLICY,
    'AUTHORITATIVE TASK: Summarise the reference page for outreach. Extract what the page/company is about, its key offerings, and any contact or lead signals.',
  ].join('\n\n');
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
      //? GAP_SCAN G8 — WATCH mode (`params.watch: true`): store a snapshot and report the DELTA since the
      //? last check instead of re-summarising the whole page every run. That is what makes a scheduled
      //? competitor watch worth reading — an unchanged page produces a one-line "no change", not noise.
      if (ctx.params.watch === true) {
        const outcome = await recordWatchSnapshot(getPrismaClient(), ctx.workspaceId, url, text);
        await pruneWatchSnapshots(getPrismaClient(), ctx.workspaceId, url);
        return { kind: 'scrape-result', title: outcome.changed ? `Changed: ${url}` : `Watched ${url}`, body: outcome.summary };
      }
      const res = await runAiCompletion('scraper', {
        system: 'You extract the most useful facts from a web page for outreach + marketing: what the page/company is about, its key offerings, and any contact or lead signals. Output a short markdown summary — no preamble.',
        prompt: buildScraperPrompt(url, text),
        workspaceId: ctx.workspaceId, label: `Scrape · ${url.slice(0, 40)}`, timeoutMs: 120_000,
      });
      return { kind: 'scrape-result', title: `Scraped ${url}`, body: res.ok && res.text.trim().length > 0 ? res.text.trim() : 'Could not summarise the page this run.' };
    },
  });
}
