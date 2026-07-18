//? X1 (UNIVERSAL_TOOL Fase A / COMPLETION Fase X) — the generic propose-safe op-catalog.
//? Locks down: (1) the catalog exhaustively classifies EVERY ControlOp (drift-guard vs OP_CAPABILITY);
//? (2) the server-side enabled tranche is in LOCKSTEP with the client CHAT_ENABLED_OPS/dispatch map;
//? (3) generic validation only passes catalog-enabled ops with type-checked params whose workspace
//? references (ticketKey/stageId/pieceId/envId/serviceName/preset) actually exist; (4) destructive
//? flags are carried; (5) the legacy 5-op rich path is untouched and excluded ops stay unreachable.

import { assert, eq, report } from '../_helpers.mts';
import { PROPOSE_CATALOG, ENABLED_OPS, catalogPromptLines, validateGenericAction } from '../../server/ai/opCatalog';
import { OP_CAPABILITY } from '../../server/control/rbac';
import { CHAT_ENABLED_OPS, isChatEnabledOp } from '../../src/workspaces/_data/chatOps';
import { validateChatAction, validatePlan, type Ctx } from '../../server/ai/workspaceChat';

const ctx: Ctx = {
  projectId: 'project-a',
  projectName: 'Project A',
  tickets: [{ key: 'DEV-1', title: 'Existing', stageId: 'unrefined' }],
  stages: [{ id: 'unrefined', name: 'Unrefined' }, { id: 'refined', name: 'Refined' }],
  members: [{ id: 'u1', name: 'Alice' }],
  pieces: [{ id: 'p1', title: 'Launch video', stageId: 'idea' }],
  environments: [{ id: 'e1', kind: 'dev', status: 'live' }],
  services: [{ name: 'events', status: 'running' }],
  customTasks: [], triggers: [], mrs: [], channels: [],
};

try {
  // ---- (1) exhaustiveness vs the ControlOp union (via the OP_CAPABILITY reference matrix)
  const capOps = Object.keys(OP_CAPABILITY).sort();
  const catOps = Object.keys(PROPOSE_CATALOG).sort();
  eq(catOps.length, capOps.length, 'catalog covers exactly as many ops as OP_CAPABILITY');
  assert(capOps.every((op, i) => catOps[i] === op), 'catalog keyset matches the ControlOp surface 1:1');

  // ---- (2) server↔client tranche lockstep
  const serverEnabled = [...ENABLED_OPS].sort();
  const clientEnabled = [...CHAT_ENABLED_OPS].sort();
  eq(serverEnabled.length, clientEnabled.length, `enabled tranche same size on both sides (${String(serverEnabled.length)})`);
  assert(serverEnabled.every((op, i) => clientEnabled[i] === op), 'server ENABLED_OPS ≡ client CHAT_ENABLED_OPS (lockstep)');
  assert(CHAT_ENABLED_OPS.every((op) => isChatEnabledOp(op)), 'the client type-guard accepts its own tranche');
  assert(!isChatEnabledOp('save-env'), 'the client type-guard rejects a non-tranche op');

  // ---- (3) secret-bearing + plumbing ops are EXCLUDED (never proposable via chat)
  for (const op of ['save-env', 'save-integration', 'save-media-provider', 'gitlab-settings', 'forge-connect', 'db-connect', 'account-disconnect', 'copilot-propose', 'accept-suggestion', 'mark-read'] as const) {
    eq(PROPOSE_CATALOG[op].mode, 'excluded', `${op} is excluded from the chat surface`);
    eq(validateGenericAction({ op }, ctx), null, `${op} never validates as a generic proposal`);
  }

  // ---- (4) generic validation: happy paths with real references
  const prov = validateGenericAction({ op: 'service-provision', name: 'queue', preset: 'kafka' }, ctx);
  assert(prov !== null && prov.op === 'service-provision', 'service-provision with a known preset validates');
  eq(prov?.projectId, ctx.projectId, 'generic proposals carry active-project provenance');
  eq(prov?.params?.name, 'queue', 'the stack name is carried in params');
  eq(validateGenericAction({ op: 'service-provision', name: 'queue', preset: 'nope' }, ctx), null, 'an unknown preset key is rejected');
  eq(validateGenericAction({ op: 'service-provision', name: 'queue' }, ctx), null, 'a missing required param is rejected');

  const down = validateGenericAction({ op: 'service-teardown', name: 'events' }, ctx);
  assert(down !== null && down.destructive === true, 'service-teardown validates against a REAL stack + carries destructive');
  eq(validateGenericAction({ op: 'service-teardown', name: 'ghost' }, ctx), null, 'teardown of a non-existent stack is rejected');

  const pauseT = validateGenericAction({ op: 'pause', ticketKey: 'DEV-1' }, ctx);
  assert(pauseT !== null, 'pause with an existing ticketKey validates');
  eq(validateGenericAction({ op: 'pause', ticketKey: 'DEV-99' }, ctx), null, 'a dangling ticketKey is rejected');

  const reorder = validateGenericAction({ op: 'stage-reorder', order: ['refined', 'unrefined'] }, ctx);
  assert(reorder !== null && Array.isArray(reorder.params?.order), 'stage-reorder with existing stage keys validates');
  eq(validateGenericAction({ op: 'stage-reorder', order: ['refined', 'ghost'] }, ctx), null, 'reorder naming an unknown stage is rejected');

  const run = validateGenericAction({ op: 'content-run-pipeline', pieceId: 'p1', durationMs: 60000 }, ctx);
  assert(run !== null, 'content-run-pipeline with a real pieceId validates');
  assert((run?.summary ?? '').includes('Launch video'), 'the summary names the piece title, not just the id');
  eq(validateGenericAction({ op: 'content-run-pipeline', pieceId: 'ghost' }, ctx), null, 'a dangling pieceId is rejected');
  eq(validateGenericAction({ op: 'content-run-pipeline', pieceId: 'p1', durationMs: 'sixty' }, ctx)?.params?.durationMs, undefined, 'a wrong-typed optional param is dropped, not carried');

  const promote = validateGenericAction({ op: 'env-promote', fromKind: 'dev' }, ctx);
  assert(promote !== null && promote.destructive === true, 'env-promote validates + is destructive');
  eq(validateGenericAction({ op: 'env-promote', fromKind: 'prod' }, ctx), null, 'an out-of-enum value is rejected');
  const redOverride = validateGenericAction({ op: 'ci-allow-red', enabled: true }, ctx);
  assert(redOverride !== null && redOverride.params?.enabled === true, 'boolean params validate');

  //? Extra undeclared fields are DROPPED (the model cannot smuggle payload past the spec).
  const teardownExtra = validateGenericAction({ op: 'env-teardown', envId: 'e1', rmVolumes: true }, ctx);
  assert(teardownExtra !== null && !('rmVolumes' in (teardownExtra.params ?? {})), 'undeclared fields are stripped from params');

  //? A `later` op (safe but not yet dispatchable) does NOT validate yet.
  eq(validateGenericAction({ op: 'mr-review' }, ctx), null, 'a later-mode op is not proposable until its dispatcher lands');

  // ---- (5) the chat entry point: legacy rich path intact, generic path reachable behind it
  assert(validateChatAction({ op: 'bulk-move', ticketKeys: ['DEV-1'], stageId: 'refined' }, ctx) !== null, 'legacy bulk-move still validates via the rich path');
  assert(validateChatAction({ op: 'create-ticket', title: 'Add login' }, ctx) !== null, 'legacy create-ticket still validates');
  const viaChat = validateChatAction({ op: 'pause-all' }, ctx);
  assert(viaChat !== null && viaChat.destructive === true, 'a generic op now validates through validateChatAction');
  eq(validateChatAction({ op: 'delete-everything' }, ctx), null, 'an unknown op still rejects (no invented verbs)');
  //? Plans can mix legacy + generic steps (each step revalidates individually).
  const plan = validatePlan({ summary: 'Ship it', steps: [
    { op: 'create-ticket', title: 'Fix the bug' },
    { op: 'ci-run', ticketKey: 'DEV-1' },
  ] }, ctx);
  assert(plan !== null && plan.steps.length === 2, 'a mixed legacy+generic plan validates');

  // ---- (6) prompt lines render one line per enabled op + the preset key list
  const lines = catalogPromptLines();
  eq(lines.length, ENABLED_OPS.length + 1, 'one prompt line per enabled op + the preset-keys line');
  assert(lines.some((l) => l.includes('[destructive]')), 'destructive ops are flagged in the prompt');
  assert(lines[lines.length - 1]?.includes('kafka'), 'the preset-keys line names the curated presets');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/opCatalogParity.test.mts');
