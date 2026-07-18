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
import { isSectionEnabled, type WorkspaceModuleId } from '../../src/workspaces/_data/modules';

//? The context slice generic validation checks references against (structural subset of
//? workspaceChat's Ctx — no import to avoid a runtime cycle).
export interface CatalogCtx {
  projectId: string;
  tickets: { key: string }[];
  stages: { id: string }[];
  members: { id: string }[];
  pieces: { id: string; title: string }[];
  environments: { id: string; kind: string }[];
  services: { name: string }[];
  //? #86/#54/#150 — custom tasks + triggers + open MRs + channels (id validation for proposals).
  customTasks: { id: string; name: string }[];
  triggers: { id: string; name: string }[];
  mrs: { id: string; ticketKey: string }[];
  channels: { id: string; name: string }[];
  //? C3 — the workspace's AI skills, so "turn on the SEO skill" validates against a REAL skill id.
  skills: { id: string; name: string }[];
  //? GAP_SCAN C4 — the workspace's enabled modules. An empty list is the legacy "everything on" state.
  enabledSections?: string[];
}

type ParamKind = 'string' | 'number' | 'boolean' | 'ticketKey' | 'stageId' | 'stageKeys' | 'pieceId' | 'envId' | 'serviceName' | 'presetKey' | 'taskId' | 'triggerId' | 'mrId' | 'channelId' | 'skillId' | 'enum';
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
  'ticket-edit': {
    mode: 'enabled',
    hint: "edit a ticket's title/description/priority ('rename DEV-3', 'bump its priority'). params: ticketKey, title?, description?, priority? (low|normal|high|urgent)",
    params: { ticketKey: { kind: 'ticketKey', required: true }, title: { kind: 'string' }, description: { kind: 'string' }, priority: { kind: 'enum', values: ['low', 'normal', 'high', 'urgent'] } },
  },
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
  'ui-review-to-ticket': EXCLUDED, // U2 gap-fix — direct inbox button on the designer page
  'ui-review-dismiss': EXCLUDED,   // U2 gap-fix — direct inbox button
  'gitlab-settings': EXCLUDED, // carries the forge token
  'gitlab-verify': LATER,
  'gitlab-resync': { mode: 'enabled', hint: 'resync issues/state from the connected forge (GitLab/GitHub) on demand. no params', params: {} },
  'forge-connect': EXCLUDED, // carries the forge token
  'forge-webhook-rotate': EXCLUDED, // #27 — mints a secret; direct settings-UI button, never a chat proposal
  //? #29 — the Assistant may PROPOSE a git-strategy/push-policy change ("push feature branches as
  //? merge requests", "switch to typed branches"). Only the named fields travel; the client dispatcher
  //? MERGES them over the workspace's current gitConfig (the Conductor normalize would otherwise reset
  //? the untouched fields to defaults). Non-secret, non-destructive config; accept dispatches through the
  //? normal saveGitConfig `_sync` → RBAC(workspaceSettings) → Conductor.
  'save-git-config': {
    mode: 'enabled',
    hint: "change the workspace's git strategy / push policy. params: branchStrategy? (ticket-prefix|typed|custom), pushPolicy? (local-only|push|merge-request), defaultBranchType? (e.g. feature), targetBranch? (the branch MRs target, e.g. main)",
    params: {
      branchStrategy: { kind: 'enum', values: ['ticket-prefix', 'typed', 'custom'] },
      pushPolicy: { kind: 'enum', values: ['local-only', 'push', 'merge-request'] },
      defaultBranchType: { kind: 'string' },
      targetBranch: { kind: 'string' },
    },
  },
  'save-sections': LATER,
  'save-ai-instruction': LATER,
  'save-ai-provider': LATER,
  'save-autonomy': LATER,
  'link-repo': LATER,
  'scan-docs': { mode: 'enabled', hint: 'rescan the linked repo for context docs (README/docs/…). no params', params: {} },
  'create-info-source': LATER,
  'scan-index': { mode: 'enabled', hint: 'rebuild the code RAG index of the linked repo (so answers ground on the latest code). no params', params: {} },
  'mr-create': LATER, 'mr-comment': LATER, 'mr-approve': LATER_D, 'mr-merge': LATER_D, 'mr-resolve': LATER,
  'mr-review': {
    mode: 'enabled',
    hint: 'run an AI review of a merge request (findings land as a suggestion the user accepts). params: mrId, ticketKey (the pair from the MR list below)',
    params: { mrId: { kind: 'mrId', required: true }, ticketKey: { kind: 'ticketKey', required: true } },
  },
  'mr-rollback': {
    mode: 'enabled', destructive: true,
    hint: 'roll back (revert) a merged merge request. params: mrId, ticketKey (the pair from the MR list below)',
    params: { mrId: { kind: 'mrId', required: true }, ticketKey: { kind: 'ticketKey', required: true } },
  },
  'raise-cap': LATER_D, 'edit-budget': LATER_D, 'resume-spend': LATER_D,
  'skill-toggle': LATER,
  //? SK1 — the universal AI-skills layer. GAP_SCAN C3: toggling/saving a skill is exactly the kind of
  //? "turn on the SEO skill" ask the Assistant should handle, so save/toggle/reset are ENABLED (delete
  //? stays `later` — destroying a user-authored skill from a chat turn is a worse trade than a UI click).
  'ai-skill-save': {
    mode: 'enabled',
    hint: 'create or update an AI skill (an instruction block injected into AI runs). params: instruction, name (required when creating), skillId (from the skills list below, to update), examples?, applyPoints? (any of: all|content|studio|designer|dev|interviewer|documents|chat|custom)',
    params: { instruction: { kind: 'string', required: true }, name: { kind: 'string' }, skillId: { kind: 'skillId' }, examples: { kind: 'string' }, applyPoints: { kind: 'string' } },
  },
  'ai-skill-toggle': {
    mode: 'enabled',
    hint: 'turn an AI skill on or off. params: skillId (from the skills list below), on (true/false)',
    params: { skillId: { kind: 'skillId', required: true }, on: { kind: 'boolean', required: true } },
  },
  'ai-skill-reset': {
    mode: 'enabled',
    hint: 'reset a BUILT-IN AI skill back to its shipped instruction. params: skillId (from the skills list below)',
    params: { skillId: { kind: 'skillId', required: true } },
  },
  'ai-skill-delete': LATER_D,
  //? DOC — the Documents module (draft-based; flip to enabled once chat-proposing documents proves useful).
  'document-create': LATER, 'document-edit': LATER, 'document-delete': LATER_D, 'document-ai': LATER,
  'document-apply-draft': LATER, 'document-discard-draft': LATER, 'document-gen-image': LATER, 'document-export': LATER,
  'document-restore-revision': LATER,
  'document-archive': LATER, 'document-unarchive': LATER,
  'doc-template-save': LATER, 'doc-template-delete': LATER_D,

  //? CI — the read-only comment inbox.
  'comments-refresh': LATER, 'comments-mark-read': LATER,
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
  'trigger-save': LATER, 'trigger-toggle': LATER, 'trigger-delete': LATER_D,
  'trigger-run': {
    mode: 'enabled',
    hint: 'run an automation trigger NOW by id (fire its action on demand). params: triggerId (a trigger id from the list below)',
    params: { triggerId: { kind: 'triggerId', required: true } },
  },
  'finding-to-ticket': LATER, 'finding-dismiss': LATER,
  'apply-design-tokens': LATER,
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
  'save-style': {
    mode: 'enabled',
    hint: 'save a reusable generation STYLE (a named prompt preset the AI reuses). params: feature (image-gen|video-gen|script|…), key (short slug), systemPrompt (the style prompt), label? (display name)',
    params: { feature: { kind: 'string', required: true }, key: { kind: 'string', required: true }, systemPrompt: { kind: 'string', required: true }, label: { kind: 'string' } },
  },
  'delete-style': LATER_D,
  'save-media-provider': EXCLUDED, // provider API keys
  'save-platform-credentials': EXCLUDED, // A7 — platform app credentials (secrets never pass through chat)
  'content-edit-brand': {
    mode: 'enabled',
    hint: "set a CHANNEL's brand voice ('set the brand voice for <channel> to X'). params: channelId (from the channel list below), brandVoice (the voice, e.g. 'bold, playful')",
    params: { channelId: { kind: 'channelId', required: true }, brandVoice: { kind: 'string', required: true } },
  },
  'content-edit-product': {
    mode: 'enabled',
    hint: "set the workspace's brand/product CONTEXT that every creative generation folds in ('set the brand voice/product to X'). params: productContext (the brand + product description)",
    params: { productContext: { kind: 'string', required: true } },
  },
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
  //? #134 — per-asset content generation (paid; the accept step is the cost-confirm, mentioned in `reply`).
  'content-gen-script': { mode: 'enabled', hint: "generate the SCRIPT for a content piece (costs money — the user confirms). params: pieceId", params: { pieceId: { kind: 'pieceId', required: true } } },
  'content-gen-voice': { mode: 'enabled', hint: "generate the VOICEOVER for a content piece (costs money). params: pieceId", params: { pieceId: { kind: 'pieceId', required: true } } },
  'content-gen-images': { mode: 'enabled', hint: "generate the IMAGES/visuals for a content piece (costs money). params: pieceId", params: { pieceId: { kind: 'pieceId', required: true } } },
  'content-assemble': { mode: 'enabled', hint: "assemble a content piece's rendered video from its scenes+audio (costs money). params: pieceId", params: { pieceId: { kind: 'pieceId', required: true } } },
  'content-gen-reference-image': LATER,
  'content-gen-shortform': { mode: 'enabled', hint: "generate a hook-driven SHORT-FORM vertical clip (TikTok/Shorts) for a piece (costs money). params: pieceId, prompt (what the clip is about)", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string', required: true } } },
  'content-analyze-reference-video': LATER,
  'content-gen-avatar': { mode: 'enabled', hint: "generate a talking-AVATAR clip for a piece (costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  'content-gen-music': { mode: 'enabled', hint: "generate background MUSIC for a piece (costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  'content-gen-sfx': { mode: 'enabled', hint: "generate a SOUND EFFECT for a piece (costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  'content-gen-3d': { mode: 'enabled', hint: "generate a 3D model for a piece (image→3D chain; costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  'content-request-publish': LATER,
  'content-from-brief': EXCLUDED, // legacy `create-content`
  'studio-send-to-content': EXCLUDED, // gap-fix — direct UI button on the Studio artifact card
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
  'capture-run': {
    mode: 'enabled',
    hint: 'record a demo video of a running app by capturing a preview/env URL (chromium walkthrough → mp4 video asset). params: url (the running app url to capture, http/https), contentProjectId? (the piece to attach the footage to), goal? (a plain-language demo goal — the AI then scripts which screens to walk)',
    params: { url: { kind: 'string', required: true }, contentProjectId: { kind: 'string' }, goal: { kind: 'string' } },
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
  'content-inpaint': LATER, 'content-reorder-beats': LATER, 'content-save-scenes': LATER, 'content-transcode': LATER,
  'content-decompose-video': LATER, 'content-refine-range': LATER,
  'content-run-pipeline': {
    mode: 'enabled',
    hint: 'run the FULL content pipeline for a piece (script→voice→visuals→assemble; costs money — the user confirms). params: pieceId, styleKey?, durationMs?',
    params: { pieceId: { kind: 'pieceId', required: true }, styleKey: { kind: 'string' }, durationMs: { kind: 'number' } },
  },
  'content-save-audio-mix': LATER,
  'content-trim-audio': LATER,
  'channel-create': {
    mode: 'enabled',
    hint: 'create a publishing CHANNEL (a platform + brand identity a content piece binds to). params: name, platform? (youtube|tiktok|none), handle?',
    params: { name: { kind: 'string', required: true }, platform: { kind: 'string' }, handle: { kind: 'string' } },
  },
  'channel-edit': {
    mode: 'enabled',
    hint: "edit a channel's name/platform/handle/brand voice. params: channelId (from the channel list), name?, platform? (youtube|tiktok|none), handle?, brandVoice?",
    params: { channelId: { kind: 'channelId', required: true }, name: { kind: 'string' }, platform: { kind: 'string' }, handle: { kind: 'string' }, brandVoice: { kind: 'string' } },
  },
  'channel-delete': {
    mode: 'enabled', destructive: true,
    hint: 'delete a publishing channel. params: channelId (from the channel list)',
    params: { channelId: { kind: 'channelId', required: true } },
  },
  'account-disconnect': EXCLUDED, // auth/token surface
  'reference-add': {
    mode: 'enabled',
    hint: 'save a brand/style REFERENCE (an inspiration example the AI should remember, e.g. "remember this ad"). params: title, description, kind? (ad|post|logo|other)',
    params: { title: { kind: 'string', required: true }, description: { kind: 'string', required: true }, kind: { kind: 'string' } },
  },
  'reference-delete': LATER_D,
  'content-unarchive': {
    mode: 'enabled',
    hint: 'restore an archived content piece. params: pieceId',
    params: { pieceId: { kind: 'pieceId', required: true } },
  },
  'content-unpublish': LATER_D,
  //? #86 — the Assistant may PROPOSE a new/updated custom AI task (a named prompt-template). Low-risk
  //? (creation the user confirms); `trigger-save` stays LATER (its nested on/action/params shape needs a
  //? richer proposal contract). delete stays a destructive LATER_D.
  'save-custom-task': {
    mode: 'enabled',
    hint: 'save (create/update) a custom AI task — a named, reusable prompt-template the user can run later. params: name (short label), promptTemplate (the prompt, may contain {{vars}})',
    params: { name: { kind: 'string', required: true }, promptTemplate: { kind: 'string', required: true } },
  },
  'delete-custom-task': LATER_D,
  'run-custom-task': {
    mode: 'enabled',
    hint: 'run a saved custom AI task by id (a named prompt-template the user defined). params: taskId (a task id from the list below)',
    params: { taskId: { kind: 'taskId', required: true } },
  },
  'save-output-template': LATER, 'delete-output-template': LATER_D,
  'copy-workspace-assets': LATER,
  'copilot-propose': EXCLUDED, // meta (the propose channel itself)
  'run-agent-role': EXCLUDED, // #167 — direct UI button (interviewer "generate now"), not a chat proposal
  //? #17/#113 — the Assistant may PROPOSE launching/stopping a ticket's live preview ("open a preview of
  //? DEV-3"). Accept dispatches through the openPreview/closePreview `_api` (ephemeral container, no
  //? Conductor write). Non-destructive; validated against a real ticketKey.
  'preview-up': {
    mode: 'enabled',
    hint: "launch a live preview of a ticket's app (starts its dev server, returns a URL). params: ticketKey",
    params: { ticketKey: { kind: 'ticketKey', required: true } },
  },
  'preview-down': {
    mode: 'enabled',
    hint: "stop a ticket's running live preview. params: ticketKey",
    params: { ticketKey: { kind: 'ticketKey', required: true } },
  },
  'mark-read': EXCLUDED, // notification plumbing
  // ---- agent-session controls
  pause: { mode: 'enabled', hint: 'pause a ticket’s autonomous agent turn. params: ticketKey', params: { ticketKey: { kind: 'ticketKey', required: true } } },
  resume: { mode: 'enabled', hint: 'resume a paused ticket. params: ticketKey', params: { ticketKey: { kind: 'ticketKey', required: true } } },
  'answer-input': EXCLUDED, // the needs-input flow has its own UI
  kill: { mode: 'enabled', destructive: true, hint: 'hard-kill a ticket’s agent turn. params: ticketKey', params: { ticketKey: { kind: 'ticketKey', required: true } } },
  'pause-all': { mode: 'enabled', destructive: true, hint: 'emergency-stop ALL agent work in the workspace. no params', params: {} },
  'resume-all': { mode: 'enabled', hint: 'resume the workspace after a pause-all. no params', params: {} },
  'accept-suggestion': EXCLUDED, // plumbing
};

//? The server-side enabled set (the client twin lives in src/workspaces/_data/chatOps.ts — parity-tested).
//? GAP_SCAN C4 — which workspace MODULE each ENABLED op needs. A content-only workspace was still offered
//? board/deploy/CI ops it cannot run, so the model proposed actions that could only fail. Ops absent from
//? this table are cross-cutting (agent controls, settings, memory, custom tasks) and stay everywhere.
export const OP_MODULE: Partial<Record<ControlOp, WorkspaceModuleId>> = {
  //? development — code, board, pipeline, deploy, CI, git, services.
  'ticket-edit': 'development', 'stage-create': 'development', 'stage-delete': 'development', 'stage-reorder': 'development',
  'project-create': 'development', 'project-from-template': 'development',
  'env-deploy': 'development', 'env-teardown': 'development', 'env-promote': 'development', 'build-export': 'development',
  'ci-run': 'development', 'ci-allow-red': 'development', 'root-cause': 'development', 'plan-critique': 'development',
  'db-migrate-create': 'development', 'db-introspect': 'development',
  'mr-review': 'development', 'mr-rollback': 'development',
  'scan-docs': 'development', 'scan-index': 'development', 'gitlab-resync': 'development', 'save-git-config': 'development',
  'service-provision': 'development', 'service-teardown': 'development',
  'preview-up': 'development', 'preview-down': 'development',
  //? content — pieces, media generation, channels, publishing.
  'content-advance': 'content', 'content-archive': 'content', 'content-unarchive': 'content',
  'content-gen-script': 'content', 'content-gen-voice': 'content', 'content-gen-images': 'content', 'content-assemble': 'content',
  'content-gen-shortform': 'content', 'content-gen-avatar': 'content', 'content-gen-music': 'content', 'content-gen-sfx': 'content',
  'content-gen-3d': 'content', 'content-critique-image': 'content', 'content-video-restyle': 'content', 'content-edit-image': 'content',
  'content-run-pipeline': 'content', 'content-edit-brand': 'content', 'content-edit-product': 'content',
  'channel-create': 'content', 'channel-edit': 'content', 'channel-delete': 'content',
  'capture-run': 'content', 'shortlink-create': 'content', 'reference-add': 'content', 'save-style': 'content',
};

//? Each module's DEFINING section. `isModuleEnabled` is deliberately loose (any section counts) because
//? the modules share sections — 'scheduled' belongs to development, content AND design — so a content-only
//? workspace would read as "development on". For op-gating we need the strict question, so key on the one
//? section a module cannot be without.
const MODULE_SECTION: Record<WorkspaceModuleId, string> = { development: 'board', content: 'content', design: 'designer', documents: 'documents' };

//? Is this op available in a workspace with these sections on? An op with no module is always available;
//? an empty `enabledSections` is the legacy all-on state (see `isSectionEnabled`).
export function opAvailable(op: ControlOp, enabledSections?: string[]): boolean {
  const mod = OP_MODULE[op];
  return mod === undefined || isSectionEnabled(enabledSections ?? [], MODULE_SECTION[mod]);
}

export const ENABLED_OPS: ControlOp[] = (Object.keys(PROPOSE_CATALOG) as ControlOp[]).filter((op) => PROPOSE_CATALOG[op].mode === 'enabled');

//? Compact prompt lines for the systemPrompt — one line per enabled op (+ the preset keys the
//? service-provision hint refers to). Grouped output keeps the prompt small (~30 lines).
export function catalogPromptLines(enabledSections?: string[]): string[] {
  //? C4 — only list ops this workspace can actually run.
  const lines = ENABLED_OPS.filter((op) => opAvailable(op, enabledSections)).map((op) => {
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
  if (kind === 'taskId') return typeof value === 'string' && ctx.customTasks.some((t) => t.id === value) ? value : undefined;
  if (kind === 'triggerId') return typeof value === 'string' && ctx.triggers.some((t) => t.id === value) ? value : undefined;
  if (kind === 'mrId') return typeof value === 'string' && ctx.mrs.some((m) => m.id === value) ? value : undefined;
  if (kind === 'channelId') return typeof value === 'string' && ctx.channels.some((c) => c.id === value) ? value : undefined;
  if (kind === 'skillId') return typeof value === 'string' && ctx.skills.some((sk) => sk.id === value) ? value : undefined;
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
  //? C4 — a module the workspace turned off is not proposable, even if the model names the op anyway.
  if (!opAvailable(typedOp, ctx.enabledSections)) return null;
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
  return { op: typedOp, projectId: ctx.projectId, summary, params, ...(spec.destructive ? { destructive: true } : {}) };
}
