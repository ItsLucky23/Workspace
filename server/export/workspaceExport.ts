//? H4 — workspace DATA EXPORT (portability / backup / GDPR "give me my data"). Assembles a tenant-scoped JSON
//? bundle of a workspace's own content: meta, tickets, pipeline stages, knowledge sources, content pieces, and
//? members (names + roles). SECRETS ARE EXCLUDED BY DESIGN — env VALUES, tokens, editor credentials never leave;
//? only the KEYS of env vars are listed (so the operator knows what to re-provision). Read-only, no write.

import type { PrismaClient } from '@prisma/client';

export interface WorkspaceExport {
  exportedAt: string;
  workspace: { id: string; name: string };
  tickets: { key: string; title: string; status: string; stageId: string; description: string | null }[];
  pipeline: { key: string; name: string; kind: string; order: number }[];
  knowledgeSources: { name: string; mode: string; source: string }[];
  content: { title: string; createdAt: string }[];
  members: { userId: string; name: string; roleKey: string }[];
  envKeys: string[]; // KEYS ONLY — never the values/secrets
  counts: { tickets: number; content: number; members: number };
}

//? Build the export bundle. `now` injected → deterministic timestamp in tests.
export async function buildWorkspaceExport(prisma: PrismaClient, workspaceId: string, now: number): Promise<WorkspaceExport | null> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!workspace) return null;

  const [tickets, stages, sources, content, members, envVars] = await Promise.all([
    prisma.ticket.findMany({ where: { workspaceId, archived: false }, select: { key: true, title: true, status: true, stageId: true, description: true }, orderBy: { number: 'asc' }, take: 5000 }),
    prisma.pipelineStage.findMany({ where: { workspaceId }, select: { key: true, name: true, kind: true, order: true }, orderBy: { order: 'asc' } }),
    prisma.infoSource.findMany({ where: { workspaceId }, select: { name: true, mode: true, source: true }, take: 1000 }),
    prisma.contentProject.findMany({ where: { workspaceId }, select: { title: true, createdAt: true }, take: 2000 }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, roleKey: true } }),
    prisma.envVar.findMany({ where: { workspaceId }, select: { key: true } }), // KEYS ONLY
  ]);

  const users = members.length > 0 ? await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true } }) : [];
  const nameById = new Map<string, string>(users.map((u) => [u.id, u.name ?? u.email]));

  return {
    exportedAt: new Date(now).toISOString(),
    workspace: { id: workspace.id, name: workspace.name },
    tickets: tickets.map((t) => ({ key: t.key, title: t.title, status: t.status, stageId: t.stageId, description: t.description })),
    pipeline: stages.map((s) => ({ key: s.key, name: s.name, kind: s.kind, order: s.order })),
    knowledgeSources: sources.map((s) => ({ name: s.name, mode: s.mode, source: s.source ?? '' })),
    content: content.map((c) => ({ title: c.title, createdAt: c.createdAt.toISOString() })),
    members: members.map((m) => ({ userId: m.userId, name: nameById.get(m.userId) ?? 'unknown', roleKey: m.roleKey })),
    envKeys: envVars.map((e) => e.key),
    counts: { tickets: tickets.length, content: content.length, members: members.length },
  };
}
