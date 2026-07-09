//? Designer ⇄ pipeline coupling (ADR 0034). Synthesizes the workspace's ACTIVE theme + style
//? (`DesignArtifact` rows with `active:true`) into a single `InfoSource(source:'design-system')`
//? context-doc. `stageRunner` auto-injects that source into every stage's CLAUDE.md, so the coding
//? agent builds on-brand. Called whenever the active theme/style changes (the control path in
//? `designerLibrary_v1`). B-23-safe: it only writes an InfoSource (feature content), never board/git.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { tryCatchSync } from '@luckystack/core';

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
//? Stringify only primitives (number/string) — Json values can be objects, which must not leak as "[object Object]".
const prim = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? String(v) : '');

//? Render a token map ({ token: value }) as a markdown bullet list (skips empties).
function tokenLines(tokens: Record<string, unknown>): string {
  return Object.entries(tokens)
    .filter(([, val]) => typeof val === 'string' && val.trim().length > 0)
    .map(([key, val]) => `- \`${key}\`: ${String(val)}`)
    .join('\n');
}

//? The compiled built-in looks (docs/AI_DESIGN_PREMADES.json, from scripts/generateDesignPremades.mjs).
interface PremadeLook { id: string; name: string; description: string; theme: { light: Record<string, string>; dark: Record<string, string> }; style: Record<string, unknown>; fontHeading: string; fontBody: string }
let premadeCache: PremadeLook[] | null = null;
function loadPremades(): PremadeLook[] {
  if (premadeCache) return premadeCache;
  const [err, raw] = tryCatchSync(() => readFileSync(path.join(process.cwd(), 'docs', 'AI_DESIGN_PREMADES.json'), 'utf8'));
  if (err || typeof raw !== 'string') { premadeCache = []; return premadeCache; }
  const [perr, parsed] = tryCatchSync(() => JSON.parse(raw) as { looks?: PremadeLook[] });
  premadeCache = (!perr && Array.isArray(parsed?.looks)) ? parsed.looks : [];
  return premadeCache;
}

//? One compact line of a look's distinguishing properties — enough for the agent to build in that look.
function lookLine(l: PremadeLook): string {
  const t = l.theme.light;
  const bits = [
    t.primary ? `primary ${t.primary}` : '', t.background ? `bg ${t.background}` : '', t.title ? `text ${t.title}` : '',
    prim(l.style.radius) ? `radius ${prim(l.style.radius)}px${l.style.pill ? ' pill' : ''}` : '',
    prim(l.style.motion) ? `motion ${prim(l.style.motion)}` : '',
    l.fontHeading ? `heading ${l.fontHeading.split(',')[0]}` : '', l.fontBody ? `body ${l.fontBody.split(',')[0]}` : '',
  ].filter((b) => b.length > 0);
  return `- **${l.name}** — ${l.description}\n  ${bits.join(' · ')}`;
}

//? A catalog of every NAMED look (built-in premades + this workspace's saved themes/styles) so a ticket that
//? references a look by name ("build the dropdown in the Apple style") grounds on its real tokens.
function namedLooksCatalog(saved: { kind: string; name: string; content: unknown }[]): string {
  const premades = loadPremades();
  const parts: string[] = [];
  if (premades.length > 0) {
    parts.push(
      '## Named looks — available by name',
      'If a request names one of these looks, build the UI using its properties (colours, radius, fonts, motion). Reference by name:',
      premades.map((l) => lookLine(l)).join('\n'),
    );
  }
  const themes = saved.filter((a) => a.kind === 'theme').map((t) => `"${t.name}"`);
  const styles = saved.filter((a) => a.kind === 'style').map((s) => `"${s.name}"`);
  if (themes.length > 0 || styles.length > 0) {
    parts.push(
      '## This workspace’s saved looks',
      ...(themes.length > 0 ? [`Themes: ${themes.join(', ')}`] : []),
      ...(styles.length > 0 ? [`Styles: ${styles.join(', ')}`] : []),
      '_Apply or copy one in the Designer to make its full token set the active system above._',
    );
  }
  return parts.join('\n\n');
}

//? Build the human+agent-readable design-system doc from the active theme + style content blobs, plus a
//? catalog of every named look (built-in + saved) so the agent can build in a look the user names.
export function buildDesignSystemDoc(
  theme: { name: string; description: string; content: unknown } | null,
  style: { name: string; description: string; content: unknown } | null,
  saved: { kind: string; name: string; content: unknown }[] = [],
): string {
  const parts: string[] = [
    '# Design system (active)',
    "This project's UI MUST follow the workspace's active design system below. The live app theme lives in `src/index.css` under the `@theme` block; build all UI from these tokens and style rules — never invent arbitrary colours, radii, or shadows.",
  ];

  if (theme) {
    const c = rec(theme.content);
    const light = rec(c.light); const dark = rec(c.dark);
    parts.push(`## Theme — "${theme.name}"`, theme.description || '');
    if (Object.keys(light).length > 0) parts.push('**Light tokens:**', tokenLines(light));
    if (Object.keys(dark).length > 0) parts.push('**Dark tokens:**', tokenLines(dark));
  }

  if (style) {
    const s = rec(style.content);
    const bits: string[] = [];
    if (prim(s.radius)) bits.push(`- Corner radius: ${prim(s.radius)}px (large ${prim(s.radiusLg) || prim(s.radius)}px)${s.pill ? ', pill buttons' : ''}`);
    if (prim(s.border)) bits.push(`- Borders: ${prim(s.border)}`);
    if (prim(s.density)) bits.push(`- Density: ${prim(s.density)}`);
    if (prim(s.motion)) bits.push(`- Motion: ${prim(s.motion)}`);
    if (prim(s.shadow)) bits.push(`- Card shadow: \`${prim(s.shadow)}\``);
    if (prim(s.shadowSm)) bits.push(`- Control shadow: \`${prim(s.shadowSm)}\``);
    if (prim(s.fontHeading)) bits.push(`- Heading font: ${prim(s.fontHeading)} (weight ${prim(s.weightHeading)})`);
    if (prim(s.fontBody)) bits.push(`- Body font: ${prim(s.fontBody)}`);
    parts.push(`## Style — "${style.name}"`, style.description || '', bits.join('\n'));
  }

  if (!theme && !style) parts.push('_No active theme or style selected yet in the Designer._');
  //? The named-looks catalog (built-in premades + this workspace's saved looks) — always appended so the agent
  //? can build in any named look, even one that isn't the active system.
  const catalog = namedLooksCatalog(saved);
  if (catalog.trim().length > 0) parts.push(catalog);
  return parts.filter((p) => p.trim().length > 0).join('\n\n');
}

//? Rebuild + upsert the workspace's `design-system` InfoSource from its active DesignArtifacts.
export async function rebuildDesignSystemDoc(prisma: PrismaClient, workspaceId: string): Promise<void> {
  const [theme, style, saved] = await Promise.all([
    prisma.designArtifact.findFirst({ where: { workspaceId, kind: 'theme', active: true }, select: { name: true, description: true, content: true } }),
    prisma.designArtifact.findFirst({ where: { workspaceId, kind: 'style', active: true }, select: { name: true, description: true, content: true } }),
    prisma.designArtifact.findMany({ where: { workspaceId, kind: { in: ['theme', 'style'] } }, select: { kind: true, name: true, content: true }, orderBy: { createdAt: 'asc' } }),
  ]);

  const content = buildDesignSystemDoc(
    theme ? { name: theme.name, description: theme.description ?? '', content: theme.content } : null,
    style ? { name: style.name, description: style.description ?? '', content: style.content } : null,
    saved,
  );

  const existing = await prisma.infoSource.findFirst({ where: { workspaceId, mode: 'context-doc', source: 'design-system' }, select: { id: true } });
  await (existing
    ? prisma.infoSource.update({ where: { id: existing.id }, data: { content, enabled: true } })
    : prisma.infoSource.create({ data: { workspaceId, mode: 'context-doc', source: 'design-system', name: 'Design system', content, enabled: true, usedByStages: [] } }));
}
