//? Integration test for #90 (run-command executor) — a LIVE docker round-trip. Fires the executor's
//? run-command action against a real labelled ticket container and asserts the command ran IN the container
//? (its output lands as a member notification with the exit code). Also proves it's a clean noop without a
//? ticket/container. Skips when Docker is unavailable. Run: `npx tsx tests/integration/runCommandExec.test.mts`.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const executor = await import('../../server/automation/executor');
const { docker, dockerAvailable, containerName } = await import('../../server/container/runtime');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rc-${String(stamp)}@youcomm.nl`, name: 'RC Owner' } });
let workspaceId: string | null = null;
const TICKET = 'DEV-7001';
let container = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'RC WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  container = containerName(wsId, TICKET);

  //? Without a ticketKey/command it is a clean noop (never a throw).
  eq((await executor.executeTriggerAction(prisma, wsId, { action: 'run-command', params: {} })).status, 'noop', 'run-command with no command/ticket is a noop');

  if (!(await dockerAvailable())) {
    console.log('[runCommandExec] docker unavailable — skipping the live in-container run (structural path covered)');
  } else {
    //? A labelled "ours" ticket container (what run-command execs into).
    await docker(['rm', '-f', container]);
    const run = await docker(['run', '-d', '--label', `org.workspaces.workspace=${wsId}`, '--name', container, 'alpine', 'sleep', '120']);
    assert(run.code === 0, 'the labelled ticket container started');
    await docker(['exec', container, 'sh', '-c', 'mkdir -p /work']);

    const ok = await executor.executeTriggerAction(prisma, wsId, { action: 'run-command', params: { command: 'echo hello-from-container' }, ticketKey: TICKET, triggerName: 'CmdTest' });
    eq(ok.status, 'executed', 'run-command executed in the container (exit 0)');
    const notif = await prisma.notification.findFirst({ where: { workspaceId: wsId, type: 'automation', title: { contains: 'exit 0' } }, orderBy: { createdAt: 'desc' } });
    assert(notif !== null, 'the command result landed as a notification');
    assert((notif?.body ?? '').includes('hello-from-container'), 'the notification carries the real command STDOUT from inside the container');

    //? A failing command surfaces a non-zero exit as an error outcome (still best-effort, no throw).
    const bad = await executor.executeTriggerAction(prisma, wsId, { action: 'run-command', params: { command: 'exit 3' }, ticketKey: TICKET, triggerName: 'CmdFail' });
    eq(bad.status, 'error', 'a non-zero command is an error outcome');
    assert((bad.detail ?? '').includes('3'), 'the non-zero exit code is reported');
  }
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (container) await docker(['rm', '-f', container]).catch(() => undefined);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/runCommandExec.test.mts');
