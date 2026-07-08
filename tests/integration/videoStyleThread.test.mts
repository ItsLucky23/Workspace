//? M2 — the DB side: a saved per-workspace VIDEO-GEN style resolves for the scene decomposition, so
//? decompose (which now threads styleKey) carries it into every clip. Real Mongo; cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { resolveStyle } = await import('../../server/content/styles');
const { buildSceneRequest } = await import('../../server/content/sceneDecompose');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `vs-${String(stamp)}@youcomm.nl`, name: 'VS' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'VS WS' }, userId: owner.id, clientRequestId: `vs-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? A workspace video-gen style ("stick-man").
  await prisma.stylePreset.create({ data: { workspaceId: wsId, feature: 'video-gen', key: 'stick-man', label: 'Stick-man', systemPrompt: 'stick-man figures, minimalist black line art on white', builtin: false } });

  //? resolveStyle picks it up — this is exactly what decomposeIntoScenes resolves before generating scenes.
  const resolved = await resolveStyle(prisma, wsId, 'video-gen', 'stick-man');
  assert(resolved !== null, 'the saved video-gen style resolves for decomposition');
  eq(resolved?.key, 'stick-man', 'the resolved style is the stick-man style');
  assert((resolved?.systemPrompt ?? '').includes('stick-man'), 'the resolved style carries its systemPrompt');

  //? …and that resolved style rides the scene request (the M2 fix, end-to-end from DB → request).
  const req = buildSceneRequest('a rocket launches', 1, wsId, resolved ? { key: resolved.key, systemPrompt: resolved.systemPrompt } : undefined);
  eq(req.style?.key, 'stick-man', 'the saved style reaches the scene-gen request');
  console.log(`[vs] ✓ style "${resolved?.key ?? ''}" resolves + rides the scene request`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/videoStyleThread.test.mts');
