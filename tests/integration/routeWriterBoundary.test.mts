//? Legacy typed-route migration seam: account writes enter the global Conductor scope; workspace writes enter
//? tenant scope under the workspace writer/lease and append a processed durable signal. No HTTP server needed.

import { tryCatchSync } from '@luckystack/core';
import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { currentWorkspaceId } from '../../server/tenant/tenantContext.ts';
import { currentWriterScope, GLOBAL_WRITER_SCOPE } from '../../server/orchestrator/writerContext.ts';

const prisma = await db();
const { enqueueGlobalRouteWrite, enqueueWorkspaceRouteWrite } = await import('../../server/orchestrator/conductor.ts');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `route-writer-${String(stamp)}@example.com`, name: 'Route writer' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Route writer boundary');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  const globalScope = await enqueueGlobalRouteWrite(
    { kind: 'test-account-write', userId: owner.id, clientRequestId: `global-${String(stamp)}` },
    async () => currentWriterScope(),
  );
  eq(globalScope, GLOBAL_WRITER_SCOPE, 'account route writes execute inside the global Conductor scope');
  eq(currentWriterScope(), null, 'global writer context does not leak after completion');

  const observed = await enqueueWorkspaceRouteWrite(
    wsId,
    { kind: 'test-workspace-write', userId: owner.id, clientRequestId: `workspace-${String(stamp)}` },
    async () => {
      const writerScope = currentWriterScope();
      const tenantScope = currentWorkspaceId();
      const note = await prisma.workspaceNote.create({ data: { workspaceId: wsId, authorKind: 'user', authorId: owner.id, body: 'written by route seam' } });
      return { writerScope, tenantScope, noteId: note.id };
    },
  );
  eq(observed.writerScope, wsId, 'workspace route writes execute inside the matching writer scope');
  eq(observed.tenantScope, wsId, 'workspace route writes execute inside runInTenant');
  assert(await prisma.workspaceNote.findFirst({ where: { workspaceId: wsId, id: observed.noteId } }) !== null, 'the authoritative write persisted');

  const signal = await prisma.workspaceSignal.findFirst({ where: { workspaceId: wsId, kind: 'route.test-workspace-write' }, orderBy: { seq: 'desc' } });
  assert(signal !== null, 'workspace route write appends a durable signal');
  assert(signal?.processedAt instanceof Date, 'the signal is marked processed only after the write completes');
  eq(currentWriterScope(), null, 'workspace writer context does not leak after completion');
  const [tenantScopeError] = tryCatchSync(() => currentWorkspaceId());
  assert(tenantScopeError !== null, 'tenant context does not leak after completion');
} catch (error) {
  assert(false, `unexpected error during route-writer boundary test: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/routeWriterBoundary.test.mts');
