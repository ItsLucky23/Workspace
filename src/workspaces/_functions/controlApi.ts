//? Workspaces — the [control-API] contract (the FROZEN A1 write-path shape).
//?
//? The single, typed definition of the web-app → orchestrator write transport that
//? every user-initiated write goes through (CONTROL_API.md). A control-API `_api`
//? route runs `preApiExecute` RBAC (§5), then ENQUEUES a Conductor action onto the
//? serial signal-log and returns a `ControlAck` — it NEVER mutates authoritative
//? state inline (§7, B-23: only the Conductor writes). The client shows an
//? optimistic affordance and reconciles on the realtime `seq` stream (§6.3).
//?
//? This file is a CONTRACT: pure types + constants, shared by the client (calls
//? ops via the typed apiRequest) and the server handlers (which enqueue). It adds
//? NO structured-channel verb (the verbs are the disjoint AI read/propose path, §4).
//? Catalogue source: CONTROL_API §8. RBAC source: 16 §RBAC / B-28 (seed
//? RBAC_CAPABILITIES) + the Admin+ rows (D69).

// ---------------------------------------------------------------- operations

//? Every `op` is one route in the family (`src/workspaces/_api/<op>_v1.ts`).
//? Grouped by owning feature doc; the non-AI (Fase 1) ops are the workspace/
//? member/RBAC/settings/board writes — the AI-session ops (pause/kill/…) are
//? contract-frozen here but wired by Lane A in Fase 2.
export type ControlOp =
  // tickets / board (12/13)
  | 'quick-add'
  | 'ticket-edit'
  | 'add-comment'
  | 'archive'
  | 'bulk-move' | 'bulk-status' | 'bulk-assign' | 'bulk-sprint' | 'bulk-archive'
  | 'sprint-create' | 'sprint-edit'
  // members / RBAC / workspace lifecycle (16/17)
  | 'create-workspace' | 'clone-workspace' | 'rename-workspace' | 'delete-workspace' | 'transfer-ownership'
  | 'change-role' | 'remove-member' | 'invite' | 'revoke-invite' | 'accept-invite'
  | 'role-create' | 'role-update'
  // workspace settings (15/19/22)
  | 'save-env' | 'remove-env' | 'save-integration' | 'remove-integration'
  | 'service-provision' | 'service-teardown' | 'ui-review-create' | 'ui-review-to-ticket' | 'ui-review-dismiss'
  | 'gitlab-settings' | 'gitlab-verify' | 'gitlab-resync'
  | 'forge-connect'
  | 'save-git-config' | 'save-sections' | 'save-ai-instruction' | 'save-ai-provider' | 'save-autonomy'
  | 'link-repo' | 'scan-docs' | 'create-info-source' | 'scan-index'
  | 'mr-create' | 'mr-comment' | 'mr-approve' | 'mr-merge' | 'mr-rollback' | 'mr-resolve' | 'mr-review'
  | 'raise-cap' | 'edit-budget' | 'resume-spend'
  | 'skill-toggle' | 'save-stage-config' | 'stage-create' | 'stage-delete' | 'stage-reorder'
  | 'trigger-save' | 'trigger-toggle' | 'trigger-delete' | 'trigger-run'
  | 'finding-to-ticket' | 'finding-dismiss'
  | 'ticket-link-artifact' | 'ticket-unlink-artifact' | 'apply-design-tokens'
  // multi-project / multi-service (ADR 0035) + scaffolding (ADR 0046)
  | 'project-create' | 'service-create' | 'service-delete' | 'project-from-template'
  // environments / deploy (ADR 0037/0038)
  | 'env-deploy' | 'env-teardown' | 'env-promote' | 'build-export' | 'env-rollback'
  // CI / quality gates (ADR 0039)
  | 'ci-run' | 'ci-allow-red'
  // AI rollback (ADR 0042)
  | 'root-cause'
  // reasoning (ADR 0044)
  | 'plan-critique'
  // RAG / institutional memory (ADR 0045)
  | 'index-memory'
  // user-app DB + migrations (ADR 0043)
  | 'db-connect' | 'db-migrate-create' | 'db-migrate-apply' | 'db-introspect'
  // content platform (ADR 0049)
  | 'edit-media-budget' | 'save-style' | 'delete-style' | 'save-media-provider' | 'save-platform-credentials' | 'content-edit-brand' | 'content-edit-product'
  | 'content-create' | 'content-advance' | 'content-archive'
  | 'content-gen-script' | 'content-gen-voice' | 'content-gen-images' | 'content-assemble'
  | 'content-gen-reference-image' | 'content-gen-shortform' | 'content-analyze-reference-video'
  | 'content-gen-avatar' | 'content-gen-music' | 'content-gen-sfx' | 'content-gen-3d'
  | 'content-request-publish' | 'content-from-brief' | 'content-import-asset' | 'content-regenerate' | 'content-inpaint' | 'content-reorder-beats' | 'content-save-scenes' | 'content-decompose-video' | 'content-refine-range' | 'content-run-pipeline' | 'content-save-audio-mix' | 'content-trim-audio' | 'content-critique-image' | 'content-gen-thumbnail' | 'content-reply-comment' | 'studio-publish-site' | 'studio-unpublish-site' | 'asset-star' | 'content-video-restyle' | 'content-edit-image' | 'content-transcode' | 'shortlink-create' | 'capture-run'
  | 'channel-create' | 'channel-edit' | 'channel-delete' | 'account-disconnect'
  | 'reference-add' | 'reference-delete' | 'content-unarchive' | 'content-unpublish' | 'save-custom-task' | 'delete-custom-task' | 'run-custom-task' | 'save-output-template' | 'delete-output-template' | 'copy-workspace-assets' | 'copilot-propose' | 'run-agent-role' | 'studio-send-to-content'
  //? SK1 (DOCUMENTS_AND_SKILLS) — the universal AI-skills layer (workspace-scoped instruction blocks
  //? injected into AI runs). Distinct from the older 'skill-toggle' (InfoSource workflow snippets).
  | 'ai-skill-save' | 'ai-skill-toggle' | 'ai-skill-delete' | 'ai-skill-reset'
  //? DOC (DOCUMENTS_AND_SKILLS) — the Documents module. AI output lands as aiDraft; apply-draft is the
  //? consent that writes content (B-23). gen-image reuses the media pipeline into document assets.
  | 'document-create' | 'document-edit' | 'document-delete' | 'document-ai' | 'document-apply-draft' | 'document-discard-draft' | 'document-gen-image' | 'document-export' | 'document-restore-revision' | 'document-archive' | 'document-unarchive' | 'doc-template-save' | 'doc-template-delete'
  //? CI (DOCUMENTS_AND_SKILLS) — the read-only comment inbox (refresh + mark read; replies are a non-goal).
  | 'comments-refresh' | 'comments-mark-read'
  // notifications (18)
  | 'mark-read'
  // AI-session controls (24/19) — contract-frozen; wired by Lane A (Fase 2)
  | 'pause' | 'resume' | 'answer-input' | 'kill' | 'pause-all' | 'resume-all'
  //? #27 — generate/rotate the per-workspace inbound-webhook secret (workspaceSettings; direct UI button,
  //? never a chat proposal since it mints a secret). The Conductor is the single writer of the secret.
  | 'forge-webhook-rotate'
  //? #17/#113 — preview-up/preview-down: AI-proposable preview launch/stop (owner conflict-resolution
  //? 2026-07-12 "preview=implement", overrides the earlier remove-answer). They do NOT reach the Conductor —
  //? their accept dispatches through the openPreview/closePreview `_api` routes (ephemeral container state,
  //? like openEditor; NOT authoritative board/git/status), so single-writer is untouched.
  | 'preview-up' | 'preview-down'
  | 'accept-suggestion';

//? The op-specific target (CONTROL_API §6.1). A union of the shapes the ops use.
export type ControlTarget =
  | { ticketId: string }
  | { ticketIds: string[] }
  | { memberId: string }
  | { inviteId: string }
  | { inviteToken: string }
  | { sprintId: string }
  | { roleKey: string }
  | { envId: string }
  | { integrationId: string }
  | { notificationId: string }
  | { all: true }
  | { suggestionId: string }
  | { workspaceId: string }
  | Record<string, never>; // ops whose target is the workspace itself (create-workspace, …)

//? The request the web-app sends (CONTROL_API §6.1). The real per-op payload types
//? are refined at each route; this is the transport envelope.
export interface ControlRequest<P = Record<string, unknown>> {
  workspaceId: string;     // tenant scope; the server enters runInTenant(workspaceId)
  op: ControlOp;
  target: ControlTarget;
  payload: P;
  clientRequestId: string; // idempotency key (dedups re-sends, §6.4)
}

//? An ACKNOWLEDGEMENT that the action was enqueued — NOT the mutated entity. The
//? real state change arrives later over the realtime channel once the Conductor
//? drains the signal and writes (CONTROL_API §6.2).
export type ControlAck =
  | { status: 'success'; result: { accepted: true; signalSeq: number } }
  | { status: 'error'; result: { accepted: false; reason: ControlDenyReason } };

export type ControlDenyReason = 'rbac' | 'rate-limit' | 'invalid' | 'conflict';

// ---------------------------------------------------------------- RBAC

//? The capability matrix (B-28) — positional, mirrored from seed `RBAC_CAPABILITIES`.
//? `WorkspaceRole.perms[i]` is the boolean for capability `i`. Keep this list in
//? lockstep with seed.ts RBAC_CAPABILITIES and the WorkspaceRole seeding.
export const RBAC_CAPABILITIES = [
  'Use terminals + work on tickets',      // 0
  'Edit pipeline / stages',               // 1
  'Workspace settings / GitLab token',    // 2
  'Invite / remove members',              // 3
  'Manage sprints + labels, teardown',    // 4
  'Promote a member to Admin',            // 5
  'Downgrade / remove an Admin',          // 6
  'Transfer ownership / delete workspace',// 7
] as const;

export type Capability = (typeof RBAC_CAPABILITIES)[number];

//? The runtime RBAC gate (`hasCapability` + `CAP`) lives in `server/control/rbac.ts`
//? — each per-action `_api` route calls it (the generated server bundle stubs
//? non-`_api` `src/` runtime imports to undefined; type imports here erase fine).
//? `OP_CAPABILITY` there is the consolidated reference matrix of every op's capability.

//? Destructive/irreversible ops that require an explicit user confirm BEFORE the
//? control-API request is even sent (V1_SCOPE §3.3 confirm-on-important).
export const CONFIRM_REQUIRED: ReadonlySet<ControlOp> = new Set<ControlOp>([
  'delete-workspace', 'transfer-ownership', 'remove-member', 'kill', 'pause-all',
  //? SEC8 — tearing down an environment kills its container + route (destructive, B-23 confirm).
  'env-teardown',
  //? D3 — a rollback replaces what is LIVE with an older commit; the user confirms before it ships.
  'env-rollback',
]);
