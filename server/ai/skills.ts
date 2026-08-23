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
//? The block's FORMAT is shared with the client preview (F-075) — the header + `### Skill:` shape used
//? to live only here, so the preview showed bare instructions the agent never saw in that form.
import { formatSkillBlock } from '../../src/workspaces/_functions/aiLayers';

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

//? The skills of a workspace that apply automatically at the given point.
//?
//? Owner decision 2026-08-20: there is no `enabled` flag any more. Apply points ARE the switch — a
//? skill with none runs nowhere automatically, and a pipeline stage picks its own skills by id
//? (`resolveSkillsByIds`). Two controls that both meant "off" was the confusion: you could enable a
//? skill and still see nothing, because its apply points excluded the thing you were looking at.
//?
//? That also flips the old "[] means everywhere" rule to "[] means nowhere". `schemaVersion.ts`
//? migrates both directions so no existing workspace changes what it runs: a disabled skill loses its
//? apply points, and an enabled skill with none gains 'all'.
//? Deterministic order (slug) so prompts are stable.
export async function resolveSkillsFor(workspaceId: string, applyPoint: SkillApplyPoint): Promise<ResolvedSkill[]> {
  const rows = await getPrismaClient().skill.findMany({
    where: { workspaceId, skillType: 'instruction' },
    select: { slug: true, name: true, instruction: true, examples: true, applyPoints: true },
    orderBy: { slug: 'asc' },
  });
  return rows
    .filter((r) => r.applyPoints.includes('all') || r.applyPoints.includes(applyPoint))
    .map(({ slug, name, instruction, examples }) => ({ slug, name, instruction, examples }));
}

/** The skills a PIPELINE STAGE picked, by id. Explicit selection — apply points do not enter into it. */
export async function resolveSkillsByIds(workspaceId: string, ids: string[]): Promise<ResolvedSkill[]> {
  if (ids.length === 0) return [];
  const rows = await getPrismaClient().skill.findMany({
    where: { workspaceId, skillType: 'instruction', id: { in: ids } },
    select: { slug: true, name: true, instruction: true, examples: true },
    orderBy: { slug: 'asc' },
  });
  return rows;
}

//? The formatted prompt block for a workspace + apply-point ('' when no skill applies). Best-effort:
//? any read failure ⇒ '' — a broken skills read must never fail the AI turn itself.
export async function skillPromptBlock(workspaceId: string | undefined, applyPoint: SkillApplyPoint): Promise<string> {
  if (!workspaceId) return '';
  const [err, skills] = await tryCatch(() => resolveSkillsFor(workspaceId, applyPoint));
  if (err || !skills || skills.length === 0) return '';
  return formatSkillBlock(skills);
}

/** The same block for an explicit id list — what a pipeline stage renders. */
export async function stageSkillBlock(workspaceId: string | undefined, ids: string[]): Promise<string> {
  if (!workspaceId || ids.length === 0) return '';
  const [err, skills] = await tryCatch(() => resolveSkillsByIds(workspaceId, ids));
  if (err || !skills || skills.length === 0) return '';
  return formatSkillBlock(skills);
}

//? SK3 — the builtin seed set. Editable per workspace (instruction/applyPoints), resettable to these
//? texts, never deletable. `applyPoints` here is the SUGGESTED scope restored by "reset to default";
//? a freshly seeded builtin starts with none, so it runs nowhere until asked for.
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
        //? Seeded with NO apply points, which is what "off" means now that `enabled` is gone: a
        //? builtin is available to read and edit and runs nowhere until you give it apply points or a
        //? pipeline stage picks it. `seed.applyPoints` is its SUGGESTED scope and is what "reset to
        //? default" restores — seeding it here would silently turn Humanizer on for every new
        //? workspace's content, documents, studio and chat.
        applyPoints: [], enabled: true, builtin: true,
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
