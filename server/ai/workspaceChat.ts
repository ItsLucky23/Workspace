//? Workspace-AI chat interpreter (feature `workspace-chat`). Turns a natural-language
//? message into EITHER a plain reply OR a single PROPOSED control-op the user then
//? accepts — the AI never writes directly (the Conductor stays the only writer). Runs
//? through the pluggable provider layer (`runAiCompletion`), so which AI backs the chat
//? is a per-feature config choice (see ai-provider-abstraction). The AI's JSON is
//? VALIDATED against the workspace's real tickets/stages before it can become a proposal.

import { tryCatch, tryCatchSync } from '@luckystack/core';
import { runAiCompletion } from './registry';
import type { PrismaClient } from '@prisma/client';
//? PROJECT FACTS — the repo's package.json + linked-state come from the EXISTING repoStore loaders
//? (bare-clone reads, no checkout, no new git plumbing here).
import { isLinked, showRepoFile } from '../git/repoStore';
import { retrieve } from '../rag/index';
import { retrieveMemory } from '../rag/memory';
import { retrieveProductKnowledge } from '../rag/productKnowledge';
import { renderUntrustedContext, UNTRUSTED_CONTEXT_POLICY } from './untrustedContext';
//? R3-b — repos are per-(workspace,project); the code-RAG must be scoped to the ACTIVE project
//? or the chat grounds on whichever project indexed last (answering about the wrong codebase).
import { resolveProjectId } from '../orchestrator/projectResolve';
//? X1 — the generic op-catalog: every catalog-enabled control-op becomes proposable (still
//? propose→accept→Conductor; destructive ops carry an extra client confirm).
import { catalogPromptLines, validateGenericAction } from './opCatalog';
//? The proposal shape is shared with the client (it crosses the aiChat API boundary).
import type { ChatProposal, ChatPlan } from '../../src/workspaces/_data/types';
//? #109 — the copilot nav allowlist derives from the nav category map (pure constants, server-safe import
//? — same pattern as opCatalog's `modules.ts` import) so every real view is a valid nav target.
import { VIEW_CATEGORY } from '../../src/workspaces/_data/nav';

export interface ChatResult {
  reply: string;
  proposal: ChatProposal | null;
  plan?: ChatPlan | null;
  //? #109 — an AI-drives-UI directive: navigate the user to a page + optional form pre-fill hints.
  copilot?: { navigate: string; note: string; prefill?: Record<string, string> } | null;
  error?: string;
}

//? #109 — the KNOWN nav targets a copilot directive may point at (a WsView id or a piece/settings sub-route).
//? Parity wave: DERIVED from the nav category map (every categorized view) + the flat category-less views,
//? so a newly added page is navigable the moment it lands in `nav.ts` — no second hardcoded list to drift.
const COPILOT_NAV_TARGETS: string[] = [...Object.keys(VIEW_CATEGORY), 'content/settings', 'ai', 'settings', 'workspace'];
const COPILOT_NAV = new Set(COPILOT_NAV_TARGETS);

//? #109 — validate a model-proposed copilot directive: a known nav target + a note, with string-only prefill
//? hints. Rejects to null (the turn degrades to a plain reply) — never invents a route.
export function validateCopilot(raw: unknown): { navigate: string; note: string; prefill?: Record<string, string> } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const navigate = typeof r.navigate === 'string' ? r.navigate.trim() : '';
  if (!COPILOT_NAV.has(navigate)) return null;
  const note = typeof r.note === 'string' && r.note.trim().length > 0 ? r.note.trim() : '';
  if (note.length === 0) return null;
  const prefill: Record<string, string> = {};
  if (r.prefill !== null && typeof r.prefill === 'object' && !Array.isArray(r.prefill)) {
    for (const [k, v] of Object.entries(r.prefill as Record<string, unknown>)) if (typeof v === 'string') prefill[k] = v;
  }
  return { navigate, note, ...(Object.keys(prefill).length > 0 ? { prefill } : {}) };
}

export interface Ctx {
  //? Every proposal is bound to this validated project. The client rejects it once
  //? another project becomes active, so a delayed Accept cannot target stale state.
  projectId: string;
  projectName: string;
  tickets: { key: string; title: string; stageId: string }[];
  stages: { id: string; name: string }[];
  members: { id: string; name: string }[];
  //? X1 (A3-slice) — the generic ops reference content pieces, environments and service stacks,
  //? so the model gets (and the validator checks against) the real ids/names, not guesses.
  pieces: { id: string; title: string; stageId: string }[];
  environments: { id: string; kind: string; status: string }[];
  services: { name: string; status: string }[];
  //? #86 — the workspace's user-defined custom AI tasks, so the AI can propose running one by id.
  customTasks: { id: string; name: string }[];
  //? #86 — the workspace's automation triggers, so the AI can propose running one on demand by id.
  triggers: { id: string; name: string }[];
  //? #54 — the workspace's open merge requests (id + the ticket key they belong to) so the AI can
  //? propose an MR review or rollback.
  mrs: { id: string; ticketKey: string; title: string }[];
  //? #150 — the workspace's publishing channels so the AI can propose setting a channel's brand voice.
  channels: { id: string; name: string }[];
  //? C3 — the workspace's AI skills, so "turn on the SEO skill" resolves to a real skill id.
  skills: { id: string; name: string; enabled: boolean }[];
  //? Parity wave — the remaining reference collections upcoming proposal validation grounds on
  //? (compact id/name pairs; same capped-list pattern as the fields above).
  documents: { id: string; title: string; status: string }[];
  documentTemplates: { slug: string; name: string }[];
  sprints: { id: string; name: string }[];
  invites: { id: string; email: string; role: string }[];
  findings: { id: string; title: string }[];
  uiReviews: { id: string; page: string; status: string }[];
  styles: { key: string; name: string }[];
  outputTemplates: { id: string; name: string }[];
  references: { id: string; kind: string; title: string }[];
  commentInbox: { unread: number; total: number };
  //? Parity wave — RBAC roles (invite/change-role/role-update name a roleKey), the Sources-page
  //? workflow-snippet skills (skill-toggle) and the project's monorepo services (service-delete).
  roles: { key: string; label: string }[];
  infoSources: { id: string; name: string; enabled: boolean }[];
  projectServices: { id: string; name: string }[];
  migrations: { id: string; name: string; envKind: string }[];
  //? Parity wave — structured facts about the ACTIVE project so "is X possible with this project?"
  //? is answerable from real state. envKeys carries KEY NAMES ONLY — values never enter a prompt.
  projectFacts: ProjectFacts;
  //? C4 — which modules this workspace runs; ops of a disabled module are neither listed nor validated.
  enabledSections: string[];
  //? Effective positional WorkspaceRole permissions for the caller. Undefined is retained only for
  //? internal/live compatibility; the production chat route always supplies userId.
  permissions?: boolean[];
}

export interface ProjectFacts {
  repoLinked: boolean;
  stack: string;
  framework: string;
  dependencies: { name: string; version: string }[];
  databases: { name: string; kind: string; envKind: string }[];
  deployTargets: { kind: string; route: string; status: string }[];
  envKeys: string[];
  ciPipelines: { stages: string[]; enabled: boolean }[];
}

//? Framework detection from package.json dep names — most-specific first (a Next app also depends
//? on react; @luckystack apps also depend on react). Display labels, not package names.
const FRAMEWORK_DEPS: [string, string][] = [
  ['next', 'next'], ['nuxt', 'nuxt'], ['@angular/core', 'angular'], ['@sveltejs/kit', 'sveltekit'],
  ['svelte', 'svelte'], ['@nestjs/core', 'nestjs'], ['@remix-run/react', 'remix'], ['astro', 'astro'],
  ['@luckystack/core', 'luckystack'], ['vue', 'vue'], ['react', 'react'], ['express', 'express'], ['fastify', 'fastify'],
];

//? Typed [name, version] pairs out of a package.json dependency map (unknown-shaped by design).
function depEntries(v: unknown): [string, string][] {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string');
}

export async function loadCtx(prisma: PrismaClient, workspaceId: string, projectId: string, userId?: string): Promise<Ctx | null> {
  //? An explicit active project is mandatory. resolveProjectId validates both ObjectId
  //? shape and workspace ownership and never falls through when the supplied id is stale.
  const activeProjectId = await resolveProjectId(prisma, workspaceId, projectId);
  if (!activeProjectId) return null;
  const project = await prisma.project.findFirst({ where: { workspaceId, id: activeProjectId }, select: { name: true, stack: true } });
  if (!project) return null;

  const [tickets, stages, memberRows, pieces, environments, services, customTasks, triggers, mrRows, channels, skills, wsRow] = await Promise.all([
    //? Parity wave: 60→40 — the state text has a hard 12k slice; the cap is trimmed here rather than
    //? letting the added reference lists push the tail of the text past the budget.
    prisma.ticket.findMany({ where: { workspaceId, projectId: activeProjectId, archived: false }, select: { key: true, title: true, stageId: true }, take: 40, orderBy: { lastActivityAt: 'desc' } }),
    prisma.pipelineStage.findMany({ where: { workspaceId, projectId: activeProjectId }, select: { key: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, roleKey: true }, take: 40 }),
    prisma.contentProject.findMany({ where: { workspaceId, projectId: activeProjectId, archived: false }, select: { id: true, title: true, stageId: true }, take: 30, orderBy: { updatedAt: 'desc' } }),
    prisma.environment.findMany({ where: { workspaceId, projectId: activeProjectId }, select: { id: true, kind: true, status: true, route: true }, take: 12 }),
    prisma.serviceStack.findMany({ where: { workspaceId }, select: { name: true, status: true }, take: 12 }),
    prisma.customAiTask.findMany({ where: { workspaceId }, select: { id: true, name: true }, take: 30 }),
    prisma.workspaceTrigger.findMany({ where: { workspaceId }, select: { id: true, name: true }, take: 30 }),
    prisma.mergeRequest.findMany({ where: { workspaceId, projectId: activeProjectId, status: { in: ['open', 'conflict', 'merged'] } }, select: { id: true, title: true, ticketId: true }, take: 20, orderBy: { createdAt: 'desc' } }),
    prisma.channel.findMany({ where: { workspaceId, projectId: activeProjectId }, select: { id: true, name: true }, take: 30 }),
    prisma.skill.findMany({ where: { workspaceId }, select: { id: true, name: true, enabled: true }, take: 40 }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { enabledSections: true } }),
  ]);
  //? Parity wave — the remaining reference collections + the project-facts sources, same
  //? tenant-scoped/capped pattern as the batch above (small caps: the state text has a 12k budget).
  const [documents, docTemplates, sprints, inviteRows, findings, uiReviews, styleRows, outputTemplates, referenceRows, unreadComments, totalComments, dbConns, envVarRows, pipelines, roleRows, infoSourceRows, projectServiceRows, migrations] = await Promise.all([
    prisma.document.findMany({ where: { workspaceId, archived: false }, select: { id: true, title: true, aiDraft: true }, take: 20, orderBy: { updatedAt: 'desc' } }),
    prisma.documentTemplate.findMany({ where: { workspaceId }, select: { slug: true, name: true }, take: 12 }),
    prisma.sprint.findMany({ where: { workspaceId, projectId: activeProjectId }, select: { id: true, name: true }, take: 10, orderBy: { createdAt: 'desc' } }),
    prisma.invite.findMany({ where: { workspaceId, status: 'pending' }, select: { id: true, email: true, roleKey: true }, take: 10 }),
    prisma.interviewFinding.findMany({ where: { workspaceId, status: 'open' }, select: { id: true, title: true }, take: 15, orderBy: { createdAt: 'desc' } }),
    //? projectId is null on legacy/unscoped review requests — include both for the active project.
    prisma.uiReviewRequest.findMany({ where: { workspaceId, status: 'open', OR: [{ projectId: activeProjectId }, { projectId: null }] }, select: { id: true, page: true, status: true }, take: 10, orderBy: { createdAt: 'desc' } }),
    //? workspaceId null = global builtin style presets — both are pickable in this workspace.
    prisma.stylePreset.findMany({ where: { OR: [{ workspaceId }, { workspaceId: null }] }, select: { key: true, label: true }, take: 24 }),
    prisma.outputTemplate.findMany({ where: { workspaceId }, select: { id: true, name: true }, take: 12 }),
    prisma.referenceExample.findMany({ where: { workspaceId }, select: { id: true, kind: true, title: true }, take: 15, orderBy: { createdAt: 'desc' } }),
    prisma.socialComment.count({ where: { workspaceId, read: false } }),
    prisma.socialComment.count({ where: { workspaceId } }),
    prisma.dbConnection.findMany({ where: { workspaceId, projectId: activeProjectId }, select: { name: true, kind: true, envKind: true }, take: 8 }),
    //? KEY NAMES ONLY — the value column (plaintext or encrypted) is never selected.
    prisma.envVar.findMany({ where: { workspaceId }, select: { key: true }, take: 40, orderBy: { key: 'asc' } }),
    prisma.pipeline.findMany({ where: { workspaceId, projectId: activeProjectId }, select: { stages: true, enabled: true }, take: 5 }),
    //? Parity wave — roles (roleKey refs), canonical workflow capabilities (skill-toggle) and the
    //? project's monorepo Service rows (service-delete) — same tenant-scoped/capped pattern.
    prisma.workspaceRole.findMany({ where: { workspaceId }, select: { key: true, label: true, perms: true }, take: 12 }),
    prisma.skill.findMany({ where: { workspaceId, skillType: 'capability', OR: [{ projectId: activeProjectId }, { projectId: null }] }, select: { id: true, name: true, enabled: true }, take: 20 }),
    prisma.service.findMany({ where: { workspaceId, projectId: activeProjectId }, select: { id: true, name: true }, take: 12 }),
    prisma.migration.findMany({ where: { workspaceId, projectId: activeProjectId, status: 'pending' }, select: { id: true, name: true, envKind: true }, take: 12, orderBy: { createdAt: 'desc' } }),
  ]);
  //? PROJECT FACTS — package.json straight from the bare clone via the existing repoStore loader
  //? (best-effort: '' when unlinked/absent; parse failure degrades to no dependency facts).
  const repoLinked = isLinked(workspaceId, activeProjectId);
  const [, pkgRaw] = await tryCatch(() => showRepoFile(workspaceId, activeProjectId, 'HEAD', 'package.json'));
  const [, pkgParsed] = tryCatchSync(() => JSON.parse(pkgRaw ?? '') as unknown);
  const pkg = (pkgParsed !== null && typeof pkgParsed === 'object' && !Array.isArray(pkgParsed)) ? pkgParsed as Record<string, unknown> : null;
  const dependencies = [...depEntries(pkg?.dependencies), ...depEntries(pkg?.devDependencies)].slice(0, 40).map(([name, version]) => ({ name, version }));
  const depNames = new Set(dependencies.map((d) => d.name));
  const framework = FRAMEWORK_DEPS.find(([dep]) => depNames.has(dep))?.[1] ?? '';
  //? WorkspaceMember stores only userId (no User relation) — resolve names separately.
  const users = await prisma.user.findMany({ where: { id: { in: memberRows.map((m) => m.userId) } }, select: { id: true, name: true } });
  //? Authorization must never depend on the display-list cap above: a valid member beyond the first 40
  //? still gets their exact role, while an absent membership receives no proposal capabilities.
  const actorMembership = userId
    ? await prisma.workspaceMember.findFirst({ where: { workspaceId, userId }, select: { roleKey: true } })
    : null;
  const actorRole = actorMembership
    ? await prisma.workspaceRole.findFirst({ where: { workspaceId, key: actorMembership.roleKey }, select: { perms: true } })
    : null;
  //? #54 — resolve each open MR's ticket KEY (the chat + mrAction reference the DEV-#### key, not the id).
  const mrTicketKeys = await prisma.ticket.findMany({ where: { workspaceId, projectId: activeProjectId, id: { in: mrRows.map((m) => m.ticketId) } }, select: { id: true, key: true } });
  const keyByTicketId = new Map(mrTicketKeys.map((t) => [t.id, t.key]));
  return {
    projectId: activeProjectId,
    projectName: project.name,
    tickets: tickets.map((t) => ({ key: t.key, title: t.title, stageId: t.stageId })),
    stages: stages.map((s) => ({ id: s.key, name: s.name })),
    members: users.map((u) => ({ id: u.id, name: u.name ?? u.id })),
    pieces: pieces.map((p) => ({ id: p.id, title: p.title, stageId: p.stageId })),
    environments: environments.map((e) => ({ id: e.id, kind: e.kind, status: e.status })),
    services: services.map((s) => ({ name: s.name, status: s.status })),
    customTasks: customTasks.map((t) => ({ id: t.id, name: t.name })),
    triggers: triggers.map((t) => ({ id: t.id, name: t.name })),
    mrs: mrRows.map((m) => ({ id: m.id, ticketKey: keyByTicketId.get(m.ticketId) ?? '', title: m.title })).filter((m) => m.ticketKey.length > 0),
    channels: channels.map((c) => ({ id: c.id, name: c.name })),
    skills: skills.map((sk) => ({ id: sk.id, name: sk.name, enabled: sk.enabled })),
    documents: documents.map((d) => ({ id: d.id, title: d.title, status: d.aiDraft === null ? 'ready' : 'draft-pending' })),
    documentTemplates: docTemplates.map((t) => ({ slug: t.slug, name: t.name })),
    sprints: sprints.map((s) => ({ id: s.id, name: s.name })),
    invites: inviteRows.map((i) => ({ id: i.id, email: i.email, role: i.roleKey })),
    findings: findings.map((f) => ({ id: f.id, title: f.title })),
    uiReviews: uiReviews.map((r) => ({ id: r.id, page: r.page ?? '(unspecified)', status: r.status })),
    styles: styleRows.map((s) => ({ key: s.key, name: s.label })),
    outputTemplates: outputTemplates.map((t) => ({ id: t.id, name: t.name })),
    references: referenceRows.map((r) => ({ id: r.id, kind: r.kind, title: r.title })),
    commentInbox: { unread: unreadComments, total: totalComments },
    roles: roleRows.map((r) => ({ key: r.key, label: r.label })),
    infoSources: infoSourceRows.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled })),
    projectServices: projectServiceRows.map((s) => ({ id: s.id, name: s.name })),
    migrations: migrations.map((m) => ({ id: m.id, name: m.name, envKind: m.envKind })),
    projectFacts: {
      repoLinked,
      //? Explicit project stack wins; else a parsed package.json implies node; else unknown/unlinked.
      stack: project.stack ?? (dependencies.length > 0 ? 'node' : (repoLinked ? 'unknown' : 'unlinked')),
      framework,
      dependencies,
      databases: dbConns.map((d) => ({ name: d.name, kind: d.kind, envKind: d.envKind })),
      deployTargets: environments.map((e) => ({ kind: e.kind, route: e.route, status: e.status })),
      envKeys: envVarRows.map((v) => v.key),
      ciPipelines: pipelines.map((p) => ({ stages: p.stages, enabled: p.enabled })),
    },
    enabledSections: wsRow?.enabledSections ?? [],
    ...(userId ? {
      permissions: actorRole?.perms ?? [],
    } : {}),
  };
}

function workspaceStateText(ctx: Ctx): string {
  const f = ctx.projectFacts;
  return [
    `Active project: ${ctx.projectId} — ${ctx.projectName}`,
    //? STRUCTURED PROJECT FACTS — placed directly under the project line (the state text is sliced
    //? at 12k from the bottom, so the facts can never be the part that gets truncated away).
    'PROJECT FACTS (answer "can we / is X possible with this project?" from these):',
    `- Repo: ${f.repoLinked ? 'linked' : 'not linked'}; stack: ${f.stack}${f.framework.length > 0 ? `; framework: ${f.framework}` : ''}`,
    `- Dependencies (name@version): ${f.dependencies.map((d) => `${d.name}@${d.version}`).join('; ') || '(none detected)'}`,
    `- Databases (name — kind [env]): ${f.databases.map((d) => `${d.name} — ${d.kind} [${d.envKind}]`).join('; ') || '(none connected)'}`,
    `- Service stacks (name [status]): ${ctx.services.map((s) => `${s.name} [${s.status}]`).join('; ') || '(none)'}`,
    `- Deploy targets (kind — route [status]): ${f.deployTargets.map((t) => `${t.kind} — ${t.route} [${t.status}]`).join('; ') || '(none)'}`,
    `- Env var KEYS (names only — values are secret and never shown): ${f.envKeys.join('; ') || '(none)'}`,
    `- CI: ${f.ciPipelines.length > 0 ? f.ciPipelines.map((p) => `pipeline [${p.enabled ? 'enabled' : 'disabled'}] stages: ${p.stages.join(' > ')}`).join('; ') : 'no pipeline configured'}`,
    `Stages (id — name): ${ctx.stages.map((s) => `${s.id} — ${s.name}`).join('; ')}`,
    `Tickets (key — title [stage]): ${ctx.tickets.map((t) => `${t.key} — ${t.title} [${t.stageId}]`).join('; ') || '(none)'}`,
    `Members (id — name): ${ctx.members.map((m) => `${m.id} — ${m.name}`).join('; ') || '(none)'}`,
    `Content pieces (pieceId — title [stage]): ${ctx.pieces.map((p) => `${p.id} — ${p.title} [${p.stageId}]`).join('; ') || '(none)'}`,
    `Environments (envId — kind [status]): ${ctx.environments.map((e) => `${e.id} — ${e.kind} [${e.status}]`).join('; ') || '(none)'}`,
    //? Service stacks are listed once, in the PROJECT FACTS block above (identical name [status] pairs).
    `Custom AI tasks (taskId — name): ${ctx.customTasks.map((t) => `${t.id} — ${t.name}`).join('; ') || '(none)'}`,
    `Automation triggers (triggerId — name): ${ctx.triggers.map((t) => `${t.id} — ${t.name}`).join('; ') || '(none)'}`,
    `Merge requests (mrId [ticketKey] — title): ${ctx.mrs.map((m) => `${m.id} [${m.ticketKey}] — ${m.title}`).join('; ') || '(none)'}`,
    `Channels (channelId — name): ${ctx.channels.map((c) => `${c.id} — ${c.name}`).join('; ') || '(none)'}`,
    //? C3 — the AI-skills list, so a skill op proposal can name a REAL skillId (and see its on/off state).
    `AI skills (skillId — name [on|off]): ${ctx.skills.map((sk) => `${sk.id} — ${sk.name} [${sk.enabled ? 'on' : 'off'}]`).join('; ') || '(none)'}`,
    //? Parity wave — the remaining reference collections (documents/templates/sprints/invites/findings/
    //? ui-reviews/styles/output-templates/references/inbox) so proposals can name REAL ids here too.
    `Documents (docId — title [status]): ${ctx.documents.map((d) => `${d.id} — ${d.title} [${d.status}]`).join('; ') || '(none)'}`,
    `Document templates (slug — name): ${ctx.documentTemplates.map((t) => `${t.slug} — ${t.name}`).join('; ') || '(none)'}`,
    `Sprints (sprintId — name): ${ctx.sprints.map((s) => `${s.id} — ${s.name}`).join('; ') || '(none)'}`,
    `Pending invites (inviteId — email — role): ${ctx.invites.map((i) => `${i.id} — ${i.email} — ${i.role}`).join('; ') || '(none)'}`,
    `Roles (roleKey — label): ${ctx.roles.map((r) => `${r.key} — ${r.label}`).join('; ') || '(none)'}`,
    `Workflow-snippet skills (sourceId — name [on|off]): ${ctx.infoSources.map((s) => `${s.id} — ${s.name} [${s.enabled ? 'on' : 'off'}]`).join('; ') || '(none)'}`,
    `Project services / deploy-units (serviceId — name): ${ctx.projectServices.map((s) => `${s.id} — ${s.name}`).join('; ') || '(none)'}`,
    `Pending DB migrations (migrationId — name [env]): ${ctx.migrations.map((m) => `${m.id} — ${m.name} [${m.envKind}]`).join('; ') || '(none)'}`,
    `Open interview findings (findingId — title): ${ctx.findings.map((fi) => `${fi.id} — ${fi.title}`).join('; ') || '(none)'}`,
    `Open UI reviews (reviewId — page [status]): ${ctx.uiReviews.map((r) => `${r.id} — ${r.page} [${r.status}]`).join('; ') || '(none)'}`,
    `Style presets (key — name): ${ctx.styles.map((s) => `${s.key} — ${s.name}`).join('; ') || '(none)'}`,
    `Output templates (templateId — name): ${ctx.outputTemplates.map((t) => `${t.id} — ${t.name}`).join('; ') || '(none)'}`,
    `Reference examples (refId — kind — title): ${ctx.references.map((r) => `${r.id} — ${r.kind} — ${r.title}`).join('; ') || '(none)'}`,
    `Comment inbox: ${String(ctx.commentInbox.unread)} unread of ${String(ctx.commentInbox.total)} total`,
  ].join('\n');
}

export function systemPrompt(ctx: Ctx, codeContext: string, productContext = '', memoryContext = '', message = ''): string {
  return [
    'You are the Workspace-AI for an AI dev + content orchestration app. Given the user message and the workspace state, either answer conversationally (you CAN explain the codebase — use the repo excerpts below — AND explain what THIS PRODUCT can do — use the product-capabilities below) OR propose EXACTLY ONE action for the user to confirm. You never execute anything yourself — the user taps Accept and the Conductor performs it.',
    'Respond with STRICT JSON only, no prose, no markdown fences. Shape:',
    '{"reply": string, "action": null | <action>, "plan"?: {"summary": string, "steps": <action>[]}, "copilot"?: {"navigate": string, "note": string, "prefill"?: object}}  where <action> = {"op": "bulk-move"|"assign"|"add-comment"|"create-ticket"|"create-content", "ticketKeys"?: string[], "stageId"?: string, "assigneeId"?: string, "body"?: string, "title"?: string, "description"?: string, "brief"?: string, "format"?: string}',
    '- bulk-move: move ticketKeys to stageId (a stage id from the list). Use for pulling a high-priority/bugfix ticket forward.',
    '- assign: set assigneeId (a member id) on the single ticketKeys[0].',
    '- add-comment: post body on ticketKeys[0].',
    '- create-ticket: create a NEW dev ticket from a natural-language ask (e.g. "add a login page"). Set a concise `title` (required) and an optional `description`. Use when the user wants to BUILD/FIX software.',
    '- create-content: create a NEW content piece (video/post) from an idea (e.g. "make a 60s video about our launch"). Set `title` (required), a `brief` (what it is about, required) and an optional `format` ("faceless"|"talking-head"). Use when the user wants to MAKE media/content.',
    'For a BIG idea that needs MULTIPLE steps (e.g. "build a todo app with login and a dashboard"), instead of `action` return a `plan`: {"summary": string, "steps": [ <action>, <action>, … ]} — an ordered list of create-ticket/create-content actions the user approves at once. Break a software idea into a few focused create-ticket steps; a content idea usually stays a single create-content. Use `plan` (not `action`) whenever ≥2 steps make sense.',
    'Prefer a create action or plan when the user expresses a new goal ("I want …", "make …", "build …"). Only reference tickets/stages/members that exist below. For a code/architecture question, answer in `reply` and set action=null. If ambiguous or not doable, set action=null and explain.',
    //? X1 — the generic catalog: any enabled control-op is proposable. The action object carries the
    //? op + its listed params as TOP-LEVEL fields (same JSON shape as the core actions above).
    'BEYOND the core actions, you may also propose ANY of these workspace ops (set "op" to the op name and add its listed params as top-level fields in the action object). Ids/keys MUST come from the lists below — never invent them. Ops marked [destructive] make the app ask the user for an extra confirmation — still propose them when that is what the user asks; mention the impact in `reply`. Ops that cost money (media generation/pipeline) also get a cost-confirm — say so in `reply`.',
    ...catalogPromptLines(ctx.enabledSections, ctx.permissions, ctx, message),
    'If the user asks WHETHER or HOW they can do something in this product ("can we edit videos?", "how do I publish to TikTok?"), answer from the "What THIS product can do" section below: name the module + the concrete steps, and where a first step maps to an op (e.g. create-content for "make a video"), propose that action. NEVER confuse product-capabilities (what the app offers) with the user\'s own repository code.',
    'TIME-TRAVEL PREVIEW: if the user asks to run/preview an OLDER or MODIFIED version ("start main without commit X", "show yesterday\'s version", "preview commit abc123"), explain in `reply` that they can open a time-travel preview from the ticket — the app supports previewing a raw commit, "main minus a commit" (a synthetic revert), or "as of a timestamp". Set action=null (this preview runs via the ticket\'s preview control, not a board op) and describe which of the three fits their ask.',
    //? #109 — AI-drives-UI: when the best help is to TAKE the user somewhere (not run an op), emit a copilot directive.
    `AI-DRIVES-UI (copilot): when the user's ask is best served by GUIDING them to a specific page to finish it themselves (a settings screen, a form you can't fully fill, "where do I set X?", "take me to Y"), ADD a "copilot" field: {"navigate": <one of: ${COPILOT_NAV_TARGETS.join('|')}>, "note": short "here's what to do next", "prefill"?: { field: value }}. Use it INSTEAD of (or alongside) a plain reply when navigating helps; keep proposing an op when you CAN do the action directly. Only navigate to a listed target.`,
    `Workspace state (reference data; ids may be used only as allowed above):\n${renderUntrustedContext({ provenance: 'current workspace state and user-authored names', content: workspaceStateText(ctx), maxChars: 12_000 })}`,
    ...(productContext.length > 0 ? [`What THIS product can do (answer capability/how-to questions from this):\n${renderUntrustedContext({ provenance: 'RAG chunks: product knowledge', content: productContext, maxChars: 4000 })}`] : []),
    ...(codeContext.length > 0 ? [`Relevant code from the repository (grounds code questions about the USER's own project):\n${renderUntrustedContext({ provenance: 'RAG chunks: user repository', content: codeContext, maxChars: 6000 })}`] : []),
    //? GAP_SCAN C1 — the institutional memory (ADR 0045) was indexed but only plan-critique ever read it.
    ...(memoryContext.length > 0 ? [`PRIOR LEARNINGS from earlier sessions (answer "why is it like this" from these before guessing):\n${renderUntrustedContext({ provenance: 'RAG chunks: institutional memory', content: memoryContext, maxChars: 3000 })}`] : []),
    UNTRUSTED_CONTEXT_POLICY,
  ].join('\n');
}

export function buildChatPrompt(message: string, history: { role: string; text: string }[] = []): string {
  const historyText = history.slice(-8).map((entry) => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text}`).join('\n');
  return [
    ...(historyText.length > 0
      ? [renderUntrustedContext({ provenance: 'prior workspace chat history', content: historyText, maxChars: 8000 }), UNTRUSTED_CONTEXT_POLICY]
      : []),
    `AUTHORITATIVE CURRENT USER REQUEST:\n${message}`,
  ].join('\n\n');
}

//? Slice the first balanced {...} object out of the model's reply (tolerates stray prose
//? / ```json fences the instruction tried to forbid). Parsing is done by the async caller
//? via tryCatch so this stays a pure, throw-free string scan.
function extractJsonSlice(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

//? Validate the model's action against the REAL workspace state — a proposal may only
//? name tickets/stages/members that exist, or it is dropped to a reply-only result.
//? Exported for direct unit-testing (pure guard; the create ops (O-B) are the key surface to lock down).
export function validateChatAction(raw: unknown, ctx: Ctx): ChatProposal | null {
  if (raw === null || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const op = a.op;
  const keys = Array.isArray(a.ticketKeys) ? a.ticketKeys.filter((k): k is string => typeof k === 'string') : [];
  const known = new Set(ctx.tickets.map((t) => t.key));
  const validKeys = keys.filter((k) => known.has(k));
  if (op === 'bulk-move') {
    const stageId = typeof a.stageId === 'string' ? a.stageId : '';
    if (validKeys.length === 0 || !ctx.stages.some((s) => s.id === stageId)) return null;
    const stageName = ctx.stages.find((s) => s.id === stageId)?.name ?? stageId;
    return { op, projectId: ctx.projectId, ticketKeys: validKeys, stageId, summary: `Move ${validKeys.join(', ')} → ${stageName}` };
  }
  const [firstKey] = validKeys;
  if (op === 'assign') {
    const assigneeId = typeof a.assigneeId === 'string' ? a.assigneeId : '';
    if (firstKey === undefined || !ctx.members.some((m) => m.id === assigneeId)) return null;
    const who = ctx.members.find((m) => m.id === assigneeId)?.name ?? assigneeId;
    return { op, projectId: ctx.projectId, ticketKeys: [firstKey], assigneeId, summary: `Assign ${firstKey} → ${who}` };
  }
  if (op === 'add-comment') {
    const body = typeof a.body === 'string' ? a.body.trim() : '';
    if (firstKey === undefined || body.length === 0) return null;
    return { op, projectId: ctx.projectId, ticketKeys: [firstKey], body, summary: `Comment on ${firstKey}` };
  }
  //? O-B create ops — free-form (they invent NEW state), so they validate on their own fields, not against
  //? existing tickets/stages. They still only PROPOSE; accept routes them to the existing quick-add /
  //? content-from-brief verbs (single-writer + frozen-verb surface intact).
  if (op === 'create-ticket') {
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    if (title.length === 0) return null;
    const description = typeof a.description === 'string' ? a.description.trim() : undefined;
    return { op, projectId: ctx.projectId, title, ...(description ? { description } : {}), summary: `Create ticket: ${title}` };
  }
  if (op === 'create-content') {
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    const brief = typeof a.brief === 'string' ? a.brief.trim() : '';
    if (title.length === 0 || brief.length === 0) return null;
    const format = typeof a.format === 'string' && a.format.trim().length > 0 ? a.format.trim() : undefined;
    return { op, projectId: ctx.projectId, title, brief, ...(format ? { format } : {}), summary: `Create content: ${title}` };
  }
  //? X1 — everything else falls through to the generic catalog: any ENABLED op validates against
  //? the catalog's param spec + the real workspace context (unknown/disabled/dangling → null).
  return validateGenericAction(raw, ctx);
}

//? O-A — validate a multi-step intake plan: each step must independently validate (same guard as a single
//? proposal), invalid steps are dropped, and a plan needs ≥2 surviving steps to be a real plan (a 1-step
//? "plan" is just a proposal and is handled by the `action` path). Returns null otherwise.
export function validatePlan(raw: unknown, ctx: Ctx): ChatPlan | null {
  if (raw === null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const rawSteps = Array.isArray(p.steps) ? p.steps : [];
  const steps = rawSteps.map((s) => validateChatAction(s, ctx)).filter((s): s is ChatProposal => s !== null);
  if (steps.length < 2) return null;
  const summary = typeof p.summary === 'string' && p.summary.trim().length > 0 ? p.summary.trim() : `Plan: ${String(steps.length)} steps`;
  return { summary, steps };
}

//? Interpret one chat message → a reply + an optional (validated) proposal OR multi-step plan.
export async function interpretChat(prisma: PrismaClient, workspaceId: string, message: string, projectId?: string, history?: { role: string; text: string }[], userId?: string): Promise<ChatResult> {
  if (!projectId) return { reply: '', proposal: null, error: 'project.notFound' };
  const ctx = await loadCtx(prisma, workspaceId, projectId, userId);
  if (!ctx) return { reply: '', proposal: null, error: 'project.notFound' };
  //? Ground the chat in the actual codebase (the same shared RAG index the coding agent + Sources use),
  //? so "how does X work?" answers from real code instead of flying blind. Best-effort — empty when
  //? nothing is indexed. R3-b — scope to the active project so a multi-project workspace grounds on the
  //? RIGHT repo (else `retrieve`'s fallback picks whichever project indexed last).
  const [, chunks] = await tryCatch(() => retrieve(prisma, workspaceId, message, 6, undefined, ctx.projectId));
  const codeContext = (chunks ?? []).map((c) => `// ${c.filePath}\n${c.content}`).join('\n\n').slice(0, 6000);
  //? Q3 — ALSO ground on the PRODUCT's own capabilities (Q2 corpus), so the assistant can answer "can we edit
  //? videos? → yes, via the media module, first generate/upload a video then the timeline editor". Kept as a
  //? SEPARATE section from the user-code context so the model never confuses "what this product can do" with
  //? "what the user's repo contains". Best-effort — empty when the corpus isn't indexed.
  const [, pk] = await tryCatch(() => retrieveProductKnowledge(prisma, message, 4));
  const productContext = (pk ?? []).map((c) => `// ${c.filePath}\n${c.content}`).join('\n\n').slice(0, 4000);
  //? #112 — prior turns are model/user-authored reference data; only the current message is a direct,
  //? authoritative request. Bounded to the last 8 turns inside one unique untrusted block.
  //? C1 — "why is X like this?" is a chat question; ground it in the institutional memory too.
  const [, mem] = await tryCatch(() => retrieveMemory(prisma, workspaceId, message, 4));
  const memoryContext = (mem ?? []).map((m) => `- ${m.content}`).join('\n').slice(0, 3000);
  const fullPrompt = buildChatPrompt(message, history ?? []);
  const res = await runAiCompletion('workspace-chat', { prompt: fullPrompt, system: systemPrompt(ctx, codeContext, productContext, memoryContext, message), timeoutMs: 90_000, workspaceId, label: 'Workspace-AI chat' });
  if (!res.ok) return { reply: '', proposal: null, error: res.error ?? 'ai.turnFailed' };
  const slice = extractJsonSlice(res.text);
  const [, parsed] = slice ? await tryCatch(() => Promise.resolve(JSON.parse(slice) as unknown)) : [null, null];
  const obj = (parsed !== null && typeof parsed === 'object') ? parsed as Record<string, unknown> : null;
  const replyRaw = (obj !== null && typeof obj.reply === 'string') ? obj.reply : res.text.trim();
  //? Prefer a multi-step plan when the model returned one; else a single proposal. (Never both — a plan wins.)
  const plan = validatePlan(obj?.plan ?? null, ctx);
  //? #109 — a copilot directive (AI drives the UI) is orthogonal to a proposal/plan: it can guide the user to
  //? a page to finish an action the AI can't fully specify. Validated against the known nav targets.
  const copilot = validateCopilot(obj?.copilot ?? null);
  return { reply: replyRaw, proposal: plan ? null : validateChatAction(obj?.action ?? null, ctx), plan, copilot };
}
