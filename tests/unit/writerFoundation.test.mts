//? B0 writer foundation: internal writer ops stay off every public surface, and
//? writer AsyncLocalStorage is scoped to one matching execute boundary.

import { tryCatch } from '@luckystack/core';

import type { ControlOp } from '../../src/workspaces/_functions/controlApi';
import type { InternalOp } from '../../server/orchestrator/internalOps';
import { PROPOSE_CATALOG } from '../../server/ai/opCatalog';
import { OP_CAPABILITY } from '../../server/control/rbac';
import { isDocumentOp, PUBLIC_DOCUMENT_OPS } from '../../src/workspaces/_sync/documentsControl_server_v1';
import {
  assertWriterContext,
  currentWriterScope,
  GLOBAL_WRITER_SCOPE,
  runInWriterContext,
  WriterContextMismatchError,
} from '../../server/orchestrator/writerContext';
import { assert, eq, report } from '../_helpers.mts';

const INTERNAL_OPS: InternalOp[] = [
  'document-set-asset-text',
  'forge-event-apply',
  'forge-snapshot-apply',
];
type InternalPublicOverlap = Extract<InternalOp, ControlOp>;
const noClientUnionOverlap: [InternalPublicOverlap] extends [never] ? true : false = true;

assert(noClientUnionOverlap, 'InternalOp has no compile-time overlap with the client ControlOp union');
for (const op of INTERNAL_OPS) {
  assert(!(op in OP_CAPABILITY), `${op} is absent from PUBLIC RBAC`);
  assert(!(op in PROPOSE_CATALOG), `${op} is absent from the PUBLIC proposal catalog`);
  assert(!PUBLIC_DOCUMENT_OPS.has(op), `${op} is absent from the public document sync allowlist`);
  assert(!isDocumentOp(op), `the public document runtime guard rejects ${op}`);
}

eq(currentWriterScope(), null, 'writer context is absent outside an execute boundary');
let observedWorkspaceScope: string | null = null;
await runInWriterContext('workspace-a', async () => {
  observedWorkspaceScope = currentWriterScope();
  eq(assertWriterContext('workspace-a'), 'workspace-a', 'writer context is present in the matching workspace boundary');
  await runInWriterContext('workspace-a', async () => {
    eq(currentWriterScope(), 'workspace-a', 'same-workspace nesting preserves the writer scope');
  });
});
eq(observedWorkspaceScope, 'workspace-a', 'the execute callback observed its workspace writer scope');
eq(currentWriterScope(), null, 'writer context is absent again after execute settles');

const [nestedMismatch] = await tryCatch(() => runInWriterContext('workspace-a', async () => {
  await runInWriterContext('workspace-b', async () => undefined);
}));
assert(
  nestedMismatch instanceof WriterContextMismatchError
    && nestedMismatch.activeScope === 'workspace-a'
    && nestedMismatch.requestedScope === 'workspace-b',
  'nested execution for a different workspace is rejected',
);
eq(currentWriterScope(), null, 'a rejected nested scope does not leak writer context');

await runInWriterContext(GLOBAL_WRITER_SCOPE, async () => {
  eq(assertWriterContext(GLOBAL_WRITER_SCOPE), GLOBAL_WRITER_SCOPE, 'tenant bootstrap has an explicit global writer scope');
});
eq(currentWriterScope(), null, 'global writer scope is absent after its execute boundary');

report('tests/unit/writerFoundation.test.mts');
