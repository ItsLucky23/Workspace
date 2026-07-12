//? Workspaces — X1 client dispatchers for the CHAT-ENABLED generic ops (chatOps.ts tranche).
//? An ACCEPTED generic proposal dispatches through the SAME `_sync` routes the manual UI uses —
//? RBAC + Conductor single-writer stay fully intact (B-23; no new verbs). One dispatcher per
//? enabled op; `Record<ChatEnabledOp, …>` makes forgetting one a tsc error, and
//? `tests/unit/opCatalogParity.test.mts` keeps this tranche in lockstep with the server catalog.
//? Params were already server-validated against the workspace context; the local `str/num/…`
//? readers only re-narrow the JSON types (never invent values, no casts).

import { syncRequest } from 'src/_sockets/syncRequest';

import type { ChatEnabledOp } from '../_data/chatOps';
import type { ChatProposal } from '../_data/types';

export interface ChatDispatchExtras {
  room: string;                    // workspaceId (the sync receiver)
  activeProjectId: string | null;  // projectAdmin ops target the active project
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

//? agentControl family (pause/resume/kill/pause-all/resume-all) — one small helper.
const agent = (op: 'pause' | 'resume' | 'kill' | 'pause-all' | 'resume-all') => (p: ChatProposal, x: ChatDispatchExtras): void => {
  const ticketKey = str(p, 'ticketKey');
  void syncRequest({ name: 'workspaces/agentControl', version: 'v1', data: { op, ...(ticketKey ? { ticketKey } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
};

export const CHAT_DISPATCH: Record<ChatEnabledOp, (p: ChatProposal, x: ChatDispatchExtras) => void> = {
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
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'ci-run', ...(x.activeProjectId ? { projectId: x.activeProjectId } : {}), ...(ticketKey ? { ticketKey } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'ci-allow-red': (p, x) => {
    const enabled = bool(p, 'enabled'); if (enabled === undefined) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'ci-allow-red', ...(x.activeProjectId ? { projectId: x.activeProjectId } : {}), enabled, clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'root-cause': (p, x) => {
    const symptom = str(p, 'symptom');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'root-cause', ...(x.activeProjectId ? { projectId: x.activeProjectId } : {}), ...(symptom ? { symptom } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'plan-critique': (p, x) => {
    const ticketKey = str(p, 'ticketKey');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'plan-critique', ...(ticketKey ? { ticketKey } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
  },
  'index-memory': (_p, x) => {
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'index-memory', clientRequestId: x.nextReqId() }, receiver: x.room });
  },

  'db-migrate-create': (p, x) => {
    const name = str(p, 'name'); if (!name) return;
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-migrate-create', name, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'db-introspect': (p, x) => {
    const connectionId = str(p, 'connectionId');
    void syncRequest({ name: 'workspaces/projectAdmin', version: 'v1', data: { op: 'db-introspect', ...(connectionId ? { connectionId } : {}), clientRequestId: x.nextReqId() }, receiver: x.room });
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
    if (!key || !name) return;
    const kind = str(p, 'kind');
    void syncRequest({ name: 'workspaces/stageCreate', version: 'v1', data: { key, name, ...(kind ? { kind } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'stage-delete': (p, x) => {
    const stageId = str(p, 'stageId'); if (!stageId) return;
    void syncRequest({ name: 'workspaces/stageDelete', version: 'v1', data: { stageId, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
  'stage-reorder': (p, x) => {
    const order = strArr(p, 'order'); if (!order || order.length === 0) return;
    void syncRequest({ name: 'workspaces/stageReorder', version: 'v1', data: { order, clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
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
    void syncRequest({ name: 'workspaces/contentControl', version: 'v1', data: { op: 'channel-create', name, ...(platform ? { platform } : {}), ...(handle ? { handle } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
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
  //? #7 — edit a ticket's title/description/priority (ticketEdit route; the key travels as `ticketId`).
  'ticket-edit': (p, x) => {
    const ticketKey = str(p, 'ticketKey'); if (!ticketKey) return;
    const title = str(p, 'title'); const description = str(p, 'description'); const priority = str(p, 'priority');
    void syncRequest({ name: 'workspaces/ticketEdit', version: 'v1', data: { ticketId: ticketKey, ...(title ? { title } : {}), ...(description ? { description } : {}), ...(priority ? { priority } : {}), clientRequestId: x.nextReqId() }, receiver: x.room }).then(() => { x.refetch(); });
  },
};
