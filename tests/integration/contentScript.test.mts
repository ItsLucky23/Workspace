//? Integration test for F1.2 (script + beats, ADR 0049). Real Conductor + Mongo. The content-gen-script
//? control-op turns a piece's brief into a Script + storyboard Beats. No API key → the content-script
//? service STUBS a valid-shaped script (dummy-data mode). Asserts: a script + N ordered beats are written,
//? the chosen style is resolved + linked, the resolved provider is recorded.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { ensureDefaultStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f12-${String(stamp)}@youcomm.nl`, name: 'CP F12' } });
let workspaceId: string | null = null;

try {
  await ensureDefaultStyles(prisma);
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F12 WS' }, userId: owner.id, clientRequestId: `f12-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f12-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Dino explainer', brief: 'a story about dinosaurs and how they lived', format: 'faceless' }, userId: owner.id, clientRequestId: `f12-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Dino explainer' } }));
  const pieceId = piece?.id ?? '';

  //? Generate the script + beats with a style + extra instructions (stub, no key).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-script', target: {}, payload: { contentProjectId: pieceId, styleKey: 'storytelling', extraInstructions: 'keep it energetic and kid-friendly' }, userId: owner.id, clientRequestId: `f12-gs-${String(stamp)}` });

  const script = await poll(() => prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId } }));
  assert(script !== null, 'content-gen-script wrote a Script (Conductor is the writer)');
  assert((script?.body ?? '').length > 0, 'the script has a non-empty body');
  eq(script?.providerId, 'gemini-api', 'the resolved provider (gemini) is recorded');

  const globalStyle = await prisma.stylePreset.findFirst({ where: { workspaceId: null, feature: 'script', key: 'storytelling' } });
  eq(script?.styleId, globalStyle?.id, 'the chosen style is resolved + linked onto the script');

  const beats = await prisma.beat.findMany({ where: { workspaceId: wsId, scriptId: script?.id ?? '' }, orderBy: { order: 'asc' } });
  eq(beats.length, 4, 'the script is split into storyboard beats');
  eq(beats[0]?.order, 0, 'beats are ordered from 0');
  assert((beats[0]?.visualPrompt ?? '').length > 0, 'each beat carries a visual prompt (drives the per-beat image)');
  assert((beats[0]?.text ?? '').toLowerCase().includes('dino'), 'the beats reflect the brief topic');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentScript.test.mts');
