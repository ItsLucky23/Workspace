//? Prompt grounding — proves the content best-practices + the workspace's inspiration references are actually
//? INJECTED into the script model prompt (not just retrievable). A spy captures the composed `system` string
//? that generateScript passes to the model, so a regression that drops either from the prompt fails here.
//? Real Mongo + local embedder; cleans up.

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { generateScript } = await import('../../server/content/script');
const { ensureContentPlaybook, PLAYBOOK_WS, PLAYBOOK_COMMIT } = await import('../../server/rag/contentPlaybook');
const { addReference } = await import('../../server/content/referenceLibrary');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 9000, stepMs = 80): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sg-${String(stamp)}@youcomm.nl`, name: 'SG' } });
let workspaceId: string | null = null;

try {
  await ensureContentPlaybook(prisma); // global corpus (idempotent)
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'SG WS' }, userId: owner.id, clientRequestId: `sg-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));

  //? A distinctive inspiration reference in this workspace.
  await addReference(prisma, wsId, { kind: 'ad', title: 'Winning ad', description: 'ZZZ_UNIQUE_MARKER problem-agitation-solution with one clear call-to-action' });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', title: 'Hook', brief: 'how to hook viewers in the first seconds of an ad' } });

  //? A spy captures the composed system prompt.
  let capturedSystem = '';
  const spy = (_feature: string, req: { system?: string }) => {
    capturedSystem = req.system ?? '';
    return Promise.resolve({ ok: true, text: '{"body":"b","beats":[{"text":"a beat","visualPrompt":"a shot"}]}', providerId: 'spy' });
  };
  const opts = { complete: spy } as unknown as Parameters<typeof generateScript>[2];

  await generateScript(prisma, { workspaceId: wsId, contentProjectId: piece.id, brief: 'how to hook viewers in the first seconds of an ad' }, opts);

  assert(capturedSystem.length > 0, 'a system prompt was composed + passed to the model');
  assert(/best-practices/i.test(capturedSystem), 'the composed prompt injects the content best-practices section');
  assert(/hook|3 seconds|retention/i.test(capturedSystem), 'the injected best-practices are relevant to the brief (a hook chunk)');
  assert(/inspiration library/i.test(capturedSystem) && /ZZZ_UNIQUE_MARKER/.test(capturedSystem), 'the composed prompt injects the workspace reference example');
  console.log('[sg] ✓ script prompt injects best-practices + the inspiration reference');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) { await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: 'reference' } }).catch(() => null); await cleanupWorkspace(prisma, workspaceId, [owner.id]); }
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
  await prisma.ragEntry.deleteMany({ where: { workspaceId: PLAYBOOK_WS, commitHash: PLAYBOOK_COMMIT } }).catch(() => null);
}

report('tests/integration/scriptGrounding.test.mts');
