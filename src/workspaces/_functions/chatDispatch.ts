//? Workspaces — X1 client dispatchers for the CHAT-ENABLED generic ops (chatOps.ts tranche).
//? An ACCEPTED generic proposal dispatches through the SAME `_sync` routes the manual UI uses —
//? RBAC + Conductor single-writer stay fully intact (B-23; no new verbs). One dispatcher per
//? enabled op; `Record<ChatEnabledOp, …>` makes forgetting one a tsc error, and
//? `tests/unit/opCatalogParity.test.mts` keeps this tranche in lockstep with the server catalog.
//? Params were already server-validated against the workspace context; the local `str/num/…`
//? readers only re-narrow the JSON types (never invent values, no casts).

import { apiRequest as rawApiRequest } from 'src/_sockets/apiRequest';
import { syncRequest as rawSyncRequest } from 'src/_sockets/syncRequest';

import type { ChatEnabledOp } from '../_data/chatOps';
import type { ChatProposal, GitConfig, PipelineStageCfg } from '../_data/types';
//? role-create seeds an all-false perms array with the canonical capability count (B-28 positional).
import { RBAC_CAPABILITIES } from './controlApi';

export interface ChatDispatchExtras {
  room: string;                    // workspaceId (the sync receiver)
  activeProjectId: string;         // validated current project; stale proposals never reach this layer
  gitConfig: GitConfig;            // #29 — current git strategy, so save-git-config merges (never clobbers)
  //? Parity wave — merge sources for the full-payload routes: saveAiInstruction writes ALL five fields
  //? (absent → ''), saveStageConfig wants a COMPLETE PipelineStageCfg. Same clobber-guard as gitConfig.
  aiSettings: { aiInstruction: string; outputLanguage: string; geminiModel: string; geminiTemperature: string; geminiBaseUrl: string };
  stageConfigs: PipelineStageCfg[];
  //? delete-workspace reuses the provider's OWN delete flow (api call + nav/loading reset) — the one
  //? accept whose aftermath lives in client state the dispatcher cannot reach.
  deleteWorkspace: () => Promise<{ status: 'success' | 'error' }>;
  nextReqId: () => string;         // idempotency key factory
  refetch: () => void;             // snapshot refresh for slow/rare structural writes
}

let activeReceiptCollector: ((receipt: Promise<unknown>) => void) | null = null;

const collectReceipt = <T extends Promise<unknown>>(receipt: T): T => {
  activeReceiptCollector?.(receipt);
  return receipt;
};

//? Catalog dispatchers historically fire-and-forgot every request, so the chat painted “Done” before RBAC or
//? execution replied. These typed wrappers keep all existing dispatcher bodies intact while collecting the
//? real API/sync receipts for the one synchronous dispatch invocation that is currently being accepted.
const apiRequest: typeof rawApiRequest = (options) => collectReceipt(rawApiRequest(options));
const syncRequest: typeof rawSyncRequest = (options) => collectReceipt(rawSyncRequest(options));

const str = (p: ChatProposal, key: string): string | undefined => {
  const v = p.params?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};
const num = (p: ChatProposal, key: string): number | undefined => {
  const v = p.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const bool = (p: ChatProposal, key: string): boolean | undefined => {
  const v = p.params?.[key];
  return typeof v === 'boolean' ? v : undefined;
};
const strArr = (p: ChatProposal, key: string): string[] | undefined => {
  const v = p.params?.[key];
  return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : undefined;
};

//? Proposal provenance is a security boundary, not display metadata: after a project
//? switch an old proposal must not dispatch against the newly active project.
export function isChatProposalForProject(proposal: ChatProposal, activeProjectId: string | null): boolean {
  return activeProjectId !== null && proposal.projectId === activeProjectId;
}

//? agentControl family (pause/resume/kill/pause-all/resume-all) — one small helper.
const agent = (op: 'pause' | 'resume' | 'kill' | 'pause-all' | 'resume-all') => (p: ChatProposal, x: ChatDispatchExtras): void => {
  const ticketKey = str(p, 'ticketKey');
  void syncRequest({ name: 'workspaces/agentControl', version: 'v1', data: { op, ...(ticketKey ? { ticketKey } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
};

//? #134 — per-asset content-gen family: pieceId → contentProjectId + optional prompt, via contentControl.
const contentGen = (op: string) => (p: ChatProposal, x: ChatDispatchExtras): void => {
  const pieceId = str(p, 'pieceId'); if (!pieceId) return;
  const prompt = str(p, 'prompt');
  void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op, contentProjectId: pieceId, ...(prompt ? { prompt } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
};

//? GAP_SCAN C3 — the AI-skills family. Both route through the SAME skillsControl `_sync` the settings
//? UI uses → RBAC(workspaceSettings) → Conductor (B-23); the chat only ever proposes.
const skill = (op: 'ai-skill-save' | 'ai-skill-reset') => (p: ChatProposal, x: ChatDispatchExtras): void => {
  const skillId = str(p, 'skillId');
  const name = str(p, 'name');
  const instruction = str(p, 'instruction');
  const examples = str(p, 'examples');
  const applyPointsRaw = str(p, 'applyPoints');
  const applyPoints = applyPointsRaw ? applyPointsRaw.split(',').map((v) => v.trim()).filter((v) => v.length > 0) : undefined;
  //? reset acts on an EXISTING skill; save needs either a target id (update) or a name (create).
  if (op !== 'ai-skill-save' && !skillId) return;
  if (op === 'ai-skill-save' && !skillId && !name) return;
  void syncRequest({
    name: 'workspaces/skillsControl', version: 'v1',
    data: {
      op,
      ...(skillId ? { skillId } : {}), ...(name ? { name } : {}),
      ...(instruction ? { instruction } : {}), ...(examples ? { examples } : {}),
      ...(applyPoints ? { applyPoints } : {}),
      clientRequestId: x.nextReqId(),
    },
    receiver: x.room,
  }).then(() => { x.refetch(); });
};

export const CHAT_DISPATCH: Record<ChatEnabledOp, (p: ChatProposal, x: ChatDispatchExtras) => void> = {
  //? Documents housekeeping — both reversible, so the accept is a plain confirm.
  'document-archive': (p, x) => {
    const documentId = str(p, 'documentId'); if (!documentId) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-archive', documentId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-unarchive': (p, x) => {
    const documentId = str(p, 'documentId'); if (!documentId) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-unarchive', documentId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? F48 — the bin, from chat. Purge already passed the destructive-confirm before it reaches here.
  'media-trash-restore': (p, x) => {
    const trashId = str(p, 'trashId'); if (!trashId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'media-trash-restore', trashId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'media-trash-purge': (p, x) => {
    const trashId = str(p, 'trashId'); if (!trashId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'media-trash-purge', trashId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? G4 — curate the reusable asset library from chat.
  'asset-star': (p, x) => {
    const assetId = str(p, 'assetId'); const starred = bool(p, 'starred');
    if (!assetId || starred === undefined) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'asset-star', assetId, starred, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? F5 — the destructive-confirm the user just answered IS the send approval; the text is the one they saw.
  'content-reply-comment': (p, x) => {
    const commentId = str(p, 'commentId'); const replyText = str(p, 'replyText');
    if (!commentId || !replyText) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-reply-comment', commentId, replyText, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? G7 — start / stop a prompt A/B from chat (the panel in settings shows the verdict).
  'prompt-experiment-save': (p, x) => {
    const feature = str(p, 'feature'); const name = str(p, 'name');
    const variantA = str(p, 'variantA'); const variantB = str(p, 'variantB');
    if (!feature || !name || !variantA || !variantB) return;
    void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'prompt-experiment-save', feature, name, variantA, variantB, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'prompt-experiment-stop': (p, x) => {
    const experimentId = str(p, 'experimentId'); if (!experimentId) return;
    void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'prompt-experiment-stop', experimentId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? G3 — take a published page down again.
  'studio-unpublish-site': (p, x) => {
    const slug = str(p, 'slug'); if (!slug) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'studio-unpublish-site', slug, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? G3 — publish a generated Studio page (the artifact id comes from the studio list).
  'studio-publish-site': (p, x) => {
    const artifactId = str(p, 'artifactId'); if (!artifactId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'studio-publish-site', artifactId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? F1 — compose a thumbnail for a piece (headline + optional AI background).
  'content-gen-thumbnail': (p, x) => {
    const pieceId = str(p, 'pieceId'); const headline = str(p, 'headline');
    if (!pieceId || !headline) return;
    const backgroundPrompt = str(p, 'backgroundPrompt');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-gen-thumbnail', contentProjectId: pieceId, headline, ...(backgroundPrompt ? { backgroundPrompt } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'ai-skill-save': skill('ai-skill-save'),
  'ai-skill-reset': skill('ai-skill-reset'),
  pause: agent('pause'),
  resume: agent('resume'),
  kill: agent('kill'),
  'pause-all': agent('pause-all'),
  'resume-all': agent('resume-all'),

  'env-deploy': (p, x) => {
    const kind = str(p, 'kind'); if (!kind || !x.activeProjectId) return;
    const serviceId = str(p, 'serviceId');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-deploy', projectId: x.activeProjectId, kind, ...(serviceId ? { serviceId } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'env-rollback': (p, x) => {
    const envId = str(p, 'envId'); if (!envId) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-rollback', envId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'env-teardown': (p, x) => {
    const envId = str(p, 'envId'); if (!envId) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-teardown', envId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'env-promote': (p, x) => {
    const fromKind = str(p, 'fromKind'); if (!fromKind || !x.activeProjectId) return;
    //? The destructive-confirm the user just answered IS the promote approval (prod stays further
    //? gated server-side on green CI + security — the flag alone never bypasses those).
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'env-promote', projectId: x.activeProjectId, fromKind, approved: true, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'build-export': (p, x) => {
    const kind = str(p, 'kind'); if (!kind || !x.activeProjectId) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'build-export', projectId: x.activeProjectId, kind, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  'ci-run': (p, x) => {
    const ticketKey = str(p, 'ticketKey');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'ci-run', projectId: x.activeProjectId, ...(ticketKey ? { ticketKey } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'ci-allow-red': (p, x) => {
    const enabled = bool(p, 'enabled'); if (enabled === undefined) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'ci-allow-red', projectId: x.activeProjectId, enabled, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'root-cause': (p, x) => {
    const symptom = str(p, 'symptom');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'root-cause', projectId: x.activeProjectId, ...(symptom ? { symptom } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'plan-critique': (p, x) => {
    const ticketKey = str(p, 'ticketKey');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'plan-critique', projectId: x.activeProjectId, ...(ticketKey ? { ticketKey } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'index-memory': (_p, x) => {
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'index-memory', clientRequestId: x.nextReqId() }, receiver: x.room });
  },

  'db-migrate-create': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-migrate-create', projectId: x.activeProjectId, name, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? The generic destructive-confirm is the explicit migration approval; the server still scopes the
  //? migration id to this workspace and applies its configured environment contract.
  'db-migrate-apply': (p, x) => {
    const migrationId = str(p, 'migrationId'); if (!migrationId) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-migrate-apply', migrationId, approved: true, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'db-introspect': (p, x) => {
    const connectionId = str(p, 'connectionId');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-introspect', projectId: x.activeProjectId, ...(connectionId ? { connectionId } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },

  'project-create': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'project-create', name, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'project-from-template': (p, x) => {
    const name = str(p, 'name'); const template = str(p, 'template');
    if (!name || !template) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'project-from-template', name, template, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  'service-provision': (p, x) => {
    const name = str(p, 'name'); const preset = str(p, 'preset');
    if (!name || !preset) return;
    void syncRequest({ name: 'workspaces/serviceProvision', version: 'v1', data: { name, preset, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'service-teardown': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    void syncRequest({ name: 'workspaces/serviceTeardown', version: 'v1', data: { name, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  'stage-create': (p, x) => {
    const key = str(p, 'key'); const name = str(p, 'name');
    if (!key || !name || !x.activeProjectId) return;
    const kind = str(p, 'kind');
    void syncRequest({ name: 'workspaces/stageCreate', version: 'v1', data: { projectId: x.activeProjectId, key, name, ...(kind ? { kind } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'stage-delete': (p, x) => {
    const stageId = str(p, 'stageId'); if (!stageId || !x.activeProjectId) return;
    void syncRequest({ name: 'workspaces/stageDelete', version: 'v1', data: { projectId: x.activeProjectId, stageId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'pipeline-apply-preset': (p, x) => {
    const preset = str(p, 'preset'); if (!preset || !x.activeProjectId) return;
    const mode = str(p, 'mode') === 'switch' ? 'switch' : 'fill';
    void syncRequest({ name: 'workspaces/pipelinePreset', version: 'v1', data: { projectId: x.activeProjectId, preset, mode, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'stage-reorder': (p, x) => {
    const order = strArr(p, 'order'); if (!order || order.length === 0 || !x.activeProjectId) return;
    void syncRequest({ name: 'workspaces/stageReorder', version: 'v1', data: { projectId: x.activeProjectId, order, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  'content-run-pipeline': (p, x) => {
    const pieceId = str(p, 'pieceId'); if (!pieceId) return;
    const styleKey = str(p, 'styleKey'); const durationMs = num(p, 'durationMs');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-run-pipeline', contentProjectId: pieceId, ...(styleKey ? { styleKey } : {}), ...(typeof durationMs === 'number' ? { durationMs } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-advance': (p, x) => {
    const pieceId = str(p, 'pieceId'); if (!pieceId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-advance', contentProjectId: pieceId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-archive': (p, x) => {
    const pieceId = str(p, 'pieceId'); if (!pieceId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-archive', contentProjectId: pieceId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-unarchive': (p, x) => {
    const pieceId = str(p, 'pieceId'); if (!pieceId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-unarchive', contentProjectId: pieceId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-regenerate': (p, x) => {
    const assetId = str(p, 'assetId'); if (!assetId) return;
    const pieceId = str(p, 'pieceId'); const tweak = str(p, 'tweak'); const count = num(p, 'count');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-regenerate', assetId, ...(pieceId ? { contentProjectId: pieceId } : {}), ...(tweak ? { tweak } : {}), ...(typeof count === 'number' ? { count: String(count) } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-critique-image': (p, x) => {
    const pieceId = str(p, 'pieceId'); const assetId = str(p, 'assetId');
    if (!pieceId || !assetId) return;
    const prompt = str(p, 'prompt');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-critique-image', contentProjectId: pieceId, assetId, ...(prompt ? { prompt } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-video-restyle': (p, x) => {
    const pieceId = str(p, 'pieceId'); const assetId = str(p, 'assetId'); const prompt = str(p, 'prompt');
    if (!pieceId || !assetId || !prompt) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-video-restyle', contentProjectId: pieceId, assetId, prompt, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'capture-run': (p, x) => {
    const url = str(p, 'url'); const pieceId = str(p, 'pieceId');
    if (!url || !pieceId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'capture-run', contentProjectId: pieceId, url, ...(str(p, 'goal') ? { goal: str(p, 'goal') } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'shortlink-create': (p, x) => {
    const targetUrl = str(p, 'targetUrl'); const pieceId = str(p, 'pieceId');
    if (!targetUrl) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'shortlink-create', targetUrl, ...(pieceId ? { contentProjectId: pieceId } : {}), ...(str(p, 'variant') ? { variant: str(p, 'variant') } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-edit-image': (p, x) => {
    const pieceId = str(p, 'pieceId'); const assetId = str(p, 'assetId'); const prompt = str(p, 'prompt');
    if (!pieceId || !assetId || !prompt) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-edit-image', contentProjectId: pieceId, assetId, prompt, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  //? #150 — save a reusable generation style (contentSettings route, upsert-by-key).
  'save-style': (p, x) => {
    const feature = str(p, 'feature'); const key = str(p, 'key'); const systemPrompt = str(p, 'systemPrompt');
    if (!feature || !key || !systemPrompt) return;
    const label = str(p, 'label');
    void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'save-style', feature, key, systemPrompt, ...(label ? { label } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #142 — create a publishing channel (contentControl route; projectId resolves server-side).
  'channel-create': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    const platform = str(p, 'platform'); const handle = str(p, 'handle');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'channel-create', projectId: x.activeProjectId, name, ...(platform ? { platform } : {}), ...(handle ? { handle } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #150 — save a brand/style reference (contentControl route, workspace-level inspiration library).
  'reference-add': (p, x) => {
    const title = str(p, 'title'); const description = str(p, 'description');
    if (!title || !description) return;
    const kind = str(p, 'kind');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'reference-add', title, description, ...(kind ? { kind } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #150 — set the workspace brand/product context (contentSettings route).
  'content-edit-product': (p, x) => {
    const productContext = str(p, 'productContext'); if (!productContext) return;
    void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'content-edit-product', productContext, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #150 — set a channel's brand voice (contentSettings route).
  'content-edit-brand': (p, x) => {
    const channelId = str(p, 'channelId'); const brandVoice = str(p, 'brandVoice');
    if (!channelId || brandVoice === undefined) return;
    void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'content-edit-brand', channelId, brandVoice, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #29 — on-demand forge issue resync (projectAdmin route; no params).
  'gitlab-resync': (_p, x) => {
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'gitlab-resync', projectId: x.activeProjectId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #29 — change git strategy / push policy. Only the proposed fields were validated; MERGE them over
  //? the current gitConfig so the untouched fields survive the Conductor's normalize (saveGitConfig route).
  'save-git-config': (p, x) => {
    const branchStrategy = str(p, 'branchStrategy'); const pushPolicy = str(p, 'pushPolicy');
    const defaultBranchType = str(p, 'defaultBranchType'); const targetBranch = str(p, 'targetBranch');
    const gitConfig: GitConfig = {
      ...x.gitConfig,
      ...(branchStrategy === 'ticket-prefix' || branchStrategy === 'typed' || branchStrategy === 'custom' ? { branchStrategy } : {}),
      ...(pushPolicy === 'local-only' || pushPolicy === 'push' || pushPolicy === 'merge-request' ? { pushPolicy } : {}),
      ...(defaultBranchType ? { defaultBranchType } : {}),
      ...(targetBranch ? { targetBranch } : {}),
    };
    void syncRequest({ name: 'workspaces/saveGitConfig', version: 'v1', data: { gitConfig, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #86 — run a saved custom AI task by id (customTask route).
  'run-custom-task': (p, x) => {
    const taskId = str(p, 'taskId'); if (!taskId) return;
    void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'run-custom-task', taskId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #86 — the Assistant proposes a new custom AI task (name + prompt-template); accept saves it.
  'save-custom-task': (p, x) => {
    const name = str(p, 'name'); const promptTemplate = str(p, 'promptTemplate'); if (!name || !promptTemplate) return;
    void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'save-custom-task', name, promptTemplate, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #86 — run an automation trigger on demand by id (triggerAction route).
  'trigger-run': (p, x) => {
    const triggerId = str(p, 'triggerId'); if (!triggerId) return;
    void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-run', triggerId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #54 — AI review of an MR (mrAction route; the ControlOp maps to the route's `action` field).
  'mr-review': (p, x) => {
    const mrId = str(p, 'mrId'); const ticketKey = str(p, 'ticketKey');
    if (!mrId || !ticketKey) return;
    void syncRequest({ name: 'workspaces/mrAction', version: 'v1', data: { action: 'review', ticketKey, mrId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #54 — roll back a merged MR (mrAction route).
  'mr-rollback': (p, x) => {
    const mrId = str(p, 'mrId'); const ticketKey = str(p, 'ticketKey');
    if (!mrId || !ticketKey) return;
    void syncRequest({ name: 'workspaces/mrAction', version: 'v1', data: { action: 'rollback', ticketKey, mrId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? #7 — edit a ticket's title/description/priority (ticketEdit route; the key travels as `ticketId`).
  'ticket-edit': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); if (!ticketKey) return;
    const title = str(p, 'title'); const description = str(p, 'description'); const priority = str(p, 'priority');
    void syncRequest({ name: 'workspaces/ticketEdit', version: 'v1', data: { ticketId: ticketKey, ...(title ? { title } : {}), ...(description ? { description } : {}), ...(priority ? { priority } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  //? #134 — per-asset content generation (paid; accept = cost-confirm).
  'content-gen-script': contentGen('content-gen-script'),
  'content-gen-voice': contentGen('content-gen-voice'),
  'content-gen-images': contentGen('content-gen-images'),
  'content-assemble': contentGen('content-assemble'),
  'content-gen-avatar': contentGen('content-gen-avatar'),
  'content-gen-music': contentGen('content-gen-music'),
  'content-gen-sfx': contentGen('content-gen-sfx'),
  'content-gen-3d': contentGen('content-gen-3d'),
  'content-gen-shortform': contentGen('content-gen-shortform'),

  //? #142 — channel management (contentControl route).
  'channel-edit': (p, x) => {
    const channelId = str(p, 'channelId'); if (!channelId) return;
    const name = str(p, 'name'); const platform = str(p, 'platform'); const handle = str(p, 'handle'); const brandVoice = str(p, 'brandVoice');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'channel-edit', channelId, ...(name ? { name } : {}), ...(platform ? { platform } : {}), ...(handle ? { handle } : {}), ...(brandVoice ? { brandVoice } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'channel-delete': (p, x) => {
    const channelId = str(p, 'channelId'); if (!channelId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'channel-delete', channelId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  //? knowledge refresh (no params) — rescan docs / rebuild the code RAG index.
  'scan-docs': (_p, x) => { void syncRequest({ name: 'workspaces/scanDocs', version: 'v1', data: { clientRequestId: x.nextReqId() }, receiver: x.room }); },
  'scan-index': (_p, x) => { void syncRequest({ name: 'workspaces/scanIndex', version: 'v1', data: { clientRequestId: x.nextReqId() }, receiver: x.room }); },

  //? #17/#113 — preview launch/stop route through the openPreview/closePreview `_api` (ephemeral container
  //? state, NOT the Conductor). `x.room` is the workspaceId; ticketKey was validated against the ctx.
  'preview-up': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); if (!ticketKey) return;
    void apiRequest({ name: 'workspaces/openPreview', version: 'v1', data: { workspaceId: x.room, ticketKey, clientRequestId: x.nextReqId() } });
  },
  'preview-down': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); if (!ticketKey) return;
    void apiRequest({ name: 'workspaces/closePreview', version: 'v1', data: { workspaceId: x.room, ticketKey, clientRequestId: x.nextReqId() } });
  },

  //? ---- Parity wave 2026-07-20 — every dispatcher below copies the EXACT `_sync` shape its manual UI
  //? twin sends (WorkspacesProvider/page callers), so RBAC + Conductor single-writer stay fully intact.

  // -- board / sprints (the routes broadcast deltas — no refetch needed, same as the UI path)
  archive: (p, x) => {
    const ticketKey = str(p, 'ticketKey'); if (!ticketKey) return;
    //? The route field is named ticketId but carries the DEV-#### key (Ticket.id IS the key).
    void syncRequest({ name: 'workspaces/archive', version: 'v1', data: { ticketId: ticketKey, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'bulk-status': (p, x) => {
    const ticketIds = strArr(p, 'ticketKeys'); const status = str(p, 'status');
    if (!ticketIds || ticketIds.length === 0 || !status) return;
    void syncRequest({ name: 'workspaces/bulkStatus', version: 'v1', data: { ticketIds, status, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'bulk-sprint': (p, x) => {
    const ticketIds = strArr(p, 'ticketKeys'); if (!ticketIds || ticketIds.length === 0) return;
    //? Empty sprintId = move back to the backlog (the same shape the backlog UI sends).
    const sprintId = str(p, 'sprintId') ?? '';
    void syncRequest({ name: 'workspaces/bulkSprint', version: 'v1', data: { ticketIds, sprintId, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'bulk-archive': (p, x) => {
    const ticketIds = strArr(p, 'ticketKeys'); if (!ticketIds || ticketIds.length === 0) return;
    void syncRequest({ name: 'workspaces/bulkArchive', version: 'v1', data: { ticketIds, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'sprint-create': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    const active = bool(p, 'active');
    void syncRequest({ name: 'workspaces/sprintCreate', version: 'v1', data: { name, active: active === true, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'sprint-edit': (p, x) => {
    const sprintId = str(p, 'sprintId'); if (!sprintId) return;
    const name = str(p, 'name'); const active = bool(p, 'active');
    const startAt = str(p, 'startAt'); const endAt = str(p, 'endAt');
    void syncRequest({ name: 'workspaces/sprintEdit', version: 'v1', data: { sprintId, ...(name ? { name } : {}), ...(active === undefined ? {} : { active }), ...(startAt ? { startAt } : {}), ...(endAt ? { endAt } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  //? Ticket-artifact links change rarely and carry no delta broadcast — refetch after, like the UI.
  'ticket-link-artifact': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); const artifactId = str(p, 'artifactId'); const artifactKind = str(p, 'artifactKind');
    if (!ticketKey || !artifactId || !artifactKind) return;
    const label = str(p, 'label');
    void syncRequest({ name: 'workspaces/ticketArtifact', version: 'v1', data: { op: 'ticket-link-artifact', ticketId: ticketKey, artifactId, artifactKind, ...(label ? { label } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'ticket-unlink-artifact': (p, x) => {
    const linkId = str(p, 'linkId'); if (!linkId) return;
    void syncRequest({ name: 'workspaces/ticketArtifact', version: 'v1', data: { op: 'ticket-unlink-artifact', linkId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  // -- members / roles / workspace lifecycle (delta callbacks update state — no refetch)
  invite: (p, x) => {
    const email = str(p, 'email'); const roleKey = str(p, 'roleKey');
    if (!email || !roleKey) return;
    void syncRequest({ name: 'workspaces/invite', version: 'v1', data: { email, roleKey, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'revoke-invite': (p, x) => {
    const inviteId = str(p, 'inviteId'); if (!inviteId) return;
    void syncRequest({ name: 'workspaces/revokeInvite', version: 'v1', data: { inviteId, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'change-role': (p, x) => {
    const memberId = str(p, 'memberId'); const roleKey = str(p, 'roleKey');
    if (!memberId || !roleKey) return;
    void syncRequest({ name: 'workspaces/changeRole', version: 'v1', data: { memberId, roleKey, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'remove-member': (p, x) => {
    const memberId = str(p, 'memberId'); if (!memberId) return;
    void syncRequest({ name: 'workspaces/removeMember', version: 'v1', data: { memberId, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'role-create': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    //? Same key derivation as the settings UI; perms start all-false with the canonical B-28 length.
    const key = name.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
    if (!key) return;
    void syncRequest({ name: 'workspaces/roleCreate', version: 'v1', data: { key, label: name, perms: RBAC_CAPABILITIES.map(() => false), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  //? DELIBERATELY label-only: the perms array is merged client-side by the settings UI from live state
  //? the chat layer does not carry — a chat-side perms write would clobber (permission toggles stay UI).
  'role-update': (p, x) => {
    const roleKey = str(p, 'roleKey'); const label = str(p, 'label');
    if (!roleKey || !label) return;
    void syncRequest({ name: 'workspaces/roleUpdate', version: 'v1', data: { roleKey, label, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'rename-workspace': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    void syncRequest({ name: 'workspaces/renameWorkspace', version: 'v1', data: { name, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'transfer-ownership': (p, x) => {
    const memberId = str(p, 'memberId'); if (!memberId) return;
    void syncRequest({ name: 'workspaces/transferOwnership', version: 'v1', data: { memberId, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  //? The one accept that must also reset client nav/loading state — reuse the provider's own flow.
  'delete-workspace': (_p, x) => { void collectReceipt(x.deleteWorkspace()); },

  // -- documents + templates (no fine-grained delta — refetch after, like the documents UI)
  'document-create': (p, x) => {
    const title = str(p, 'title'); if (!title) return;
    const content = str(p, 'content'); const templateSlug = str(p, 'templateSlug');
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-create', title, ...(content ? { content } : {}), ...(templateSlug ? { templateSlug } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-edit': (p, x) => {
    const documentId = str(p, 'documentId'); if (!documentId) return;
    const title = str(p, 'title'); const content = str(p, 'content');
    //? `'content' in payload` semantics server-side — only send content when actually proposed.
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-edit', documentId, ...(title ? { title } : {}), ...(content === undefined ? {} : { content }), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-delete': (p, x) => {
    const documentId = str(p, 'documentId'); if (!documentId) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-delete', documentId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? B-23-clean: writes ONLY aiDraft/aiDraftLabel — document-apply-draft is the consent step.
  'document-ai': (p, x) => {
    const documentId = str(p, 'documentId'); if (!documentId) return;
    const mode = str(p, 'mode'); const instruction = str(p, 'instruction');
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-ai', documentId, ...(mode ? { mode } : {}), ...(instruction ? { instruction } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-apply-draft': (p, x) => {
    const documentId = str(p, 'documentId'); if (!documentId) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-apply-draft', documentId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-discard-draft': (p, x) => {
    const documentId = str(p, 'documentId'); if (!documentId) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-discard-draft', documentId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-gen-image': (p, x) => {
    const documentId = str(p, 'documentId'); const prompt = str(p, 'prompt');
    if (!documentId || !prompt) return;
    const assetId = str(p, 'assetId');
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-gen-image', documentId, prompt, ...(assetId ? { assetId } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-export': (p, x) => {
    const documentId = str(p, 'documentId'); const format = str(p, 'format');
    if (!documentId || !format) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-export', documentId, format, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'document-restore-revision': (p, x) => {
    const documentId = str(p, 'documentId'); const revisionId = str(p, 'revisionId');
    if (!documentId || !revisionId) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'document-restore-revision', documentId, revisionId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'doc-template-save': (p, x) => {
    const name = str(p, 'name'); const sectionsRaw = str(p, 'sections');
    if (!name || !sectionsRaw) return;
    //? sections travel as 'Heading::hint||Heading2::hint2' (ParamKind has no object-array kind — same
    //? encode-in-a-string precedent as ai-skill-save's comma-separated applyPoints).
    const sections = sectionsRaw.split('||').map((s) => {
      const [heading, hint] = s.split('::');
      const trimmedHint = (hint ?? '').trim();
      return { heading: (heading ?? '').trim(), ...(trimmedHint.length > 0 ? { hint: trimmedHint } : {}) };
    }).filter((s) => s.heading.length > 0);
    if (sections.length === 0) return;
    const description = str(p, 'description'); const slug = str(p, 'slug');
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'doc-template-save', name, sections, ...(description ? { description } : {}), ...(slug ? { slug } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'doc-template-delete': (p, x) => {
    const slug = str(p, 'slug'); if (!slug) return;
    void syncRequest({ name: 'workspaces/documentsControl', version: 'v1', data: { op: 'doc-template-delete', slug, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  // -- content: publish/retract, asset import, editors (contentControl route, refetch after)
  'content-request-publish': (p, x) => {
    const pieceId = str(p, 'pieceId'); const assetId = str(p, 'assetId'); const platform = str(p, 'platform');
    if (!pieceId || !assetId || !platform) return;
    const caption = str(p, 'caption'); const privacy = str(p, 'privacy'); const scheduledAt = str(p, 'scheduledAt');
    const syntheticMedia = bool(p, 'syntheticMedia'); const accountId = str(p, 'accountId');
    //? hashtags travel comma-separated in the proposal; the route wants string[] like the composer sends.
    const hashtagsRaw = str(p, 'hashtags');
    const hashtags = hashtagsRaw ? hashtagsRaw.split(',').map((t) => t.trim()).filter((t) => t.length > 0) : undefined;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-request-publish', contentProjectId: pieceId, assetId, platform, ...(caption ? { caption } : {}), ...(hashtags && hashtags.length > 0 ? { hashtags } : {}), ...(privacy ? { privacy } : {}), ...(scheduledAt ? { scheduledAt } : {}), ...(syntheticMedia === undefined ? {} : { syntheticMedia }), ...(accountId ? { accountId } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-unpublish': (p, x) => {
    const pieceId = str(p, 'pieceId'); const assetId = str(p, 'assetId'); const platform = str(p, 'platform');
    if (!pieceId || !assetId || !platform) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-unpublish', contentProjectId: pieceId, assetId, platform, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-import-asset': (p, x) => {
    const pieceId = str(p, 'pieceId'); const url = str(p, 'url'); const kind = str(p, 'kind');
    if (!pieceId || !url || !kind) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-import-asset', contentProjectId: pieceId, url, kind, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-inpaint': (p, x) => {
    const pieceId = str(p, 'pieceId'); const referenceUrl = str(p, 'referenceUrl'); const maskUrl = str(p, 'maskUrl');
    const prompt = str(p, 'prompt'); const parentAssetId = str(p, 'parentAssetId');
    if (!pieceId || !referenceUrl || !maskUrl || !prompt || !parentAssetId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-inpaint', contentProjectId: pieceId, referenceUrl, maskUrl, prompt, parentAssetId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-transcode': (p, x) => {
    const pieceId = str(p, 'pieceId'); const assetId = str(p, 'assetId'); const format = str(p, 'format');
    if (!pieceId || !assetId || (format !== 'webm' && format !== 'gif')) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-transcode', contentProjectId: pieceId, assetId, format, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-decompose-video': (p, x) => {
    const pieceId = str(p, 'pieceId'); if (!pieceId) return;
    const sceneDurationMs = num(p, 'sceneDurationMs');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-decompose-video', contentProjectId: pieceId, ...(sceneDurationMs === undefined ? {} : { sceneDurationMs }), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-refine-range': (p, x) => {
    const pieceId = str(p, 'pieceId'); const startMs = num(p, 'startMs'); const endMs = num(p, 'endMs'); const instruction = str(p, 'instruction');
    if (!pieceId || startMs === undefined || endMs === undefined || !instruction) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-refine-range', contentProjectId: pieceId, startMs, endMs, instruction, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-save-audio-mix': (p, x) => {
    const pieceId = str(p, 'pieceId'); const voiceVolume = num(p, 'voiceVolume'); const musicVolume = num(p, 'musicVolume');
    if (!pieceId || voiceVolume === undefined || musicVolume === undefined) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-save-audio-mix', contentProjectId: pieceId, voiceVolume, musicVolume, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-trim-audio': (p, x) => {
    const pieceId = str(p, 'pieceId'); const assetId = str(p, 'assetId');
    const startMs = num(p, 'startMs'); const endMs = num(p, 'endMs');
    if (!pieceId || !assetId || startMs === undefined || endMs === undefined) return;
    const gain = num(p, 'gain');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-trim-audio', contentProjectId: pieceId, assetId, startMs, endMs, ...(gain === undefined ? {} : { gain }), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-gen-reference-image': (p, x) => {
    const pieceId = str(p, 'pieceId'); const referenceUrl = str(p, 'referenceUrl');
    if (!pieceId || !referenceUrl) return;
    const styleKey = str(p, 'styleKey'); const extraInstructions = str(p, 'extraInstructions');
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-gen-reference-image', contentProjectId: pieceId, referenceUrl, ...(styleKey ? { styleKey } : {}), ...(extraInstructions ? { extraInstructions } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'content-analyze-reference-video': (p, x) => {
    const pieceId = str(p, 'pieceId'); const referenceVideoUrl = str(p, 'referenceVideoUrl'); const newStory = str(p, 'newStory');
    if (!pieceId || !referenceVideoUrl || !newStory) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'content-analyze-reference-video', contentProjectId: pieceId, referenceVideoUrl, newStory, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  // -- merge requests + monorepo services
  'mr-create': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); if (!ticketKey) return;
    void syncRequest({ name: 'workspaces/mrAction', version: 'v1', data: { action: 'create', ticketKey, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'mr-comment': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); const mrId = str(p, 'mrId'); const body = str(p, 'body');
    if (!ticketKey || !mrId || !body) return;
    const filePath = str(p, 'filePath'); const line = num(p, 'line'); const side = str(p, 'side'); const threadId = str(p, 'threadId');
    void syncRequest({ name: 'workspaces/mrAction', version: 'v1', data: { action: 'comment', ticketKey, mrId, body, ...(filePath ? { filePath } : {}), ...(line === undefined ? {} : { line }), ...(side ? { side } : {}), ...(threadId ? { threadId } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'mr-approve': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); const mrId = str(p, 'mrId');
    if (!ticketKey || !mrId) return;
    void syncRequest({ name: 'workspaces/mrAction', version: 'v1', data: { action: 'approve', ticketKey, mrId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'mr-merge': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); const mrId = str(p, 'mrId');
    if (!ticketKey || !mrId) return;
    void syncRequest({ name: 'workspaces/mrAction', version: 'v1', data: { action: 'merge', ticketKey, mrId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'mr-resolve': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); const threadId = str(p, 'threadId');
    if (!ticketKey || !threadId) return;
    const resolved = bool(p, 'resolved');
    void syncRequest({ name: 'workspaces/mrAction', version: 'v1', data: { action: 'resolve', ticketKey, threadId, ...(resolved === undefined ? {} : { resolved }), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'service-create': (p, x) => {
    const name = str(p, 'name'); if (!name || !x.activeProjectId) return;
    const path = str(p, 'path'); const buildCmd = str(p, 'buildCmd'); const deployUnit = str(p, 'deployUnit');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'service-create', projectId: x.activeProjectId, name, ...(path ? { path } : {}), ...(buildCmd ? { buildCmd } : {}), ...(deployUnit ? { deployUnit } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'service-delete': (p, x) => {
    const serviceId = str(p, 'serviceId'); if (!serviceId) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'service-delete', serviceId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  // -- automation triggers + workflow-snippet skills + knowledge intake
  'trigger-save': (p, x) => {
    const triggerId = str(p, 'triggerId');
    const name = str(p, 'name'); const on = str(p, 'on'); const action = str(p, 'action');
    //? Update needs a target id; create needs the full name/on/action triple.
    if (!triggerId && (!name || !on || !action)) return;
    const cron = str(p, 'cron'); const requiresApproval = bool(p, 'requiresApproval');
    //? The UI's saveTrigger spreads its form object into the same route; the server reads `id` for updates.
    void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-save', ...(triggerId ? { id: triggerId } : {}), ...(name ? { name } : {}), ...(on ? { on } : {}), ...(action ? { action } : {}), ...(cron ? { cron } : {}), ...(requiresApproval === undefined ? {} : { requiresApproval }), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'trigger-toggle': (p, x) => {
    const triggerId = str(p, 'triggerId'); const enabled = bool(p, 'enabled');
    if (!triggerId || enabled === undefined) return;
    void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-toggle', triggerId, enabled, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'trigger-delete': (p, x) => {
    const triggerId = str(p, 'triggerId'); if (!triggerId) return;
    void syncRequest({ name: 'workspaces/triggerAction', version: 'v1', data: { op: 'trigger-delete', triggerId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? The server broadcasts the flip — no refetch, same as the Sources-page toggle.
  'skill-toggle': (p, x) => {
    const sourceId = str(p, 'sourceId'); const on = bool(p, 'on');
    if (!sourceId || on === undefined) return;
    void syncRequest({ name: 'workspaces/skillToggle', version: 'v1', data: { sourceId, on, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'ai-skill-delete': (p, x) => {
    const skillId = str(p, 'skillId'); if (!skillId) return;
    void syncRequest({ name: 'workspaces/skillsControl', version: 'v1', data: { op: 'ai-skill-delete', skillId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'create-info-source': (p, x) => {
    const name = str(p, 'name'); const content = str(p, 'content');
    if (!name || !content) return;
    void syncRequest({ name: 'workspaces/addInfoDoc', version: 'v1', data: { name, content, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? ADR 0310 — retiring a context doc from chat. Archive/restore share one route with delete; the
  //? Conductor is still the only writer, and delete stays destructive-flagged in the catalog so the
  //? assistant has to get an explicit confirmation before proposing it.
  'info-source-archive': (p, x) => {
    const docId = str(p, 'infoSourceId');
    if (!docId) return;
    const action = bool(p, 'archived') === false ? 'restore' : 'archive';
    void syncRequest({ name: 'workspaces/infoDocAdmin', version: 'v1', data: { docId, action, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'info-source-delete': (p, x) => {
    const docId = str(p, 'infoSourceId');
    if (!docId) return;
    void syncRequest({ name: 'workspaces/infoDocAdmin', version: 'v1', data: { docId, action: 'delete', clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? Credential boundary: the route accepts an optional `token`, but a token must NEVER travel through
  //? the chat/LLM path (same principle as the EXCLUDED secret-bearing ops) — gitUrl only.
  'link-repo': (p, x) => {
    const gitUrl = str(p, 'gitUrl'); if (!gitUrl) return;
    void syncRequest({ name: 'workspaces/linkRepo', version: 'v1', data: { projectId: x.activeProjectId, gitUrl, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  // -- workspace settings + budgets
  'save-sections': (p, x) => {
    const raw = str(p, 'enabledSections'); if (!raw) return;
    const enabledSections = raw.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
    if (enabledSections.length === 0) return;
    //? Full-set replace — mirrors the settings UI; the Conductor sanitizes to GATEABLE_SECTIONS.
    void syncRequest({ name: 'workspaces/saveSections', version: 'v1', data: { enabledSections, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'save-ai-instruction': (p, x) => {
    const aiInstruction = str(p, 'aiInstruction'); const outputLanguage = str(p, 'outputLanguage');
    const geminiModel = str(p, 'geminiModel'); const geminiTemperature = str(p, 'geminiTemperature'); const geminiBaseUrl = str(p, 'geminiBaseUrl');
    if (!aiInstruction && !outputLanguage && !geminiModel && !geminiTemperature && !geminiBaseUrl) return;
    //? MERGE over the workspace's CURRENT values — the Conductor writes ALL five fields (absent → ''),
    //? so sending only the proposed field would wipe the rest (same clobber-guard as save-git-config).
    void syncRequest({
      name: 'workspaces/saveAiInstruction', version: 'v1',
      data: {
        aiInstruction: aiInstruction ?? x.aiSettings.aiInstruction,
        outputLanguage: outputLanguage ?? x.aiSettings.outputLanguage,
        geminiModel: geminiModel ?? x.aiSettings.geminiModel,
        geminiTemperature: geminiTemperature ?? x.aiSettings.geminiTemperature,
        geminiBaseUrl: geminiBaseUrl ?? x.aiSettings.geminiBaseUrl,
        clientRequestId: x.nextReqId(),
      },
      receiver: x.room,
    });
  },
  'save-ai-provider': (p, x) => {
    const feature = str(p, 'feature'); const providerId = str(p, 'providerId');
    if (!feature || !providerId) return;
    void syncRequest({ name: 'workspaces/saveAiProvider', version: 'v1', data: { feature, providerId, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'save-autonomy': (p, x) => {
    const autonomyLevel = str(p, 'autonomyLevel'); if (!autonomyLevel) return;
    void syncRequest({ name: 'workspaces/saveAutonomy', version: 'v1', data: { autonomyLevel, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'save-stage-config': (p, x) => {
    const stageId = str(p, 'stageId'); if (!stageId || !x.activeProjectId) return;
    const current = x.stageConfigs.find((c) => c.id === stageId && c.projectId === x.activeProjectId);
    if (!current) return;
    const stageName = str(p, 'name'); const handoverPrompt = str(p, 'handoverPrompt'); const systemPrompt = str(p, 'systemPrompt');
    const customInstructions = str(p, 'customInstructions'); const definitionOfDone = str(p, 'definitionOfDone');
    const aiEnabled = bool(p, 'aiEnabled'); const gateForApproval = bool(p, 'gateForApproval');
    //? MERGE the proposed fields over the CURRENT full cfg — the route wants a complete PipelineStageCfg
    //? (and rejects cfg.projectId !== projectId); the Conductor applies the flat fields per-field.
    const cfg: PipelineStageCfg = {
      ...current,
      ...(stageName ? { name: stageName } : {}),
      ...(handoverPrompt ? { handoverPrompt } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(customInstructions ? { customInstructions } : {}),
      ...(definitionOfDone ? { definitionOfDone } : {}),
      ...(aiEnabled === undefined ? {} : { aiEnabled }),
      ...(gateForApproval === undefined ? {} : { gateForApproval }),
    };
    void syncRequest({ name: 'workspaces/saveStageConfig', version: 'v1', data: { stageId, projectId: x.activeProjectId, cfg, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'edit-budget': (p, x) => {
    const cap = num(p, 'cap'); const alertPct = num(p, 'alertPct'); const label = str(p, 'label');
    const enforcement = str(p, 'enforcement'); const create = bool(p, 'create'); const enabled = bool(p, 'enabled');
    if (cap === undefined && alertPct === undefined && label === undefined && enforcement === undefined && enabled === undefined) return;
    //? Only the provided fields travel — mirrors the Budgets UI (first edit CREATES the primary cap).
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'edit-budget', ...(cap === undefined ? {} : { cap }), ...(alertPct === undefined ? {} : { alertPct }), ...(label ? { label } : {}), ...(enforcement ? { enforcement } : {}), ...(create === undefined ? {} : { create }), ...(enabled === undefined ? {} : { enabled }), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'resume-spend': (_p, x) => {
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'resume-spend', clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'edit-media-budget': (p, x) => {
    const capCents = num(p, 'capCents'); const alertPct = num(p, 'alertPct'); const enabled = bool(p, 'enabled');
    if (capCents === undefined && alertPct === undefined && enabled === undefined) return;
    void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'edit-media-budget', ...(capCents === undefined ? {} : { capCents }), ...(alertPct === undefined ? {} : { alertPct }), ...(enabled === undefined ? {} : { enabled }), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },

  // -- inbox / findings / ui-review / styles / references / tasks / output templates / design tokens
  'comments-refresh': (_p, x) => {
    void syncRequest({ name: 'workspaces/commentInbox', version: 'v1', data: { op: 'comments-refresh', clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'comments-mark-read': (p, x) => {
    const commentId = str(p, 'commentId');
    void syncRequest({ name: 'workspaces/commentInbox', version: 'v1', data: { op: 'comments-mark-read', ...(commentId ? { commentId } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'finding-to-ticket': (p, x) => {
    const findingId = str(p, 'findingId'); if (!findingId || !x.activeProjectId) return;
    void syncRequest({ name: 'workspaces/findingAction', version: 'v1', data: { op: 'finding-to-ticket', findingId, projectId: x.activeProjectId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'finding-dismiss': (p, x) => {
    const findingId = str(p, 'findingId'); if (!findingId) return;
    void syncRequest({ name: 'workspaces/findingAction', version: 'v1', data: { op: 'finding-dismiss', findingId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? Chat has no screenshot upload — screenshots:[] and at least one problem key (route requires one OR
  //? the other; the chat path is therefore stricter than the manual form).
  'ui-review-create': (p, x) => {
    const problemsRaw = str(p, 'problems');
    const problems = problemsRaw ? problemsRaw.split(',').map((v) => v.trim()).filter((v) => v.length > 0) : [];
    if (problems.length === 0 || !x.activeProjectId) return;
    const page = str(p, 'page'); const notes = str(p, 'notes');
    void syncRequest({ name: 'workspaces/uiReviewCreate', version: 'v1', data: { projectId: x.activeProjectId, screenshots: [], problems, ...(page ? { page } : {}), ...(notes ? { notes } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'delete-style': (p, x) => {
    const feature = str(p, 'feature'); const key = str(p, 'key');
    if (!feature || !key) return;
    void syncRequest({ name: 'workspaces/contentSettings', version: 'v1', data: { op: 'delete-style', feature, key, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? Workspace-level op — the empty contentProjectId is the established runContentOp shape.
  'reference-delete': (p, x) => {
    const referenceId = str(p, 'referenceId'); if (!referenceId) return;
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'reference-delete', contentProjectId: '', referenceId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'delete-custom-task': (p, x) => {
    const taskId = str(p, 'taskId'); if (!taskId) return;
    void syncRequest({ name: 'workspaces/customTask', version: 'v1', data: { op: 'delete-custom-task', taskId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'save-output-template': (p, x) => {
    const name = str(p, 'name'); const templateId = str(p, 'templateId');
    if (!name && !templateId) return;
    const format = str(p, 'format'); const watermarkPosition = str(p, 'watermarkPosition');
    void syncRequest({ name: 'workspaces/outputTemplate', version: 'v1', data: { op: 'save-output-template', ...(templateId ? { templateId } : {}), ...(name ? { name } : {}), ...(format ? { format } : {}), ...(watermarkPosition ? { watermarkPosition } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'delete-output-template': (p, x) => {
    const templateId = str(p, 'templateId'); if (!templateId) return;
    void syncRequest({ name: 'workspaces/outputTemplate', version: 'v1', data: { op: 'delete-output-template', templateId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  //? Whole-project apply — the optional per-service target has no ctx collection to validate against,
  //? so the chat path deliberately omits serviceId (same pattern as env-deploy's validated fields).
  'apply-design-tokens': (_p, x) => {
    if (!x.activeProjectId) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'apply-design-tokens', projectId: x.activeProjectId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
};

//? Execute one generic accepted proposal and wait for every real route receipt it emitted. A dispatcher that
//? produced no request (missing/stale params) is a failure, not a fabricated success. Multiple receipts are
//? supported for composite catalog actions; all must ACK success before the UI may say “Done”.
export function chatExecutionReceiptsSucceeded(receipts: unknown[]): boolean {
  return receipts.length > 0 && receipts.every((receipt) => receipt !== null && typeof receipt === 'object' && 'status' in receipt && receipt.status === 'success');
}

export async function executeTrackedChatDispatch(
  op: ChatEnabledOp,
  proposal: ChatProposal,
  extras: ChatDispatchExtras,
): Promise<boolean> {
  const receipts: Promise<unknown>[] = [];
  activeReceiptCollector = (receipt) => { receipts.push(receipt); };
  try {
    CHAT_DISPATCH[op](proposal, extras);
  } finally {
    activeReceiptCollector = null;
  }
  return chatExecutionReceiptsSucceeded(await Promise.all(receipts));
}
