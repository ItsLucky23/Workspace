//? Integration test for F4.3 (AI-drives-UI copilot, ADR 0070). Real Conductor + Mongo. The copilot PROPOSES
//? a UI directive (navigate + pre-fill + the op to run) as a suggestion — it NEVER writes authoritative
//? state (B-23). The client applies the navigate/pre-fill; the user confirms the underlying control-op.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { validateCopilot } = await import('../../server/ai/workspaceChat');

//? #109 — the chat PRODUCER: validateCopilot accepts a known nav target + note (+ string prefill), rejects the rest.
{
  const ok = validateCopilot({ navigate: 'content', note: 'Create your video here', prefill: { title: 'Launch', brief: 'about X', bad: 5 } });
  assert(ok !== null && ok.navigate === 'content' && ok.note.length > 0, 'a valid copilot directive validates');
  eq(ok?.prefill?.title, 'Launch', 'string prefill hints are carried');
  assert(ok?.prefill !== undefined && !('bad' in ok.prefill), 'non-string prefill values are dropped');
  eq(validateCopilot({ navigate: 'nope', note: 'x' }), null, 'an unknown nav target is rejected (no invented routes)');
  eq(validateCopilot({ navigate: 'content', note: '' }), null, 'an empty note is rejected');
  eq(validateCopilot(null), null, 'a null directive is rejected');
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f43-${String(stamp)}@youcomm.nl`, name: 'CP F43' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F43 WS' }, userId: owner.id, clientRequestId: `f43-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? The copilot proposes: "go to the content view + pre-fill a new-piece form".
  await enqueueControlAction({ workspaceId: wsId, op: 'copilot-propose', target: {}, payload: { title: 'Make a dino video', note: 'I can set this up — confirm?', navigate: 'content', prefill: { title: 'Dino explainer', format: 'faceless', brief: 'a story about dinosaurs' }, op: 'content-from-brief' }, userId: owner.id, clientRequestId: `f43-cp-${String(stamp)}` });

  const suggestion = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'copilot' } }));
  assert(suggestion !== null, 'the copilot created a proposal suggestion');
  eq(await prisma.contentProject.count({ where: { workspaceId: wsId } }), 0, 'the copilot wrote NOTHING authoritative (B-23) — only a proposal');

  const patch = (suggestion?.patch ?? {}) as { navigate?: string; prefill?: { title?: string; format?: string }; op?: string };
  eq(patch.navigate, 'content', 'the directive tells the client where to navigate');
  eq(patch.prefill?.title, 'Dino explainer', 'the directive carries the form pre-fill');
  eq(patch.prefill?.format, 'faceless', 'the pre-fill includes all the form fields');
  eq(patch.op, 'content-from-brief', 'the directive names the underlying control-op the user confirms');

  //? The user confirms → runs the underlying control-op (the Conductor writes, NOT the copilot).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { title: patch.prefill?.title, format: patch.prefill?.format, brief: 'a story about dinosaurs' }, userId: owner.id, clientRequestId: `f43-run-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Dino explainer' } }));
  assert(piece !== null, 'confirming the directive runs the control-op → the content piece is created');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/copilot.test.mts');
