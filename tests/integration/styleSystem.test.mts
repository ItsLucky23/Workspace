//? Integration test for F0.4 (cross-cutting style/preset system, ADR 0049). Real Conductor + Mongo.
//? Asserts: the global default styles seed idempotently; a feature+style resolves the right system-prompt
//? preset; a per-workspace (brand) style saved via the save-style control-op (B-23) WINS over the global;
//? free-form extra instructions are appended; an unknown style resolves to null (bare prompt).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { ensureDefaultStyles, resolveStyle, composeStylePrompt, listStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f04-${String(stamp)}@youcomm.nl`, name: 'CP F04' } });
let workspaceId: string | null = null;

try {
  //? Seed global defaults (idempotent — a 2nd call adds nothing).
  await ensureDefaultStyles(prisma);
  const before = await prisma.stylePreset.count({ where: { workspaceId: null } });
  await ensureDefaultStyles(prisma);
  eq(await prisma.stylePreset.count({ where: { workspaceId: null } }), before, 'ensureDefaultStyles is idempotent');
  assert(before >= 9, 'the default global styles are seeded');

  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F04 WS' }, userId: owner.id, clientRequestId: `f04-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? The global 'realistisch' image style resolves.
  const globalStyle = await resolveStyle(prisma, wsId, 'image-gen', 'realistisch');
  assert(globalStyle !== null, 'the global realistisch style resolves');
  assert((globalStyle?.systemPrompt ?? '').includes('photorealistic'), 'it carries the curated system prompt');

  //? An unknown style / no key → null.
  eq(await resolveStyle(prisma, wsId, 'image-gen', 'does-not-exist'), null, 'an unknown style resolves to null');
  eq(await resolveStyle(prisma, wsId, 'image-gen', null), null, 'no style key resolves to null');

  //? Compose: style prompt + free-form extra instructions.
  const composed = composeStylePrompt(globalStyle, 'zorg dat de T-Rex danst, bruine krullen');
  assert(composed.includes('photorealistic') && composed.includes('danst'), 'compose merges the style + the extra instructions');
  eq(composeStylePrompt(null, 'alleen dit'), 'alleen dit', 'a null style composes to just the extra instructions');

  //? Save a per-workspace (brand) override for the SAME key via the control-op (B-23).
  await enqueueControlAction({ workspaceId: wsId, op: 'save-style', target: {}, payload: { feature: 'image-gen', key: 'realistisch', label: 'Realistisch (merk)', systemPrompt: 'ultra-photoreal, OUR brand look, warm palette' }, userId: owner.id, clientRequestId: `f04-ss-${String(stamp)}` });
  const wsStyle = await poll(() => prisma.stylePreset.findFirst({ where: { workspaceId: wsId, feature: 'image-gen', key: 'realistisch' } }));
  assert(wsStyle !== null, 'the save-style op created a per-workspace style');

  //? The per-workspace style now WINS over the global for the same key.
  const resolved = await resolveStyle(prisma, wsId, 'image-gen', 'realistisch');
  assert((resolved?.systemPrompt ?? '').includes('OUR brand look'), 'the per-workspace style overrides the global default');
  eq(resolved?.label, 'Realistisch (merk)', 'the resolved style is the brand one');

  //? listStyles shadows the global with the workspace one (one entry per key).
  const list = await listStyles(prisma, wsId, 'image-gen');
  const realistisch = list.filter((s) => s.key === 'realistisch');
  eq(realistisch.length, 1, 'the workspace style shadows the global (one realistisch entry)');
  assert((realistisch[0]?.systemPrompt ?? '').includes('OUR brand look'), 'listStyles returns the workspace-overridden style');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/styleSystem.test.mts');
