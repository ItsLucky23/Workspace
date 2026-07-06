//? Integration test for F1.3 (voiceover + per-beat timing, ADR 0049). Real Conductor + Mongo. Runs the full
//? metered path on dummy data: budget-check → tts stub gen → voice ContentAsset + MediaJob + recordMediaSpend
//? + per-beat timing. Also asserts the €-budget BLOCK path (a too-low cap stops the gen). Self-cleans.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { ensureDefaultStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}
async function genPiece(wsId: string, projectId: string, title: string, owner: string, stamp: number): Promise<string> {
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId, title, brief: `a story about ${title}`, format: 'faceless' }, userId: owner, clientRequestId: `cc-${title}-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title } }));
  const id = piece?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-script', target: {}, payload: { contentProjectId: id }, userId: owner, clientRequestId: `gs-${title}-${String(stamp)}` });
  await poll(() => prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: id } }));
  return id;
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f13-${String(stamp)}@youcomm.nl`, name: 'CP F13' } });
let workspaceId: string | null = null;

try {
  await ensureDefaultStyles(prisma);
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F13 WS' }, userId: owner.id, clientRequestId: `f13-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? A generous media budget so the debit is observable.
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f13-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f13-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  const projId = cproj?.id ?? '';

  const piece1 = await genPiece(wsId, projId, 'dinos', owner.id, stamp);
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-voice', target: {}, payload: { contentProjectId: piece1, styleKey: 'narrator' }, userId: owner.id, clientRequestId: `f13-gv1-${String(stamp)}` });

  const voice = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: piece1, kind: 'voice' } }));
  assert(voice !== null, 'content-gen-voice produced a voice asset');
  assert((voice?.url ?? '').startsWith('stub://voice/'), 'the voice asset is a valid-shaped stub');
  const job = await prisma.mediaJob.findFirst({ where: { workspaceId: wsId, contentProjectId: piece1, feature: 'tts' } });
  assert(job !== null, 'a tts MediaJob was recorded');
  eq(job?.resultAssetId, voice?.id, 'the MediaJob links its result asset');
  eq(job?.providerId, 'elevenlabs', 'tts routed to elevenlabs');

  const meta = (voice?.metadata ?? {}) as { totalMs?: number; timing?: unknown[] };
  assert((meta.totalMs ?? 0) > 0, 'the voice asset records a total duration');
  eq(meta.timing?.length, 4, 'the timing map covers all 4 beats');

  const beats = await prisma.beat.findMany({ where: { workspaceId: wsId, contentProjectId: piece1 } });
  assert(beats.every((b) => (b.durationMs ?? 0) >= 1500), 'each beat got a persisted duration');

  const spend = await prisma.mediaSpend.count({ where: { workspaceId: wsId, feature: 'tts' } });
  eq(spend, 1, 'a media-spend ledger row was written');
  const budget = await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } });
  eq(budget?.spentCents, 2, 'the tts stub cost (2c) debited the media budget');

  //? BLOCK path: set the cap to exactly the spend → remaining 0 → the next voiceover is blocked.
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 2, enabled: true }, userId: owner.id, clientRequestId: `f13-eb2-${String(stamp)}` });
  await poll(async () => ((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.capCents === 2 ? true : null));
  const piece2 = await genPiece(wsId, projId, 'volcanoes', owner.id, stamp);
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-voice', target: {}, payload: { contentProjectId: piece2 }, userId: owner.id, clientRequestId: `f13-gv2-${String(stamp)}` });
  await wait(400);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: piece2, kind: 'voice' } }), 0, 'a voiceover over the budget cap is blocked (no asset)');
  eq((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.spentCents, 2, 'a blocked gen does not debit further');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentVoice.test.mts');
