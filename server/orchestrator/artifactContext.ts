//? Ticket ⇄ artifact injection (ADR 0034). At stage-spawn the Conductor reads a ticket's
//? `TicketArtifactLink`s and renders each linked design/Studio artifact into a context-doc, so the
//? coding agent sees the specific design/spec a ticket is meant to implement (on top of the
//? workspace-wide `design-system` doc). Bounded + best-effort — a missing artifact is skipped.

import type { PrismaClient } from '@prisma/client';

import { buildDesignSystemDoc } from '../designer/designSystemDoc';

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

//? DESIGN_DOCS_PROGRAM 3.3 — the Studio artifact's HTML is the ONE artifact carrying real premium detail
//? (spacing, hierarchy, component styling), so hand the agent the ACTUAL markup (bounded) to match — not a
//? "HTML omitted" pointer that made it re-imagine the design from a sentence.
const STUDIO_HTML_CAP = 8000;
function renderStudio(kind: string, content: unknown): string {
  const c = rec(content);
  if (typeof c.markdown === 'string') return c.markdown.slice(0, 3000);
  if (Array.isArray(c.items)) return c.items.filter((i): i is string => typeof i === 'string').map((i) => `- ${i}`).join('\n').slice(0, 3000);
  if (typeof c.html === 'string') return `The ${kind}'s reference HTML (match its structure, spacing, hierarchy, and component styling):\n\n\`\`\`html\n${c.html.slice(0, STUDIO_HTML_CAP)}\n\`\`\``;
  return JSON.stringify(content).slice(0, 2000);
}

//? DESIGN_DOCS_PROGRAM 3.3 — render a linked ANIMATION artifact's motion spec (previously dropped: a linked
//? animation fell into the style branch → an empty style doc, losing the anim data entirely).
function renderAnim(name: string, description: string, content: unknown): string {
  const c = rec(content);
  return `# Animation — "${name}"\n${description}\n\nApply this motion to entrances/transitions/interactions. Spec:\n\`\`\`json\n${JSON.stringify(c)}\n\`\`\``;
}

export async function loadTicketArtifactContext(prisma: PrismaClient, workspaceId: string, ticketId: string): Promise<{ name: string; content: string }[]> {
  const links = await prisma.ticketArtifactLink.findMany({ where: { workspaceId, ticketId }, take: 8, orderBy: { createdAt: 'asc' } });
  if (links.length === 0) return [];
  const out: { name: string; content: string }[] = [];
  for (const link of links) {
    switch (link.artifactKind) {
      case 'design': {
        const artifact = await prisma.designArtifact.findFirst({ where: { workspaceId, id: link.artifactId }, select: { kind: true, name: true, description: true, content: true } });
        if (!artifact) break;
        const meta = { name: artifact.name, description: artifact.description ?? '', content: artifact.content };
        //? Render by kind — theme + style via the design-system doc; animation via its own motion block (3.3).
        const doc = artifact.kind === 'theme'
          ? buildDesignSystemDoc(meta, null)
          : (artifact.kind === 'animation' ? renderAnim(artifact.name, artifact.description ?? '', artifact.content) : buildDesignSystemDoc(null, meta));
        out.push({ name: `Linked design: ${artifact.name}`, content: doc });
        break;
      }
      case 'studio': {
        const artifact = await prisma.studioArtifact.findFirst({ where: { workspaceId, id: link.artifactId }, select: { kind: true, title: true, content: true } });
        if (!artifact) break;
        out.push({ name: `Linked ${artifact.kind}: ${artifact.title}`, content: renderStudio(artifact.kind, artifact.content) });
        break;
      }
      case 'ui-review': {
        const review = await prisma.uiReviewRequest.findFirst({ where: { workspaceId, id: link.artifactId }, select: { page: true, screenshots: true, problems: true, notes: true } });
        if (!review) break;
        const content = [
          `# UI review${review.page ? ` — ${review.page}` : ''}`,
          review.problems.length > 0 ? `## Reported problems\n${review.problems.map((problem) => `- ${problem}`).join('\n')}` : '',
          review.notes ? `## Comparison / notes\n${review.notes}` : '',
          review.screenshots.length > 0 ? `## Reference screenshots\n${review.screenshots.map((url) => `- ${url}`).join('\n')}` : '',
        ].filter((part) => part.length > 0).join('\n\n');
        out.push({ name: `Linked UI review: ${review.page ?? 'UI'}`, content });
        break;
      }
    }
  }
  return out;
}
