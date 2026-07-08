//? V5 audio-track — the content-save-audio-mix control-op persists the piece's voice/music gains (clamped)
//? through the REAL Conductor + Mongo, and the snapshot surfaces them + the audio asset urls for the
//? timeline's audio track. Creates + cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `am-${String(stamp)}@youcomm.nl`, name: 'AM' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'AM WS' }, userId: owner.id, clientRequestId: `am-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));

  //? A content piece with a voice + music asset. Defaults: voiceVolume 1, musicVolume 0.25.
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', title: 'Mix Test' } });
  eq(piece.voiceVolume, 1, 'default voiceVolume is 1');
  eq(piece.musicVolume, 0.25, 'default musicVolume is 0.25 (ducked)');
  await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'voice', url: '/media/voice-x.mp3', status: 'ready' } });
  await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'music', url: '/media/music-x.mp3', status: 'ready' } });

  //? The op persists new gains, clamped to their ranges.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-save-audio-mix', target: {}, payload: { contentProjectId: piece.id, voiceVolume: 1.4, musicVolume: 0.5 }, userId: owner.id, clientRequestId: `am-1-${String(stamp)}` });
  const saved = await poll(async () => { const p = await prisma.contentProject.findUnique({ where: { id: piece.id } }); return p && p.voiceVolume === 1.4 ? p : null; });
  assert(saved !== null, 'the op persists the voice + music gains');
  eq(saved?.musicVolume, 0.5, 'music gain persisted');

  //? Out-of-range values are clamped (voice ≤ 2, music ≤ 1).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-save-audio-mix', target: {}, payload: { contentProjectId: piece.id, voiceVolume: 9, musicVolume: 9 }, userId: owner.id, clientRequestId: `am-2-${String(stamp)}` });
  const clamped = await poll(async () => { const p = await prisma.contentProject.findUnique({ where: { id: piece.id } }); return p && p.voiceVolume === 2 ? p : null; });
  eq(clamped?.voiceVolume, 2, 'voice gain clamped to 2');
  eq(clamped?.musicVolume, 1, 'music gain clamped to 1');

  //? The snapshot surfaces the gains + the audio asset urls for the timeline audio track.
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  const snapPiece = snap.content.pieces.find((p) => p.id === piece.id);
  eq(snapPiece?.voiceVolume, 2, 'snapshot carries voiceVolume');
  eq(snapPiece?.voiceUrl, '/media/voice-x.mp3', 'snapshot carries the voice asset url');
  eq(snapPiece?.musicUrl, '/media/music-x.mp3', 'snapshot carries the music asset url');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/audioMixOp.test.mts');
