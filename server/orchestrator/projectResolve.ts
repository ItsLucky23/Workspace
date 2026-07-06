//? Workspaces — resolve the target project for a workspace-scoped op (ADR 0035).
//?
//? Before multi-project, the orchestrator resolved "the project" with
//? `project.findFirst({ where: { workspaceId } })` — safe only while a workspace held
//? exactly one project. With N projects/workspace (ADR 0035 reverses D12) that pattern
//? silently picks the OLDEST project, which is wrong for an op that targets another.
//? This resolver prefers an explicit, workspace-validated `projectId` and falls back to
//? the first project so legacy callers (and single-project workspaces) keep working.

import type { PrismaClient } from '@prisma/client';

//? A Mongo ObjectId is exactly 24 hex chars — guard the shape BEFORE querying so a
//? malformed/corrupt id (a stale client, a bad payload) falls back gracefully instead
//? of throwing Prisma's "Malformed ObjectID".
const isObjectId = (s: string): boolean => /^[0-9a-fA-F]{24}$/.test(s);

//? Returns the target projectId (explicit-if-valid, else the workspace's oldest
//? project), or null only for a genuinely project-less workspace.
export async function resolveProjectId(prisma: PrismaClient, workspaceId: string, projectId?: string | null): Promise<string | null> {
  if (projectId && isObjectId(projectId)) {
    const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
    if (p) return p.id;
  }
  const first = await prisma.project.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return first?.id ?? null;
}
