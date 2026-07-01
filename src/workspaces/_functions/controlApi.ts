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
  | 'archive'
  | 'bulk-move' | 'bulk-status' | 'bulk-assign' | 'bulk-sprint' | 'bulk-archive'
  | 'sprint-create' | 'sprint-edit'
  // members / RBAC / workspace lifecycle (16/17)
  | 'create-workspace' | 'rename-workspace' | 'delete-workspace' | 'transfer-ownership'
  | 'change-role' | 'remove-member' | 'invite' | 'revoke-invite' | 'accept-invite'
  | 'role-create' | 'role-update'
  // workspace settings (15/19/22)
  | 'save-env' | 'remove-env' | 'save-integration' | 'remove-integration'
  | 'gitlab-settings' | 'gitlab-verify' | 'gitlab-resync'
  | 'raise-cap' | 'edit-budget' | 'resume-spend'
  | 'skill-toggle' | 'save-stage-config'
  // notifications (18)
  | 'mark-read'
  // AI-session controls (24/19) — contract-frozen; wired by Lane A (Fase 2)
  | 'pause' | 'resume' | 'kill' | 'pause-all' | 'resume-all'
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

//? Which capability index a control-API op requires. The `preApiExecute` gate
//? checks the caller's WorkspaceRole.perms[requiredCap] === true (Owner is always
//? all-true). `null` = login-only (own-resource ops like mark-read / accept-invite).
export const OP_CAPABILITY: Record<ControlOp, number | null> = {
  // tickets / board
  'quick-add': CAP.workTickets,
  archive: CAP.workTickets,
  'bulk-move': CAP.workTickets,
  'bulk-status': CAP.workTickets,
  'bulk-assign': CAP.workTickets,
  'bulk-sprint': CAP.manageSprints,
  'bulk-archive': CAP.workTickets,
  'sprint-create': CAP.manageSprints,
  'sprint-edit': CAP.manageSprints,
  // members / RBAC / lifecycle
  'create-workspace': null, // any logged-in user may create a workspace (they become Owner)
  'rename-workspace': CAP.workspaceSettings,
  'delete-workspace': CAP.ownerActions,
  'transfer-ownership': CAP.ownerActions,
  'change-role': CAP.manageMembers,
  'remove-member': CAP.manageMembers,
  invite: CAP.manageMembers,
  'revoke-invite': CAP.manageMembers,
  'accept-invite': null, // token-scoped, login-only
  'role-create': CAP.editPipeline,
  'role-update': CAP.editPipeline,
  // settings
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
  // notifications
  'mark-read': null, // own notifications
  // AI-session controls (Fase 2)
  pause: CAP.workTickets,
  resume: CAP.workTickets,
  kill: CAP.demoteAdmin, // Admin+ (D69)
  'pause-all': CAP.demoteAdmin,
  'resume-all': CAP.demoteAdmin,
  'preview-up': CAP.workTickets,
  'preview-down': CAP.workTickets,
  'accept-suggestion': null, // per the suggestion's own required cap, checked at accept time
};

//? Destructive/irreversible ops that require an explicit user confirm BEFORE the
//? control-API request is even sent (V1_SCOPE §3.3 confirm-on-important).
export const CONFIRM_REQUIRED: ReadonlySet<ControlOp> = new Set<ControlOp>([
  'delete-workspace', 'transfer-ownership', 'remove-member', 'kill', 'pause-all',
]);
