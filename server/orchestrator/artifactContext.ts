//? Ticket ⇄ artifact injection (ADR 0034). At stage-spawn the Conductor reads a ticket's
//? `TicketArtifactLink`s and renders each linked design/Studio artifact into a context-doc, so the
//? coding agent sees the specific design/spec a ticket is meant to implement (on top of the
//? workspace-wide `design-system` doc). Bounded + best-effort — a missing artifact is skipped.

import type { PrismaClient } from '@prisma/client';

import { buildDesignSystemDoc } from '../designer/designSystemDoc';

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

//? Render a Studio artifact's kind-specific content into a short markdown block (bounded — never dumps
//? full landing HTML at the agent; it points at the intent + any copy).
function renderStudio(kind: string, content: unknown): string {
  const c = rec(content);
  if (typeof c.markdown === 'string') return c.markdown.slice(0, 3000);
  if (Array.isArray(c.items)) return c.items.filter((i): i is string => typeof i === 'string').map((i) => `- ${i}`).join('\n').slice(0, 3000);
  if (typeof c.html === 'string') return `A ${kind} visual design exists in the Studio module (HTML omitted here; match its structure + copy).`;
  return JSON.stringify(content).slice(0, 2000);
}

export async function loadTicketArtifactContext(prisma: PrismaClient, workspaceId: string, ticketId: string): Promise<{ name: string; content: string }[]> {
  const links = await prisma.ticketArtifactLink.findMany({ where: { workspaceId, ticketId }, take: 8, orderBy: { createdAt: 'asc' } });
  if (links.length === 0) return [];
  const out: { name: string; content: string }[] = [];
  for (const link of links) {
    if (link.artifactKind === 'design') {
      const a = await prisma.designArtifact.findFirst({ where: { workspaceId, id: link.artifactId }, select: { kind: true, name: true, description: true, content: true } });
      if (!a) continue;
      const meta = { name: a.name, description: a.description ?? '', content: a.content };
      const doc = a.kind === 'theme' ? buildDesignSystemDoc(meta, null) : buildDesignSystemDoc(null, meta);
      out.push({ name: `Linked design: ${a.name}`, content: doc });
    } else {
      const a = await prisma.studioArtifact.findFirst({ where: { workspaceId, id: link.artifactId }, select: { kind: true, title: true, content: true } });
      if (!a) continue;
      out.push({ name: `Linked ${a.kind}: ${a.title}`, content: renderStudio(a.kind, a.content) });
    }
  }
  return out;
}
