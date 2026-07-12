//? LIVE Docker proof (K3) — provision the mailpit preset (tiny image) through the REAL conductor op, then
//? verify: the connection-string EnvVars were published, resolveWorkspaceEnv would inject them, the compose
//? stack is actually up, and teardown removes both the stack and the EnvVars. Throwaway (job tmp).

import { db, cleanupWorkspace } from '../../../../../code/Workspace/tests/_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../../../../code/Workspace/server/orchestrator/conductor.ts');
const { createBlankWorkspace } = await import('../../../../../code/Workspace/server/bootstrap/seedWorkspace.ts');
const { resolveWorkspaceEnv } = await import('../../../../../code/Workspace/server/container/serviceEnv.ts');
const { docker } = await import('../../../../../code/Workspace/server/container/runtime.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `live-svc-${String(stamp)}@youcomm.nl`, name: 'Live' } });
let wsId = '';
const log = (m: string) => console.log(`[live] ${m}`);

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Live SVC WS');
  wsId = created.workspaceId;

  log('provisioning mailpit preset via the conductor op (real docker compose up)…');
  const res = await enqueueControlAction({ workspaceId: wsId, op: 'service-provision', target: {}, payload: { name: 'mail', preset: 'mailpit' }, userId: owner.id, clientRequestId: `live-prov-${String(stamp)}` });
  log(`provision result: ${JSON.stringify(res.result)}`);

  //? Poll for the ServiceStack to reach running.
  let stack = null;
  for (let i = 0; i < 60; i++) {
    stack = await prisma.serviceStack.findFirst({ where: { workspaceId: wsId, name: 'mail' } });
    if (stack?.status === 'running') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  log(`ServiceStack status: ${stack?.status ?? 'MISSING'}`);

  //? K3 — the connection-string EnvVars were published + are what a container gets injected.
  const env = await resolveWorkspaceEnv(prisma, wsId);
  log(`SMTP_HOST=${env.SMTP_HOST ?? '(none)'} SMTP_PORT=${env.SMTP_PORT ?? '(none)'} MAILPIT_WEB=${env.MAILPIT_WEB ?? '(none)'}`);
  const published = env.SMTP_HOST === 'mailpit' && env.SMTP_PORT === '1025';
  log(published ? 'PASS: connection-string env published + injectable' : 'FAIL: env not published');

  //? The compose project is really up (docker ps for the namespaced project).
  const ps = await docker(['ps', '--filter', `name=ws-${wsId}-mail`, '--format', '{{.Names}} {{.Status}}']);
  log(`docker ps: ${ps.out.trim() || '(none)'}`);

  log('tearing down…');
  await enqueueControlAction({ workspaceId: wsId, op: 'service-teardown', target: {}, payload: { name: 'mail' }, userId: owner.id, clientRequestId: `live-tear-${String(stamp)}` });
  await new Promise((r) => setTimeout(r, 2000));
  const envAfter = await resolveWorkspaceEnv(prisma, wsId);
  log(envAfter.SMTP_HOST === undefined ? 'PASS: teardown removed the connection-string EnvVars' : 'FAIL: env survived teardown');
  const psAfter = await docker(['ps', '--filter', `name=ws-${wsId}-mail`, '--format', '{{.Names}}']);
  log(`docker ps after teardown: ${psAfter.out.trim() || '(empty — good)'}`);
} catch (e) {
  log(`ERROR: ${String(e)}`);
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  log('done');
}
