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
  //? GAP_SCAN G2 — cloning READS this workspace's whole configuration, so it needs the settings bar.
  'clone-workspace': CAP.workspaceSettings,
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
  'service-provision': CAP.workspaceSettings,
  'service-teardown': CAP.workspaceSettings,
  'ui-review-create': CAP.workTickets,
  'ui-review-to-ticket': CAP.workTickets, // U2 gap-fix — inbox → redesign ticket
  'ui-review-dismiss': CAP.workTickets,   // U2 gap-fix — dismiss without ticket
  'save-integration': CAP.workspaceSettings,
  'remove-integration': CAP.workspaceSettings,
  'gitlab-settings': CAP.workspaceSettings,
  'save-git-config': CAP.workspaceSettings,
  'project-runtime-save': CAP.workspaceSettings,
  'save-sections': CAP.workspaceSettings,
  'save-ai-instruction': CAP.workspaceSettings,
  'save-ai-provider': CAP.workspaceSettings,
  'save-autonomy': CAP.workspaceSettings,
  'gitlab-verify': CAP.workspaceSettings,
  'gitlab-resync': CAP.workspaceSettings,
  'forge-connect': CAP.workspaceSettings,
  'link-repo': CAP.workspaceSettings,
  'scan-docs': CAP.editPipeline,
  'create-info-source': CAP.editPipeline,
  'info-source-archive': CAP.editPipeline,
  'info-source-delete': CAP.editPipeline,
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
  //? A7 — the platform APP credentials are workspace-level secrets, same bar as the provider keys.
  'save-platform-credentials': CAP.workspaceSettings,
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
  'studio-send-to-content': CAP.workTickets, // gap-fix — hand a Studio artifact to the content lane

  'content-import-asset': CAP.workTickets,
  'content-regenerate': CAP.workTickets,
  'content-inpaint': CAP.workTickets,
  'content-reorder-beats': CAP.workTickets,
  'content-transcode': CAP.workTickets,
  'content-save-scenes': CAP.workTickets,
  'content-decompose-video': CAP.workTickets,
  'content-refine-range': CAP.workTickets,
  'content-run-pipeline': CAP.workTickets,
  'content-save-audio-mix': CAP.workTickets,
  'content-trim-audio': CAP.workTickets,
  //? GAP_SCAN F1 — composing a thumbnail is content work (and may spend on an AI background).
  'content-gen-thumbnail': CAP.workTickets,
  //? F5 — replying posts publicly as the channel; content-work capability.
  'content-reply-comment': CAP.workTickets,
  //? G3 — publishing puts a page on a public URL; same bar as other content work.
  'studio-publish-site': CAP.workTickets,
  'studio-unpublish-site': CAP.workTickets,
  //? F48 — restoring is harmless; PURGING destroys bytes for good, so it sits at the settings bar.
  'media-trash-restore': CAP.workTickets,
  'media-trash-purge': CAP.workspaceSettings,
  //? G4 — starring marks an asset as part of the workspace's reusable library.
  'asset-star': CAP.workTickets,
  //? G7 — a prompt experiment steers every AI run for that feature; workspace-settings bar.
  'prompt-experiment-save': CAP.workspaceSettings,
  'prompt-experiment-stop': CAP.workspaceSettings,
  'content-critique-image': CAP.workTickets,
  'content-video-restyle': CAP.workTickets,
  'content-edit-image': CAP.workTickets,
  'shortlink-create': CAP.workTickets,
  'capture-run': CAP.workTickets,
  'channel-create': CAP.workTickets,
  'channel-edit': CAP.workTickets,
  'channel-delete': CAP.workTickets,
  'account-disconnect': CAP.workspaceSettings,
  'reference-add': CAP.workTickets,
  'reference-delete': CAP.workTickets,
  'content-unarchive': CAP.workTickets,
  'content-unpublish': CAP.workTickets,
  'save-custom-task': CAP.workTickets,
  'delete-custom-task': CAP.workTickets,
  'run-custom-task': CAP.workTickets,
  'run-agent-role': CAP.workTickets,   // #167 — on-demand invoke of a registered agent-role (e.g. interviewer)
  'save-output-template': CAP.workTickets,
  'delete-output-template': CAP.workTickets,
  'copy-workspace-assets': CAP.workspaceSettings,
  'copilot-propose': CAP.workTickets,
  'resume-spend': CAP.workspaceSettings,
  'skill-toggle': CAP.editPipeline,
  //? SK1 — the universal AI-skills layer (Skill model), workspace-settings-scoped.
  'ai-skill-save': CAP.workspaceSettings,
  'ai-skill-delete': CAP.workspaceSettings,
  'ai-skill-reset': CAP.workspaceSettings,
  //? DOC — the Documents module (work-scoped, like content pieces).
  'document-create': CAP.workTickets,
  'document-edit': CAP.workTickets,
  'document-delete': CAP.workTickets,
  //? GAP_SCAN C7 — archive/restore is a lighter form of delete; same capability.
  'document-archive': CAP.workTickets,
  'document-unarchive': CAP.workTickets,
  'document-ai': CAP.workTickets,
  'document-apply-draft': CAP.workTickets,
  'document-discard-draft': CAP.workTickets,
  'document-gen-image': CAP.workTickets,
  'document-export': CAP.workTickets,
  'document-restore-revision': CAP.workTickets,
  'doc-template-save': CAP.workTickets,
  'doc-template-delete': CAP.workTickets,
  //? CI — the read-only comment inbox.
  'comments-refresh': CAP.workTickets,
  'comments-mark-read': CAP.workTickets,
  'save-stage-config': CAP.editPipeline,
  //? Credentials for the backends that run every AI in the workspace — settings-level, not pipeline.
  'ai-connection-add': CAP.workspaceSettings,
  'ai-connection-test': CAP.workspaceSettings,
  'ai-connection-remove': CAP.workspaceSettings,
  'stage-create': CAP.editPipeline,
  'pipeline-apply-preset': CAP.editPipeline,
  'stage-delete': CAP.editPipeline,
  'stage-reorder': CAP.editPipeline,
  'trigger-save': CAP.editPipeline,
  'trigger-toggle': CAP.editPipeline,
  'trigger-delete': CAP.editPipeline,
  'trigger-run': CAP.editPipeline,
  'finding-to-ticket': CAP.workTickets,
  'finding-dismiss': CAP.workTickets,
  'apply-design-tokens': CAP.workTickets,
  'ticket-link-artifact': CAP.workTickets,
  'ticket-unlink-artifact': CAP.workTickets,
  'project-create': CAP.workspaceSettings,
  'project-from-template': CAP.workspaceSettings,
  'service-create': CAP.workspaceSettings,
  'service-delete': CAP.workspaceSettings,
  'env-deploy': CAP.workspaceSettings,
  'env-teardown': CAP.workspaceSettings,
  //? D3 — rolling an environment back ships code; same bar as deploying it.
  'env-rollback': CAP.workspaceSettings,
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
  //? #27 — rotate the inbound-webhook secret (settings-level).
  'forge-webhook-rotate': CAP.workspaceSettings,
  //? #17/#113 — preview launch/stop (same gate as the openPreview/closePreview _api routes: workTickets).
  'preview-up': CAP.workTickets,
  'preview-down': CAP.workTickets,
  //? Suggestions are workspace-authoritative proposals, not caller-owned resources. Even a plain
  //? acceptance can execute an automation/publish payload, so anonymous membership is insufficient.
  'accept-suggestion': CAP.workTickets,
};
