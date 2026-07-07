//? Workspaces — server-side control-API RBAC (the runtime capability map).
//?
//? These RUNTIME values live under `server/` because the generated server route
//? bundle stubs non-`_api`/`_sync` `src/` imports to undefined. `controlApi.ts` keeps
//? the TYPES + the client-facing CONFIRM_REQUIRED (type imports erase, so those
//? resolve fine).
//?
//? Post-Fase-0: the RUNTIME RBAC gate is `hasCapability` + `CAP` (each per-action
//? `_api` route calls `hasCapability(..., CAP.<x>)`). `OP_CAPABILITY` below is now a
//? REFERENCE map — the consolidated view of the whole B-28 matrix (kept in lockstep
//? with what the routes hardcode) — NOT the live source; editing it alone changes
//? nothing at runtime.

import type { PrismaClient } from '@prisma/client';

import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

//? Shared RBAC gate for the per-action typed `_api` routes (the Fase-0 write-path
//? split). `cap === null` = a login-only own-resource op (no capability needed).
//? Otherwise the caller must be a member whose `WorkspaceRole.perms[cap]` is true.
//? Mirrors the inline check the old single control route did (control_v1.ts) so
//? every per-action route enforces the SAME B-28 matrix without duplicating logic.
export async function hasCapability(prisma: PrismaClient, workspaceId: string, userId: string, cap: number | null): Promise<boolean> {
  if (cap === null) return true;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!member) return false;
  const role = await prisma.workspaceRole.findFirst({ where: { workspaceId, key: member.roleKey } });
  return role?.perms[cap] === true;
}

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

//? Which capability index each op requires (`null` = login-only own-resource) — the
//? consolidated B-28 reference matrix (see header note; the per-action routes are the
//? runtime source). Includes ops not yet client-wired (pause/kill/… = Fase 2).
export const OP_CAPABILITY: Record<ControlOp, number | null> = {
  'quick-add': CAP.workTickets,
  'ticket-edit': CAP.workTickets,
  'add-comment': CAP.workTickets,
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
  'save-git-config': CAP.workspaceSettings,
  'save-sections': CAP.workspaceSettings,
  'save-ai-instruction': CAP.workspaceSettings,
  'save-ai-provider': CAP.workspaceSettings,
  'gitlab-verify': CAP.workspaceSettings,
  'gitlab-resync': CAP.workspaceSettings,
  'forge-connect': CAP.workspaceSettings,
  'link-repo': CAP.workspaceSettings,
  'scan-docs': CAP.editPipeline,
  'create-info-source': CAP.editPipeline,
  'scan-index': CAP.editPipeline,
  'mr-create': CAP.workTickets,
  'mr-comment': CAP.workTickets,
  'mr-approve': CAP.workTickets,
  'mr-merge': CAP.workTickets,
  'mr-rollback': CAP.workTickets,
  'mr-resolve': CAP.workTickets,
  'mr-review': CAP.workTickets,
  'raise-cap': CAP.workspaceSettings,
  'edit-budget': CAP.workspaceSettings,
  'edit-media-budget': CAP.workspaceSettings,
  'save-style': CAP.workspaceSettings,
  'save-media-provider': CAP.workspaceSettings,
  'content-edit-brand': CAP.workspaceSettings,
  'content-edit-product': CAP.workspaceSettings,
  'delete-style': CAP.workspaceSettings,
  'content-create': CAP.workTickets,
  'content-advance': CAP.workTickets,
  'content-archive': CAP.workTickets,
  'content-gen-script': CAP.workTickets,
  'content-gen-voice': CAP.workTickets,
  'content-gen-images': CAP.workTickets,
  'content-assemble': CAP.workTickets,
  'content-gen-reference-image': CAP.workTickets,
  'content-gen-shortform': CAP.workTickets,
  'content-analyze-reference-video': CAP.workTickets,
  'content-gen-avatar': CAP.workTickets,
  'content-gen-music': CAP.workTickets,
  'content-gen-sfx': CAP.workTickets,
  'content-gen-3d': CAP.workTickets,
  'content-request-publish': CAP.workTickets,
  'content-from-brief': CAP.workTickets,
  'content-import-asset': CAP.workTickets,
  'content-regenerate': CAP.workTickets,
  'copilot-propose': CAP.workTickets,
  'resume-spend': CAP.workspaceSettings,
  'skill-toggle': CAP.editPipeline,
  'save-stage-config': CAP.editPipeline,
  'trigger-save': CAP.editPipeline,
  'trigger-toggle': CAP.editPipeline,
  'trigger-delete': CAP.editPipeline,
  'trigger-run': CAP.editPipeline,
  'finding-to-ticket': CAP.workTickets,
  'finding-dismiss': CAP.workTickets,
  'ticket-link-artifact': CAP.workTickets,
  'ticket-unlink-artifact': CAP.workTickets,
  'project-create': CAP.workspaceSettings,
  'project-from-template': CAP.workspaceSettings,
  'service-create': CAP.workspaceSettings,
  'service-delete': CAP.workspaceSettings,
  'env-deploy': CAP.workspaceSettings,
  'env-teardown': CAP.workspaceSettings,
  'env-promote': CAP.workspaceSettings,
  'build-export': CAP.workspaceSettings,
  'ci-run': CAP.workTickets,
  'ci-allow-red': CAP.demoteAdmin,
  'root-cause': CAP.workTickets,
  'plan-critique': CAP.workTickets,
  'index-memory': CAP.editPipeline,
  'db-connect': CAP.workspaceSettings,
  'db-migrate-create': CAP.editPipeline,
  'db-migrate-apply': CAP.workspaceSettings,
  'db-introspect': CAP.workTickets,
  'mark-read': null,
  pause: CAP.workTickets,
  resume: CAP.workTickets,
  'answer-input': CAP.workTickets,
  kill: CAP.demoteAdmin,
  'pause-all': CAP.demoteAdmin,
  'resume-all': CAP.demoteAdmin,
  'preview-up': CAP.workTickets,
  'preview-down': CAP.workTickets,
  'accept-suggestion': null,
};
