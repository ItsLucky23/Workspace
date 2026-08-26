//? The Assistant's MEMORY (owner 2026-08-26: "assistant chat moet niet fire and forget zijn maar dus
//? context hebben … en misschien kijken voor een chat history in die assistant en een auto compact layer
//? voor zijn context window als die boven de e.g. 272k tokens komt").
//?
//? Two things live here, and they are the same thing seen from both ends:
//?
//?  1. HISTORY — the assistant's context is read from the persisted `WorkspaceChatMessage` rows rather
//?     than from whatever the browser tab happens to still hold. The old path sent the last 8 client-side
//?     bubbles, so a reload, a second device, or simply a long conversation silently amnesia'd the
//?     assistant mid-thread. Per user, per workspace, per surface (assistant vs interviewer).
//?
//?  2. COMPACTION — an unbounded conversation eventually outgrows any context window, so once the stored
//?     turns exceed `CHAT_CONTEXT_TOKENS` the OLDEST slice is folded into a written summary and that
//?     summary stands in for them from then on. The summary is stored as a `Handoff` row — the same
//?     mechanism the coding agent uses to survive its own budget ceiling, whose `sessionKey` comment
//?     already reserved `assistant:…` for exactly this. No new model, no new verb.
//?
//? The Handoff's `createdAt` is the WATERMARK: it is stamped to the last summarised message, so the next
//? load reads "everything after this instant" and the summary covers everything before. Compaction is
//? best-effort — if the summarising call fails, the oldest turns are dropped instead, because a chat turn
//? must never fail because its own memory management did.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

import { estTokens } from '../spend/record';
import { CHAT_CONTEXT_TOKENS } from './promptBudget';
import { runAiCompletion } from './registry';

export type ChatSurface = 'assistant' | 'interviewer';
export interface ChatTurn { role: string; text: string }
export interface ChatContext {
  //? What earlier turns amounted to, when there were too many to carry verbatim. '' = nothing compacted yet.
  summary: string;
  //? The verbatim tail, oldest → newest.
  turns: ChatTurn[];
}

//? Never read more than this many rows in one go, whatever the token ceiling says: the token budget is
//? what decides how much is USED, this is only a guard against a pathological single query.
const MAX_ROWS = 1000;
//? What fraction of an over-budget conversation gets folded into the summary. Leaving a real tail behind
//? matters: the most recent turns are the ones a follow-up ("do that for the other ticket too") refers to.
const COMPACT_FRACTION = 0.7;

const rolesFor = (surface: ChatSurface): string[] => (surface === 'interviewer' ? ['interviewer-user', 'interviewer-ai'] : ['user', 'ai']);
const sessionKeyFor = (userId: string, surface: ChatSurface): string => (surface === 'interviewer' ? `assistant:${userId}:interviewer` : `assistant:${userId}`);

const tokensOf = (turns: ChatTurn[]): number => turns.reduce((total, turn) => total + estTokens(turn.role.length + turn.text.length + 2), 0);

//? The stored summary text of a Handoff body, cast-free.
function summaryOf(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return '';
  const value = (body as Record<string, unknown>).summary;
  return typeof value === 'string' ? value : '';
}

//? Fold `turns` into a few paragraphs the next turn can stand on. Deliberately asks for FACTS the
//? conversation established (decisions, ids, names, open questions) rather than a prose recap: a summary
//? that loses "we agreed to name it DEV-42" is worse than no summary at all.
async function summarise(workspaceId: string, priorSummary: string, turns: ChatTurn[]): Promise<string | null> {
  const transcript = turns.map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`).join('\n');
  const res = await runAiCompletion('workspace-chat', {
    prompt: [
      ...(priorSummary.length > 0 ? [`Summary of everything before this excerpt:\n${priorSummary}`] : []),
      `Conversation excerpt to fold in:\n${transcript}`,
    ].join('\n\n'),
    system: [
      'You compact an assistant conversation so it can continue past its context window.',
      'Write a single running summary that REPLACES the excerpt (and absorbs the earlier summary, if given).',
      'Keep, verbatim where it matters: decisions taken, concrete identifiers (ticket keys, ids, names, paths, settings), what the user asked for and has not got yet, and open questions.',
      'Drop pleasantries, restatements, and anything already superseded by a later turn.',
      'Plain prose or short bullets. No preamble, no "here is the summary" — output the summary itself.',
    ].join('\n'),
    timeoutMs: 90_000,
    workspaceId,
    label: 'Assistant chat compaction',
  });
  const text = res.ok ? res.text.trim() : '';
  return text.length > 0 ? text : null;
}

//? Load the assistant's context for one user, compacting first when the conversation has outgrown the
//? ceiling. Returns the summary (possibly '') plus the verbatim tail to send with this turn.
export async function loadChatContext(
  prisma: PrismaClient, workspaceId: string, userId: string, surface: ChatSurface = 'assistant',
): Promise<ChatContext> {
  const sessionKey = sessionKeyFor(userId, surface);
  const handoff = await prisma.handoff.findFirst({
    where: { workspaceId, sessionKey },
    orderBy: { createdAt: 'desc' },
    select: { body: true, createdAt: true },
  });
  let summary = handoff ? summaryOf(handoff.body) : '';

  const rows = await prisma.workspaceChatMessage.findMany({
    where: {
      workspaceId, userId, role: { in: rolesFor(surface) },
      ...(handoff ? { createdAt: { gt: handoff.createdAt } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_ROWS,
    select: { role: true, text: true, createdAt: true },
  });
  let turns: ChatTurn[] = rows.map((row) => ({ role: row.role.endsWith('user') ? 'user' : 'ai', text: row.text }));

  if (estTokens(summary.length) + tokensOf(turns) <= CHAT_CONTEXT_TOKENS) return { summary, turns };

  //? Over the ceiling → fold the oldest slice away. `cut` is at least one turn, so this always makes
  //? progress; without that a single enormous turn would re-trigger compaction on every message.
  const cut = Math.max(1, Math.floor(turns.length * COMPACT_FRACTION));
  const older = turns.slice(0, cut);
  const tail = turns.slice(cut);
  const watermark = rows[cut - 1]?.createdAt;
  const [, folded] = await tryCatch(() => summarise(workspaceId, summary, older));
  if (folded !== null && watermark !== undefined) {
    //? `createdAt` is stamped to the last summarised message, NOT to now: it is the watermark the next
    //? load reads from, and messages that arrived while we were summarising must not be swallowed by it.
    await tryCatch(() => prisma.handoff.create({
      data: { workspaceId, sessionKey, body: { summary: folded, decisions: [], state: '', next: [], gotchas: [] }, reason: 'budget', createdAt: watermark },
    }));
    summary = folded;
  }
  //? Whether or not the summary was written, this turn continues on the tail alone — dropping the oldest
  //? turns is the honest degradation when the summariser is unavailable, and it is what keeps the request
  //? inside the window either way.
  turns = tail;
  return { summary, turns };
}
