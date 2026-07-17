//? Golf 5 (gap-fixes) against the REAL Mongo: (1) the watermark ffmpeg pass args, (2) the OutputTemplate
//? that finally has EFFECT (its format persists onto the piece via content-assemble), (3) the blocks-gate
//? helper (open/done/archived/urgent semantics), and (4) the workspace-import round-trip of a real export.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { buildWatermarkArgs } = await import('../../server/content/render.ts');
const { enqueueControlAction, openBlockersFor } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { buildWorkspaceExport } = await import('../../server/export/workspaceExport');
const { importWorkspaceBundle } = await import('../../server/export/workspaceImport');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `g5-${String(stamp)}@youcomm.nl`, name: 'G5' } });
let wsId = '';
let importedWsId = '';

try {
  // ---- 1. watermark args (pure) ----
  const args = buildWatermarkArgs('in.mp4', 'out.mp4', 'logo.png', 'br');
  const joined = args.join(' ');
  assert(joined.includes('-i /media/in.mp4') && joined.includes('-i /media/logo.png'), 'video + logo are inputs');
  assert(joined.includes('overlay=W-w-24:H-h-24'), 'bottom-right overlay position');
  assert(joined.includes('-map [outv]') && joined.includes('0:a?'), 'video from the overlay graph, audio copied when present');
  assert(buildWatermarkArgs('a.mp4', 'b.mp4', 'l.png', 'tl').join(' ').includes('overlay=24:24'), 'top-left maps to 24:24');

  // ---- setup a workspace ----
  const created = await createBlankWorkspace(prisma, owner.id, 'G5 WS');
  wsId = created.workspaceId;
  const project = await prisma.project.create({ data: { workspaceId: wsId, name: 'content', projectType: 'content', gitlabPath: '' } });

  // ---- 2. OutputTemplate has EFFECT: content-assemble persists its format onto the piece ----
  const tpl = await prisma.outputTemplate.create({ data: { workspaceId: wsId, name: 'Shorts', format: '9:16', watermarkPosition: 'br' } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project.id, title: 'G5 piece', brief: 'x' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'content-assemble', target: {}, payload: { contentProjectId: piece.id, templateId: tpl.id }, userId: owner.id, clientRequestId: `g5-asm-${String(stamp)}` });
  const after = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, id: piece.id, aspectRatio: '9:16' } }));
  assert(after !== null, "the template's 9:16 format persisted onto the piece (templates were CRUD-without-effect)");

  // ---- 3. blocks-gate semantics ----
  const devProject = await prisma.project.create({ data: { workspaceId: wsId, name: 'dev', gitlabPath: 'g5/dev' } });
  const mkTicket = (n: number, key: string) => prisma.ticket.create({ data: { workspaceId: wsId, projectId: devProject.id, key, number: n, title: key, stageId: 'unrefined', status: 'idle', labels: [], creatorId: owner.id, priority: 'normal' } });
  const blocker = await mkTicket(101, 'G5-101');
  const blocked = await mkTicket(102, 'G5-102');
  await prisma.ticketLink.create({ data: { workspaceId: wsId, ticketId: blocker.id, targetTicketId: blocked.id, rel: 'blocks' } });
  eq(await openBlockersFor(prisma, wsId, blocked.id), ['G5-101'], 'an open blocker gates the ticket');
  eq(await openBlockersFor(prisma, wsId, blocker.id), [], 'the blocker itself is not gated (direction matters)');
  await prisma.ticket.updateMany({ where: { workspaceId: wsId, id: blocker.id }, data: { status: 'done' } });
  eq(await openBlockersFor(prisma, wsId, blocked.id), [], "a 'done' blocker no longer gates");
  await prisma.ticket.updateMany({ where: { workspaceId: wsId, id: blocker.id }, data: { status: 'idle', archived: true } });
  eq(await openBlockersFor(prisma, wsId, blocked.id), [], 'an archived blocker no longer gates');

  // ---- 4. workspace-import round-trip of a REAL export ----
  const bundle = await buildWorkspaceExport(prisma, wsId, Date.now());
  assert(bundle !== null, 'the export bundle builds');
  const imported = await importWorkspaceBundle(prisma, owner.id, bundle);
  assert(imported.ok && imported.workspaceId !== undefined, 'the bundle imports as a NEW workspace');
  importedWsId = imported.workspaceId ?? '';
  //? The source ws carries 2 seeded welcome tickets + G5-102 live (G5-101 was archived → excluded).
  eq(imported.tickets, 3, 'all live source tickets (2 welcome + G5-102) came back; the archived one did not');
  const importedTickets = await prisma.ticket.findMany({ where: { workspaceId: importedWsId }, select: { title: true, labels: true, stageId: true } });
  eq(importedTickets.filter((t) => t.labels.includes('imported')).length, 3, 'every RE-CREATED ticket carries the imported label (the fresh seeds do not)');
  assert(importedTickets.some((t) => t.title === 'G5-102'), 'ticket titles survive the round-trip');
  eq(imported.pieces, 1, 'the content piece title came back');
  const err = await importWorkspaceBundle(prisma, owner.id, { nonsense: true });
  eq(err.ok, false, 'garbage input is rejected, no workspace created');
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, []).catch(() => undefined);
  if (importedWsId) await cleanupWorkspace(prisma, importedWsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/golf5Media.test.mts');
}
