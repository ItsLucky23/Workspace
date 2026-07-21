//? Gap-fix — the IMPORT counterpart of workspaceExport (there was none: the GDPR/portability JSON could
//? never be brought back through the app; only a full-DB mongorestore). Recreates what the bundle
//? actually carries into a NEW workspace owned by the caller: tickets (key-resequenced; the original
//? stage is kept when the fresh pipeline has it, else 'unrefined'), knowledge sources and content-piece
//? titles. Members/env are NOT recreated (the bundle carries no credentials — keys only, by design).

import type { PrismaClient } from '@prisma/client';

import { createBlankWorkspace } from '../bootstrap/seedWorkspace';

export interface WorkspaceImportResult { ok: boolean; workspaceId?: string; name?: string; tickets: number; pieces: number; sources: number; error?: string }

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }

//? Import a bundle (parsed JSON) as a NEW workspace for `ownerId`. Never touches an existing workspace.
export async function importWorkspaceBundle(prisma: PrismaClient, ownerId: string, bundle: unknown): Promise<WorkspaceImportResult> {
  const b = asRecord(bundle);
  const meta = asRecord(b.workspace);
  const name = str(meta.name);
  if (!name || !Array.isArray(b.tickets)) return { ok: false, tickets: 0, pieces: 0, sources: 0, error: 'import.invalidBundle' };

  //? skipStarterSeed=true — an import already carries the bundle's own tickets; the default
  //? "welcome" starter tickets would otherwise land as phantoms alongside them.
  const created = await createBlankWorkspace(prisma, ownerId, `${name} (import)`, undefined, 'professional', undefined, true);
  const workspaceId = created.workspaceId;
  const project = await prisma.project.create({ data: { workspaceId, name: `${name} (import)`, gitlabPath: '' } });

  //? The fresh workspace's seeded pipeline decides which original stage keys survive.
  const stages = await prisma.pipelineStage.findMany({ where: { workspaceId }, select: { key: true } });
  const stageKeys = new Set(stages.map((s) => s.key));

  const lastTicket = await prisma.ticket.findFirst({ where: { workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
  let number = lastTicket?.number ?? 0;
  let tickets = 0;
  for (const raw of arr(b.tickets).slice(0, 5000)) {
    const t = asRecord(raw);
    const title = str(t.title);
    if (!title) continue;
    number += 1;
    await prisma.ticket.create({ data: {
      workspaceId, projectId: project.id, key: `DEV-${String(number)}`, number, title,
      description: str(t.description) || null,
      stageId: stageKeys.has(str(t.stageId)) ? str(t.stageId) : 'unrefined',
      status: 'idle', labels: ['imported'], creatorId: ownerId, priority: 'normal',
    } });
    tickets += 1;
  }

  let sources = 0;
  for (const raw of arr(b.knowledgeSources).slice(0, 1000)) {
    const s = asRecord(raw);
    const sname = str(s.name);
    if (!sname) continue;
    await prisma.infoSource.create({ data: { workspaceId, name: sname, mode: str(s.mode) || 'context-doc', source: str(s.source) || 'import', enabled: true } });
    sources += 1;
  }

  let pieces = 0;
  const contentRows = arr(b.content).slice(0, 2000);
  if (contentRows.length > 0) {
    const contentProject = await prisma.project.create({ data: { workspaceId, name: 'Content', projectType: 'content', gitlabPath: '' } });
    for (const raw of contentRows) {
      const c = asRecord(raw);
      const title = str(c.title);
      if (!title) continue;
      await prisma.contentProject.create({ data: { workspaceId, projectId: contentProject.id, title, brief: null } });
      pieces += 1;
    }
  }

  return { ok: true, workspaceId, name: `${name} (import)`, tickets, pieces, sources };
}
