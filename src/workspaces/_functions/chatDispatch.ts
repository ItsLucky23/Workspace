//? Workspaces — X1 client dispatchers for the CHAT-ENABLED generic ops (chatOps.ts tranche).
//? An ACCEPTED generic proposal dispatches through the SAME `_sync` routes the manual UI uses —
//? RBAC + Conductor single-writer stay fully intact (B-23; no new verbs). One dispatcher per
//? enabled op; `Record<ChatEnabledOp, …>` makes forgetting one a tsc error, and
//? `tests/unit/opCatalogParity.test.mts` keeps this tranche in lockstep with the server catalog.
//? Params were already server-validated against the workspace context; the local `str/num/…`
//? readers only re-narrow the JSON types (never invent values, no casts).

import { apiRequest } from 'src/_sockets/apiRequest';
import { syncRequest } from 'src/_sockets/syncRequest';

import type { ChatEnabledOp } from '../_data/chatOps';
import type { ChatProposal, GitConfig } from '../_data/types';

export interface ChatDispatchExtras {
  room: string;                    // workspaceId (the sync receiver)
  activeProjectId: string;         // validated current project; stale proposals never reach this layer
  gitConfig: GitConfig;            // #29 — current git strategy, so save-git-config merges (never clobbers)
  nextReqId: () => string;         // idempotency key factory
  refetch: () => void;             // snapshot refresh for slow/rare structural writes
}

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

//? GAP_SCAN C3 — the AI-skills family. All three route through the SAME skillsControl `_sync` the settings
//? UI uses → RBAC(workspaceSettings) → Conductor (B-23); the chat only ever proposes.
const skill = (op: 'ai-skill-save' | 'ai-skill-toggle' | 'ai-skill-reset') => (p: ChatProposal, x: ChatDispatchExtras): void => {
  const skillId = str(p, 'skillId');
  const name = str(p, 'name');
  const instruction = str(p, 'instruction');
  const examples = str(p, 'examples');
  const applyPointsRaw = str(p, 'applyPoints');
  const applyPoints = applyPointsRaw ? applyPointsRaw.split(',').map((v) => v.trim()).filter((v) => v.length > 0) : undefined;
  const on = bool(p, 'on');
  //? toggle/reset act on an EXISTING skill; save needs either a target id (update) or a name (create).
  if (op !== 'ai-skill-save' && !skillId) return;
  if (op === 'ai-skill-save' && !skillId && !name) return;
  if (op === 'ai-skill-toggle' && on === undefined) return;
  void syncRequest({
    name: 'workspaces/skillsControl', version: 'v1',
    data: {
      op,
      ...(skillId ? { skillId } : {}), ...(name ? { name } : {}),
      ...(instruction ? { instruction } : {}), ...(examples ? { examples } : {}),
      ...(applyPoints ? { applyPoints } : {}), ...(on === undefined ? {} : { on }),
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
  'ai-skill-toggle': skill('ai-skill-toggle'),
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
    void apiRequest({ name: 'workspaces/openPreview', version: 'v1', data: { workspaceId: x.room, ticketKey } });
  },
  'preview-down': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); if (!ticketKey) return;
    void apiRequest({ name: 'workspaces/closePreview', version: 'v1', data: { workspaceId: x.room, ticketKey } });
  },
};
