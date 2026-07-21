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
import { OP_CAPABILITY } from '../control/rbac';

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
  //? Parity wave — the reference collections the newly-enabled tranche validates against (all fed by
  //? workspaceChat's loadCtx; structural subsets, same as the fields above).
  sprints: { id: string }[];
  documents: { id: string }[];
  invites: { id: string }[];
  roles: { key: string }[];
  findings: { id: string }[];
  references: { id: string }[];
  outputTemplates: { id: string }[];
  styles: { key: string }[];
  infoSources: { id: string }[];
  projectServices: { id: string }[];
  migrations: { id: string }[];
  //? GAP_SCAN C4 — the workspace's enabled modules. An empty list is the legacy "everything on" state.
  enabledSections?: string[];
  permissions?: boolean[];
}

type ParamKind = 'string' | 'number' | 'boolean' | 'ticketKey' | 'ticketKeys' | 'stageId' | 'stageKeys' | 'pieceId' | 'envId' | 'serviceName' | 'presetKey' | 'taskId' | 'triggerId' | 'mrId' | 'channelId' | 'skillId' | 'sprintId' | 'memberId' | 'roleKey' | 'inviteId' | 'documentId' | 'migrationId' | 'findingId' | 'referenceId' | 'outputTemplateId' | 'styleKey' | 'sourceId' | 'projectServiceId' | 'enum';
interface ParamSpec { kind: ParamKind; required?: true; values?: readonly string[] }
export interface OpSpec {
  mode: 'enabled' | 'later' | 'excluded';
  destructive?: true;
  //? One-liner the systemPrompt shows the model (enabled ops only).
  hint?: string;
  params?: Record<string, ParamSpec>;
}

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
  archive: {
    mode: 'enabled', destructive: true,
    hint: 'archive a single ticket (soft; board/backlog hide it). params: ticketKey (e.g. DEV-3)',
    params: { ticketKey: { kind: 'ticketKey', required: true } },
  },
  'bulk-move': EXCLUDED, // legacy rich path
  'bulk-status': {
    mode: 'enabled',
    hint: 'set the status of one or more tickets at once. params: ticketKeys (list), status (idle|needs-input|busy|done|paused|stuck)',
    params: { ticketKeys: { kind: 'ticketKeys', required: true }, status: { kind: 'enum', required: true, values: ['idle', 'needs-input', 'busy', 'done', 'paused', 'stuck'] } },
  },
  'bulk-assign': EXCLUDED, // legacy `assign`
  'bulk-sprint': {
    mode: 'enabled',
    hint: 'move one or more tickets into a sprint (omit sprintId = back to backlog). params: ticketKeys (list), sprintId? (from the sprint list)',
    params: { ticketKeys: { kind: 'ticketKeys', required: true }, sprintId: { kind: 'sprintId' } },
  },
  'bulk-archive': {
    mode: 'enabled', destructive: true,
    hint: 'archive several tickets at once (soft; hidden from board/backlog). params: ticketKeys (list)',
    params: { ticketKeys: { kind: 'ticketKeys', required: true } },
  },
  'sprint-create': {
    mode: 'enabled',
    hint: 'create a new sprint. params: name, active? (default false — activate it immediately)',
    params: { name: { kind: 'string', required: true }, active: { kind: 'boolean' } },
  },
  'sprint-edit': {
    mode: 'enabled',
    hint: 'rename / (de)activate / (re)date an existing sprint. params: sprintId, name?, active?, startAt? (ISO date), endAt? (ISO date)',
    params: { sprintId: { kind: 'sprintId', required: true }, name: { kind: 'string' }, active: { kind: 'boolean' }, startAt: { kind: 'string' }, endAt: { kind: 'string' } },
  },
  // ---- members / RBAC / workspace lifecycle
  'create-workspace': EXCLUDED, // cross-workspace plumbing
  //? G2 — cloning creates a SECOND workspace; the Assistant is scoped to the current one (invariant #4),
  //? so this stays a deliberate UI action.
  'clone-workspace': EXCLUDED,
  'rename-workspace': {
    mode: 'enabled',
    hint: 'rename the current workspace. params: name (the new workspace name)',
    params: { name: { kind: 'string', required: true } },
  },
  'delete-workspace': {
    mode: 'enabled', destructive: true,
    hint: 'permanently delete the CURRENT workspace and everything in it. no params. Extremely destructive — always confirmed; only propose on an explicit, unambiguous user request',
    params: {},
  },
  'transfer-ownership': {
    mode: 'enabled', destructive: true,
    hint: "hand workspace ownership to another member (current owner becomes admin). params: memberId (the new owner's member id). Irreversible — always confirmed",
    params: { memberId: { kind: 'memberId', required: true } },
  },
  'change-role': {
    mode: 'enabled', destructive: true,
    hint: "change an existing member's role ('make Piet an admin'). params: memberId (an existing member id), roleKey (an existing role key)",
    params: { memberId: { kind: 'memberId', required: true }, roleKey: { kind: 'roleKey', required: true } },
  },
  'remove-member': {
    mode: 'enabled', destructive: true,
    hint: "remove a member from the workspace ('kick Piet'). params: memberId (an existing member id). Irreversible for their access — always confirmed",
    params: { memberId: { kind: 'memberId', required: true } },
  },
  invite: {
    mode: 'enabled',
    hint: "invite a person to this workspace by email with a role ('invite jan@x.nl as developer'). params: email, roleKey (an existing role key)",
    params: { email: { kind: 'string', required: true }, roleKey: { kind: 'roleKey', required: true } },
  },
  'revoke-invite': {
    mode: 'enabled', destructive: true,
    hint: "withdraw a pending workspace invite ('cancel the invite for jan@x.nl'). params: inviteId (an existing pending invite id)",
    params: { inviteId: { kind: 'inviteId', required: true } },
  },
  'accept-invite': EXCLUDED, // own-resource plumbing
  'role-create': {
    mode: 'enabled', destructive: true,
    hint: 'create a new custom RBAC role (starts with zero permissions; grant perms afterwards in Settings). params: name (display label; the key is derived)',
    params: { name: { kind: 'string', required: true } },
  },
  'role-update': {
    mode: 'enabled', destructive: true,
    hint: "rename a custom role's display label ('rename role reviewer to auditor'). params: roleKey (existing role key), label (new display name). Permission toggles stay a Settings-UI action",
    params: { roleKey: { kind: 'roleKey', required: true }, label: { kind: 'string', required: true } },
  },
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
  'ui-review-create': {
    mode: 'enabled',
    hint: "file a UI-review ('unfuck the UI') request for the current project: comma-separated problem keys + optional free-text notes and page name. Chat cannot attach screenshots — at least one problem is required. params: problems, notes?, page?",
    params: { problems: { kind: 'string', required: true }, notes: { kind: 'string' }, page: { kind: 'string' } },
  },
  'ui-review-to-ticket': EXCLUDED, // U2 gap-fix — direct inbox button on the designer page
  'ui-review-dismiss': EXCLUDED,   // U2 gap-fix — direct inbox button
  'gitlab-settings': EXCLUDED, // carries the forge token
  //? Connectivity is already proven by the credential-free snapshot fetch in gitlab-resync. Keeping a
  //? second no-op writer would let chat report success without evidence, so the legacy alias is excluded.
  'gitlab-verify': EXCLUDED,
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
  //? Runtime commands/custom-base are an Admin settings form, never AI-proposable.
  'project-runtime-save': EXCLUDED,
  'save-sections': {
    mode: 'enabled',
    hint: "turn workspace modules/nav sections on or off ('enable the documents module'). params: enabledSections — the COMPLETE new comma-separated section list (valid ids: board|backlog|terminals|activity|sources|pipeline|scheduled|interviewer|content|marketing|scheduled-posts|studio|designer|documents). Always include the sections that must STAY on — this replaces the whole set.",
    params: { enabledSections: { kind: 'string', required: true } },
  },
  'save-ai-instruction': {
    mode: 'enabled',
    hint: 'set the workspace-wide AI behaviour: the always-on instruction prepended to every AI run, the preferred output language, and/or the Gemini model/temperature(0-2)/base-url. Only pass the fields to change; the rest keep their current value. params: aiInstruction?, outputLanguage?, geminiModel?, geminiTemperature?, geminiBaseUrl?',
    params: { aiInstruction: { kind: 'string' }, outputLanguage: { kind: 'string' }, geminiModel: { kind: 'string' }, geminiTemperature: { kind: 'string' }, geminiBaseUrl: { kind: 'string' } },
  },
  'save-ai-provider': {
    mode: 'enabled',
    hint: "switch which AI provider runs ONE non-coding feature ('use Gemini for MR reviews'). params: feature (script|docs-generate|studio-designer|studio-marketer|designer-theme|interviewer|mr-review|root-cause|plan-critique), providerId (default clears the override | claude-cli | gemini-api). The CODING agent is not switchable.",
    params: {
      feature: { kind: 'enum', required: true, values: ['script', 'docs-generate', 'studio-designer', 'studio-marketer', 'designer-theme', 'interviewer', 'mr-review', 'root-cause', 'plan-critique'] },
      providerId: { kind: 'enum', required: true, values: ['default', 'claude-cli', 'gemini-api'] },
    },
  },
  'save-autonomy': {
    mode: 'enabled',
    hint: 'set how often the human must approve pipeline stages: gate-every (approve each stage) | gate-key-stages (default) | full-auto (no human gates — propose with care and say so in the reply). params: autonomyLevel',
    params: { autonomyLevel: { kind: 'enum', required: true, values: ['gate-every', 'gate-key-stages', 'full-auto'] } },
  },
  //? Credential boundary: the route also accepts a `token`, but a token must NEVER travel through the
  //? chat/LLM path — the chat surface is gitUrl-only (private repos go via the settings UI).
  'link-repo': {
    mode: 'enabled',
    hint: 'link (clone) a git repository to the workspace by URL. params: gitUrl (https/ssh clone URL). PUBLIC repos only from chat — a private repo needs a token, which must be entered in the settings UI, never via chat',
    params: { gitUrl: { kind: 'string', required: true } },
  },
  'scan-docs': { mode: 'enabled', hint: 'rescan the linked repo for context docs (README/docs/…). no params', params: {} },
  'create-info-source': {
    mode: 'enabled',
    hint: "register a user-provided text/markdown document as a context doc the coding AI reads (the 'bring your own knowledge' path). params: name (doc filename/label), content (the full md/txt text — include it verbatim in the proposal)",
    params: { name: { kind: 'string', required: true }, content: { kind: 'string', required: true } },
  },
  'scan-index': { mode: 'enabled', hint: 'rebuild the code RAG index of the linked repo (so answers ground on the latest code). no params', params: {} },
  'mr-create': {
    mode: 'enabled',
    hint: "open/refresh the built-in merge request for a ticket's branch (idempotent — also just loads the MR view). params: ticketKey",
    params: { ticketKey: { kind: 'ticketKey', required: true } },
  },
  'mr-comment': {
    mode: 'enabled',
    hint: 'post a review comment on a merge request — MR-level by default, or line-anchored via filePath+line, or reply in an existing thread via threadId. params: ticketKey, mrId, body, filePath?, line?, side? (new|old), threadId?',
    params: { ticketKey: { kind: 'ticketKey', required: true }, mrId: { kind: 'mrId', required: true }, body: { kind: 'string', required: true }, filePath: { kind: 'string' }, line: { kind: 'number' }, side: { kind: 'enum', values: ['new', 'old'] }, threadId: { kind: 'string' } },
  },
  'mr-approve': {
    mode: 'enabled', destructive: true,
    hint: "approve a merge request (records the caller's approval; staleness tracked against head). params: ticketKey, mrId — pick the pair from the open-MR list",
    params: { ticketKey: { kind: 'ticketKey', required: true }, mrId: { kind: 'mrId', required: true } },
  },
  'mr-merge': {
    mode: 'enabled', destructive: true,
    hint: 'merge a merge request into its target branch (irreversible except via mr-rollback). params: ticketKey, mrId — only propose when the user explicitly asks to merge',
    params: { ticketKey: { kind: 'ticketKey', required: true }, mrId: { kind: 'mrId', required: true } },
  },
  'mr-resolve': {
    mode: 'enabled',
    hint: "mark a merge-request review thread resolved (or unresolved with resolved:false). params: ticketKey, threadId (from the MR's thread list), resolved? (default true)",
    params: { ticketKey: { kind: 'ticketKey', required: true }, threadId: { kind: 'string', required: true }, resolved: { kind: 'boolean' } },
  },
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
  //? Exact legacy alias of edit-budget. Showing both wastes scarce tool context and creates two names for
  //? one effect, so chat exposes only the canonical operation.
  'raise-cap': EXCLUDED,
  'edit-budget': {
    mode: 'enabled', destructive: true,
    hint: "create or edit the AI €-spend cap ('raise the budget to 50', 'alert me at 80%'). params: cap (the new amount), alertPct? (0-100), label?, enforcement? (pauseNew = pause new work | pauseAll = pause everything), create? (true = add a SEPARATE additional cap), enabled? (false retires the cap). Only pass the fields to change.",
    params: { cap: { kind: 'number' }, alertPct: { kind: 'number' }, label: { kind: 'string' }, enforcement: { kind: 'enum', values: ['pauseNew', 'pauseAll'] }, create: { kind: 'boolean' }, enabled: { kind: 'boolean' } },
  },
  'resume-spend': {
    mode: 'enabled', destructive: true,
    hint: "resume AI spending after a budget freeze — resets the current window's spent counter to 0 for ALL caps and unfreezes work. no params. Destructive because it re-opens real spending.",
    params: {},
  },
  'skill-toggle': {
    mode: 'enabled',
    hint: 'enable or disable a workflow capability or context document from the Sources page (NOT an instruction AI skill; those use ai-skill-toggle). params: sourceId, on (true/false)',
    params: { sourceId: { kind: 'sourceId', required: true }, on: { kind: 'boolean', required: true } },
  },
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
  //? ADR 0283 — the owner consciously overruled the earlier "delete stays UI-only" pin (2026-07-20):
  //? the assistant may propose skill deletion; destructive keeps the extra explicit confirm on accept.
  'ai-skill-delete': {
    mode: 'enabled', destructive: true,
    hint: 'permanently delete an AI skill. params: skillId (from the skills list below). Destructive — the user gets an extra confirm; prefer ai-skill-toggle off unless the user explicitly wants it gone',
    params: { skillId: { kind: 'skillId', required: true } },
  },
  //? DOC — the Documents module (draft-based). B-23-clean: document-ai writes ONLY a draft; apply-draft
  //? is the consent step, and edits/restores snapshot the previous content as a revision first.
  'document-create': {
    mode: 'enabled',
    hint: "create a new document. params: title, content? (initial markdown), templateSlug? (a document-template slug; seeds the doc's kind + a section skeleton when content is empty)",
    params: { title: { kind: 'string', required: true }, content: { kind: 'string' }, templateSlug: { kind: 'string' } },
  },
  'document-edit': {
    mode: 'enabled',
    hint: "edit a document's title and/or REPLACE its full markdown content (the previous content is auto-snapshotted as a revision). params: documentId, title?, content? (full replacement, not a patch)",
    params: { documentId: { kind: 'documentId', required: true }, title: { kind: 'string' }, content: { kind: 'string' } },
  },
  'document-delete': {
    mode: 'enabled', destructive: true,
    hint: "PERMANENTLY delete a document + ALL its revisions and RAG rows (prefer document-archive for 'remove from the list'). params: documentId",
    params: { documentId: { kind: 'documentId', required: true } },
  },
  'document-ai': {
    mode: 'enabled',
    hint: 'run AI over a document (generate/rewrite/summarize/extend; costs AI spend). The result lands as a DRAFT only — the user applies it via document-apply-draft. params: documentId, mode? (default rewrite), instruction?',
    params: { documentId: { kind: 'documentId', required: true }, mode: { kind: 'enum', values: ['generate', 'rewrite', 'summarize', 'extend'] }, instruction: { kind: 'string' } },
  },
  'document-apply-draft': {
    mode: 'enabled',
    hint: "apply a document's pending AI draft as the real content (previous content is snapshotted as a revision first). Only meaningful when the doc HAS a pending draft. params: documentId",
    params: { documentId: { kind: 'documentId', required: true } },
  },
  'document-discard-draft': {
    mode: 'enabled',
    hint: "throw away a document's pending AI draft (content untouched). params: documentId",
    params: { documentId: { kind: 'documentId', required: true } },
  },
  'document-gen-image': {
    mode: 'enabled',
    hint: 'add an image to a document — generates one from the prompt (costs money — the user confirms), or with assetId reuses an EXISTING approved asset (no spend). params: documentId, prompt, assetId?',
    params: { documentId: { kind: 'documentId', required: true }, prompt: { kind: 'string', required: true }, assetId: { kind: 'string' } },
  },
  'document-export': {
    mode: 'enabled',
    hint: "export a document to a file (md|html|pdf|docx|xlsx); the file lands in the doc's assets list as an 'export' entry. params: documentId, format",
    params: { documentId: { kind: 'documentId', required: true }, format: { kind: 'enum', required: true, values: ['md', 'html', 'pdf', 'docx', 'xlsx'] } },
  },
  'document-restore-revision': {
    mode: 'enabled',
    hint: "restore a prior revision as the current content (the current content is snapshotted first, so this is itself undoable; any pending AI draft is cleared). params: documentId, revisionId (from the doc's revision history)",
    params: { documentId: { kind: 'documentId', required: true }, revisionId: { kind: 'string', required: true } },
  },
  //? The Assistant may propose archiving/restoring a document — both are reversible and the Conductor
  //? scopes the id to this workspace, so the worst case is a document the user un-archives again.
  'document-archive': {
    mode: 'enabled',
    hint: 'archive a document (reversible; keeps every revision). params: documentId',
    params: { documentId: { kind: 'string', required: true } },
  },
  'document-unarchive': {
    mode: 'enabled',
    hint: 'restore an archived document. params: documentId',
    params: { documentId: { kind: 'string', required: true } },
  },
  //? ParamKind has no object-array kind, so `sections` travels ENCODED IN A STRING
  //? ('Heading::hint||Heading2') — same encode-in-a-string precedent as ai-skill-save's applyPoints.
  'doc-template-save': {
    mode: 'enabled',
    hint: "create or update a document template (a named list of sections a doc is generated against). params: name, sections (encoded as 'Heading::hint||Heading2::hint2' — at least one heading), description?, slug? (existing slug = update/override, incl. overriding a builtin)",
    params: { name: { kind: 'string', required: true }, sections: { kind: 'string', required: true }, description: { kind: 'string' }, slug: { kind: 'string' } },
  },
  'doc-template-delete': {
    mode: 'enabled', destructive: true,
    hint: 'delete a document template by slug (for a builtin slug this resets it to the builtin default rather than removing it). params: slug',
    params: { slug: { kind: 'string', required: true } },
  },

  //? CI — the read-only comment inbox.
  'comments-refresh': {
    mode: 'enabled',
    hint: 'refresh the read-only comment inbox (fetch new comments on published posts on demand). no params',
    params: {},
  },
  'comments-mark-read': {
    mode: 'enabled',
    hint: 'mark one inbox comment read (commentId from the comment list) or ALL read when commentId is omitted. params: commentId?',
    params: { commentId: { kind: 'string' } },
  },
  'save-stage-config': {
    mode: 'enabled',
    hint: "edit ONE pipeline stage's config: rename it, set its prompt/system-prompt/custom instructions/definition-of-done, toggle AI on it, or toggle its human approval gate. params: stageId (from the stage list) + only the fields to change (name?, promptTemplate?, systemPrompt?, customInstructions?, definitionOfDone?, aiEnabled?, gateForApproval?)",
    params: { stageId: { kind: 'stageId', required: true }, name: { kind: 'string' }, promptTemplate: { kind: 'string' }, systemPrompt: { kind: 'string' }, customInstructions: { kind: 'string' }, definitionOfDone: { kind: 'string' }, aiEnabled: { kind: 'boolean' }, gateForApproval: { kind: 'boolean' } },
  },
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
  //? Parity wave — trigger-save ships the FLAT param subset only (create/rename/re-cron/approval-flip);
  //? nested action payloads (notify title/body, emit-signal name, …) still need the settings UI, so a
  //? chat-created `notify` trigger starts with an empty params object. Documented in the hint.
  'trigger-save': {
    mode: 'enabled',
    hint: 'create or update an automation trigger (fires an action on an event or cron). params: triggerId (from the triggers list, to update), name + on (event: ticket.created|stage.on_enter|stage.on_complete|stage.on_signal|stage.on_approval|ticket.merged|suggestion.accepted|cron) + action (notify|emit-signal|start-stage|invoke-agent-role|invoke-workspace-ai|run-command|webhook) — all three required when creating, cron (expression, required when on=cron), requiresApproval?. Action DETAILS (message text, stage key, …) are configured afterwards in the automation panel',
    params: {
      triggerId: { kind: 'triggerId' },
      name: { kind: 'string' },
      on: { kind: 'enum', values: ['ticket.created', 'stage.on_enter', 'stage.on_complete', 'stage.on_signal', 'stage.on_approval', 'ticket.merged', 'suggestion.accepted', 'cron'] },
      action: { kind: 'enum', values: ['notify', 'emit-signal', 'start-stage', 'invoke-agent-role', 'invoke-workspace-ai', 'run-command', 'webhook'] },
      cron: { kind: 'string' },
      requiresApproval: { kind: 'boolean' },
    },
  },
  'trigger-toggle': {
    mode: 'enabled',
    hint: 'enable or disable an automation trigger. params: triggerId (a trigger id from the list below), enabled (true/false)',
    params: { triggerId: { kind: 'triggerId', required: true }, enabled: { kind: 'boolean', required: true } },
  },
  'trigger-delete': {
    mode: 'enabled', destructive: true,
    hint: 'permanently delete an automation trigger. params: triggerId (a trigger id from the list below)',
    params: { triggerId: { kind: 'triggerId', required: true } },
  },
  'trigger-run': {
    mode: 'enabled',
    hint: 'run an automation trigger NOW by id (fire its action on demand). params: triggerId (a trigger id from the list below)',
    params: { triggerId: { kind: 'triggerId', required: true } },
  },
  'finding-to-ticket': {
    mode: 'enabled',
    hint: 'turn an Interviewer finding into a board ticket (human-approved — the Interviewer never creates tickets itself). params: findingId (from the findings list)',
    params: { findingId: { kind: 'findingId', required: true } },
  },
  'finding-dismiss': {
    mode: 'enabled',
    hint: 'dismiss an Interviewer finding (it leaves the open list). params: findingId (from the findings list)',
    params: { findingId: { kind: 'findingId', required: true } },
  },
  'apply-design-tokens': {
    mode: 'enabled',
    hint: "apply the Designer's approved design tokens (colors/typography) to the current project's codebase. no params (runs against the active project)",
    params: {},
  },
  'ticket-link-artifact': {
    mode: 'enabled',
    hint: 'link a design/Studio/UI-review artifact to a ticket so it is injected at stage-spawn. params: ticketKey, artifactId, artifactKind (design|studio|ui-review), label?',
    params: { ticketKey: { kind: 'ticketKey', required: true }, artifactId: { kind: 'string', required: true }, artifactKind: { kind: 'enum', required: true, values: ['design', 'studio', 'ui-review'] }, label: { kind: 'string' } },
  },
  'ticket-unlink-artifact': {
    mode: 'enabled',
    hint: 'remove an existing artifact link from a ticket. params: linkId (an existing TicketArtifactLink id, not the artifactId)',
    params: { linkId: { kind: 'string', required: true } },
  },
  // ---- projects / services / greenfield
  'project-create': {
    mode: 'enabled',
    hint: 'add an (empty) project to the workspace. params: name',
    params: { name: { kind: 'string', required: true } },
  },
  'service-create': {
    mode: 'enabled',
    hint: 'add a monorepo service/deploy-unit to the ACTIVE project (name + optional sub-path, build command, deploy unit). NOT for third-party stacks — that is service-provision. params: name, path?, buildCmd?, deployUnit?',
    params: { name: { kind: 'string', required: true }, path: { kind: 'string' }, buildCmd: { kind: 'string' }, deployUnit: { kind: 'string' } },
  },
  'service-delete': {
    mode: 'enabled', destructive: true,
    hint: 'remove a monorepo service/deploy-unit row from the project (does not touch code; its per-unit CI/deploy config disappears). params: serviceId — an existing project-service id (NOT a service-stack name)',
    params: { serviceId: { kind: 'projectServiceId', required: true } },
  },
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
  'env-rollback': {
    mode: 'enabled', destructive: true,
    hint: 'roll an environment back to the last commit that was actually live. params: envId',
    params: { envId: { kind: 'envId', required: true } },
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
  'db-migrate-apply': {
    mode: 'enabled', destructive: true,
    hint: 'apply an existing pending migration to its configured user-app database. params: migrationId (from the pending migrations list). Always requires the extra explicit confirmation',
    params: { migrationId: { kind: 'migrationId', required: true } },
  },
  'db-introspect': { mode: 'enabled', hint: 'introspect the connected user-app database (tables/columns). params: connectionId?', params: { connectionId: { kind: 'string' } } },
  // ---- content settings / brand / styles
  //? Unit trap: capCents is CENTS (€25 = 2500) while edit-budget's cap is the plain Budgets-UI number.
  'edit-media-budget': {
    mode: 'enabled', destructive: true,
    hint: 'edit the MEDIA-generation €-budget (paid image/video/audio providers): capCents (the cap in CENTS — €25 = 2500), alertPct? (0-100 warn threshold), enabled? (false disables the guard entirely). Only pass the fields to change. Distinct from edit-budget (the AI/token budget).',
    params: { capCents: { kind: 'number' }, alertPct: { kind: 'number' }, enabled: { kind: 'boolean' } },
  },
  'save-style': {
    mode: 'enabled',
    hint: 'save a reusable generation STYLE (a named prompt preset the AI reuses). params: feature (image-gen|video-gen|script|…), key (short slug), systemPrompt (the style prompt), label? (display name)',
    params: { feature: { kind: 'string', required: true }, key: { kind: 'string', required: true }, systemPrompt: { kind: 'string', required: true }, label: { kind: 'string' } },
  },
  'delete-style': {
    mode: 'enabled', destructive: true,
    hint: 'delete a saved generation STYLE preset. params: feature + key exactly as shown in the styles list (styles are keyed by feature+key, not an id; builtins cannot be deleted)',
    params: { feature: { kind: 'string', required: true }, key: { kind: 'styleKey', required: true } },
  },
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
  // ---- content pipeline
  //? The core create-content proposal already maps to content-from-brief and carries the richer brief.
  //? Exposing this lower-level duplicate would create a second, less capable creation path.
  'content-create': EXCLUDED,
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
  'content-gen-reference-image': {
    mode: 'enabled',
    hint: "generate an image GUIDED BY a reference image url ('make one like this picture') — costs money, the user confirms. params: pieceId, referenceUrl (the reference image url), styleKey?, extraInstructions?",
    params: { pieceId: { kind: 'pieceId', required: true }, referenceUrl: { kind: 'string', required: true }, styleKey: { kind: 'string' }, extraInstructions: { kind: 'string' } },
  },
  'content-gen-shortform': { mode: 'enabled', hint: "generate a hook-driven SHORT-FORM vertical clip (TikTok/Shorts) for a piece (costs money). params: pieceId, prompt (what the clip is about)", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string', required: true } } },
  'content-analyze-reference-video': {
    mode: 'enabled',
    hint: "analyze a reference video url and seed a script blueprint that retells YOUR story in its style ('script it like this video, but about X'). params: pieceId, referenceVideoUrl (http/https), newStory (what the new video should be about)",
    params: { pieceId: { kind: 'pieceId', required: true }, referenceVideoUrl: { kind: 'string', required: true }, newStory: { kind: 'string', required: true } },
  },
  'content-gen-avatar': { mode: 'enabled', hint: "generate a talking-AVATAR clip for a piece (costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  'content-gen-music': { mode: 'enabled', hint: "generate background MUSIC for a piece (costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  'content-gen-sfx': { mode: 'enabled', hint: "generate a SOUND EFFECT for a piece (costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  'content-gen-3d': { mode: 'enabled', hint: "generate a 3D model for a piece (image→3D chain; costs money). params: pieceId, prompt?", params: { pieceId: { kind: 'pieceId', required: true }, prompt: { kind: 'string' } } },
  //? F5-rationale: posting is public + hard to undo, so destructive even though the old LATER was plain.
  'content-request-publish': {
    mode: 'enabled', destructive: true,
    hint: 'publish a finished render/asset of a piece to a connected platform (posts PUBLICLY on accept) — params: pieceId, assetId (a ready render), platform (a CONNECTED platform), caption?, hashtags? (comma-separated), privacy? (public|unlisted|private), scheduledAt? (ISO), syntheticMedia? (AI-disclosure), accountId?',
    params: { pieceId: { kind: 'pieceId', required: true }, assetId: { kind: 'string', required: true }, platform: { kind: 'string', required: true }, caption: { kind: 'string' }, hashtags: { kind: 'string' }, privacy: { kind: 'enum', values: ['public', 'unlisted', 'private'] }, scheduledAt: { kind: 'string' }, syntheticMedia: { kind: 'boolean' }, accountId: { kind: 'string' } },
  },
  'content-from-brief': EXCLUDED, // legacy `create-content`
  'studio-send-to-content': EXCLUDED, // gap-fix — direct UI button on the Studio artifact card
  'content-import-asset': {
    mode: 'enabled',
    hint: 'attach an ALREADY-UPLOADED media url (library asset or user upload) to a piece as an asset — params: pieceId, url (an existing workspace media url), kind (image|video)',
    params: { pieceId: { kind: 'pieceId', required: true }, url: { kind: 'string', required: true }, kind: { kind: 'enum', required: true, values: ['image', 'video'] } },
  },
  'content-regenerate': {
    mode: 'enabled',
    hint: 'regenerate a media asset (optionally tweaked, costs money — the user confirms). params: assetId, pieceId?, tweak?, count? (1-4)',
    params: { assetId: { kind: 'string', required: true }, pieceId: { kind: 'pieceId' }, tweak: { kind: 'string' }, count: { kind: 'number' } },
  },
  'content-gen-thumbnail': {
    mode: 'enabled',
    hint: 'compose a thumbnail for a piece: bold headline over a background (optionally AI-generated). params: pieceId, headline, backgroundPrompt? (omit for the free template)',
    params: { pieceId: { kind: 'pieceId', required: true }, headline: { kind: 'string', required: true }, backgroundPrompt: { kind: 'string' } },
  },
  //? F5 — the reply POSTS PUBLICLY, so it is marked destructive: the client wraps accept in an extra
  //? explicit confirm, and the user sees the exact text before it ships. That is the same propose→accept
  //? contract the inbox's own draft button uses (B-23) — the AI never posts by itself either way.
  'content-reply-comment': {
    mode: 'enabled', destructive: true,
    hint: 'reply to a comment in the inbox. params: commentId (from the comments list), replyText (the exact text to post)',
    params: { commentId: { kind: 'string', required: true }, replyText: { kind: 'string', required: true } },
  },
  //? G3 — one-click "put this generated page live". Publishing is public-facing, so the Assistant may
  //? propose it (the user still accepts) but taking it down stays a UI action.
  'studio-publish-site': {
    mode: 'enabled',
    hint: 'publish a generated Studio page to a public URL. params: artifactId',
    params: { artifactId: { kind: 'string', required: true } },
  },
  'studio-unpublish-site': {
    mode: 'enabled', destructive: true,
    hint: 'take a published page offline. params: slug (from the published page URL)',
    params: { slug: { kind: 'string', required: true } },
  },
  //? F48 — the Assistant may pull something back out of the bin freely. PURGE is `confirm`: it is the one
  //? op in the system that destroys media immediately, with nothing left to undo it with.
  'media-trash-restore': {
    mode: 'enabled',
    hint: 'take a file back out of the trash before it is deleted. params: trashId',
    params: { trashId: { kind: 'string', required: true } },
  },
  'media-trash-purge': {
    mode: 'enabled', destructive: true,
    hint: 'permanently delete a trashed file NOW instead of waiting out its grace period. params: trashId',
    params: { trashId: { kind: 'string', required: true } },
  },
  //? G4 — the id is validated by the Conductor's tenant-scoped lookup (a foreign asset is simply not
  //? found), so a plain string param is safe here; starring is fully reversible.
  'asset-star': {
    mode: 'enabled',
    hint: 'keep an asset in the reusable library, or take it out. params: assetId, starred (true/false)',
    params: { assetId: { kind: 'string', required: true }, starred: { kind: 'boolean', required: true } },
  },
  //? G7 — "test these two prompts against each other" is a natural thing to ask the Assistant. Starting
  //? one retires the previous experiment on that feature (the Conductor enforces one-per-feature).
  'prompt-experiment-save': {
    mode: 'enabled',
    hint: 'start an A/B test between two prompt variants for one AI feature. params: feature (script|interviewer|mr-review|workspace-chat), name, variantA, variantB',
    params: { feature: { kind: 'enum', values: ['script', 'interviewer', 'mr-review', 'workspace-chat'], required: true }, name: { kind: 'string', required: true }, variantA: { kind: 'string', required: true }, variantB: { kind: 'string', required: true } },
  },
  'prompt-experiment-stop': {
    mode: 'enabled',
    hint: 'stop measuring a prompt experiment (its results are kept). params: experimentId',
    params: { experimentId: { kind: 'string', required: true } },
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
  //? Chat cannot paint a mask — content-inpaint is only proposable when the user already has a mask url
  //? (whole-image edits are the enabled content-edit-image).
  'content-inpaint': {
    mode: 'enabled',
    hint: 'region-edit (inpaint) an image asset with an ALREADY-UPLOADED painted mask (costs money) — params: pieceId, referenceUrl (the source image url), maskUrl (a painted mask image url), prompt, parentAssetId (the source assetId). Without an existing mask url, point the user to the image editor instead',
    params: { pieceId: { kind: 'pieceId', required: true }, referenceUrl: { kind: 'string', required: true }, maskUrl: { kind: 'string', required: true }, prompt: { kind: 'string', required: true }, parentAssetId: { kind: 'string', required: true } },
  },
  //? Timeline replacement requires the complete current scene/beat graph; omitted ids are destructive.
  //? That graph intentionally stays in the visual editor rather than entering a compact chat context.
  'content-reorder-beats': EXCLUDED, 'content-save-scenes': EXCLUDED,
  'content-transcode': {
    mode: 'enabled',
    hint: 'transcode a video/render asset into an extra delivery format (webm or gif) — free ffmpeg job, produces a new variant. params: pieceId, assetId, format',
    params: { pieceId: { kind: 'pieceId', required: true }, assetId: { kind: 'string', required: true }, format: { kind: 'enum', required: true, values: ['webm', 'gif'] } },
  },
  'content-decompose-video': {
    mode: 'enabled',
    hint: "(re)generate the timeline's scene list from the piece's script (replaces the current scene plan). params: pieceId, sceneDurationMs? (per-scene target length)",
    params: { pieceId: { kind: 'pieceId', required: true }, sceneDurationMs: { kind: 'number' } },
  },
  'content-refine-range': {
    mode: 'enabled',
    hint: "AI-refine ONE time-range of a piece's video with an instruction ('make 0:05-0:12 slower/moodier') — costs money, the user confirms. params: pieceId, startMs, endMs, instruction",
    params: { pieceId: { kind: 'pieceId', required: true }, startMs: { kind: 'number', required: true }, endMs: { kind: 'number', required: true }, instruction: { kind: 'string', required: true } },
  },
  'content-run-pipeline': {
    mode: 'enabled',
    hint: 'run the FULL content pipeline for a piece (script→voice→visuals→assemble; costs money — the user confirms). params: pieceId, styleKey?, durationMs?',
    params: { pieceId: { kind: 'pieceId', required: true }, styleKey: { kind: 'string' }, durationMs: { kind: 'number' } },
  },
  'content-save-audio-mix': {
    mode: 'enabled',
    hint: "save a piece's audio mix: voiceover gain + (ducked) music gain ('make the music quieter'). params: pieceId, voiceVolume, musicVolume (linear gains, ~0-1)",
    params: { pieceId: { kind: 'pieceId', required: true }, voiceVolume: { kind: 'number', required: true }, musicVolume: { kind: 'number', required: true } },
  },
  'content-trim-audio': {
    mode: 'enabled',
    hint: "trim an AUDIO asset to a start/end range with an optional linear gain ('cut the voiceover to 2-14s'). params: pieceId, assetId (an audio asset), startMs, endMs, gain?",
    params: { pieceId: { kind: 'pieceId', required: true }, assetId: { kind: 'string', required: true }, startMs: { kind: 'number', required: true }, endMs: { kind: 'number', required: true }, gain: { kind: 'number' } },
  },
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
  'reference-delete': {
    mode: 'enabled', destructive: true,
    hint: 'delete a saved brand/style reference from the inspiration library. params: referenceId (from the references list)',
    params: { referenceId: { kind: 'referenceId', required: true } },
  },
  'content-unarchive': {
    mode: 'enabled',
    hint: 'restore an archived content piece. params: pieceId',
    params: { pieceId: { kind: 'pieceId', required: true } },
  },
  'content-unpublish': {
    mode: 'enabled', destructive: true,
    hint: 'retract a PUBLISHED post from a platform (best-effort platform delete). params: pieceId, assetId (the published asset), platform (where it was published)',
    params: { pieceId: { kind: 'pieceId', required: true }, assetId: { kind: 'string', required: true }, platform: { kind: 'string', required: true } },
  },
  //? #86 — the Assistant may PROPOSE a new/updated custom AI task (a named prompt-template). Low-risk
  //? (creation the user confirms); `trigger-save` stays LATER (its nested on/action/params shape needs a
  //? richer proposal contract). delete stays a destructive LATER_D.
  'save-custom-task': {
    mode: 'enabled',
    hint: 'save (create/update) a custom AI task — a named, reusable prompt-template the user can run later. params: name (short label), promptTemplate (the prompt, may contain {{vars}})',
    params: { name: { kind: 'string', required: true }, promptTemplate: { kind: 'string', required: true } },
  },
  'delete-custom-task': {
    mode: 'enabled', destructive: true,
    hint: 'delete a saved custom AI task (a user-authored prompt-template). params: taskId (a task id from the list below)',
    params: { taskId: { kind: 'taskId', required: true } },
  },
  'run-custom-task': {
    mode: 'enabled',
    hint: 'run a saved custom AI task by id (a named prompt-template the user defined). params: taskId (a task id from the list below)',
    params: { taskId: { kind: 'taskId', required: true } },
  },
  'save-output-template': {
    mode: 'enabled',
    hint: 'create or update a reusable OUTPUT template (a named render format + watermark position). params: name (required when creating), format?, watermarkPosition?, templateId (from the templates list, to update an existing one)',
    params: { name: { kind: 'string' }, format: { kind: 'string' }, watermarkPosition: { kind: 'string' }, templateId: { kind: 'outputTemplateId' } },
  },
  'delete-output-template': {
    mode: 'enabled', destructive: true,
    hint: 'delete a saved output template. params: templateId (from the templates list)',
    params: { templateId: { kind: 'outputTemplateId', required: true } },
  },
  //? Workspace-AI is deliberately confined to one workspace. Cross-workspace copy remains an explicit UI
  //? flow where both memberships can be shown and confirmed; it must not widen chat's tenant boundary.
  'copy-workspace-assets': EXCLUDED,
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
  'env-deploy': 'development', 'env-teardown': 'development', 'env-promote': 'development', 'build-export': 'development', 'env-rollback': 'development',
  'ci-run': 'development', 'ci-allow-red': 'development', 'root-cause': 'development', 'plan-critique': 'development',
  'db-migrate-create': 'development', 'db-introspect': 'development',
  'mr-review': 'development', 'mr-rollback': 'development',
  'scan-docs': 'development', 'scan-index': 'development', 'gitlab-resync': 'development', 'save-git-config': 'development',
  'service-provision': 'development', 'service-teardown': 'development',
  'preview-up': 'development', 'preview-down': 'development',
  //? Parity wave — board/sprint/MR/service ops follow their enabled siblings into `development`.
  archive: 'development', 'bulk-status': 'development', 'bulk-sprint': 'development', 'bulk-archive': 'development',
  'sprint-create': 'development', 'sprint-edit': 'development',
  'ticket-link-artifact': 'development', 'ticket-unlink-artifact': 'development',
  'mr-create': 'development', 'mr-comment': 'development', 'mr-approve': 'development', 'mr-merge': 'development', 'mr-resolve': 'development',
  'service-create': 'development', 'service-delete': 'development',
  //? content — pieces, media generation, channels, publishing.
  'content-advance': 'content', 'content-archive': 'content', 'content-unarchive': 'content',
  'content-gen-script': 'content', 'content-gen-voice': 'content', 'content-gen-images': 'content', 'content-assemble': 'content',
  'content-gen-shortform': 'content', 'content-gen-avatar': 'content', 'content-gen-music': 'content', 'content-gen-sfx': 'content',
  'content-gen-3d': 'content', 'content-critique-image': 'content', 'content-video-restyle': 'content', 'content-edit-image': 'content',
  'content-run-pipeline': 'content', 'content-gen-thumbnail': 'content', 'content-edit-brand': 'content', 'content-edit-product': 'content',
  'channel-create': 'content', 'channel-edit': 'content', 'channel-delete': 'content',
  'capture-run': 'content', 'studio-publish-site': 'content', 'studio-unpublish-site': 'content',
  'content-reply-comment': 'content', 'asset-star': 'content',
  'media-trash-restore': 'content', 'media-trash-purge': 'content',
  //? Parity wave — the newly-enabled content-lane ops follow their siblings into `content`.
  'content-request-publish': 'content', 'content-unpublish': 'content', 'content-import-asset': 'content',
  'content-inpaint': 'content', 'content-transcode': 'content', 'content-decompose-video': 'content',
  'content-refine-range': 'content', 'content-save-audio-mix': 'content', 'content-trim-audio': 'content',
  'content-gen-reference-image': 'content', 'content-analyze-reference-video': 'content',
  'delete-style': 'content', 'reference-delete': 'content',
  //? Documents ops belong to the documents module.
  'document-archive': 'documents', 'document-unarchive': 'documents', 'shortlink-create': 'content', 'reference-add': 'content', 'save-style': 'content',
  'document-create': 'documents', 'document-edit': 'documents', 'document-delete': 'documents',
  'document-ai': 'documents', 'document-apply-draft': 'documents', 'document-discard-draft': 'documents',
  'document-gen-image': 'documents', 'document-export': 'documents', 'document-restore-revision': 'documents',
  'doc-template-save': 'documents', 'doc-template-delete': 'documents',
};

//? Each module's DEFINING section. `isModuleEnabled` is deliberately loose (any section counts) because
//? the modules share sections — 'scheduled' belongs to development, content AND design — so a content-only
//? workspace would read as "development on". For op-gating we need the strict question, so key on the one
//? section a module cannot be without.
const MODULE_SECTION: Record<WorkspaceModuleId, string> = { development: 'board', content: 'content', design: 'designer', documents: 'documents' };

//? Is this op available in a workspace with these sections on? An op with no module is always available;
//? an empty `enabledSections` is the legacy all-on state (see `isSectionEnabled`).
export function opAvailable(op: ControlOp, enabledSections?: string[], permissions?: boolean[]): boolean {
  const mod = OP_MODULE[op];
  if (mod !== undefined && !isSectionEnabled(enabledSections ?? [], MODULE_SECTION[mod])) return false;
  const capability = OP_CAPABILITY[op];
  return permissions === undefined || capability === null || permissions[capability] === true;
}

export const ENABLED_OPS: ControlOp[] = (Object.keys(PROPOSE_CATALOG) as ControlOp[]).filter((op) => PROPOSE_CATALOG[op].mode === 'enabled');

//? Compact prompt lines for the systemPrompt — one line per enabled op (+ the preset keys the
//? service-provision hint refers to). Grouped output keeps the prompt small (~30 lines).
export function catalogPromptLines(enabledSections?: string[], permissions?: boolean[], ctx?: CatalogCtx, message = ''): string[] {
  //? C4/RBAC/context budget — only list ops this caller can actually run in an enabled module. When a real
  //? request is present, rank by its words and cap the tool slice instead of injecting all ~150 actions into
  //? every turn. Calling with no message preserves the exhaustive corpus used by parity tooling/tests.
  const available = ENABLED_OPS.filter((op) => opAvailable(op, enabledSections, permissions)).filter((op) => {
    if (!ctx) return true;
    return Object.values(PROPOSE_CATALOG[op].params ?? {}).every((param) => !param.required || requiredParamContextExists(param.kind, ctx));
  });
  const requestWords = new Set(message.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
  const ranked = message.trim().length === 0 ? available : available
    .map((op, index) => {
      const text = `${op} ${PROPOSE_CATALOG[op].hint ?? ''}`.toLowerCase();
      let score = 0;
      for (const word of requestWords) if (text.includes(word)) score += 1;
      if (text.includes(message.toLowerCase().trim())) score += 8;
      return { op, score, index };
    })
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 36)
    .map((row) => row.op);
  const lines = ranked.map((op) => {
    const spec = PROPOSE_CATALOG[op];
    return `- ${op}${spec.destructive ? ' [destructive]' : ''}: ${spec.hint ?? ''}`;
  });
  const presets = listServicePresets().map((p) => p.key).join('|');
  lines.push(`Service preset keys: ${presets}`);
  return lines;
}

function requiredParamContextExists(kind: ParamKind, ctx: CatalogCtx): boolean {
  if (kind === 'ticketKey' || kind === 'ticketKeys') return ctx.tickets.length > 0;
  if (kind === 'stageId' || kind === 'stageKeys') return ctx.stages.length > 0;
  if (kind === 'pieceId') return ctx.pieces.length > 0;
  if (kind === 'envId') return ctx.environments.length > 0;
  if (kind === 'serviceName') return ctx.services.length > 0;
  if (kind === 'taskId') return ctx.customTasks.length > 0;
  if (kind === 'triggerId') return ctx.triggers.length > 0;
  if (kind === 'mrId') return ctx.mrs.length > 0;
  if (kind === 'channelId') return ctx.channels.length > 0;
  if (kind === 'skillId') return ctx.skills.length > 0;
  if (kind === 'sprintId') return ctx.sprints.length > 0;
  if (kind === 'memberId') return ctx.members.length > 0;
  if (kind === 'roleKey') return ctx.roles.length > 0;
  if (kind === 'inviteId') return ctx.invites.length > 0;
  if (kind === 'documentId') return ctx.documents.length > 0;
  if (kind === 'migrationId') return ctx.migrations.length > 0;
  if (kind === 'findingId') return ctx.findings.length > 0;
  if (kind === 'referenceId') return ctx.references.length > 0;
  if (kind === 'outputTemplateId') return ctx.outputTemplates.length > 0;
  if (kind === 'styleKey') return ctx.styles.length > 0;
  if (kind === 'sourceId') return ctx.infoSources.length > 0;
  if (kind === 'projectServiceId') return ctx.projectServices.length > 0;
  return true;
}

function checkParam(kind: ParamKind, value: unknown, spec: ParamSpec, ctx: CatalogCtx): unknown {
  if (kind === 'string') return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (kind === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (kind === 'enum') return typeof value === 'string' && (spec.values ?? []).includes(value) ? value : undefined;
  if (kind === 'ticketKey') return typeof value === 'string' && ctx.tickets.some((t) => t.key === value) ? value : undefined;
  //? Parity wave — an ARRAY of existing ticket keys (bulk-status/bulk-sprint/bulk-archive); one dangling
  //? key rejects the whole array (same all-or-nothing rule as stageKeys).
  if (kind === 'ticketKeys') {
    if (!Array.isArray(value)) return undefined;
    const keys = value.filter((v): v is string => typeof v === 'string');
    return keys.length > 0 && keys.every((k) => ctx.tickets.some((t) => t.key === k)) ? keys : undefined;
  }
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
  //? Parity wave — the remaining id-ref kinds, each against its own ctx collection.
  if (kind === 'sprintId') return typeof value === 'string' && ctx.sprints.some((s) => s.id === value) ? value : undefined;
  if (kind === 'memberId') return typeof value === 'string' && ctx.members.some((m) => m.id === value) ? value : undefined;
  if (kind === 'roleKey') return typeof value === 'string' && ctx.roles.some((r) => r.key === value) ? value : undefined;
  if (kind === 'inviteId') return typeof value === 'string' && ctx.invites.some((i) => i.id === value) ? value : undefined;
  if (kind === 'documentId') return typeof value === 'string' && ctx.documents.some((d) => d.id === value) ? value : undefined;
  if (kind === 'migrationId') return typeof value === 'string' && ctx.migrations.some((m) => m.id === value) ? value : undefined;
  if (kind === 'findingId') return typeof value === 'string' && ctx.findings.some((f) => f.id === value) ? value : undefined;
  if (kind === 'referenceId') return typeof value === 'string' && ctx.references.some((r) => r.id === value) ? value : undefined;
  if (kind === 'outputTemplateId') return typeof value === 'string' && ctx.outputTemplates.some((t) => t.id === value) ? value : undefined;
  if (kind === 'styleKey') return typeof value === 'string' && ctx.styles.some((s) => s.key === value) ? value : undefined;
  if (kind === 'sourceId') return typeof value === 'string' && ctx.infoSources.some((s) => s.id === value) ? value : undefined;
  if (kind === 'projectServiceId') return typeof value === 'string' && ctx.projectServices.some((s) => s.id === value) ? value : undefined;
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
  if (!opAvailable(typedOp, ctx.enabledSections, ctx.permissions)) return null;
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
