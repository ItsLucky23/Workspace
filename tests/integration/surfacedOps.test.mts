//? Integration test for the surfacing round: the write paths the new UI actually fires — the prompt-A/B
//? experiment ops (G7), the caption-style persistence behind the piece UI (F2), and the asset-star op the
//? shared picker uses (G4). Real Mongo, real Conductor.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { dispatchControlSync } = await import('../../server/control/dispatchSync');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { resolvePromptVariant } = await import('../../server/ai/promptExperiment');
const { listLibrary } = await import('../../server/content/assetLibrary');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `srf-${String(stamp)}@youcomm.nl`, name: 'SRF' } });
let workspaceId: string | null = null;
let seq = 0;
const reqId = (tag: string): string => { seq += 1; return `srf-${tag}-${String(stamp)}-${String(seq)}`; };

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'SRF WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId }, select: { id: true } });
  const projectId = project?.id ?? wsId;

  /* ---------------------------------------------- G7: start / replace / stop an experiment */
  await enqueueControlAction({
    workspaceId: wsId, op: 'prompt-experiment-save', target: {}, userId: owner.id, clientRequestId: reqId('exp1'),
    payload: { feature: 'script', name: 'Hook style', variantA: 'Open with a question.', variantB: 'Open with a number.' },
  });
  const running = await prisma.promptExperiment.findFirst({ where: { workspaceId: wsId, feature: 'script', status: 'running' } });
  assert(running !== null, 'the settings panel can start an experiment');
  eq(running?.name, 'Hook style', 'with its name');

  //? The invariant that keeps results readable: starting a SECOND experiment on the same feature retires
  //? the first, instead of running two overlapping tests nobody can interpret.
  await enqueueControlAction({
    workspaceId: wsId, op: 'prompt-experiment-save', target: {}, userId: owner.id, clientRequestId: reqId('exp2'),
    payload: { feature: 'script', name: 'Length', variantA: 'Be terse.', variantB: 'Be vivid.' },
  });
  eq(await prisma.promptExperiment.count({ where: { workspaceId: wsId, feature: 'script', status: 'running' } }), 1, 'only ONE experiment per feature runs at a time');
  eq((await prisma.promptExperiment.findFirst({ where: { workspaceId: wsId, id: running?.id ?? '' }, select: { status: true } }))?.status, 'stopped', 'the previous one was retired, not deleted');

  //? A different feature is independent.
  await enqueueControlAction({
    workspaceId: wsId, op: 'prompt-experiment-save', target: {}, userId: owner.id, clientRequestId: reqId('exp3'),
    payload: { feature: 'interviewer', name: 'Tone', variantA: 'Blunt.', variantB: 'Coaching.' },
  });
  eq(await prisma.promptExperiment.count({ where: { workspaceId: wsId, status: 'running' } }), 2, 'experiments on other features keep running');

  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId, title: 'Surfaced piece' } });
  const resolved = await resolvePromptVariant(prisma, wsId, 'script', piece.id);
  assert(resolved !== null, 'the running experiment now assigns a variant to real work');
  assert(resolved?.prompt === 'Be terse.' || resolved?.prompt === 'Be vivid.', 'and hands back one of the two variants');

  //? Stopping keeps the trials (the record of what each variant achieved is the whole point).
  await prisma.promptTrial.create({ data: { workspaceId: wsId, experimentId: resolved?.experimentId ?? '', subjectId: piece.id, variant: resolved?.variant ?? 'a', score: 42 } });
  await enqueueControlAction({
    workspaceId: wsId, op: 'prompt-experiment-stop', target: {}, userId: owner.id, clientRequestId: reqId('stop'),
    payload: { experimentId: resolved?.experimentId ?? '' },
  });
  eq(await prisma.promptExperiment.count({ where: { workspaceId: wsId, status: 'running' } }), 1, 'stopping ends only that experiment');
  eq(await prisma.promptTrial.count({ where: { workspaceId: wsId } }), 1, 'and its measured trials are KEPT');
  eq(await resolvePromptVariant(prisma, wsId, 'script', piece.id), null, 'a stopped experiment stops assigning variants');

  //? RBAC: prompts steer every AI run, so a non-member cannot touch them.
  const outsider = await prisma.user.create({ data: { email: `srf-out-${String(stamp)}@youcomm.nl`, name: 'OUT' } });
  const denied = await dispatchControlSync({
    op: 'prompt-experiment-save', roomCode: wsId, userId: outsider.id, prisma,
    payload: { feature: 'script', name: 'evil', variantA: 'a', variantB: 'b' }, clientRequestId: reqId('deny'),
  });
  assert(!denied.ok, 'a non-member cannot start an experiment');
  await prisma.user.delete({ where: { id: outsider.id } }).catch(() => null);

  /* ---------------------------------------------- F2: the caption style the piece UI sends is persisted */
  await enqueueControlAction({
    workspaceId: wsId, op: 'content-run-pipeline', target: {}, userId: owner.id, clientRequestId: reqId('cc'),
    payload: { contentProjectId: piece.id, mode: 'video', captionMode: 'burn', captionStyle: { fontSize: 34, color: 'ffcc00', boxed: true, wordByWord: true } },
  });
  const styled = await prisma.contentProject.findUnique({ where: { id: piece.id }, select: { captionMode: true, captionStyle: true } });
  eq(styled?.captionMode, 'burn', 'the caption mode is stored');
  const style = styled?.captionStyle !== null && typeof styled?.captionStyle === 'object' ? styled.captionStyle as Record<string, unknown> : {};
  eq(style.fontSize, 34, 'the chosen size survives to the render');
  eq(style.wordByWord, true, 'as does the word-by-word choice');

  //? Junk is refused rather than stored: a bad value must never reach an ffmpeg filtergraph.
  await enqueueControlAction({
    workspaceId: wsId, op: 'content-run-pipeline', target: {}, userId: owner.id, clientRequestId: reqId('ccbad'),
    payload: { contentProjectId: piece.id, mode: 'video', captionStyle: { fontSize: 9000, color: 'drop table' } },
  });
  eq((await prisma.contentProject.findUnique({ where: { id: piece.id }, select: { captionStyle: true } }))?.captionStyle, null, 'an unusable style clears back to the plain default');

  /* ---------------------------------------------- G4: the picker's star op */
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: '/media/surf.png', status: 'ready' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'asset-star', target: {}, userId: owner.id, clientRequestId: reqId('star'), payload: { assetId: asset.id, starred: true } });
  eq((await listLibrary(prisma, wsId))[0]?.starred, true, 'starring from the picker reaches the library');
  await enqueueControlAction({ workspaceId: wsId, op: 'asset-star', target: {}, userId: owner.id, clientRequestId: reqId('unstar'), payload: { assetId: asset.id, starred: false } });
  eq((await listLibrary(prisma, wsId))[0]?.starred, false, 'and un-starring works too');
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('surfacedOps');
