//? GAP_SCAN F3 — the SEO layer: title / description / tag suggestions for a post, GROUNDED in the metrics
//? this workspace already ingests.
//?
//? The publish metrics were a dead end: they fed the ideator's "recent winners" line and nothing else.
//? Yet the single highest-leverage lever on a short-form post is its title + thumbnail, and the workspace
//? already knows which of ITS OWN titles earned views. So this scores a proposed title against the local
//? evidence (not generic SEO folklore) and asks the provider for alternatives grounded in the same data.
//?
//? Deterministic scoring lives here (pure, testable); only the rewrite suggestions go through the provider.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { runAiCompletion } from '../ai/registry';
import { renderUntrustedContext, UNTRUSTED_CONTEXT_POLICY } from '../ai/untrustedContext';

export interface TitleScore {
  score: number;                 // 0-100, deterministic
  issues: string[];              // what to fix, in priority order
  lengthOk: boolean;
}

//? Platform title limits that actually bite: YouTube truncates in search around 60 chars, TikTok captions
//? are short and the first ~40 chars are what a scroller reads.
const TITLE_LIMIT: Record<string, number> = { youtube: 60, tiktok: 40 };

const FILLER = new Set(['the', 'a', 'an', 'this', 'that', 'my', 'our', 'very', 'really', 'just', 'stuff', 'things', 'video']);

//? Score a title deterministically: length against the platform's real cut-off, whether it opens with
//? substance rather than filler, whether it carries a concrete hook (number/question/"how"), and whether it
//? shouts. Every deduction names its reason so the UI can show WHY, not just a number.
export function scoreTitle(title: string, platform = 'youtube'): TitleScore {
  const trimmed = title.trim();
  const issues: string[] = [];
  let score = 100;

  const limit = TITLE_LIMIT[platform] ?? 60;
  const lengthOk = trimmed.length > 0 && trimmed.length <= limit;
  if (trimmed.length === 0) { return { score: 0, issues: ['seo.empty'], lengthOk: false }; }
  if (trimmed.length > limit) { score -= 25; issues.push('seo.tooLong'); }
  if (trimmed.length < 15) { score -= 15; issues.push('seo.tooShort'); }

  const words = trimmed.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const firstWord = words[0] ?? '';
  if (FILLER.has(firstWord)) { score -= 10; issues.push('seo.weakOpener'); }

  const hasHook = /\d/.test(trimmed) || trimmed.includes('?') || /^(how|why|what|when)\b/i.test(trimmed);
  if (!hasHook) { score -= 15; issues.push('seo.noHook'); }

  //? ALL CAPS reads as spam to both humans and ranking systems (measured on the letters only, so "3 TIPS"
  //? is not punished for its digits).
  const letters = trimmed.replaceAll(/[^a-zA-Z]/g, '');
  if (letters.length > 8 && letters === letters.toUpperCase()) { score -= 20; issues.push('seo.shouting'); }

  const unique = new Set(words);
  if (words.length > 4 && unique.size < words.length - 1) { score -= 10; issues.push('seo.repetitive'); }

  return { score: Math.max(0, score), issues, lengthOk };
}

//? Tags/keywords from a title: content words only, de-duped, bounded. A deliberately boring baseline the
//? AI suggestion can improve on — but one that always works, with no key and no spend.
export function deriveTags(title: string, max = 8): string[] {
  const words = title.toLowerCase().replaceAll(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !FILLER.has(w));
  return [...new Set(words)].slice(0, max);
}

export interface SeoEvidence { title: string; views: number }

//? The local evidence line: what THIS channel's best and worst titles actually earned. This is the whole
//? reason the suggestions are worth anything — generic SEO advice is free everywhere else.
export function evidenceBlock(rows: SeoEvidence[]): string {
  const ranked = rows.filter((r) => r.views > 0).toSorted((a, b) => b.views - a.views);
  if (ranked.length === 0) return '';
  const best = ranked.slice(0, 5).map((r) => `- ${String(r.views)} views: ${r.title}`);
  const worst = ranked.slice(-3).toReversed().map((r) => `- ${String(r.views)} views: ${r.title}`);
  return [`BEST PERFORMING titles on this account:`, ...best, '', 'WEAKEST performing titles:', ...worst].join('\n');
}

export interface SeoSuggestion { titles: string[]; description: string; tags: string[] }

//? Parse the model's answer. Tolerant by design: a missing section degrades to the deterministic baseline
//? rather than failing the whole suggestion.
export function parseSeoSuggestion(text: string, fallbackTags: string[]): SeoSuggestion {
  const titles: string[] = [];
  let description = '';
  let tags: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const title = /^TITLE:\s*(.+)$/i.exec(line);
    if (title?.[1]) { titles.push(title[1].trim().slice(0, 120)); continue; }
    const desc = /^DESCRIPTION:\s*(.+)$/i.exec(line);
    if (desc?.[1] && description.length === 0) { description = desc[1].trim().slice(0, 600); continue; }
    const tagLine = /^TAGS:\s*(.+)$/i.exec(line);
    if (tagLine?.[1] && tags.length === 0) tags = tagLine[1].split(',').map((t) => t.trim().replace(/^#/, '')).filter((t) => t.length > 0).slice(0, 12);
  }
  return { titles: titles.slice(0, 3), description, tags: tags.length > 0 ? tags : fallbackTags };
}

//? Suggest SEO improvements for one piece. Reads the workspace's own published titles + their view counts
//? as evidence, scores the current title deterministically, and asks the provider for alternatives.
export async function suggestSeo(
  prisma: PrismaClient, workspaceId: string, input: { title: string; platform?: string; description?: string },
): Promise<{ ok: boolean; score: TitleScore; suggestion: SeoSuggestion; error?: string }> {
  const platform = input.platform ?? 'youtube';
  const score = scoreTitle(input.title, platform);
  const baseline: SeoSuggestion = { titles: [], description: input.description ?? '', tags: deriveTags(input.title) };

  const [, evidence] = await tryCatch(async () => {
    const jobs = await prisma.publishJob.findMany({ where: { workspaceId, status: 'done', metrics: { not: null } }, select: { contentProjectId: true, metrics: true }, take: 50 });
    if (jobs.length === 0) return [] as SeoEvidence[];
    const pieces = await prisma.contentProject.findMany({ where: { workspaceId, id: { in: jobs.map((j) => j.contentProjectId) } }, select: { id: true, title: true } });
    const titleById = new Map(pieces.map((p) => [p.id, p.title]));
    return jobs.map((j) => {
      const m = j.metrics !== null && typeof j.metrics === 'object' && !Array.isArray(j.metrics) ? j.metrics as Record<string, unknown> : {};
      return { title: titleById.get(j.contentProjectId) ?? '', views: typeof m.views === 'number' ? m.views : 0 };
    }).filter((r) => r.title.length > 0);
  });

  const evidenceText = evidenceBlock(evidence ?? []);
  const system = [
    `You optimise short-form video metadata for ${platform}.`,
    `Hard limit: titles must be at most ${String(TITLE_LIMIT[platform] ?? 60)} characters.`,
    'Answer in EXACTLY this shape, nothing else:',
    'TITLE: <alternative 1>',
    'TITLE: <alternative 2>',
    'TITLE: <alternative 3>',
    'DESCRIPTION: <one short paragraph>',
    'TAGS: <comma-separated, no #>',
    evidenceText.length > 0 ? `\nEvidence from THIS account (weigh it above generic SEO advice):\n${renderUntrustedContext({ provenance: 'this workspace\'s own published titles + view counts', content: evidenceText, maxChars: 2000 })}` : '',
    evidenceText.length > 0 ? UNTRUSTED_CONTEXT_POLICY : '',
  ].filter((l) => l.length > 0).join('\n');

  const prompt = [
    `CURRENT TITLE: ${input.title}`,
    input.description ? `CURRENT DESCRIPTION: ${input.description}` : '',
    score.issues.length > 0 ? `KNOWN WEAKNESSES: ${score.issues.join(', ')}` : '',
  ].filter((l) => l.length > 0).join('\n');

  const [err, res] = await tryCatch(() => runAiCompletion('script', { prompt, system, workspaceId, label: 'SEO suggestions' }));
  if (err || !res?.ok || res.text.trim().length === 0) return { ok: false, score, suggestion: baseline, error: err?.message ?? res?.error ?? 'ai.failed' };
  return { ok: true, score, suggestion: parseSeoSuggestion(res.text, baseline.tags) };
}
