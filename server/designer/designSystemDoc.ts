//? Designer ⇄ pipeline coupling (ADR 0034). Synthesizes the workspace's ACTIVE theme + style
//? (`DesignArtifact` rows with `active:true`) into a single `InfoSource(source:'design-system')`
//? context-doc. `stageRunner` auto-injects that source into every stage's CLAUDE.md, so the coding
//? agent builds on-brand. Called whenever the active theme/style changes (the control path in
//? `designerLibrary_v1`). B-23-safe: it only writes an InfoSource (feature content), never board/git.

import type { PrismaClient } from '@prisma/client';

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

//? Build the human+agent-readable design-system doc from the active theme + style content blobs.
export function buildDesignSystemDoc(
  theme: { name: string; description: string; content: unknown } | null,
  style: { name: string; description: string; content: unknown } | null,
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
  return parts.filter((p) => p.trim().length > 0).join('\n\n');
}

//? Rebuild + upsert the workspace's `design-system` InfoSource from its active DesignArtifacts.
export async function rebuildDesignSystemDoc(prisma: PrismaClient, workspaceId: string): Promise<void> {
  const [theme, style] = await Promise.all([
    prisma.designArtifact.findFirst({ where: { workspaceId, kind: 'theme', active: true }, select: { name: true, description: true, content: true } }),
    prisma.designArtifact.findFirst({ where: { workspaceId, kind: 'style', active: true }, select: { name: true, description: true, content: true } }),
  ]);

  const content = buildDesignSystemDoc(
    theme ? { name: theme.name, description: theme.description ?? '', content: theme.content } : null,
    style ? { name: style.name, description: style.description ?? '', content: style.content } : null,
  );

  const existing = await prisma.infoSource.findFirst({ where: { workspaceId, mode: 'context-doc', source: 'design-system' }, select: { id: true } });
  await (existing
    ? prisma.infoSource.update({ where: { id: existing.id }, data: { content, enabled: true } })
    : prisma.infoSource.create({ data: { workspaceId, mode: 'context-doc', source: 'design-system', name: 'Design system', content, enabled: true, usedByStages: [] } }));
}
