//? Integration test for F3.3 (automation + conversational entry, ADR 0067). Real Conductor + Mongo.
//? (1) A scheduled trigger invoking the content-ideator role is GATED to an approval suggestion — it never
//? writes content directly (B-23, the role mutates). (2) content-from-brief spins up a content project +
//? a first piece from a chat brief.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { runTriggerAction } = await import('../../server/automation/executor');
const { registerContentIdeatorRole } = await import('../../server/content/ideatorRole');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

//? Roles register at boot; this test drives the engine directly, so register it here.
registerContentIdeatorRole();

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f33-${String(stamp)}@youcomm.nl`, name: 'CP F33' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F33 WS' }, userId: owner.id, clientRequestId: `f33-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? (1) A scheduled content-ideator role → an approval suggestion, NOT a direct content write.
  const outcome = await runTriggerAction(prisma, wsId, { action: 'invoke-agent-role', params: { role: 'content-ideator', theme: 'gaming' }, triggerName: 'weekly ideas' }, false);
  eq(outcome.status, 'gated', 'a mutating content role is gated to a suggestion (not executed directly)');
  const suggestion = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'automation' } }));
  assert(suggestion !== null, 'the scheduled content role created an approval suggestion');
  eq(await prisma.contentProject.count({ where: { workspaceId: wsId } }), 0, 'NO content was written directly by the scheduled role (B-23)');

  //? (2) Conversational quick-start: a chat brief spins up a content project + a first piece.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { brief: 'a video about startup A for school', title: 'Startup A explainer', channelName: 'School' }, userId: owner.id, clientRequestId: `f33-fb-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Startup A explainer' } }));
  assert(piece !== null, 'content-from-brief spun up a content piece from the chat brief');
  eq(piece?.brief, 'a video about startup A for school', 'the brief is carried onto the piece');
  const proj = await prisma.project.findFirst({ where: { workspaceId: wsId, id: piece?.projectId ?? '' } });
  eq(proj?.projectType, 'content', 'it created a content-lane project');
  eq(proj?.name, 'School', 'the channel name is used for the project');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentAutomation.test.mts');
