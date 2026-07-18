//? DESIGN_DOCS_PROGRAM Phase 4 (UI from 0) through the REAL Conductor + Mongo: creating a greenfield project
//? WITH a brief seeds an APP_BRIEF.md context-doc and files a scaffold ticket, auto-advanced to the first
//? AI stage, so the existing ticket→stage→agent pipeline generates the starting UI from the brief.
//? We assert the synchronous wiring (project + repo + brief doc + advanced ticket); the agent turn itself is
//? the existing pipeline and is torn down here so the test leaves nothing running.

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { isLinked } = await import('../../server/git/repoStore');
const { teardownTicketContainer } = await import('../../server/container/runtime');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 15_000, stepMs = 150): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `u0-${String(stamp)}@youcomm.nl`, name: 'U0' } });
let wsId = '';
let scaffoldKey = '';

try {
  wsId = (await createBlankWorkspace(prisma, owner.id, 'FromZero WS')).workspaceId;

  await enqueueControlAction({ workspaceId: wsId, op: 'project-from-template', target: {}, payload: { name: 'Study Planner', template: 'react-vite', brief: 'A minimalist offline-first study planner with spaced-repetition scheduling and a calm blue look.' }, userId: owner.id, clientRequestId: `pft-${String(stamp)}` });

  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, name: 'Study Planner' } }));
  assert(project !== null, 'project-from-template created the project');
  assert(isLinked(wsId, project?.id ?? ''), '4.x: the greenfield repo was initialised (linked)');

  //? 4.2 — the brief became an APP_BRIEF.md context-doc the coding agent will read.
  const briefDoc = await poll(() => prisma.infoSource.findFirst({ where: { workspaceId: wsId, projectId: project?.id ?? '', name: 'APP_BRIEF.md' } }));
  assert(briefDoc !== null, '4.2: the brief seeded an APP_BRIEF.md context-doc');
  assert((briefDoc?.content ?? '').includes('spaced-repetition'), '4.2: the brief content is in the doc');

  //? 4.3 — a scaffold ticket was filed and auto-advanced past `unrefined` to an AI stage (the pipeline
  //? generates the UI from the brief). It may already be provisioning a container — we tear it down below.
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, projectId: project?.id ?? '', labels: { has: 'scaffold' } } }));
  assert(ticket !== null, '4.3: a scaffold ticket was filed from the brief');
  scaffoldKey = ticket?.key ?? '';
  assert(ticket?.stageId !== 'unrefined', '4.3: the scaffold ticket was auto-advanced to an AI stage (start-with-AI)');
} finally {
  //? Tear down any container the scaffold ticket started (best-effort) so the test leaves nothing running.
  if (wsId && scaffoldKey) await teardownTicketContainer(wsId, scaffoldKey).catch(() => undefined);
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('uiFromZero');
