//? Cost/usage tracking (#16) — VISIBILITY ONLY, never a hard stop (the CapacityManager #12 is the
//? concurrency control; this is the "what did it cost" read). After every turn the stage-runner
//? records a SpendRecord (token estimate + cost) and bumps the session's running estimate + the
//? workspace's rolling spend. We run on the Max SUBSCRIPTION, so the Claude CLI exposes no usage
//? field — tokens are ESTIMATED from the char count (the P0.5 spike's finding), and the monetary
//? cost is 0 unless a per-model price is set. The value shown to the user is token VOLUME + time.

import type { PrismaClient } from '@prisma/client';

import type { UsageByTicket, UsageDay, WorkspaceUsage } from '../../src/workspaces/_data/types';

//? Rough chars→tokens (~4 chars/token for English+code). Advisory, not billing-grade.
const CHARS_PER_TOKEN = 4;
export const estTokens = (chars: number): number => Math.max(0, Math.ceil(chars / CHARS_PER_TOKEN));

//? Editable per-model price per 1k tokens (D31). 0 = the Max subscription (no metered cost); a
//? self-host operator paying per-token API can set real prices here (env-overridable later).
const MODEL_PRICE_PER_1K: Record<string, number> = {};
const priceFor = (model: string): number => MODEL_PRICE_PER_1K[model] ?? 0;

export interface TurnSpendInput {
  workspaceId: string; ticketId?: string | null; stageId?: string | null;
  sessionKey: string; model: string; inputChars: number; outputChars: number;
}

//? Record one turn's usage. Best-effort — a failed spend write must NEVER fail the turn (it's
//? advisory), so the caller wraps this in tryCatch. Increments the session's running token
//? estimate (feeds the #4 self-handoff) and the enabled budgets' rolling `spent` (display only —
//? no enforcement/pause here, #16 is show-only).
export async function recordTurnSpend(prisma: PrismaClient, input: TurnSpendInput): Promise<{ tokensIn: number; tokensOut: number; costEstimate: number }> {
  const tokensIn = estTokens(input.inputChars);
  const tokensOut = estTokens(input.outputChars);
  const costEstimate = ((tokensIn + tokensOut) / 1000) * priceFor(input.model);
  await prisma.spendRecord.create({
    data: {
      workspaceId: input.workspaceId, ticketId: input.ticketId ?? null, stageId: input.stageId ?? null,
      sessionKey: input.sessionKey, tokensIn, tokensOut, model: input.model, costEstimate,
    },
  });
  await prisma.agentSession.updateMany({ where: { workspaceId: input.workspaceId, sessionKey: input.sessionKey }, data: { tokenEstimate: { increment: tokensIn + tokensOut } } });
  //? Rolling spend for the caps display (never enforced here — #16 is visibility only).
  if (costEstimate > 0) await prisma.workspaceBudget.updateMany({ where: { workspaceId: input.workspaceId, enabled: true }, data: { spent: { increment: costEstimate } } });
  return { tokensIn, tokensOut, costEstimate };
}

//? Usage shapes live in the client `_data/types` (the snapshot emits them); re-exported for callers.
export type { UsageByTicket, UsageDay, WorkspaceUsage } from '../../src/workspaces/_data/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

//? A SpendRecord row (the fields the aggregate reads) — decoupled from Prisma's model type so
//? `aggregateUsage` is a PURE, unit-testable function the snapshot feeds tenant-scoped rows into.
export interface SpendRow { ticketId: string | null; tokensIn: number; tokensOut: number; createdAt: Date }

//? Aggregate SpendRecord rows → the Usage read (replaces the seed dummies). Pure + deterministic
//? (`now` injected). `ticketKeyById` maps the stored ObjectId → the DEV-#### key the frontend renders.
export function aggregateUsage(rows: SpendRow[], ticketKeyById: Map<string, string>, now: number): WorkspaceUsage {
  const windowStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const perTicket = new Map<string, UsageByTicket>();
  const perDay = new Map<string, number>();
  let totalTokens = 0;
  let totalTurns = 0;
  for (const r of rows) {
    totalTokens += r.tokensIn + r.tokensOut;
    totalTurns += 1;
    if (r.ticketId) {
      const key = ticketKeyById.get(r.ticketId) ?? r.ticketId;
      const cur = perTicket.get(key) ?? { ticketKey: key, tokensIn: 0, tokensOut: 0, turns: 0 };
      cur.tokensIn += r.tokensIn; cur.tokensOut += r.tokensOut; cur.turns += 1;
      perTicket.set(key, cur);
    }
    if (r.createdAt >= windowStart) {
      const dayKey = r.createdAt.toISOString().slice(0, 10);
      perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + r.tokensIn + r.tokensOut);
    }
  }

  //? A dense 7-day series (oldest→newest) so the chart always has 7 bars, zero-filled.
  const activity: UsageDay[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const dayKey = d.toISOString().slice(0, 10);
    activity.push({ day: DAY_LABELS[d.getUTCDay()] ?? '', tokens: perDay.get(dayKey) ?? 0 });
  }

  const byTicket = [...perTicket.values()].toSorted((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut)).slice(0, 50);
  return { byTicket, activity, totalTokens, totalTurns };
}

//? Convenience: query a workspace's recent SpendRecord rows + aggregate them. Used outside the
//? tenant-scoped snapshot (which feeds `aggregateUsage` its own tenant rows).
export async function usageForWorkspace(prisma: PrismaClient, workspaceId: string, ticketKeyById: Map<string, string>, now: number): Promise<WorkspaceUsage> {
  const rows = await prisma.spendRecord.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 5000, select: { ticketId: true, tokensIn: true, tokensOut: true, createdAt: true } });
  return aggregateUsage(rows, ticketKeyById, now);
}
