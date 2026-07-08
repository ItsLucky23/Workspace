//? H1 — the admin/security audit trail through the REAL Conductor + Mongo. Verifies: governance ops (save-env,
//? change-role, invite) each append an immutable AuditLog row with the actor + action + target, the secret VALUE
//? is NEVER logged, and listAuditLog returns them newest-first with the actor's name resolved.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { listAuditLog } = await import('../../server/control/audit');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `au-owner-${String(stamp)}@youcomm.nl`, name: 'Owner' } });
const member = await prisma.user.create({ data: { email: `au-member-${String(stamp)}@youcomm.nl`, name: 'Member' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Audit WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: member.id, roleKey: 'member' } });

  await enqueueControlAction({ workspaceId: wsId, op: 'save-env', target: {}, payload: { key: 'API_SECRET', value: 'super-secret-value', secret: true }, userId: owner.id, clientRequestId: `au-env-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'change-role', target: { memberId: member.id }, payload: { roleKey: 'admin' }, userId: owner.id, clientRequestId: `au-role-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'invite', target: {}, payload: { email: `new-${String(stamp)}@x.com`, roleKey: 'member' }, userId: owner.id, clientRequestId: `au-inv-${String(stamp)}` });

  const rows = await poll(async () => {
    const r = await prisma.auditLog.findMany({ where: { workspaceId: wsId } });
    return r.length >= 3 ? r : null;
  });
  assert(rows !== null, 'the three governance ops each appended an audit row');
  const actions = (rows ?? []).map((r) => r.action);
  assert(actions.includes('save-env') && actions.includes('change-role') && actions.includes('invite'), 'each op is recorded by name');

  //? The secret VALUE is never logged — only the fact + the key.
  const envRow = (rows ?? []).find((r) => r.action === 'save-env');
  eq(envRow?.target, 'API_SECRET', 'the env KEY is the audit target');
  assert(!JSON.stringify(envRow?.metadata ?? {}).includes('super-secret-value'), 'the secret VALUE is NOT in the audit metadata');
  const roleRow = (rows ?? []).find((r) => r.action === 'change-role');
  eq(roleRow?.target, member.id, 'change-role targets the member');
  eq(roleRow?.actorId, owner.id, 'the actor (owner) is recorded');

  //? listAuditLog resolves the actor name + is newest-first.
  const view = await listAuditLog(prisma, wsId);
  assert(view.length >= 3, 'the audit view lists the entries');
  assert(view.every((e) => e.actorName === 'Owner'), 'the actor name is resolved (Owner)');
  for (let i = 1; i < view.length; i++) assert(view[i - 1].createdAt >= view[i].createdAt, 'the view is newest-first');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, member.id]).catch(() => undefined);
  else await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } }).catch(() => undefined);
}

report('tests/integration/auditLog.test.mts');
