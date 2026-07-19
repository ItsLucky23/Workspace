//? #19 — workspace PACKS: the product-truth layer that onboarding never had.
//?
//? Creating a workspace asked which MODULES to switch on and then handed you an empty one. Module toggles
//? decide which nav items exist; they say nothing about what the workspace is FOR, and a new user still
//? faced a blank board, no skills, no styles, no channel — the "now what?" moment the module picker was
//? supposed to solve.
//?
//? A pack is the missing answer: a named use case that carries a module set, a pipeline tier, and the
//? seed content that makes the workspace immediately usable. It is deliberately NOT a template engine —
//? each pack is a small, readable data literal, because the moment this becomes configurable it becomes a
//? feature nobody maintains.
//?
//? Every seeded artifact is ordinary user-editable data. A pack is a starting point, never a constraint.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import type { PipelinePreset } from './defaultPipeline';

export interface PackSkill { slug: string; name: string; instruction: string; applyPoints: string[] }
export interface PackChannel { name: string; platform: string; brandVoice: string }
export interface PackDocument { title: string; content: string }

export interface WorkspacePack {
  id: string;
  //? i18n keys — a pack's label is UI copy, not a hardcoded string (Rule 13).
  labelKey: string;
  descKey: string;
  icon: string;
  modules: string[];
  preset: PipelinePreset;
  skills: PackSkill[];
  channels: PackChannel[];
  documents: PackDocument[];
  //? The first thing the user should do, seeded as a real ticket so the board is never empty.
  starterTickets: { title: string; description: string }[];
}

export const WORKSPACE_PACKS: WorkspacePack[] = [
  {
    id: 'solo-dev',
    labelKey: 'workspaces.packs.soloDev', descKey: 'workspaces.packs.soloDevDesc', icon: 'code-branch',
    modules: ['development'],
    //? A solo project does not need a 7-stage pipeline; that ceremony is what made small projects feel heavy.
    preset: 'simple',
    skills: [
      { slug: 'concise-code', name: 'Concise code', instruction: 'Prefer the smallest change that solves the problem. No speculative abstractions, no options nobody asked for.', applyPoints: ['dev'] },
    ],
    channels: [],
    documents: [{ title: 'Project notes', content: '# Project notes\n\nWhat this project is, and the decisions worth remembering.\n' }],
    starterTickets: [
      { title: 'Connect your repository', description: 'Add your git repo under Settings → Forge so the pipeline can work on real code.' },
    ],
  },
  {
    id: 'content-creator',
    labelKey: 'workspaces.packs.creator', descKey: 'workspaces.packs.creatorDesc', icon: 'wand-magic-sparkles',
    modules: ['content', 'design'],
    preset: 'simple',
    skills: [
      { slug: 'hook-first', name: 'Hook first', instruction: 'Open every script with a concrete hook in the first sentence: a number, a question, or a claim. Never open with a greeting or a preamble.', applyPoints: ['content'] },
      { slug: 'plain-language', name: 'Plain language', instruction: 'Write the way people talk. Short sentences. No marketing adjectives, no "unlock", no "elevate".', applyPoints: ['content', 'studio'] },
    ],
    channels: [{ name: 'Main channel', platform: 'youtube', brandVoice: 'Direct, practical, a bit dry. Explains rather than sells.' }],
    documents: [{ title: 'Content plan', content: '# Content plan\n\n## Who this is for\n\n## What I post about\n\n## What worked so far\n' }],
    starterTickets: [],
  },
  {
    id: 'agency',
    labelKey: 'workspaces.packs.agency', descKey: 'workspaces.packs.agencyDesc', icon: 'users',
    modules: ['development', 'content', 'design', 'documents'],
    //? An agency runs client work through review — the full pipeline is the point here.
    preset: 'professional',
    skills: [
      { slug: 'client-ready', name: 'Client-ready output', instruction: 'Assume everything you produce may be shown to a client. State assumptions explicitly; never invent a fact about the client\'s business.', applyPoints: ['all'] },
    ],
    channels: [],
    documents: [
      { title: 'Client brief', content: '# Client brief\n\n## Goal\n\n## Audience\n\n## Constraints\n\n## Definition of done\n' },
      { title: 'Handover', content: '# Handover\n\nWhat was delivered, where it lives, and what the client needs to maintain it.\n' },
    ],
    starterTickets: [
      { title: 'Set up the client brief', description: 'Fill in the Client brief document — it grounds every AI run in this workspace.' },
    ],
  },
  {
    id: 'student',
    labelKey: 'workspaces.packs.student', descKey: 'workspaces.packs.studentDesc', icon: 'book-open',
    modules: ['documents', 'development'],
    preset: 'simple',
    skills: [
      { slug: 'cite-sources', name: 'Cite the source', instruction: 'Ground every factual claim in an uploaded source and name it inline. If the sources do not support a claim, say so instead of filling the gap.', applyPoints: ['documents'] },
    ],
    channels: [],
    documents: [
      { title: 'Technical design', content: '# Technical design\n\n## Problem\n\n## Approach\n\n## Architecture\n\n## Trade-offs\n' },
    ],
    starterTickets: [
      { title: 'Upload your source material', description: 'Drop the PDFs/briefs into Documents — the AI drafts from YOUR sources, not from generic knowledge.' },
    ],
  },
];

export function findPack(id: string): WorkspacePack | null {
  return WORKSPACE_PACKS.find((p) => p.id === id) ?? null;
}

export interface PackSeedOutcome { skills: number; channels: number; documents: number; tickets: number }

//? Seed a pack's content into an existing workspace. Best-effort per artifact: a pack is a nicety, and a
//? failed seed must never make workspace creation fail.
export async function seedPack(prisma: PrismaClient, workspaceId: string, projectId: string, ownerId: string, pack: WorkspacePack): Promise<PackSeedOutcome> {
  const outcome: PackSeedOutcome = { skills: 0, channels: 0, documents: 0, tickets: 0 };

  for (const skill of pack.skills) {
    const [error] = await tryCatch(() => prisma.skill.create({
      data: { workspaceId, slug: `${skill.slug}-${workspaceId.slice(-6)}`, name: skill.name, instruction: skill.instruction, examples: '', applyPoints: skill.applyPoints, enabled: true, builtin: false },
    }));
    if (!error) outcome.skills += 1;
  }

  for (const channel of pack.channels) {
    const [error] = await tryCatch(() => prisma.channel.create({
      data: { workspaceId, projectId, name: channel.name, platform: channel.platform, brandVoice: channel.brandVoice, autopilot: false },
    }));
    if (!error) outcome.channels += 1;
  }

  for (const doc of pack.documents) {
    const [error] = await tryCatch(() => prisma.document.create({ data: { workspaceId, title: doc.title, content: doc.content } }));
    if (!error) outcome.documents += 1;
  }

  //? Starter tickets continue the existing numbering rather than assuming an empty board.
  const last = await prisma.ticket.findFirst({ where: { workspaceId, projectId }, orderBy: { number: 'desc' }, select: { number: true } });
  let number = last?.number ?? 0;
  for (const ticket of pack.starterTickets) {
    number += 1;
    const [error] = await tryCatch(() => prisma.ticket.create({
      data: {
        workspaceId, projectId, key: `DEV-${String(number)}`, number,
        title: ticket.title, description: ticket.description,
        stageId: 'unrefined', status: 'idle', labels: [], creatorId: ownerId,
      },
    }));
    if (!error) outcome.tickets += 1;
  }

  return outcome;
}
