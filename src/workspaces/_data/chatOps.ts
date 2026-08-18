//? Workspaces — the CHAT-ENABLED op tranche (X1, UNIVERSAL_TOOL_PROGRAM Fase A / COMPLETION Fase X).
//? The single client-side source of truth for WHICH control-ops the Workspace-AI may propose AND the
//? client can dispatch on accept. The server keeps its own copy inside `server/ai/opCatalog.ts`
//? (the bundler stubs `src/` runtime imports in server code, same constraint as OP_CAPABILITY) —
//? `tests/unit/opCatalogParity.test.mts` keeps the two in lockstep. Growing the assistant surface =
//? add the op here + a dispatcher in `chatDispatch.ts` + flip it to `enabled` in the server catalog.
//? NO imports in this file (it must stay safely importable from tests + client + anywhere).

export const CHAT_ENABLED_OPS = [
  // agent-session controls
  'pause', 'resume', 'kill', 'pause-all', 'resume-all',
  // deploy / environments
  'env-deploy', 'env-teardown', 'env-promote', 'build-export',
  //? D3 — roll an environment back to its last live commit (destructive → extra confirm on accept).
  'env-rollback',
  // CI + reasoning + memory
  'ci-run', 'ci-allow-red', 'root-cause', 'plan-critique', 'index-memory',
  // user-app DB (db-connect stays excluded — it carries a connection-string secret)
  'db-migrate-create', 'db-migrate-apply', 'db-introspect',
  // projects / greenfield
  'project-create', 'project-from-template',
  // service stacks (preset-only via chat; bring-your-own compose stays UI-only)
  'service-provision', 'service-teardown',
  // pipeline shape (R1 ops)
  'stage-create', 'stage-delete', 'stage-reorder',
  // content lifecycle + orchestration (paid per-asset gen ops follow once cost-confirms land, B4)
  'content-run-pipeline', 'content-advance', 'content-archive', 'content-unarchive', 'content-regenerate',
  // F5 — AI image critique (advisory, no asset write)
  'content-critique-image',
  //? F1 — compose a thumbnail (template, or with an AI background).
  'content-gen-thumbnail',
  //? G3 — put a generated Studio page live on a public URL, or take it down again.
  'studio-publish-site', 'studio-unpublish-site',
  //? Documents housekeeping (both reversible) + the reusable-asset library marker.
  'document-archive', 'document-unarchive', 'asset-star', 'media-trash-restore', 'media-trash-purge',
  //? F5 — reply to an inbox comment (destructive: it posts publicly, so accept carries an extra confirm).
  'content-reply-comment',
  //? G7 — run a prompt A/B and stop it again.
  'prompt-experiment-save', 'prompt-experiment-stop',
  // F7 — video-to-video restyle (paid gen)
  'content-video-restyle',
  'content-edit-image',
  'shortlink-create',
  'capture-run',
  // brand/style/reference/channel config (#150/#142) — text/config proposals, no paid gen
  'save-style', 'channel-create', 'reference-add', 'content-edit-product', 'content-edit-brand',
  // ticket edit (#7) — rename / re-describe / re-prioritise a ticket
  'ticket-edit',
  // forge issue resync (#29) — pull issues/state from the connected forge on demand
  'gitlab-resync',
  // git strategy / push policy change (#29) — merged over the current gitConfig on accept
  'save-git-config',
  // run a saved custom AI task by id (#86)
  'run-custom-task',
  'save-custom-task',
  // run an automation trigger on demand by id (#86)
  'trigger-run',
  // MR review / rollback (#54) — the mrId+ticketKey pair comes from the ctx MR list
  'mr-review', 'mr-rollback',
  // per-asset content generation (#134) — paid gen ops, accept = cost-confirm
  'content-gen-script', 'content-gen-voice', 'content-gen-images', 'content-assemble',
  'content-gen-avatar', 'content-gen-music', 'content-gen-sfx', 'content-gen-3d',
  // channel management (#142) — edit/delete an existing channel by id
  'channel-edit', 'channel-delete',
  // short-form clip generation (#134) — hook-driven vertical clip
  'content-gen-shortform',
  // knowledge refresh — rescan docs / rebuild the code index (no params)
  'scan-docs', 'scan-index',
  // preview launch/stop (#17/#113) — dispatched via the openPreview/closePreview _api, not the Conductor
  'preview-up', 'preview-down',
  //? GAP_SCAN C3 — the universal AI-skills layer: "turn on the SEO skill" / "make the humanizer stricter".
  'ai-skill-save', 'ai-skill-toggle', 'ai-skill-reset',
  //? ---- Parity wave 2026-07-20 — full UI parity for the Workspace-AI (destructive ops keep the extra
  //? explicit confirm on accept via spec.destructive; the catalog is the single classification source).
  // board / sprints / ticket-artifact links
  'archive', 'bulk-status', 'bulk-sprint', 'bulk-archive', 'sprint-create', 'sprint-edit',
  'ticket-link-artifact', 'ticket-unlink-artifact',
  // members / roles / workspace lifecycle
  'invite', 'revoke-invite', 'change-role', 'remove-member', 'role-create', 'role-update',
  'rename-workspace', 'transfer-ownership', 'delete-workspace',
  // documents + document templates
  'document-create', 'document-edit', 'document-delete', 'document-ai', 'document-apply-draft',
  'document-discard-draft', 'document-gen-image', 'document-export', 'document-restore-revision',
  'doc-template-save', 'doc-template-delete',
  // content: publish/retract, asset import, editors (paid gen ops: accept = cost-confirm)
  'content-request-publish', 'content-unpublish', 'content-import-asset', 'content-inpaint',
  'content-transcode', 'content-decompose-video', 'content-refine-range', 'content-save-audio-mix',
  'content-trim-audio', 'content-gen-reference-image', 'content-analyze-reference-video',
  // merge requests + monorepo services
  'mr-create', 'mr-comment', 'mr-approve', 'mr-merge', 'mr-resolve', 'service-create', 'service-delete',
  // automation triggers + workflow-snippet skills + knowledge intake
  'trigger-save', 'trigger-toggle', 'trigger-delete', 'skill-toggle', 'ai-skill-delete',
  'create-info-source', 'info-source-archive', 'info-source-delete', 'link-repo',
  // workspace settings + budgets
  'save-sections', 'save-ai-instruction', 'save-ai-provider', 'save-autonomy', 'save-stage-config',
  'edit-budget', 'resume-spend', 'edit-media-budget',
  // inbox / findings / ui-review / styles / references / tasks / output templates / design tokens
  'comments-refresh', 'comments-mark-read', 'finding-to-ticket', 'finding-dismiss', 'ui-review-create',
  'delete-style', 'reference-delete', 'delete-custom-task', 'save-output-template', 'delete-output-template',
  'apply-design-tokens',
] as const;

export type ChatEnabledOp = (typeof CHAT_ENABLED_OPS)[number];

//? Type-guard so the provider can index the dispatch map without a cast (Rule 21).
export function isChatEnabledOp(op: string): op is ChatEnabledOp {
  return (CHAT_ENABLED_OPS as readonly string[]).includes(op);
}
