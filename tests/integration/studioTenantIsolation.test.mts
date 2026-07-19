//? Studio tenant-boundary regression: a member of workspace A cannot use known IDs from workspace B,
//? and a detached generation completion cannot restore an artifact deleted while it was generating.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { tryCatch } = await import('@luckystack/core');
const saveBriefRoute = await import('../../src/workspaces/_api/studioSaveBrief_v1.ts');
const deleteRoute = await import('../../src/workspaces/_api/studioDelete_v1.ts');
const generateRoute = await import('../../src/workspaces/_api/studioGenerate_v1.ts');
const brandRoute = await import('../../src/workspaces/_api/studioBrand_v1.ts');
const brandImportRoute = await import('../../src/workspaces/_api/brandImport_v1.ts');
const brandExportRoute = await import('../../src/workspaces/_api/brandExport_v1.ts');
const styleImportRoute = await import('../../src/workspaces/_api/styleImport_v1.ts');
const styleExportRoute = await import('../../src/workspaces/_api/styleExport_v1.ts');
const { beginArtifact, completeArtifact } = await import('../../server/studio/generate.ts');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace.ts');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now();
const memberA = await prisma.user.create({ data: { email: `studio-a-${String(stamp)}@youcomm.nl`, name: 'Studio A' } });
const ownerB = await prisma.user.create({ data: { email: `studio-b-${String(stamp)}@youcomm.nl`, name: 'Studio B' } });
let workspaceA = '';
let workspaceB = '';

try {
  workspaceA = (await createBlankWorkspace(prisma, memberA.id, 'Studio A')).workspaceId;
  workspaceB = (await createBlankWorkspace(prisma, ownerB.id, 'Studio B')).workspaceId;
  const projectB = await prisma.project.findFirst({ where: { workspaceId: workspaceB }, select: { id: true } });
  if (!projectB) throw new Error('workspace B project was not seeded');

  const briefB = await prisma.studioBrief.create({ data: { workspaceId: workspaceB, projectId: projectB.id, name: 'B brief', productName: 'B product', audience: 'B audience', tone: 'B tone', goals: 'B goals' } });
  const artifactB = await prisma.studioArtifact.create({ data: { workspaceId: workspaceB, briefId: briefB.id, kind: 'brand', role: 'designer', title: 'B artifact', content: { voice: 'B voice' }, status: 'ready' } });
  await prisma.studioBrandLibrary.create({ data: { workspaceId: workspaceB, name: 'B brand', palette: [], typography: { heading: '', body: '' }, voice: 'B voice', taglines: [], logoIdeas: [] } });
  await prisma.stylePreset.create({ data: { workspaceId: workspaceB, feature: 'image-gen', key: 'b-style', label: 'B style', systemPrompt: 'B system prompt', builtin: false } });

  const functions = { db: { prisma }, tryCatch: { tryCatch } } as never;
  const user = { id: memberA.id } as never;

  const foreignUpdate = await saveBriefRoute.main({ data: { workspaceId: workspaceA, id: briefB.id, name: 'stolen', productName: 'stolen', audience: 'stolen', tone: 'stolen', goals: 'stolen' }, user, functions });
  eq(foreignUpdate.status, 'error', 'a workspace A member cannot update a workspace B brief by ID');
  eq((await prisma.studioBrief.findFirst({ where: { id: briefB.id } }))?.name, 'B brief', 'the foreign brief remains unchanged');

  const foreignProject = await saveBriefRoute.main({ data: { workspaceId: workspaceA, projectId: projectB.id, name: 'foreign project', productName: 'A product', audience: 'A audience', tone: 'A tone', goals: 'A goals' }, user, functions });
  eq(foreignProject.status, 'error', 'a brief cannot be created against a project from another workspace');
  eq(await prisma.studioBrief.count({ where: { workspaceId: workspaceA } }), 0, 'the foreign project ID creates no brief in workspace A');

  const foreignGenerate = await generateRoute.main({ data: { workspaceId: workspaceA, briefId: briefB.id, kind: 'copy' }, user, functions });
  eq(foreignGenerate.status, 'error', 'a workspace B brief cannot generate an artifact in workspace A');
  eq(await prisma.studioArtifact.count({ where: { workspaceId: workspaceA } }), 0, 'foreign generation creates no artifact');

  const foreignArtifactDelete = await deleteRoute.main({ data: { workspaceId: workspaceA, artifactId: artifactB.id }, user, functions });
  eq(foreignArtifactDelete.status, 'error', 'a workspace A member cannot delete a workspace B artifact by ID');
  assert(await prisma.studioArtifact.findFirst({ where: { id: artifactB.id } }) !== null, 'the foreign artifact remains');

  const foreignBriefDelete = await deleteRoute.main({ data: { workspaceId: workspaceA, briefId: briefB.id }, user, functions });
  eq(foreignBriefDelete.status, 'error', 'a workspace A member cannot delete a workspace B brief by ID');
  assert(await prisma.studioBrief.findFirst({ where: { id: briefB.id } }) !== null, 'the foreign brief remains after deletion attempt');

  const foreignBrandSave = await brandRoute.main({ data: { workspaceId: workspaceB, op: 'save', name: 'stolen brand' }, user, functions });
  eq(foreignBrandSave.status, 'error', 'a non-member cannot overwrite workspace B brand data');
  eq((await prisma.studioBrandLibrary.findFirst({ where: { workspaceId: workspaceB } }))?.name, 'B brand', 'the foreign brand remains unchanged');

  const foreignBrandPromote = await brandRoute.main({ data: { workspaceId: workspaceA, op: 'promote', artifactId: artifactB.id }, user, functions });
  eq(foreignBrandPromote.status, 'error', 'a workspace B artifact cannot be promoted into workspace A');
  eq(await prisma.studioBrandLibrary.count({ where: { workspaceId: workspaceA } }), 0, 'foreign promotion creates no workspace A brand library');

  const foreignBrandImport = await brandImportRoute.main({ data: { workspaceId: workspaceB, kit: '{"name":"stolen"}' }, user, functions });
  eq(foreignBrandImport.status, 'error', 'a non-member cannot import into workspace B brand data');
  const foreignStyleImport = await styleImportRoute.main({ data: { workspaceId: workspaceB, styles: '[{"feature":"image-gen","key":"b-style","label":"stolen","systemPrompt":"stolen"}]' }, user, functions });
  eq(foreignStyleImport.status, 'error', 'a non-member cannot import into workspace B styles');
  eq((await prisma.stylePreset.findFirst({ where: { workspaceId: workspaceB, key: 'b-style' } }))?.label, 'B style', 'the foreign style remains unchanged');

  const foreignBrandRead = await brandExportRoute.main({ data: { workspaceId: workspaceB }, user, functions });
  eq(foreignBrandRead.status, 'error', 'a non-member cannot read workspace B brand data');
  const foreignStyleRead = await styleExportRoute.main({ data: { workspaceId: workspaceB }, user, functions });
  eq(foreignStyleRead.status, 'error', 'a non-member cannot read workspace B styles');

  const briefA = await prisma.studioBrief.create({ data: { workspaceId: workspaceA, name: 'A brief', productName: 'A product', audience: 'A audience', tone: 'A tone', goals: 'A goals' } });
  const pending = await prisma.studioArtifact.create({ data: { workspaceId: workspaceA, briefId: briefA.id, kind: 'copy', role: 'marketer', title: 'Pending', content: {}, status: 'generating' } });
  const deleted = await deleteRoute.main({ data: { workspaceId: workspaceA, artifactId: pending.id }, user, functions });
  eq(deleted.status, 'success', 'the generating artifact is deleted before its detached completion');
  const completed = await completeArtifact(prisma, pending.id, { workspaceId: workspaceA, briefId: briefA.id, kind: 'copy' }, { status: 'ready', content: { sections: [] }, error: null });
  eq(completed, false, 'the stale detached completion loses its workspace/status CAS');
  eq(await prisma.studioArtifact.count({ where: { id: pending.id } }), 0, 'a deleted artifact is never resurrected by completion');

  //? Force the old race: generation has read the brief but has not created its placeholder when
  //? deletion starts. The shared per-brief Redis owner lock makes delete wait, then removes both.
  const racedBrief = await prisma.studioBrief.create({ data: { workspaceId: workspaceA, name: 'Raced brief', productName: 'Race', audience: 'A', tone: 'Direct', goals: 'No orphan' } });
  let markBriefRead: () => void = () => undefined;
  let releaseGeneration: () => void = () => undefined;
  const briefRead = new Promise<void>((resolve) => { markBriefRead = resolve; });
  const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
  const generation = beginArtifact(prisma, { workspaceId: workspaceA, briefId: racedBrief.id, kind: 'copy' }, {
    afterBriefCheck: async () => { markBriefRead(); await generationGate; },
  });
  await briefRead;
  let deleteSettled = false;
  const racedDelete = deleteRoute.main({ data: { workspaceId: workspaceA, briefId: racedBrief.id }, user, functions }).then((result) => {
    deleteSettled = true;
    return result;
  });
  await wait(80);
  assert(!deleteSettled, 'brief deletion waits while generation owns the per-brief lock');
  releaseGeneration();
  const begun = await generation;
  const deletedRace = await racedDelete;
  assert(begun.ok && begun.artifactId !== undefined, 'the lock owner creates its placeholder before releasing');
  eq(deletedRace.status, 'success', 'the queued brief deletion succeeds after generation releases');
  eq(await prisma.studioBrief.count({ where: { id: racedBrief.id } }), 0, 'the raced brief is deleted');
  eq(await prisma.studioArtifact.count({ where: { workspaceId: workspaceA, briefId: racedBrief.id } }), 0, 'the forced delete/generate interleaving leaves no orphan artifact');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceA) await cleanupWorkspace(prisma, workspaceA, [memberA.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: memberA.id } }).catch(() => undefined);
  if (workspaceB) await cleanupWorkspace(prisma, workspaceB, [ownerB.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: ownerB.id } }).catch(() => undefined);
}

report('tests/integration/studioTenantIsolation.test.mts');
