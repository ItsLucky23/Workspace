//? Test for FREEDOM_PROGRAM E5 — user-defined custom AI tasks. Verifies renderTaskPrompt substitutes
//? {{variables}}, and the save/run/delete ops manage a task through the single-writer Conductor. Running is
//? propose/generate: it only ever writes the task's own lastOutput — never authoritative state (no tickets/
//? assets created). Real Conductor + Mongo; the provider may stub without keys (the run just returns cleanly).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { renderTaskPrompt } = await import('../../server/ai/customTask');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

// pure template rendering
{
  eq(renderTaskPrompt('Hi {{name}}, write about {{topic}}.', { name: 'Sam', topic: 'AI' }), 'Hi Sam, write about AI.', 'variables substituted');
  eq(renderTaskPrompt('{{missing}} ok', {}), ' ok', 'a missing variable → empty');
  eq(renderTaskPrompt('{{ spaced }}', { spaced: 'X' }), 'X', 'whitespace inside braces tolerated');
  eq(renderTaskPrompt('no vars here'), 'no vars here', 'a template without vars is unchanged');
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cat-${String(stamp)}@youcomm.nl`, name: 'CAT' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'CAT WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  // save (create)
  await enqueueControlAction({ workspaceId: wsId, op: 'save-custom-task', target: {}, payload: { name: 'Blog outline', promptTemplate: 'Outline a post about {{topic}}.' }, userId: owner.id, clientRequestId: `cat-1-${String(stamp)}` });
  const tasks = await prisma.customAiTask.findMany({ where: { workspaceId: wsId } });
  eq(tasks.length, 1, 'the task was created');
  const task = tasks[0];
  eq(task.name, 'Blog outline', 'name persisted');

  // save (update)
  await enqueueControlAction({ workspaceId: wsId, op: 'save-custom-task', target: {}, payload: { taskId: task.id, name: 'Blog outline v2', promptTemplate: task.promptTemplate }, userId: owner.id, clientRequestId: `cat-2-${String(stamp)}` });
  eq((await prisma.customAiTask.findUnique({ where: { id: task.id } }))?.name, 'Blog outline v2', 'update renamed the task');
  eq(await prisma.customAiTask.count({ where: { workspaceId: wsId } }), 1, 'update did not create a duplicate');

  // run — never throws + never creates authoritative state
  const ticketsBefore = await prisma.ticket.count({ where: { workspaceId: wsId } });
  let threw = false;
  try { await enqueueControlAction({ workspaceId: wsId, op: 'run-custom-task', target: {}, payload: { taskId: task.id, vars: { topic: 'gardening' } }, userId: owner.id, clientRequestId: `cat-3-${String(stamp)}` }); } catch { threw = true; }
  assert(!threw, 'running a task never throws');
  eq(await prisma.ticket.count({ where: { workspaceId: wsId } }), ticketsBefore, 'running a task creates NO authoritative state (no tickets)');
  eq(await prisma.customAiTask.count({ where: { workspaceId: wsId } }), 1, 'still exactly one task after a run');

  // delete
  await enqueueControlAction({ workspaceId: wsId, op: 'delete-custom-task', target: {}, payload: { taskId: task.id }, userId: owner.id, clientRequestId: `cat-4-${String(stamp)}` });
  eq(await prisma.customAiTask.count({ where: { workspaceId: wsId } }), 0, 'the task was deleted');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/customAiTask.test.mts');
