//? X1 (UNIVERSAL_TOOL Fase A / COMPLETION Fase X) — the generic propose-safe op-catalog.
//? Locks down: (1) the catalog exhaustively classifies EVERY ControlOp (drift-guard vs OP_CAPABILITY);
//? (2) the server-side enabled tranche is in LOCKSTEP with the client CHAT_ENABLED_OPS/dispatch map;
//? (3) generic validation only passes catalog-enabled ops with type-checked params whose workspace
//? references (ticketKey/stageId/pieceId/envId/serviceName/preset) actually exist; (4) destructive
//? flags are carried; (5) the legacy 5-op rich path is untouched and excluded ops stay unreachable.

import { assert, eq, report } from '../_helpers.mts';
import { PROPOSE_CATALOG, ENABLED_OPS, catalogPromptLines, validateGenericAction } from '../../server/ai/opCatalog';
import { OP_CAPABILITY } from '../../server/control/rbac';
import { CHAT_ENABLED_OPS, isChatEnabledOp } from '../../src/workspaces/_data/chatOps';
import { validateChatAction, validatePlan, type Ctx } from '../../server/ai/workspaceChat';
import type { ControlOp } from '../../src/workspaces/_functions/controlApi';

const ctx: Ctx = {
  projectId: 'project-a',
  projectName: 'Project A',
  tickets: [{ key: 'DEV-1', title: 'Existing', stageId: 'unrefined' }],
  stages: [{ id: 'unrefined', name: 'Unrefined' }, { id: 'refined', name: 'Refined' }],
  members: [{ id: 'u1', name: 'Alice' }],
  pieces: [{ id: 'p1', title: 'Launch video', stageId: 'idea' }],
  environments: [{ id: 'e1', kind: 'dev', status: 'live' }],
  services: [{ name: 'events', status: 'running' }],
  customTasks: [{ id: 'task1', name: 'Weekly summary' }],
  triggers: [{ id: 'trig1', name: 'Nightly CI' }],
  mrs: [{ id: 'mr1', ticketKey: 'DEV-1', title: 'Login MR' }],
  channels: [{ id: 'ch1', name: 'Main' }],
  skills: [{ id: 'skill1', name: 'SEO', enabled: true }],
  //? Parity wave — the reference collections the newly-enabled tranche validates against.
  documents: [{ id: 'doc1', title: 'Handbook', status: 'ready' }],
  documentTemplates: [{ slug: 'tpl-spec', name: 'Spec' }],
  sprints: [{ id: 'spr1', name: 'Sprint 1' }],
  invites: [{ id: 'inv1', email: 'jan@example.com', role: 'member' }],
  findings: [{ id: 'find1', title: 'Slow page' }],
  uiReviews: [{ id: 'rev1', page: 'board', status: 'open' }],
  styles: [{ key: 'noir', name: 'Noir' }],
  outputTemplates: [{ id: 'tmpl1', name: 'Square' }],
  references: [{ id: 'ref1', kind: 'ad', title: 'Nike ad' }],
  commentInbox: { unread: 0, total: 0 },
  roles: [{ key: 'member', label: 'Member' }],
  infoSources: [{ id: 'src1', name: 'Deploy checklist', enabled: true }],
  projectServices: [{ id: 'svc1', name: 'api' }],
  migrations: [{ id: 'mig1', name: 'add-users', envKind: 'dev' }],
  projectFacts: { repoLinked: false, stack: 'unknown', framework: '', dependencies: [], databases: [], deployTargets: [], envKeys: [], ciPipelines: [] },
  enabledSections: [],
};

try {
  // ---- (1) exhaustiveness vs the ControlOp union (via the OP_CAPABILITY reference matrix)
  const capOps = Object.keys(OP_CAPABILITY).sort();
  const catOps = Object.keys(PROPOSE_CATALOG).sort();
  eq(catOps.length, capOps.length, 'catalog covers exactly as many ops as OP_CAPABILITY');
  assert(capOps.every((op, i) => catOps[i] === op), 'catalog keyset matches the ControlOp surface 1:1');

  // ---- (2) server↔client tranche lockstep
  const serverEnabled = [...ENABLED_OPS].sort();
  const clientEnabled = [...CHAT_ENABLED_OPS].sort();
  eq(serverEnabled.length, clientEnabled.length, `enabled tranche same size on both sides (${String(serverEnabled.length)})`);
  assert(serverEnabled.every((op, i) => clientEnabled[i] === op), 'server ENABLED_OPS ≡ client CHAT_ENABLED_OPS (lockstep)');
  assert(CHAT_ENABLED_OPS.every((op) => isChatEnabledOp(op)), 'the client type-guard accepts its own tranche');
  assert(!isChatEnabledOp('save-env'), 'the client type-guard rejects a non-tranche op');

  // ---- (3) secret-bearing + plumbing ops are EXCLUDED (never proposable via chat)
  for (const op of ['save-env', 'save-integration', 'save-media-provider', 'gitlab-settings', 'forge-connect', 'db-connect', 'account-disconnect', 'accept-suggestion', 'mark-read', 'project-runtime-save'] as const) {
    eq(PROPOSE_CATALOG[op].mode, 'excluded', `${op} is excluded from the chat surface`);
    eq(validateGenericAction({ op }, ctx), null, `${op} never validates as a generic proposal`);
  }

  // ---- (4) generic validation: happy paths with real references
  const prov = validateGenericAction({ op: 'service-provision', name: 'queue', preset: 'kafka' }, ctx);
  assert(prov !== null && prov.op === 'service-provision', 'service-provision with a known preset validates');
  eq(prov?.projectId, ctx.projectId, 'generic proposals carry active-project provenance');
  eq(prov?.params?.name, 'queue', 'the stack name is carried in params');
  eq(validateGenericAction({ op: 'service-provision', name: 'queue', preset: 'nope' }, ctx), null, 'an unknown preset key is rejected');
  eq(validateGenericAction({ op: 'service-provision', name: 'queue' }, ctx), null, 'a missing required param is rejected');

  const down = validateGenericAction({ op: 'service-teardown', name: 'events' }, ctx);
  assert(down !== null && down.destructive === true, 'service-teardown validates against a REAL stack + carries destructive');
  eq(validateGenericAction({ op: 'service-teardown', name: 'ghost' }, ctx), null, 'teardown of a non-existent stack is rejected');

  const pauseT = validateGenericAction({ op: 'pause', ticketKey: 'DEV-1' }, ctx);
  assert(pauseT !== null, 'pause with an existing ticketKey validates');
  eq(validateGenericAction({ op: 'pause', ticketKey: 'DEV-99' }, ctx), null, 'a dangling ticketKey is rejected');

  const reorder = validateGenericAction({ op: 'stage-reorder', order: ['refined', 'unrefined'] }, ctx);
  assert(reorder !== null && Array.isArray(reorder.params?.order), 'stage-reorder with existing stage keys validates');
  eq(validateGenericAction({ op: 'stage-reorder', order: ['refined', 'ghost'] }, ctx), null, 'reorder naming an unknown stage is rejected');

  const run = validateGenericAction({ op: 'content-run-pipeline', pieceId: 'p1', durationMs: 60000 }, ctx);
  assert(run !== null, 'content-run-pipeline with a real pieceId validates');
  assert((run?.summary ?? '').includes('Launch video'), 'the summary names the piece title, not just the id');
  eq(validateGenericAction({ op: 'content-run-pipeline', pieceId: 'ghost' }, ctx), null, 'a dangling pieceId is rejected');
  eq(validateGenericAction({ op: 'content-run-pipeline', pieceId: 'p1', durationMs: 'sixty' }, ctx)?.params?.durationMs, undefined, 'a wrong-typed optional param is dropped, not carried');

  const promote = validateGenericAction({ op: 'env-promote', fromKind: 'dev' }, ctx);
  assert(promote !== null && promote.destructive === true, 'env-promote validates + is destructive');
  eq(validateGenericAction({ op: 'env-promote', fromKind: 'prod' }, ctx), null, 'an out-of-enum value is rejected');
  const redOverride = validateGenericAction({ op: 'ci-allow-red', enabled: true }, ctx);
  assert(redOverride !== null && redOverride.params?.enabled === true, 'boolean params validate');

  //? Extra undeclared fields are DROPPED (the model cannot smuggle payload past the spec).
  const teardownExtra = validateGenericAction({ op: 'env-teardown', envId: 'e1', rmVolumes: true }, ctx);
  assert(teardownExtra !== null && !('rmVolumes' in (teardownExtra.params ?? {})), 'undeclared fields are stripped from params');

  //? There is no ambiguous `later` bucket left. Duplicate aliases, full-state timeline replacements and
  //? cross-workspace operations are explicitly excluded; the one safe missing effect is dispatchable.
  for (const op of ['content-create', 'content-save-scenes', 'copy-workspace-assets'] as const) {
    eq(PROPOSE_CATALOG[op].mode, 'excluded', `${op} is consciously excluded from chat`);
    eq(validateGenericAction({ op }, ctx), null, `${op} cannot enter a chat proposal`);
  }
  const migrationApply = validateGenericAction({ op: 'db-migrate-apply', migrationId: 'mig1' }, ctx);
  assert(migrationApply !== null && migrationApply.destructive === true, 'a real pending migration is proposable behind destructive confirmation');
  eq(validateGenericAction({ op: 'db-migrate-apply', migrationId: 'missing' }, ctx), null, 'a dangling migration id is rejected');

  // ---- (5) the chat entry point: legacy rich path intact, generic path reachable behind it
  assert(validateChatAction({ op: 'bulk-move', ticketKeys: ['DEV-1'], stageId: 'refined' }, ctx) !== null, 'legacy bulk-move still validates via the rich path');
  assert(validateChatAction({ op: 'create-ticket', title: 'Add login' }, ctx) !== null, 'legacy create-ticket still validates');
  const viaChat = validateChatAction({ op: 'pause-all' }, ctx);
  assert(viaChat !== null && viaChat.destructive === true, 'a generic op now validates through validateChatAction');
  eq(validateChatAction({ op: 'delete-everything' }, ctx), null, 'an unknown op still rejects (no invented verbs)');
  //? Plans can mix legacy + generic steps (each step revalidates individually).
  const plan = validatePlan({ summary: 'Ship it', steps: [
    { op: 'create-ticket', title: 'Fix the bug' },
    { op: 'ci-run', ticketKey: 'DEV-1' },
  ] }, ctx);
  assert(plan !== null && plan.steps.length === 2, 'a mixed legacy+generic plan validates');

  // ---- (5b) parity wave — every newly-enabled op validates with GOOD refs and degrades to null
  //? on a dangling/invalid ref. `bad` is null for ops whose params are all-optional scalars (nothing
  //? can dangle — the dispatcher no-ops on an empty payload instead).
  const wave: [ControlOp, Record<string, unknown>, Record<string, unknown> | null][] = [
    // board / sprints / ticket-artifact links
    ['archive', { ticketKey: 'DEV-1' }, { ticketKey: 'DEV-99' }],
    ['bulk-status', { ticketKeys: ['DEV-1'], status: 'done' }, { ticketKeys: ['DEV-1', 'DEV-99'], status: 'done' }],
    ['bulk-sprint', { ticketKeys: ['DEV-1'], sprintId: 'spr1' }, { ticketKeys: ['DEV-99'], sprintId: 'spr1' }],
    ['bulk-archive', { ticketKeys: ['DEV-1'] }, { ticketKeys: [] }],
    ['sprint-create', { name: 'Sprint 2' }, {}],
    ['sprint-edit', { sprintId: 'spr1', name: 'Renamed' }, { sprintId: 'ghost' }],
    ['ticket-link-artifact', { ticketKey: 'DEV-1', artifactId: 'art1', artifactKind: 'design' }, { ticketKey: 'DEV-1', artifactId: 'art1', artifactKind: 'bogus' }],
    ['ticket-unlink-artifact', { linkId: 'link1' }, {}],
    // members / roles / workspace lifecycle
    ['invite', { email: 'piet@example.com', roleKey: 'member' }, { email: 'piet@example.com', roleKey: 'ghost' }],
    ['revoke-invite', { inviteId: 'inv1' }, { inviteId: 'ghost' }],
    ['change-role', { memberId: 'u1', roleKey: 'member' }, { memberId: 'ghost', roleKey: 'member' }],
    ['remove-member', { memberId: 'u1' }, { memberId: 'ghost' }],
    ['role-create', { name: 'Reviewer' }, {}],
    ['role-update', { roleKey: 'member', label: 'Teamlid' }, { roleKey: 'ghost', label: 'X' }],
    ['rename-workspace', { name: 'New name' }, {}],
    ['transfer-ownership', { memberId: 'u1' }, { memberId: 'ghost' }],
    ['delete-workspace', {}, null],
    // documents + templates
    ['document-create', { title: 'Doc' }, {}],
    ['document-edit', { documentId: 'doc1', title: 'X' }, { documentId: 'ghost' }],
    ['document-delete', { documentId: 'doc1' }, { documentId: 'ghost' }],
    ['document-ai', { documentId: 'doc1', mode: 'rewrite' }, { documentId: 'ghost' }],
    ['document-apply-draft', { documentId: 'doc1' }, { documentId: 'ghost' }],
    ['document-discard-draft', { documentId: 'doc1' }, { documentId: 'ghost' }],
    ['document-gen-image', { documentId: 'doc1', prompt: 'a cat' }, { documentId: 'doc1' }],
    ['document-export', { documentId: 'doc1', format: 'pdf' }, { documentId: 'doc1', format: 'exe' }],
    ['document-restore-revision', { documentId: 'doc1', revisionId: 'rev1' }, { documentId: 'ghost', revisionId: 'rev1' }],
    ['doc-template-save', { name: 'Spec', sections: 'Intro::what||Scope' }, { name: 'Spec' }],
    ['doc-template-delete', { slug: 'tpl-spec' }, {}],
    // content lane
    ['content-request-publish', { pieceId: 'p1', assetId: 'a1', platform: 'youtube' }, { pieceId: 'ghost', assetId: 'a1', platform: 'youtube' }],
    ['content-unpublish', { pieceId: 'p1', assetId: 'a1', platform: 'youtube' }, { pieceId: 'ghost', assetId: 'a1', platform: 'youtube' }],
    ['content-import-asset', { pieceId: 'p1', url: 'https://x/y.mp4', kind: 'video' }, { pieceId: 'p1', url: 'https://x/y.mp4', kind: 'gifje' }],
    ['content-inpaint', { pieceId: 'p1', referenceUrl: 'https://x/a.png', maskUrl: 'https://x/m.png', prompt: 'sunset', parentAssetId: 'a1' }, { pieceId: 'p1', referenceUrl: 'https://x/a.png', maskUrl: 'https://x/m.png', prompt: 'sunset' }],
    ['content-transcode', { pieceId: 'p1', assetId: 'a1', format: 'gif' }, { pieceId: 'p1', assetId: 'a1', format: 'avi' }],
    ['content-decompose-video', { pieceId: 'p1' }, { pieceId: 'ghost' }],
    ['content-refine-range', { pieceId: 'p1', startMs: 0, endMs: 5000, instruction: 'slower' }, { pieceId: 'p1', startMs: 0, endMs: 5000 }],
    ['content-save-audio-mix', { pieceId: 'p1', voiceVolume: 1, musicVolume: 0.3 }, { pieceId: 'p1', voiceVolume: 1 }],
    ['content-trim-audio', { pieceId: 'p1', assetId: 'a1', startMs: 2000, endMs: 14000 }, { pieceId: 'p1', assetId: 'a1', startMs: 2000 }],
    ['content-gen-reference-image', { pieceId: 'p1', referenceUrl: 'https://x/img.png' }, { pieceId: 'ghost', referenceUrl: 'https://x/img.png' }],
    ['content-analyze-reference-video', { pieceId: 'p1', referenceVideoUrl: 'https://x/v.mp4', newStory: 'about us' }, { pieceId: 'p1', referenceVideoUrl: 'https://x/v.mp4' }],
    // merge requests + monorepo services
    ['mr-create', { ticketKey: 'DEV-1' }, { ticketKey: 'DEV-99' }],
    ['mr-comment', { ticketKey: 'DEV-1', mrId: 'mr1', body: 'nice' }, { ticketKey: 'DEV-1', mrId: 'ghost', body: 'nice' }],
    ['mr-approve', { ticketKey: 'DEV-1', mrId: 'mr1' }, { ticketKey: 'DEV-1', mrId: 'ghost' }],
    ['mr-merge', { ticketKey: 'DEV-1', mrId: 'mr1' }, { ticketKey: 'DEV-1', mrId: 'ghost' }],
    ['mr-resolve', { ticketKey: 'DEV-1', threadId: 't1' }, { ticketKey: 'DEV-99', threadId: 't1' }],
    ['service-create', { name: 'api' }, {}],
    ['service-delete', { serviceId: 'svc1' }, { serviceId: 'ghost' }],
    // automation + skills + knowledge intake
    ['trigger-save', { triggerId: 'trig1', cron: '0 0 * * *' }, null],
    ['trigger-toggle', { triggerId: 'trig1', enabled: false }, { triggerId: 'ghost', enabled: true }],
    ['trigger-delete', { triggerId: 'trig1' }, { triggerId: 'ghost' }],
    ['skill-toggle', { sourceId: 'src1', on: false }, { sourceId: 'ghost', on: true }],
    ['ai-skill-delete', { skillId: 'skill1' }, { skillId: 'ghost' }],
    ['create-info-source', { name: 'notes.md', content: '# hi' }, { name: 'notes.md' }],
    ['link-repo', { gitUrl: 'https://github.com/x/y.git' }, {}],
    // settings + budgets
    ['save-sections', { enabledSections: 'board,content' }, {}],
    ['save-ai-instruction', { aiInstruction: 'be terse' }, null],
    ['save-ai-provider', { feature: 'mr-review', providerId: 'gemini-api' }, { feature: 'coding-agent', providerId: 'gemini-api' }],
    ['save-autonomy', { autonomyLevel: 'full-auto' }, { autonomyLevel: 'yolo' }],
    ['save-stage-config', { stageId: 'refined', name: 'Refined 2' }, { stageId: 'ghost' }],
    ['edit-budget', { cap: 50 }, null],
    ['resume-spend', {}, null],
    ['edit-media-budget', { capCents: 2500 }, null],
    // inbox / findings / ui-review / styles / references / tasks / output templates / design tokens
    ['comments-refresh', {}, null],
    ['comments-mark-read', {}, null],
    ['finding-to-ticket', { findingId: 'find1' }, { findingId: 'ghost' }],
    ['finding-dismiss', { findingId: 'find1' }, { findingId: 'ghost' }],
    ['ui-review-create', { problems: 'contrast,spacing' }, {}],
    ['delete-style', { feature: 'image-gen', key: 'noir' }, { feature: 'image-gen', key: 'ghost' }],
    ['reference-delete', { referenceId: 'ref1' }, { referenceId: 'ghost' }],
    ['delete-custom-task', { taskId: 'task1' }, { taskId: 'ghost' }],
    ['save-output-template', { name: 'Square' }, null],
    ['delete-output-template', { templateId: 'tmpl1' }, { templateId: 'ghost' }],
    ['apply-design-tokens', {}, null],
  ];
  for (const [op, good, bad] of wave) {
    const okProposal = validateGenericAction({ op, ...good }, ctx);
    assert(okProposal !== null && okProposal.op === op, `${op} validates with real refs`);
    eq(okProposal?.destructive === true, PROPOSE_CATALOG[op].destructive === true, `${op} carries its catalog destructive flag`);
    eq(okProposal?.projectId, ctx.projectId, `${op} carries active-project provenance`);
    if (bad !== null) eq(validateGenericAction({ op, ...bad }, ctx), null, `${op} degrades to null on a dangling/invalid ref`);
  }
  eq(new Set(wave.map(([op]) => op)).size, wave.length, 'the wave table lists each newly-enabled op exactly once');

  // ---- (6) prompt lines render one line per enabled op + the preset key list
  const lines = catalogPromptLines();
  eq(lines.length, ENABLED_OPS.length + 1, 'one prompt line per enabled op + the preset-keys line');
  assert(lines.some((l) => l.includes('[destructive]')), 'destructive ops are flagged in the prompt');
  assert(lines[lines.length - 1]?.includes('kafka'), 'the preset-keys line names the curated presets');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/opCatalogParity.test.mts');
