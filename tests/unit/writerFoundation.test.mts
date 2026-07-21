//? B0 writer foundation: internal writer ops stay off every public surface, and
//? writer AsyncLocalStorage is scoped to one matching execute boundary.

import { tryCatch, tryCatchSync } from '@luckystack/core';

import type { ControlOp } from '../../src/workspaces/_functions/controlApi';
import { CRASH_REPLAYABLE_INTERNAL_OPS, assertValidInternalAction, internalActionFromSignal, internalActionReplayKeys, type InternalOp } from '../../server/orchestrator/internalOps';
import { PROPOSE_CATALOG } from '../../server/ai/opCatalog';
import { OP_CAPABILITY } from '../../server/control/rbac';
import { isDocumentOp, PUBLIC_DOCUMENT_OPS } from '../../src/workspaces/_sync/documentsControl_server_v1';
import {
  assertWriterContext,
  currentWriterScope,
  GLOBAL_WRITER_SCOPE,
  hasActiveWriterDedupKey,
  runInWriterContext,
  WriterContextMismatchError,
} from '../../server/orchestrator/writerContext';
import { assert, eq, report } from '../_helpers.mts';

const INTERNAL_OPS: InternalOp[] = [
  'document-set-asset-text',
  'forge-event-apply',
  'forge-snapshot-apply',
  'ci-public-complete',
  'automation-event-apply',
  'automation-cron-fire',
  'automation-action-run',
  'workspace-builtins-ensure',
  'studio-artifact-begin',
  'studio-artifact-complete',
  'project-docs-complete',
  'project-image-complete',
  'brand-import',
  'style-import',
  'dockerfile-save',
  'worktree-file-save',
  'chat-turn-record',
  'design-library-write',
  'studio-brief-save',
  'studio-delete',
  'pat-issue',
  'runtime-launch-prepare',
  'runtime-launch-complete',
  'stage-activation-complete',
  'stage-session-start',
  'stage-session-update',
  'stage-tool-trail-append',
  'stage-turn-complete',
  'stage-handoff-complete',
  'stage-forge-prepare',
  'stage-forge-complete',
  'stage-defer-update',
  'agent-recovery-transition',
  'watchdog-reminder-apply',
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

const internalBase = { workspaceId: 'workspace-a', userId: 'automation', clientRequestId: 'runtime-validation' };
const rejectsInternal = (action: unknown): boolean => tryCatchSync(() => assertValidInternalAction(action))[0] !== null;

assert(rejectsInternal({ ...internalBase, op: 'automation-event-apply', target: {}, payload: { event: null, depth: 0 } }), 'a null nested event is rejected before dereference');
assert(rejectsInternal({ ...internalBase, op: 'automation-event-apply', target: {}, payload: { event: { on: 7 }, depth: 0 } }), 'an event with a wrong-typed `on` is rejected');
assert(rejectsInternal({ ...internalBase, op: 'automation-event-apply', target: {}, payload: { event: { on: 'x'.repeat(513) }, depth: 0 } }), 'an oversized event field is rejected');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'approve', requiresApproval: true, action: { action: 'notify', params: {} } } }), 'only exact gated/execute modes are accepted');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'execute', action: { action: 'notify', params: {} } } }), 'missing requiresApproval cannot fall through to execution');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'execute', requiresApproval: 'false', action: { action: 'notify', params: {} } } }), 'wrong-typed requiresApproval cannot bypass the gate');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'execute', requiresApproval: true, action: { action: 'notify', params: {} } } }), 'approval-required work cannot use execute mode');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'gated', requiresApproval: false, action: { action: 'notify', params: [] } } }), 'action params must be a JSON object');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'gated', requiresApproval: false, action: { action: 'notify', params: { nested: undefined } } } }), 'non-JSON nested params are rejected instead of being silently dropped');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'gated', requiresApproval: false, action: { action: 'notify', params: { body: 'x'.repeat(64_001) } } } }), 'oversized nested action params are rejected');
assert(rejectsInternal({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'gated', requiresApproval: false, action: { action: 'unknown-action', params: {} } } }), 'an unknown trigger action is rejected');
const [validInternalError] = tryCatchSync(() => assertValidInternalAction({ ...internalBase, op: 'automation-action-run', target: {}, payload: { mode: 'gated', requiresApproval: true, action: { action: 'notify', params: { title: 'Valid' } } } }));
eq(validInternalError, null, 'a well-formed gated InternalOp passes runtime validation');
const [validBuiltinsError] = tryCatchSync(() => assertValidInternalAction({ ...internalBase, op: 'workspace-builtins-ensure', target: {}, payload: {} }));
eq(validBuiltinsError, null, 'the empty workspace-builtins InternalOp passes runtime validation');
assert(rejectsInternal({ ...internalBase, op: 'workspace-builtins-ensure', target: {}, payload: { injected: true } }), 'workspace-builtins rejects injected payload fields');
assert(rejectsInternal({ ...internalBase, op: 'design-library-write', target: {}, payload: { mode: 'save', kind: 'theme', name: 'Theme', content: {} } }), 'a replayable design save requires a deterministic artifact id');
for (const casReplay of ['brand-import', 'style-import', 'dockerfile-save', 'worktree-file-save'] as const) {
  assert(CRASH_REPLAYABLE_INTERNAL_OPS.includes(casReplay), `${casReplay} is crash-replayable now that it carries an entity CAS`);
}
assert(rejectsInternal({ ...internalBase, op: 'brand-import', target: { expectedVersion: -1 }, payload: { kit: {} } }), 'entity CAS versions cannot be negative');

const replayedRouteJob = internalActionFromSignal({
  workspaceId: 'workspace-a',
  kind: 'project-image-complete',
  payload: {
    op: 'project-image-complete',
    userId: 'user-a',
    clientRequestId: 'project-image:one',
    version: 1,
    target: { projectId: 'project-a' },
    payload: { tag: 'workspaces/project-a:sha256' },
  },
});
eq(replayedRouteJob?.op, 'project-image-complete', 'a bounded typed route job reconstructs from its durable signal');
eq(replayedRouteJob ? internalActionReplayKeys(replayedRouteJob) : [], ['project-image:project-a'], 'a replayable completion exposes its supersession entity key');
eq(internalActionFromSignal({ workspaceId: 'workspace-a', kind: 'project-image-complete', payload: { userId: 'u', clientRequestId: 'x', target: {}, payload: {} } }), null, 'an incomplete durable job cannot reconstruct');

eq(currentWriterScope(), null, 'writer context is absent outside an execute boundary');
let observedWorkspaceScope: string | null = null;
await runInWriterContext('workspace-a', async () => {
  observedWorkspaceScope = currentWriterScope();
  eq(assertWriterContext('workspace-a'), 'workspace-a', 'writer context is present in the matching workspace boundary');
  assert(hasActiveWriterDedupKey('top-key'), 'the top writer action dedup key is active');
  await runInWriterContext('workspace-a', async () => {
    eq(currentWriterScope(), 'workspace-a', 'same-workspace nesting preserves the writer scope');
    assert(hasActiveWriterDedupKey('top-key'), 'a nested action sees its top-level ancestor key');
    assert(hasActiveWriterDedupKey('nested-key'), 'a nested action tracks its own dedup key');
  }, undefined, 'nested-key');
  assert(!hasActiveWriterDedupKey('nested-key'), 'the nested key leaves the active ancestor set after completion');
}, undefined, 'top-key');
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
