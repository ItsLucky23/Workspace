//? Workspace-AI chat interpreter (feature `workspace-chat`). Turns a natural-language
//? message into EITHER a plain reply OR a single PROPOSED control-op the user then
//? accepts — the AI never writes directly (the Conductor stays the only writer). Runs
//? through the pluggable provider layer (`runAiCompletion`), so which AI backs the chat
//? is a per-feature config choice (see ai-provider-abstraction). The AI's JSON is
//? VALIDATED against the workspace's real tickets/stages before it can become a proposal.

import { tryCatch } from '@luckystack/core';
import { runAiCompletion } from './registry';
import type { PrismaClient } from '@prisma/client';
import { retrieve } from '../rag/index';
import { retrieveProductKnowledge } from '../rag/productKnowledge';
//? R3-b — repos are per-(workspace,project); the code-RAG must be scoped to the ACTIVE project
//? or the chat grounds on whichever project indexed last (answering about the wrong codebase).
import { resolveProjectId } from '../orchestrator/projectResolve';
//? X1 — the generic op-catalog: every catalog-enabled control-op becomes proposable (still
//? propose→accept→Conductor; destructive ops carry an extra client confirm).
import { catalogPromptLines, validateGenericAction } from './opCatalog';
//? The proposal shape is shared with the client (it crosses the aiChat API boundary).
import type { ChatProposal, ChatPlan } from '../../src/workspaces/_data/types';

export interface ChatResult {
  reply: string;
  proposal: ChatProposal | null;
  plan?: ChatPlan | null;
  error?: string;
}

export interface Ctx {
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
}

async function loadCtx(prisma: PrismaClient, workspaceId: string): Promise<Ctx> {
  const [tickets, stages, memberRows, pieces, environments, services, customTasks, triggers, mrRows, channels] = await Promise.all([
    prisma.ticket.findMany({ where: { workspaceId, archived: false }, select: { key: true, title: true, stageId: true }, take: 60, orderBy: { lastActivityAt: 'desc' } }),
    prisma.pipelineStage.findMany({ where: { workspaceId }, select: { key: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true }, take: 40 }),
    prisma.contentProject.findMany({ where: { workspaceId, archived: false }, select: { id: true, title: true, stageId: true }, take: 30, orderBy: { updatedAt: 'desc' } }),
    prisma.environment.findMany({ where: { workspaceId }, select: { id: true, kind: true, status: true }, take: 12 }),
    prisma.serviceStack.findMany({ where: { workspaceId }, select: { name: true, status: true }, take: 12 }),
    prisma.customAiTask.findMany({ where: { workspaceId }, select: { id: true, name: true }, take: 30 }),
    prisma.workspaceTrigger.findMany({ where: { workspaceId }, select: { id: true, name: true }, take: 30 }),
    prisma.mergeRequest.findMany({ where: { workspaceId, status: { in: ['open', 'conflict', 'merged'] } }, select: { id: true, title: true, ticketId: true }, take: 20, orderBy: { createdAt: 'desc' } }),
    prisma.channel.findMany({ where: { workspaceId }, select: { id: true, name: true }, take: 30 }),
  ]);
  //? WorkspaceMember stores only userId (no User relation) — resolve names separately.
  const users = await prisma.user.findMany({ where: { id: { in: memberRows.map((m) => m.userId) } }, select: { id: true, name: true } });
  //? #54 — resolve each open MR's ticket KEY (the chat + mrAction reference the DEV-#### key, not the id).
  const mrTicketKeys = await prisma.ticket.findMany({ where: { workspaceId, id: { in: mrRows.map((m) => m.ticketId) } }, select: { id: true, key: true } });
  const keyByTicketId = new Map(mrTicketKeys.map((t) => [t.id, t.key]));
  return {
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
  };
}

function systemPrompt(ctx: Ctx, codeContext: string, productContext = ''): string {
  return [
    'You are the Workspace-AI for an AI dev + content orchestration app. Given the user message and the workspace state, either answer conversationally (you CAN explain the codebase — use the repo excerpts below — AND explain what THIS PRODUCT can do — use the product-capabilities below) OR propose EXACTLY ONE action for the user to confirm. You never execute anything yourself — the user taps Accept and the Conductor performs it.',
    'Respond with STRICT JSON only, no prose, no markdown fences. Shape:',
    '{"reply": string, "action": null | <action>, "plan"?: {"summary": string, "steps": <action>[]}}  where <action> = {"op": "bulk-move"|"assign"|"add-comment"|"create-ticket"|"create-content", "ticketKeys"?: string[], "stageId"?: string, "assigneeId"?: string, "body"?: string, "title"?: string, "description"?: string, "brief"?: string, "format"?: string}',
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
    ...catalogPromptLines(),
    'If the user asks WHETHER or HOW they can do something in this product ("can we edit videos?", "how do I publish to TikTok?"), answer from the "What THIS product can do" section below: name the module + the concrete steps, and where a first step maps to an op (e.g. create-content for "make a video"), propose that action. NEVER confuse product-capabilities (what the app offers) with the user\'s own repository code.',
    'TIME-TRAVEL PREVIEW: if the user asks to run/preview an OLDER or MODIFIED version ("start main without commit X", "show yesterday\'s version", "preview commit abc123"), explain in `reply` that they can open a time-travel preview from the ticket — the app supports previewing a raw commit, "main minus a commit" (a synthetic revert), or "as of a timestamp". Set action=null (this preview runs via the ticket\'s preview control, not a board op) and describe which of the three fits their ask.',
    `Stages (id — name): ${ctx.stages.map((s) => `${s.id} — ${s.name}`).join('; ')}`,
    `Tickets (key — title [stage]): ${ctx.tickets.map((t) => `${t.key} — ${t.title} [${t.stageId}]`).join('; ') || '(none)'}`,
    `Members (id — name): ${ctx.members.map((m) => `${m.id} — ${m.name}`).join('; ') || '(none)'}`,
    `Content pieces (pieceId — title [stage]): ${ctx.pieces.map((p) => `${p.id} — ${p.title} [${p.stageId}]`).join('; ') || '(none)'}`,
    `Environments (envId — kind [status]): ${ctx.environments.map((e) => `${e.id} — ${e.kind} [${e.status}]`).join('; ') || '(none)'}`,
    `Service stacks (name [status]): ${ctx.services.map((s) => `${s.name} [${s.status}]`).join('; ') || '(none)'}`,
    `Custom AI tasks (taskId — name): ${ctx.customTasks.map((t) => `${t.id} — ${t.name}`).join('; ') || '(none)'}`,
    `Automation triggers (triggerId — name): ${ctx.triggers.map((t) => `${t.id} — ${t.name}`).join('; ') || '(none)'}`,
    `Merge requests (mrId [ticketKey] — title): ${ctx.mrs.map((m) => `${m.id} [${m.ticketKey}] — ${m.title}`).join('; ') || '(none)'}`,
    `Channels (channelId — name): ${ctx.channels.map((c) => `${c.id} — ${c.name}`).join('; ') || '(none)'}`,
    ...(productContext.length > 0 ? [`What THIS product can do (answer capability/how-to questions from this):\n${productContext}`] : []),
    ...(codeContext.length > 0 ? [`Relevant code from the repository (grounds code questions about the USER's own project):\n${codeContext}`] : []),
  ].join('\n');
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
    return { op, ticketKeys: validKeys, stageId, summary: `Move ${validKeys.join(', ')} → ${stageName}` };
  }
  const [firstKey] = validKeys;
  if (op === 'assign') {
    const assigneeId = typeof a.assigneeId === 'string' ? a.assigneeId : '';
    if (firstKey === undefined || !ctx.members.some((m) => m.id === assigneeId)) return null;
    const who = ctx.members.find((m) => m.id === assigneeId)?.name ?? assigneeId;
    return { op, ticketKeys: [firstKey], assigneeId, summary: `Assign ${firstKey} → ${who}` };
  }
  if (op === 'add-comment') {
    const body = typeof a.body === 'string' ? a.body.trim() : '';
    if (firstKey === undefined || body.length === 0) return null;
    return { op, ticketKeys: [firstKey], body, summary: `Comment on ${firstKey}` };
  }
  //? O-B create ops — free-form (they invent NEW state), so they validate on their own fields, not against
  //? existing tickets/stages. They still only PROPOSE; accept routes them to the existing quick-add /
  //? content-from-brief verbs (single-writer + frozen-verb surface intact).
  if (op === 'create-ticket') {
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    if (title.length === 0) return null;
    const description = typeof a.description === 'string' ? a.description.trim() : undefined;
    return { op, title, ...(description ? { description } : {}), summary: `Create ticket: ${title}` };
  }
  if (op === 'create-content') {
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    const brief = typeof a.brief === 'string' ? a.brief.trim() : '';
    if (title.length === 0 || brief.length === 0) return null;
    const format = typeof a.format === 'string' && a.format.trim().length > 0 ? a.format.trim() : undefined;
    return { op, title, brief, ...(format ? { format } : {}), summary: `Create content: ${title}` };
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
export async function interpretChat(prisma: PrismaClient, workspaceId: string, message: string, projectId?: string, history?: { role: string; text: string }[]): Promise<ChatResult> {
  const ctx = await loadCtx(prisma, workspaceId);
  //? Ground the chat in the actual codebase (the same shared RAG index the coding agent + Sources use),
  //? so "how does X work?" answers from real code instead of flying blind. Best-effort — empty when
  //? nothing is indexed. R3-b — scope to the active project so a multi-project workspace grounds on the
  //? RIGHT repo (else `retrieve`'s fallback picks whichever project indexed last).
  const projId = await resolveProjectId(prisma, workspaceId, projectId ?? null);
  const [, chunks] = await tryCatch(() => retrieve(prisma, workspaceId, message, 6, undefined, projId ?? undefined));
  const codeContext = (chunks ?? []).map((c) => `// ${c.filePath}\n${c.content}`).join('\n\n').slice(0, 6000);
  //? Q3 — ALSO ground on the PRODUCT's own capabilities (Q2 corpus), so the assistant can answer "can we edit
  //? videos? → yes, via the media module, first generate/upload a video then the timeline editor". Kept as a
  //? SEPARATE section from the user-code context so the model never confuses "what this product can do" with
  //? "what the user's repo contains". Best-effort — empty when the corpus isn't indexed.
  const [, pk] = await tryCatch(() => retrieveProductKnowledge(prisma, message, 4));
  const productContext = (pk ?? []).map((c) => c.content).join('\n\n').slice(0, 4000);
  //? #112 — thread the last N prior turns into the prompt so the AI can follow up ("do that for the
  //? other ticket too"). Bounded to the last 8 turns; the current message is the final line.
  const historyText = (history ?? []).slice(-8).map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n');
  const fullPrompt = historyText.length > 0 ? `Conversation so far:\n${historyText}\n\nUser: ${message}` : message;
  const res = await runAiCompletion('workspace-chat', { prompt: fullPrompt, system: systemPrompt(ctx, codeContext, productContext), timeoutMs: 90_000, workspaceId, label: 'Workspace-AI chat' });
  if (!res.ok) return { reply: '', proposal: null, error: res.error ?? 'ai.turnFailed' };
  const slice = extractJsonSlice(res.text);
  const [, parsed] = slice ? await tryCatch(() => Promise.resolve(JSON.parse(slice) as unknown)) : [null, null];
  const obj = (parsed !== null && typeof parsed === 'object') ? parsed as Record<string, unknown> : null;
  const replyRaw = (obj !== null && typeof obj.reply === 'string') ? obj.reply : res.text.trim();
  //? Prefer a multi-step plan when the model returned one; else a single proposal. (Never both — a plan wins.)
  const plan = validatePlan(obj?.plan ?? null, ctx);
  return { reply: replyRaw, proposal: plan ? null : validateChatAction(obj?.action ?? null, ctx), plan };
}
