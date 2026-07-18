/** @docs owner ItsLucky23 */
//? DESIGN_DOCS_PROGRAM 3.4 — turn the workspace's ACTIVE theme into the project's `src/index.css` so the
//? design tokens can be applied to a project FAST (a mechanical token swap committed by the Conductor),
//? without paying a full pipeline run. Pure CSS generator (unit-testable) + a resolver for the active theme.

import type { PrismaClient } from '@prisma/client';

const rec = (v: unknown): Record<string, string> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val;
  return out;
};

//? Render the light + dark token sets into a Tailwind-v4 `@theme` block (light) + a `.dark` override, the
//? exact shape `src/index.css` uses. Deterministic + pure.
export function buildIndexCss(light: Record<string, string>, dark: Record<string, string>): string {
  const vars = (tokens: Record<string, string>): string => Object.entries(tokens).map(([k, v]) => `  --color-${k}: ${v};`).join('\n');
  const lightBlock = Object.keys(light).length > 0 ? `@theme {\n${vars(light)}\n}\n` : '@theme {\n}\n';
  const darkBlock = Object.keys(dark).length > 0 ? `\n.dark {\n${vars(dark)}\n}\n` : '';
  return `@import "tailwindcss";\n\n${lightBlock}${darkBlock}`;
}

//? The active theme's light/dark token sets (or null when no active theme). Reads the DesignArtifact the
//? user activated (kind 'theme', active true).
export async function activeThemeCss(prisma: PrismaClient, workspaceId: string): Promise<string | null> {
  const theme = await prisma.designArtifact.findFirst({ where: { workspaceId, kind: 'theme', active: true }, select: { content: true } });
  if (!theme) return null;
  //? content = { light: {...}, dark: {...} } — narrow each side.
  const c = theme.content !== null && typeof theme.content === 'object' && !Array.isArray(theme.content) ? theme.content as Record<string, unknown> : {};
  const light = rec(c.light);
  const dark = rec(c.dark);
  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) return null;
  return buildIndexCss(light, dark);
}
