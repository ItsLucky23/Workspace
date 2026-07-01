//? Workspaces — server-side control-API RBAC (the runtime capability map).
//?
//? These RUNTIME values live under `server/` because the generated server route
//? bundle stubs non-`_api`/`_sync` `src/` imports to undefined (so importing
//? OP_CAPABILITY from `src/workspaces/_functions/controlApi` yields undefined in a
//? route at runtime). `controlApi.ts` keeps the TYPES + the client-facing
//? CONFIRM_REQUIRED (type imports erase, so those resolve fine). Keep the capability
//? mapping here in lockstep with the ControlOp union.

import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

//? Positional capability indices over RBAC_CAPABILITIES (B-28; mirrors seed).
export const CAP = {
  workTickets: 0,
  editPipeline: 1,
  workspaceSettings: 2,
  manageMembers: 3,
  manageSprints: 4,
  promoteAdmin: 5,
  demoteAdmin: 6,
  ownerActions: 7,
} as const;

//? Which capability index a control-API op requires (`null` = login-only own-resource).
export const OP_CAPABILITY: Record<ControlOp, number | null> = {
  'quick-add': CAP.workTickets,
  archive: CAP.workTickets,
  'bulk-move': CAP.workTickets,
  'bulk-status': CAP.workTickets,
  'bulk-assign': CAP.workTickets,
  'bulk-sprint': CAP.manageSprints,
  'bulk-archive': CAP.workTickets,
  'sprint-create': CAP.manageSprints,
  'sprint-edit': CAP.manageSprints,
  'create-workspace': null,
  'rename-workspace': CAP.workspaceSettings,
  'delete-workspace': CAP.ownerActions,
  'transfer-ownership': CAP.ownerActions,
  'change-role': CAP.manageMembers,
  'remove-member': CAP.manageMembers,
  invite: CAP.manageMembers,
  'revoke-invite': CAP.manageMembers,
  'accept-invite': null,
  'role-create': CAP.editPipeline,
  'role-update': CAP.editPipeline,
  'save-env': CAP.workspaceSettings,
  'remove-env': CAP.workspaceSettings,
  'save-integration': CAP.workspaceSettings,
  'remove-integration': CAP.workspaceSettings,
  'gitlab-settings': CAP.workspaceSettings,
  'gitlab-verify': CAP.workspaceSettings,
  'gitlab-resync': CAP.workspaceSettings,
  'raise-cap': CAP.workspaceSettings,
  'edit-budget': CAP.workspaceSettings,
  'resume-spend': CAP.workspaceSettings,
  'skill-toggle': CAP.editPipeline,
  'save-stage-config': CAP.editPipeline,
  'mark-read': null,
  pause: CAP.workTickets,
  resume: CAP.workTickets,
  kill: CAP.demoteAdmin,
  'pause-all': CAP.demoteAdmin,
  'resume-all': CAP.demoteAdmin,
  'preview-up': CAP.workTickets,
  'preview-down': CAP.workTickets,
  'accept-suggestion': null,
};
