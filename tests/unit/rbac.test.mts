//? Unit test — the Workspaces Fase-1 RBAC contract (no DB). Verifies the runtime
//? capability map (`server/control/rbac`) stays in lockstep with the frozen
//? `ControlOp` union + `RBAC_CAPABILITIES` / `CONFIRM_REQUIRED` (the [control-API]
//? contract). Run: `npx tsx tests/unit/rbac.test.mts`.

import { OP_CAPABILITY, CAP } from '../../server/control/rbac';
import { RBAC_CAPABILITIES, CONFIRM_REQUIRED } from '../../src/workspaces/_functions/controlApi';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';
import { assert, eq, report } from '../_helpers.mts';

//? Exhaustive runtime enumeration of the ControlOp union (typed as ControlOp[] so
//? a stray/renamed literal fails the compile). Kept in the doc-order of the union.
const ALL_OPS: ControlOp[] = [
  // tickets / board
  'quick-add', 'archive',
  'bulk-move', 'bulk-status', 'bulk-assign', 'bulk-sprint', 'bulk-archive',
  'sprint-create', 'sprint-edit',
  // members / RBAC / workspace lifecycle
  'create-workspace', 'rename-workspace', 'delete-workspace', 'transfer-ownership',
  'change-role', 'remove-member', 'invite', 'revoke-invite', 'accept-invite',
  'role-create', 'role-update',
  // workspace settings
  'save-env', 'remove-env', 'save-integration', 'remove-integration',
  'gitlab-settings', 'gitlab-verify', 'gitlab-resync',
  'raise-cap', 'edit-budget', 'resume-spend',
  'skill-toggle', 'save-stage-config',
  // notifications
  'mark-read',
  // AI-session controls
  'pause', 'resume', 'kill', 'pause-all', 'resume-all',
  'preview-up', 'preview-down',
  'accept-suggestion',
];

// --- 1. Every ControlOp has an OP_CAPABILITY entry (no undefined) ------------
for (const op of ALL_OPS) {
  const cap = OP_CAPABILITY[op];
  assert(cap !== undefined, `OP_CAPABILITY has an entry for '${op}'`);
}

//? Completeness in BOTH directions: the map has exactly the union's members,
//? nothing missing, nothing stale.
const mapKeys = Object.keys(OP_CAPABILITY).sort();
eq(mapKeys.length, ALL_OPS.length, 'OP_CAPABILITY key count matches ControlOp union size');
eq(mapKeys, [...ALL_OPS].sort(), 'OP_CAPABILITY keys == ControlOp union (no missing / stale ops)');

// --- 2. CAP indices are 0..7 unique ------------------------------------------
const capValues = Object.values(CAP);
eq([...capValues].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7], 'CAP indices are exactly 0..7');
eq(new Set(capValues).size, capValues.length, 'CAP indices are unique');

// --- 3. Every capability-gated op maps to a valid CAP index (or null) ---------
for (const op of ALL_OPS) {
  const cap = OP_CAPABILITY[op];
  if (cap === null) continue; // login-only own-resource op
  const valid = Number.isInteger(cap) && (cap as number) >= 0 && (cap as number) <= 7;
  assert(valid, `OP_CAPABILITY['${op}'] = ${String(cap)} is a valid CAP index (0..7)`);
}

//? Spot-check the Fase-1 write ops that MUST require a specific capability.
eq(OP_CAPABILITY['rename-workspace'], CAP.workspaceSettings, "'rename-workspace' requires workspaceSettings");
eq(OP_CAPABILITY['change-role'], CAP.manageMembers, "'change-role' requires manageMembers");
eq(OP_CAPABILITY['remove-member'], CAP.manageMembers, "'remove-member' requires manageMembers");
eq(OP_CAPABILITY['invite'], CAP.manageMembers, "'invite' requires manageMembers");
eq(OP_CAPABILITY['delete-workspace'], CAP.ownerActions, "'delete-workspace' requires ownerActions");
eq(OP_CAPABILITY['transfer-ownership'], CAP.ownerActions, "'transfer-ownership' requires ownerActions");
eq(OP_CAPABILITY['save-env'], CAP.workspaceSettings, "'save-env' requires workspaceSettings");
eq(OP_CAPABILITY['quick-add'], CAP.workTickets, "'quick-add' requires workTickets");
eq(OP_CAPABILITY['sprint-create'], CAP.manageSprints, "'sprint-create' requires manageSprints");
eq(OP_CAPABILITY['role-create'], CAP.editPipeline, "'role-create' requires editPipeline");

//? The login-only ops carry NO capability requirement (null).
eq(OP_CAPABILITY['create-workspace'], null, "'create-workspace' is login-only (null)");
eq(OP_CAPABILITY['accept-invite'], null, "'accept-invite' is login-only (null)");
eq(OP_CAPABILITY['mark-read'], null, "'mark-read' is login-only (null)");
eq(OP_CAPABILITY['accept-suggestion'], null, "'accept-suggestion' is login-only (null)");

// --- 4. CONFIRM_REQUIRED gates the destructive ops (and only those) ----------
const mustConfirm: ControlOp[] = ['delete-workspace', 'transfer-ownership', 'remove-member', 'kill', 'pause-all'];
for (const op of mustConfirm) {
  assert(CONFIRM_REQUIRED.has(op), `CONFIRM_REQUIRED gates the destructive op '${op}'`);
}
eq(CONFIRM_REQUIRED.size, mustConfirm.length, 'CONFIRM_REQUIRED contains exactly the destructive ops');

const mustNotConfirm: ControlOp[] = ['quick-add', 'archive', 'mark-read', 'rename-workspace', 'invite', 'resume', 'save-env'];
for (const op of mustNotConfirm) {
  assert(!CONFIRM_REQUIRED.has(op), `CONFIRM_REQUIRED does NOT gate the harmless op '${op}'`);
}

// --- 5. RBAC_CAPABILITIES has 8 entries --------------------------------------
eq(RBAC_CAPABILITIES.length, 8, 'RBAC_CAPABILITIES has 8 entries');
//? The capability matrix is positional — its length is the CAP index space.
eq(RBAC_CAPABILITIES.length, Object.keys(CAP).length, 'RBAC_CAPABILITIES length == CAP index count');

report('tests/unit/rbac.test.mts');
