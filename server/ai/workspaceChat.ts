//? Workspace-AI chat interpreter (feature `workspace-chat`). Turns a natural-language
//? message into EITHER a plain reply OR a single PROPOSED control-op the user then
//? accepts — the AI never writes directly (the Conductor stays the only writer). Runs
//? through the pluggable provider layer (`runAiCompletion`), so which AI backs the chat
//? is a per-feature config choice (see ai-provider-abstraction). The AI's JSON is
//? VALIDATED against the workspace's real tickets/stages before it can become a proposal.

import { tryCatch } from '@luckystack/core';
import { runAiCompletion } from './registry';
import type { PrismaClient } from '@prisma/client';
//? The proposal shape is shared with the client (it crosses the aiChat API boundary).
import type { ChatProposal } from '../../src/workspaces/_data/types';

export interface ChatResult {
  reply: string;
  proposal: ChatProposal | null;
  error?: string;
}

interface Ctx {
  tickets: { key: string; title: string; stageId: string }[];
  stages: { id: string; name: string }[];
  members: { id: string; name: string }[];
}

async function loadCtx(prisma: PrismaClient, workspaceId: string): Promise<Ctx> {
  const [tickets, stages, memberRows] = await Promise.all([
    prisma.ticket.findMany({ where: { workspaceId, archived: false }, select: { key: true, title: true, stageId: true }, take: 60, orderBy: { lastActivityAt: 'desc' } }),
    prisma.pipelineStage.findMany({ where: { workspaceId }, select: { key: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true }, take: 40 }),
  ]);
  //? WorkspaceMember stores only userId (no User relation) — resolve names separately.
  const users = await prisma.user.findMany({ where: { id: { in: memberRows.map((m) => m.userId) } }, select: { id: true, name: true } });
  return {
    tickets: tickets.map((t) => ({ key: t.key, title: t.title, stageId: t.stageId })),
    stages: stages.map((s) => ({ id: s.key, name: s.name })),
    members: users.map((u) => ({ id: u.id, name: u.name ?? u.id })),
  };
}

function systemPrompt(ctx: Ctx): string {
  return [
    'You are the Workspace-AI for a Kanban dev-orchestration board. Given the user message and the workspace state, either answer conversationally OR propose EXACTLY ONE action for the user to confirm. You never execute anything yourself.',
    'Respond with STRICT JSON only, no prose, no markdown fences. Shape:',
    '{"reply": string, "action": null | {"op": "bulk-move"|"assign"|"add-comment", "ticketKeys"?: string[], "stageId"?: string, "assigneeId"?: string, "body"?: string}}',
    '- bulk-move: move ticketKeys to stageId (a stage id from the list). Use for pulling a high-priority/bugfix ticket forward.',
    '- assign: set assigneeId (a member id) on the single ticketKeys[0].',
    '- add-comment: post body on ticketKeys[0].',
    'Only reference tickets/stages/members that exist below. If the request is ambiguous or not doable, set action=null and explain in reply.',
    `Stages (id — name): ${ctx.stages.map((s) => `${s.id} — ${s.name}`).join('; ')}`,
    `Tickets (key — title [stage]): ${ctx.tickets.map((t) => `${t.key} — ${t.title} [${t.stageId}]`).join('; ') || '(none)'}`,
    `Members (id — name): ${ctx.members.map((m) => `${m.id} — ${m.name}`).join('; ') || '(none)'}`,
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
function validate(raw: unknown, ctx: Ctx): ChatProposal | null {
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
  return null;
}

//? Interpret one chat message → a reply + an optional (validated) proposal.
export async function interpretChat(prisma: PrismaClient, workspaceId: string, message: string): Promise<ChatResult> {
  const ctx = await loadCtx(prisma, workspaceId);
  const res = await runAiCompletion('workspace-chat', { prompt: message, system: systemPrompt(ctx), timeoutMs: 90_000 });
  if (!res.ok) return { reply: '', proposal: null, error: res.error ?? 'ai.turnFailed' };
  const slice = extractJsonSlice(res.text);
  const [, parsed] = slice ? await tryCatch(() => Promise.resolve(JSON.parse(slice) as unknown)) : [null, null];
  const obj = (parsed !== null && typeof parsed === 'object') ? parsed as Record<string, unknown> : null;
  const replyRaw = (obj !== null && typeof obj.reply === 'string') ? obj.reply : res.text.trim();
  return { reply: replyRaw, proposal: validate(obj?.action ?? null, ctx) };
}
