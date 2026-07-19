//? SK1/SK2 (DOCUMENTS_AND_SKILLS) — the universal SKILLS layer. A Skill is a workspace-scoped,
//? reusable instruction block (humanizer, tone-of-voice, SEO, brand voice, jargon translator, or
//? user-authored) injected into AI runs at its APPLY-POINTS. One resolver (`skillPromptBlock`) feeds
//? the single completion choke-point in registry.ts (every one-shot feature) AND the PTY stage-runner
//? (as a contextDoc), so a skill steers EVERY AI surface without per-feature wiring. Skills are
//? OFF by default (consent-first); `builtin` seeds are editable + resettable, never deletable.
//? ADR-0015 boundary: the humanizer improves human tone — it never evades AI-detection/disclosure.
//? @adr 0270

import { getPrismaClient, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import type { AiFeature } from './types';
import { deterministicObjectId } from '../orchestrator/actionIds';

//? The user-facing apply-point GROUPS a skill targets — canonical list lives in _data/types.ts (one
//? source, client + server; same pattern as uiReviewTaxonomy). 'all' (or an empty list) = every AI run.
export { AI_SKILL_APPLY_POINTS as SKILL_APPLY_POINTS, type AiSkillApplyPoint as SkillApplyPoint } from '../../src/workspaces/_data/types';
import type { AiSkillApplyPoint as SkillApplyPoint } from '../../src/workspaces/_data/types';

//? Every AiFeature maps to exactly one group — add a feature = add one row here (the type errors until you do).
const FEATURE_GROUP: Record<AiFeature, SkillApplyPoint> = {
  'workspace-chat': 'chat',
  'docs-generate': 'documents',
  'dockerfile-generate': 'dev',
  'pipeline-agent': 'dev',
  'conflict-resolve': 'dev',
  'studio-designer': 'studio',
  'studio-marketer': 'studio',
  'designer-theme': 'designer',
  'designer-style': 'designer',
  'designer-animation': 'designer',
  'interviewer': 'interviewer',
  'scraper': 'content',
  'mr-review': 'dev',
  'root-cause': 'dev',
  'plan-critique': 'dev',
  'reference-video-analysis': 'content',
  'script': 'content',
  'custom-generate': 'custom',
  'image-critique': 'designer',
  'document-generate': 'documents',
  'speech-to-text': 'chat',
};

export function applyPointForFeature(feature: AiFeature): SkillApplyPoint {
  return FEATURE_GROUP[feature];
}

export interface ResolvedSkill {
  slug: string;
  name: string;
  instruction: string;
  examples: string;
}

//? All ENABLED skills of a workspace whose applyPoints match the given group ([] / 'all' matches
//? everything). Pure read, best-effort at call sites; deterministic order (slug) so prompts are stable.
export async function resolveSkillsFor(workspaceId: string, applyPoint: SkillApplyPoint): Promise<ResolvedSkill[]> {
  const rows = await getPrismaClient().skill.findMany({
    where: { workspaceId, enabled: true },
    select: { slug: true, name: true, instruction: true, examples: true, applyPoints: true },
    orderBy: { slug: 'asc' },
  });
  return rows
    .filter((r) => r.applyPoints.length === 0 || r.applyPoints.includes('all') || r.applyPoints.includes(applyPoint))
    .map(({ slug, name, instruction, examples }) => ({ slug, name, instruction, examples }));
}

//? The formatted prompt block for a workspace + apply-point ('' when no skill applies). Best-effort:
//? any read failure ⇒ '' — a broken skills read must never fail the AI turn itself.
export async function skillPromptBlock(workspaceId: string | undefined, applyPoint: SkillApplyPoint): Promise<string> {
  if (!workspaceId) return '';
  const [err, skills] = await tryCatch(() => resolveSkillsFor(workspaceId, applyPoint));
  if (err || !skills || skills.length === 0) return '';
  const blocks = skills.map((s) => {
    const body = s.instruction.trim();
    const ex = s.examples.trim();
    return `### Skill: ${s.name}\n${body}${ex.length > 0 ? `\n\nExamples:\n${ex}` : ''}`;
  });
  return `## Active skills (apply these writing/working instructions to your output)\n\n${blocks.join('\n\n')}`;
}

//? SK3 — the builtin seed set. Editable per workspace (instruction/applyPoints/enabled), resettable to
//? these texts, never deletable. All are OFF by default — enabling one is the user's explicit choice.
const BUILTIN_SKILLS: { slug: string; name: string; applyPoints: SkillApplyPoint[]; instruction: string }[] = [
  {
    slug: 'humanizer',
    name: 'Humanizer',
    applyPoints: ['content', 'documents', 'studio', 'chat'],
    instruction: [
      'Write like a thoughtful human, not like an AI assistant:',
      '- Vary sentence length and rhythm; short punchy lines are welcome.',
      '- Prefer concrete, specific wording over abstractions and buzzwords.',
      '- Cut filler openers ("In today\'s fast-paced world", "It\'s important to note", "Furthermore").',
      '- Avoid formulaic list-of-three constructions and repetitive paragraph shapes.',
      '- Use plain connectors (and, but, so) over stilted ones (moreover, thus, consequently).',
      '- Allow a light, natural personality; do not be relentlessly upbeat or salesy.',
      'Integrity boundary (non-negotiable): the goal is genuinely better, human-sounding writing. Never attempt to defeat or evade AI-detection tools, never remove or contradict required AI-involvement disclosures, and never claim human authorship of AI-generated text.',
    ].join('\n'),
  },
  {
    slug: 'tone-of-voice',
    name: 'Tone of voice',
    applyPoints: ['content', 'documents', 'studio', 'chat'],
    instruction: [
      'Keep one consistent tone of voice across all output. Default: friendly, direct and confident — informal but professional (in Dutch: spreek de lezer aan met "je", niet "u").',
      'Edit this skill to describe YOUR tone: how formal, how playful, sentence style, words you always/never use.',
    ].join('\n'),
  },
  {
    slug: 'seo-optimizer',
    name: 'SEO optimizer',
    applyPoints: ['content'],
    instruction: [
      'When writing titles, descriptions, or long-form content, optimize for search naturally:',
      '- Put the primary keyword early in titles and opening lines; never keyword-stuff.',
      '- Write meta-style descriptions that state the concrete benefit in ≤160 characters.',
      '- Use clear headings that match how people actually search (questions, how-to phrasing).',
      '- Prefer specific long-tail phrasing over generic head terms when both fit.',
    ].join('\n'),
  },
  {
    slug: 'brand-voice',
    name: 'Brand voice',
    applyPoints: ['content', 'studio', 'documents'],
    instruction: [
      'Stay on-brand in every piece of output: weave in the workspace\'s product context (who we are, who we serve, what we always mention) where it fits naturally — never as a bolted-on advertisement.',
      'Edit this skill to add fixed brand rules: taglines, phrases to always/never use, competitor names to avoid, claims that need care.',
    ].join('\n'),
  },
  {
    slug: 'jargon-translator',
    name: 'Jargon translator',
    applyPoints: ['documents', 'chat', 'content'],
    instruction: [
      'Write for a smart reader who is NOT a domain expert:',
      '- Replace jargon with plain language; when a technical term is unavoidable, explain it in one short clause the first time.',
      '- Prefer a concrete example over an abstract definition.',
      '- Keep sentences short; one idea per sentence.',
    ].join('\n'),
  },
];

//? Idempotent per-workspace seed writer: inserts missing builtins and never overwrites user edits.
//? Call only from workspace bootstrap or the Conductor's internal builtins backfill — never from reads.
export async function ensureBuiltinSkills(prisma: PrismaClient, workspaceId: string): Promise<number> {
  const seeds = BUILTIN_SKILLS.map((seed) => ({
    seed,
    id: deterministicObjectId(workspaceId, seed.slug, 'builtin-skill'),
  }));
  const existing = await prisma.skill.findMany({
    where: { workspaceId, id: { in: seeds.map(({ id }) => id) } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((skill) => skill.id));
  for (const { seed, id } of seeds) {
    //? Exact deterministic ids make concurrent first-seed/retry calls converge without a schema unique.
    //? Historical random-id duplicates are deliberately not deleted or rewritten here.
    await prisma.skill.upsert({
      where: { id },
      update: {},
      create: {
        id, workspaceId, slug: seed.slug, name: seed.name, instruction: seed.instruction,
        applyPoints: [...seed.applyPoints], enabled: false, builtin: true,
      },
    });
  }
  return seeds.filter(({ id }) => !existingIds.has(id)).length;
}

//? The canonical builtin text for a slug (the "reset to default" source). null for user-authored slugs.
export function builtinSkillDefault(slug: string): { name: string; instruction: string; applyPoints: SkillApplyPoint[] } | null {
  const seed = BUILTIN_SKILLS.find((s) => s.slug === slug);
  return seed ? { name: seed.name, instruction: seed.instruction, applyPoints: [...seed.applyPoints] } : null;
}
