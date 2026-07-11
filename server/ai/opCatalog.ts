//? Workspaces — the propose-safe OP-CATALOG (X1). Replaces the hardcoded 5-op chat whitelist with a
//? catalog over the FULL ControlOp surface: every op is classified `enabled` (proposable now + client-
//? dispatchable), `later` (safe in principle; flips to enabled when its client dispatcher lands) or
//? `excluded` (never via chat: secret-bearing, auth, dead, or plumbing/legacy). The AI still only
//? PROPOSES — accept dispatches through the normal `_sync` routes → RBAC → Conductor (B-23 single-writer,
//? frozen verbs: no new verb is added anywhere here). Destructive ops carry `destructive: true` and the
//? client wraps their accept in an extra explicit confirm (user decision 2026-07-09, UNIVERSAL_TOOL §0).
//?
//? The client twin of the enabled set lives in `src/workspaces/_data/chatOps.ts` (the server bundle
//? stubs `src/` runtime imports — same split as OP_CAPABILITY); `tests/unit/opCatalogParity.test.mts`
//? enforces lockstep. Param values that reference workspace state (ticketKey/stageId/pieceId/…) are
//? validated against the REAL workspace context before a proposal is allowed to exist.

import type { ControlOp } from '../../src/workspaces/_functions/controlApi';
import type { ChatProposal } from '../../src/workspaces/_data/types';
import { listServicePresets } from '../container/servicePresets';

//? The context slice generic validation checks references against (structural subset of
//? workspaceChat's Ctx — no import to avoid a runtime cycle).
export interface CatalogCtx {
  tickets: { key: string }[];
  stages: { id: string }[];
  members: { id: string }[];
  pieces: { id: string; title: string }[];
  environments: { id: string; kind: string }[];
  services: { name: string }[];
}

type ParamKind = 'string' | 'number' | 'boolean' | 'ticketKey' | 'stageId' | 'stageKeys' | 'pieceId' | 'envId' | 'serviceName' | 'presetKey' | 'enum';
interface ParamSpec { kind: ParamKind; required?: true; values?: readonly string[] }
export interface OpSpec {
  mode: 'enabled' | 'later' | 'excluded';
  destructive?: true;
  //? One-liner the systemPrompt shows the model (enabled ops only).
  hint?: string;
  params?: Record<string, ParamSpec>;
}

const LATER: OpSpec = { mode: 'later' };
const LATER_D: OpSpec = { mode: 'later', destructive: true };
const EXCLUDED: OpSpec = { mode: 'excluded' };

//? Exhaustive over ControlOp — adding an op to the union without classifying it here is a tsc error.
export const PROPOSE_CATALOG: Record<ControlOp, OpSpec> = {
  // ---- tickets / board — the legacy rich chat path handles these (bulk-move/assign/add-comment/create-*)
  'quick-add': EXCLUDED, // legacy `create-ticket`
  'ticket-edit': LATER,
  'add-comment': EXCLUDED, // legacy rich path
  archive: LATER_D,
  'bulk-move': EXCLUDED, // legacy rich path
  'bulk-status': LATER,
  'bulk-assign': EXCLUDED, // legacy `assign`
  'bulk-sprint': LATER,
  'bulk-archive': LATER_D,
  'sprint-create': LATER,
  'sprint-edit': LATER,
  // ---- members / RBAC / workspace lifecycle
  'create-workspace': EXCLUDED, // cross-workspace plumbing
  'rename-workspace': LATER,
  'delete-workspace': LATER_D,
  'transfer-ownership': LATER_D,
  'change-role': LATER_D,
  'remove-member': LATER_D,
  invite: LATER,
  'revoke-invite': LATER_D,
  'accept-invite': EXCLUDED, // own-resource plumbing
  'role-create': LATER_D,
  'role-update': LATER_D,
  // ---- workspace settings (secret-bearing ops NEVER flow through the chat/LLM)
  'save-env': EXCLUDED, // env values may be secrets
  'remove-env': EXCLUDED,
  'save-integration': EXCLUDED, // integration credentials
  'remove-integration': EXCLUDED,
  'service-provision': {
    mode: 'enabled',
    hint: 'attach a curated third-party service stack (Kafka/Postgres/Redis/…) to the workspace. params: name (stack name), preset (one of the preset keys below)',
    params: { name: { kind: 'string', required: true }, preset: { kind: 'presetKey', required: true } },
  },
  'service-teardown': {
    mode: 'enabled', destructive: true,
    hint: 'stop + remove a running service stack. params: name (an existing stack name)',
    params: { name: { kind: 'serviceName', required: true } },
  },
  'ui-review-create': LATER,
  'gitlab-settings': EXCLUDED, // carries the forge token
  'gitlab-verify': LATER,
  'gitlab-resync': LATER,
  'forge-connect': EXCLUDED, // carries the forge token
  'save-git-config': LATER,
  'save-sections': LATER,
  'save-ai-instruction': LATER,
  'save-ai-provider': LATER,
  'save-autonomy': LATER,
  'link-repo': LATER,
  'scan-docs': LATER,
  'create-info-source': LATER,
  'scan-index': LATER,
  'mr-create': LATER, 'mr-comment': LATER, 'mr-approve': LATER_D, 'mr-merge': LATER_D, 'mr-rollback': LATER_D, 'mr-resolve': LATER, 'mr-review': LATER,
  'raise-cap': LATER_D, 'edit-budget': LATER_D, 'resume-spend': LATER_D,
  'skill-toggle': LATER,
  'save-stage-config': LATER,
  'stage-create': {
    mode: 'enabled',
    hint: 'add a pipeline stage. params: key (short slug), name (display name), kind? (code|test|review|…)',
    params: { key: { kind: 'string', required: true }, name: { kind: 'string', required: true }, kind: { kind: 'string' } },
  },
  'stage-delete': {
    mode: 'enabled', destructive: true,
    hint: 'remove a pipeline stage. params: stageId (a stage id from the list)',
    params: { stageId: { kind: 'stageId', required: true } },
  },
  'stage-reorder': {
    mode: 'enabled',
    hint: 'reorder the pipeline stages. params: order (ALL stage ids in their new order)',
    params: { order: { kind: 'stageKeys', required: true } },
  },
  'trigger-save': LATER, 'trigger-toggle': LATER, 'trigger-delete': LATER_D, 'trigger-run': LATER,
  'finding-to-ticket': LATER, 'finding-dismiss': LATER,
  'ticket-link-artifact': LATER, 'ticket-unlink-artifact': LATER,
  // ---- projects / services / greenfield
  'project-create': {
    mode: 'enabled',
    hint: 'add an (empty) project to the workspace. params: name',
    params: { name: { kind: 'string', required: true } },
  },
  'service-create': LATER, 'service-delete': LATER_D,
  'project-from-template': {
    mode: 'enabled',
    hint: 'create a NEW runnable project from a stack starter template. params: name, template (e.g. node-api|react-vite|python-fastapi|go-api)',
    params: { name: { kind: 'string', required: true }, template: { kind: 'string', required: true } },
  },
  // ---- environments / deploy
  'env-deploy': {
    mode: 'enabled',
    hint: 'deploy the active project to a persistent environment ("publish commit X on DNS Y" in one call). params: kind (dev|staging|demo — prod is ONLY reachable via env-promote), serviceId?, pinnedCommit? (a sha to freeze a demo at), subdomain? (a chosen subdomain on the base domain), customDomain? (a user-owned domain, served with auto-TLS)',
    //? SEC7 — no direct prod deploys (the Conductor rejects them too); prod goes through env-promote.
    //? D2/D3/D4 — the DNS + pin params so the assistant can do "put commit <sha> on preview.mydomain.com".
    params: { kind: { kind: 'enum', required: true, values: ['dev', 'staging', 'demo'] }, serviceId: { kind: 'string' }, pinnedCommit: { kind: 'string' }, subdomain: { kind: 'string' }, customDomain: { kind: 'string' } },
  },
  'env-teardown': {
    mode: 'enabled', destructive: true,
    hint: 'tear down a running environment. params: envId (an environment id from the list)',
    params: { envId: { kind: 'envId', required: true } },
  },
  'env-promote': {
    mode: 'enabled', destructive: true,
    hint: 'promote the tested image one step up the dev→staging→prod ladder. params: fromKind (dev|staging). Prod promotion is gated on green CI + security and the user’s explicit confirm',
    params: { fromKind: { kind: 'enum', required: true, values: ['dev', 'staging'] } },
  },
  'build-export': {
    mode: 'enabled',
    hint: 'export the project as a downloadable production build. params: kind (image|bundle)',
    params: { kind: { kind: 'enum', required: true, values: ['image', 'bundle'] } },
  },
  // ---- CI / quality
  'ci-run': {
    mode: 'enabled',
    hint: 'run the built-in CI pipeline. params: ticketKey? (run at that ticket’s MR head)',
    params: { ticketKey: { kind: 'ticketKey' } },
  },
  'ci-allow-red': {
    mode: 'enabled', destructive: true,
    hint: 'admin override: allow/deny merging while CI is red. params: enabled (true|false)',
    params: { enabled: { kind: 'boolean', required: true } },
  },
  'root-cause': {
    mode: 'enabled',
    hint: 'AI incident diagnosis: rank the MR that likely broke something and propose a rollback. params: symptom? (what the user reports broken)',
    params: { symptom: { kind: 'string' } },
  },
  'plan-critique': {
    mode: 'enabled',
    hint: 'run an AI critique of a ticket’s plan before implementation. params: ticketKey?',
    params: { ticketKey: { kind: 'ticketKey' } },
  },
  'index-memory': { mode: 'enabled', hint: 'reindex the workspace’s institutional memory (RAG). no params', params: {} },
  // ---- user-app DB
  'db-connect': EXCLUDED, // carries a connection-string secret
  'db-migrate-create': {
    mode: 'enabled',
    hint: 'draft a DB migration for the user’s app. params: name (migration name)',
    params: { name: { kind: 'string', required: true } },
  },
  'db-migrate-apply': LATER_D,
  'db-introspect': { mode: 'enabled', hint: 'introspect the connected user-app database (tables/columns). params: connectionId?', params: { connectionId: { kind: 'string' } } },
  // ---- content settings / brand / styles
  'edit-media-budget': LATER_D,
  'save-style': LATER, 'delete-style': LATER_D,
  'save-media-provider': EXCLUDED, // provider API keys
  'content-edit-brand': LATER, 'content-edit-product': LATER,
  // ---- content pipeline (per-asset PAID gen ops stay `later` until cost-confirms land — B4)
  'content-create': LATER,
  'content-advance': {
    mode: 'enabled',
    hint: 'advance a content piece to its next pipeline stage. params: pieceId (a piece id from the list)',
    params: { pieceId: { kind: 'pieceId', required: true } },
  },
  'content-archive': {
    mode: 'enabled', destructive: true,
    hint: 'archive a content piece (soft; restorable). params: pieceId',
    params: { pieceId: { kind: 'pieceId', required: true } },
  },
  'content-gen-script': LATER, 'content-gen-voice': LATER, 'content-gen-images': LATER, 'content-assemble': LATER,
  'content-gen-reference-image': LATER, 'content-gen-shortform': LATER, 'content-analyze-reference-video': LATER,
  'content-gen-avatar': LATER, 'content-gen-music': LATER, 'content-gen-sfx': LATER, 'content-gen-3d': LATER,
  'content-request-publish': LATER,
  'content-from-brief': EXCLUDED, // legacy `create-content`
  'content-import-asset': LATER, 'content-regenerate': {
    mode: 'enabled',
    hint: 'regenerate a media asset (optionally tweaked, costs money — the user confirms). params: assetId, pieceId?, tweak?, count? (1-4)',
    params: { assetId: { kind: 'string', required: true }, pieceId: { kind: 'pieceId' }, tweak: { kind: 'string' }, count: { kind: 'number' } },
  },
  'content-critique-image': {
    mode: 'enabled',
    hint: 'AI critique of an image asset ("what should change about this photo") — vision feedback + which edit fixes each point. params: pieceId, assetId, prompt? (a specific question)',
    params: { pieceId: { kind: 'pieceId', required: true }, assetId: { kind: 'string', required: true }, prompt: { kind: 'string' } },
  },
  'content-video-restyle': {
    mode: 'enabled',
    hint: 'restyle an existing VIDEO asset ("make this cinematic") — video-to-video (costs money, the user confirms). params: pieceId, assetId (a video asset), prompt (the style, e.g. "cinematic, warm grade")',
    params: { pieceId: { kind: 'pieceId', required: true }, assetId: { kind: 'string', required: true }, prompt: { kind: 'string', required: true } },
  },
  'shortlink-create': {
    mode: 'enabled',
    hint: 'create a trackable short link (/l/<slug>) that records clicks + redirects to a landing URL — the campaign conversion signal. params: targetUrl (the landing url), contentProjectId? (the ad piece), variant? (an A/B label)',
    params: { targetUrl: { kind: 'string', required: true }, contentProjectId: { kind: 'string' }, variant: { kind: 'string' } },
  },
  'content-edit-image': {
    mode: 'enabled',
    hint: 'instruct-edit an existing IMAGE asset ("change the sky to sunset") — whole-image edit, no mask (costs money, the user confirms). params: pieceId, assetId (an image/render asset), prompt (the instruction)',
    params: { pieceId: { kind: 'pieceId', required: true }, assetId: { kind: 'string', required: true }, prompt: { kind: 'string', required: true } },
  },
  'content-inpaint': LATER, 'content-reorder-beats': LATER, 'content-save-scenes': LATER,
  'content-decompose-video': LATER, 'content-refine-range': LATER,
  'content-run-pipeline': {
    mode: 'enabled',
    hint: 'run the FULL content pipeline for a piece (script→voice→visuals→assemble; costs money — the user confirms). params: pieceId, styleKey?, durationMs?',
    params: { pieceId: { kind: 'pieceId', required: true }, styleKey: { kind: 'string' }, durationMs: { kind: 'number' } },
  },
  'content-save-audio-mix': LATER,
  'content-trim-audio': LATER,
  'channel-create': LATER, 'channel-edit': LATER, 'channel-delete': LATER_D,
  'account-disconnect': EXCLUDED, // auth/token surface
  'reference-add': LATER, 'reference-delete': LATER_D,
  'content-unarchive': {
    mode: 'enabled',
    hint: 'restore an archived content piece. params: pieceId',
    params: { pieceId: { kind: 'pieceId', required: true } },
  },
  'content-unpublish': LATER_D,
  'save-custom-task': LATER, 'delete-custom-task': LATER_D, 'run-custom-task': LATER,
  'save-output-template': LATER, 'delete-output-template': LATER_D,
  'copy-workspace-assets': LATER,
  'copilot-propose': EXCLUDED, // meta (the propose channel itself)
  'mark-read': EXCLUDED, // notification plumbing
  // ---- agent-session controls
  pause: { mode: 'enabled', hint: 'pause a ticket’s autonomous agent turn. params: ticketKey', params: { ticketKey: { kind: 'ticketKey', required: true } } },
  resume: { mode: 'enabled', hint: 'resume a paused ticket. params: ticketKey', params: { ticketKey: { kind: 'ticketKey', required: true } } },
  'answer-input': EXCLUDED, // the needs-input flow has its own UI
  kill: { mode: 'enabled', destructive: true, hint: 'hard-kill a ticket’s agent turn. params: ticketKey', params: { ticketKey: { kind: 'ticketKey', required: true } } },
  'pause-all': { mode: 'enabled', destructive: true, hint: 'emergency-stop ALL agent work in the workspace. no params', params: {} },
  'resume-all': { mode: 'enabled', hint: 'resume the workspace after a pause-all. no params', params: {} },
  'preview-up': EXCLUDED, // dead op (preview runs via openPreview _api) — COMPLETION A5 decides its fate
  'preview-down': EXCLUDED,
  'accept-suggestion': EXCLUDED, // plumbing
};

//? The server-side enabled set (the client twin lives in src/workspaces/_data/chatOps.ts — parity-tested).
export const ENABLED_OPS: ControlOp[] = (Object.keys(PROPOSE_CATALOG) as ControlOp[]).filter((op) => PROPOSE_CATALOG[op].mode === 'enabled');

//? Compact prompt lines for the systemPrompt — one line per enabled op (+ the preset keys the
//? service-provision hint refers to). Grouped output keeps the prompt small (~30 lines).
export function catalogPromptLines(): string[] {
  const lines = ENABLED_OPS.map((op) => {
    const spec = PROPOSE_CATALOG[op];
    return `- ${op}${spec.destructive ? ' [destructive]' : ''}: ${spec.hint ?? ''}`;
  });
  const presets = listServicePresets().map((p) => p.key).join('|');
  lines.push(`Service preset keys: ${presets}`);
  return lines;
}

function checkParam(kind: ParamKind, value: unknown, spec: ParamSpec, ctx: CatalogCtx): unknown {
  if (kind === 'string') return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (kind === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (kind === 'enum') return typeof value === 'string' && (spec.values ?? []).includes(value) ? value : undefined;
  if (kind === 'ticketKey') return typeof value === 'string' && ctx.tickets.some((t) => t.key === value) ? value : undefined;
  if (kind === 'stageId') return typeof value === 'string' && ctx.stages.some((s) => s.id === value) ? value : undefined;
  if (kind === 'stageKeys') {
    if (!Array.isArray(value)) return undefined;
    const keys = value.filter((v): v is string => typeof v === 'string');
    return keys.length > 0 && keys.every((k) => ctx.stages.some((s) => s.id === k)) ? keys : undefined;
  }
  if (kind === 'pieceId') return typeof value === 'string' && ctx.pieces.some((p) => p.id === value) ? value : undefined;
  if (kind === 'envId') return typeof value === 'string' && ctx.environments.some((e) => e.id === value) ? value : undefined;
  if (kind === 'serviceName') return typeof value === 'string' && ctx.services.some((s) => s.name === value) ? value : undefined;
  //? kind === 'presetKey' (the only remaining ParamKind).
  return typeof value === 'string' && listServicePresets().some((p) => p.key === value) ? value : undefined;
}

//? Validate a model-proposed GENERIC action against the catalog + the real workspace context.
//? Unknown ops, non-enabled ops, missing required params and dangling references all reject to null
//? (the chat then degrades to a reply-only turn). Extra fields the spec doesn't declare are DROPPED.
export function validateGenericAction(raw: unknown, ctx: CatalogCtx): ChatProposal | null {
  if (raw === null || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const op = typeof a.op === 'string' ? a.op : '';
  if (!(op in PROPOSE_CATALOG)) return null;
  const typedOp = op as ControlOp;
  const spec = PROPOSE_CATALOG[typedOp];
  if (spec.mode !== 'enabled') return null;
  const params: Record<string, unknown> = {};
  for (const [field, pSpec] of Object.entries(spec.params ?? {})) {
    const value = checkParam(pSpec.kind, a[field], pSpec, ctx);
    if (value === undefined) {
      if (pSpec.required) return null;
      continue;
    }
    params[field] = value;
  }
  const rendered = Object.entries(params).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(', ');
  //? Piece params render their title in the summary so the confirm reads human, not as an ObjectId.
  const pieceTitle = typeof params.pieceId === 'string' ? ctx.pieces.find((p) => p.id === params.pieceId)?.title : undefined;
  const summary = `${typedOp}${pieceTitle ? ` — ${pieceTitle}` : ''}${rendered.length > 0 ? ` (${rendered})` : ''}`;
  return { op: typedOp, summary, params, ...(spec.destructive ? { destructive: true } : {}) };
}
