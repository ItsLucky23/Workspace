//? Cost/usage tracking (#16) — VISIBILITY ONLY, never a hard stop (the CapacityManager #12 is the
//? concurrency control; this is the "what did it cost" read). After every turn the stage-runner
//? records a SpendRecord (token estimate + cost) and bumps the session's running estimate + the
//? workspace's rolling spend. We run on the Max SUBSCRIPTION, so the Claude CLI exposes no usage
//? field — tokens are ESTIMATED from the char count (the P0.5 spike's finding), and the monetary
//? cost is 0 unless a per-model price is set. The value shown to the user is token VOLUME + time.

import { tryCatchSync } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import type { AiUsage, UsageByTicket, UsageDay, WorkspaceUsage } from '../../src/workspaces/_data/types';

//? Rough chars→tokens (~4 chars/token for English+code). Advisory, not billing-grade.
const CHARS_PER_TOKEN = 4;
export const estTokens = (chars: number): number => Math.max(0, Math.ceil(chars / CHARS_PER_TOKEN));

//? Per-model price per 1k tokens (D31), blended in+out. Claude models are intentionally ABSENT →
//? priceFor()=0: the coding agent runs on the Max SUBSCRIPTION (CLAUDE.md invariant 6), so it has no
//? metered € cost — only token volume. Metered API providers (Gemini) DO bill per token → advisory
//? blended defaults. A self-host operator paying per-token can override any model via the
//? WS_MODEL_PRICE_PER_1K_JSON env (a JSON object model→number/1k), merged over these defaults.
const DEFAULT_MODEL_PRICE_PER_1K: Record<string, number> = {
  'gemini-2.5-flash': 0.0015,
  'gemini-2.5-pro': 0.012,
  'gemini-1.5-flash': 0.0005,
  'gemini-1.5-pro': 0.006,
  'gemini-embedding-001': 0.0001,
};
function priceMap(): Record<string, number> {
  const merged: Record<string, number> = { ...DEFAULT_MODEL_PRICE_PER_1K };
  const [, override] = tryCatchSync(() => JSON.parse(process.env.WS_MODEL_PRICE_PER_1K_JSON ?? '{}') as unknown);
  if (override !== null && typeof override === 'object' && !Array.isArray(override)) {
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) merged[k] = v;
    }
  }
  return merged;
}
export const priceFor = (model: string): number => priceMap()[model] ?? 0;

export interface TurnSpendInput {
  workspaceId: string; userId?: string | null; ticketId?: string | null; stageId?: string | null;
  sessionKey: string; model: string; inputChars: number; outputChars: number;
  providerId?: string | null; feature?: string | null;
  //? Real usage from a metered provider (Gemini usageMetadata) — preferred over the char-estimate when present.
  tokensIn?: number; tokensOut?: number;
}

//? Record one turn's usage. Best-effort — a failed spend write must NEVER fail the turn (it's
//? advisory), so the caller wraps this in tryCatch. Increments the session's running token
//? estimate (feeds the #4 self-handoff) and the enabled budgets' rolling `spent` (display only —
//? no enforcement/pause here, #16 is show-only).
export async function recordTurnSpend(prisma: PrismaClient, input: TurnSpendInput): Promise<{ tokensIn: number; tokensOut: number; costEstimate: number }> {
  const tokensIn = input.tokensIn ?? estTokens(input.inputChars);
  const tokensOut = input.tokensOut ?? estTokens(input.outputChars);
  const costEstimate = ((tokensIn + tokensOut) / 1000) * priceFor(input.model);
  await prisma.spendRecord.create({
    data: {
      workspaceId: input.workspaceId, userId: input.userId ?? null, ticketId: input.ticketId ?? null, stageId: input.stageId ?? null,
      sessionKey: input.sessionKey, tokensIn, tokensOut, model: input.model, costEstimate,
      providerId: input.providerId ?? null, feature: input.feature ?? null,
    },
  });
  await prisma.agentSession.updateMany({ where: { workspaceId: input.workspaceId, sessionKey: input.sessionKey }, data: { tokenEstimate: { increment: tokensIn + tokensOut } } });
  //? Rolling spend for the caps display (never enforced here — #16 is visibility only).
  if (costEstimate > 0) await prisma.workspaceBudget.updateMany({ where: { workspaceId: input.workspaceId, enabled: true }, data: { spent: { increment: costEstimate } } });
  return { tokensIn, tokensOut, costEstimate };
}

//? #99 — is the workspace at/over an ENFORCED metered budget cap? Reads the enforcement field (#103) that
//? was previously stored-but-never-read. Only METERED spend accrues `spent` (costEstimate>0 → Gemini/media;
//? the Claude subscription is 0), so a Claude-only workspace never trips this — exactly decision B (€-metered
//? enforcement, token/Claude stays visibility-only). Best-effort (a read failure = not enforced, never blocks).
export async function isSpendEnforcementActive(prisma: PrismaClient, workspaceId: string): Promise<boolean> {
  //? luckystack-allow tenant-scope: called from the background provision loop (no runInTenant context, like
  //? the reaper/watchdog reads); explicitly filtered by the passed workspaceId, so it is tenant-safe.
  const caps = await prisma.workspaceBudget.findMany({
    where: { workspaceId, enabled: true, enforcement: { in: ['pauseNew', 'pauseAll'] } },
    select: { cap: true, spent: true },
  });
  if (caps.some((c) => c.cap > 0 && c.spent >= c.cap)) return true;
  //? Host-wide ceiling: one runaway workspace must not be able to run the TOTAL bill unbounded.
  return await isHostSpendCapReached(prisma);
}

//? Host-wide metered €-ceiling (gap-scan blind spot: budgets were per-workspace only). Configured by the
//? self-host operator via WS_HOST_SPEND_CAP_EUR (0/absent = no host cap). Total = every workspace's
//? metered spend: the mediaSpend €-ledger (cents) + the SpendRecord costEstimate (€, Gemini). Enforced
//? with pauseNew semantics through isSpendEnforcementActive + the media pre-generation guard. The
//? aggregate is cached briefly so per-generation checks don't rescan both tables.
const HOST_CAP_CACHE_MS = 60_000;
const hostCapCache = { at: 0, totalCents: 0 };
export async function hostSpendTotalCents(prisma: PrismaClient, opts: { fresh?: boolean } = {}): Promise<number> {
  //? F34 — the cache is a throughput optimisation for the common case (far below the cap). Near or over
  //? the cap it is exactly wrong: a 60-second-stale total is how parallel generations sail past the limit.
  //? So a caller that is about to SPEND asks for a fresh read, and the cache self-invalidates once the
  //? last known total is within 10% of the cap.
  const cap = hostSpendCapCents();
  const nearCap = cap > 0 && hostCapCache.totalCents >= cap * 0.9;
  if (!opts.fresh && !nearCap && Date.now() - hostCapCache.at < HOST_CAP_CACHE_MS) return hostCapCache.totalCents;
  //? luckystack-allow tenant-scope: a deliberately host-wide aggregate (the whole point of the cap).
  const media = await prisma.mediaSpend.aggregate({ _sum: { costCents: true } });
  //? luckystack-allow tenant-scope: same host-wide aggregate.
  const records = await prisma.spendRecord.aggregate({ _sum: { costEstimate: true } });
  hostCapCache.totalCents = (media._sum.costCents ?? 0) + Math.round((records._sum.costEstimate ?? 0) * 100);
  hostCapCache.at = Date.now();
  return hostCapCache.totalCents;
}
export function hostSpendCapCents(): number {
  const eur = Number(process.env.WS_HOST_SPEND_CAP_EUR ?? '0');
  return Number.isFinite(eur) && eur > 0 ? Math.round(eur * 100) : 0;
}
export async function isHostSpendCapReached(prisma: PrismaClient): Promise<boolean> {
  const cap = hostSpendCapCents();
  if (cap <= 0) return false;
  //? A cap CHECK always reads fresh: this is the guard, not a dashboard number.
  return (await hostSpendTotalCents(prisma, { fresh: true })) >= cap;
}
//? Test hook: drop the cached aggregate so a test sees fresh sums.
export function resetHostSpendCache(): void { hostCapCache.at = 0; }

//? Usage shapes live in the client `_data/types` (the snapshot emits them); re-exported for callers.
export type { AiUsage, UsageByTicket, UsageDay, WorkspaceUsage } from '../../src/workspaces/_data/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

//? A SpendRecord row (the fields the aggregate reads) — decoupled from Prisma's model type so
//? `aggregateUsage` is a PURE, unit-testable function the snapshot feeds tenant-scoped rows into.
//? providerId/feature/costEstimate feed the per-AI breakdown; optional so pre-per-AI callers still compile.
export interface SpendRow { ticketId: string | null; tokensIn: number; tokensOut: number; createdAt: Date; providerId?: string | null; feature?: string | null; costEstimate?: number; userId?: string | null }

//? Human labels for the known AI providers (the raw id is the fallback for anything new/unknown).
const PROVIDER_LABELS: Record<string, string> = { 'claude-cli': 'Claude (CLI)', 'gemini-api': 'Gemini API' };

//? Aggregate spend PER AI (provider + feature/role) — the per-AI usage breakdown. Rows with no provider
//? land in an 'unknown' bucket; `subscription` marks the Claude PTY coding agent (Max subscription — token
//? volume only, no metered €). Sorted by total tokens desc. Pure + exported for tests.
export function aggregateByAi(rows: SpendRow[]): AiUsage[] {
  const per = new Map<string, AiUsage>();
  for (const r of rows) {
    const providerId = r.providerId ?? 'unknown';
    const feature = r.feature ?? 'unknown';
    const key = `${providerId}::${feature}`;
    const cur = per.get(key) ?? { providerId, providerLabel: PROVIDER_LABELS[providerId] ?? providerId, feature, tokensIn: 0, tokensOut: 0, turns: 0, costEstimate: 0, subscription: providerId === 'claude-cli' };
    cur.tokensIn += r.tokensIn; cur.tokensOut += r.tokensOut; cur.turns += 1; cur.costEstimate += r.costEstimate ?? 0;
    per.set(key, cur);
  }
  return [...per.values()].toSorted((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut));
}

//? H2 — per-user spend rows (attribution). Pure over rows carrying a userId + tokens + cost.
export interface UserSpendRow { userId: string | null; tokensIn: number; tokensOut: number; costEstimate: number }
export interface UserUsage { userId: string; tokensIn: number; tokensOut: number; turns: number; costEstimate: number }

//? Aggregate spend PER USER (the H2 attribution / fairness read): who is burning the tokens. Unattributed rows
//? (no userId — e.g. system turns) are grouped under 'system'. Sorted by total tokens desc. Pure.
export function aggregateByUser(rows: UserSpendRow[]): UserUsage[] {
  const perUser = new Map<string, UserUsage>();
  for (const r of rows) {
    const key = r.userId ?? 'system';
    const cur = perUser.get(key) ?? { userId: key, tokensIn: 0, tokensOut: 0, turns: 0, costEstimate: 0 };
    cur.tokensIn += r.tokensIn; cur.tokensOut += r.tokensOut; cur.turns += 1; cur.costEstimate += r.costEstimate;
    perUser.set(key, cur);
  }
  return [...perUser.values()].toSorted((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut));
}

//? H2 — a per-user budget check (advisory, matching #16's visibility-first model): has this user's token spend in
//? the window crossed their cap? `capTokens <= 0` = no cap (never exceeded). Pure — the caller decides to warn/pause.
export function userBudgetExceeded(userTokens: number, capTokens: number): boolean {
  return capTokens > 0 && userTokens >= capTokens;
}

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
  //? #100 — per-user attribution folded in (tokens/cost per member) for the Usage 'by person' card.
  const byUser = aggregateByUser(rows.map((r) => ({ userId: r.userId ?? null, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costEstimate: r.costEstimate ?? 0 })));
  return { byTicket, activity, totalTokens, totalTurns, byAi: aggregateByAi(rows), byUser };
}

//? Convenience: query a workspace's recent SpendRecord rows + aggregate them. Used outside the
//? tenant-scoped snapshot (which feeds `aggregateUsage` its own tenant rows).
export async function usageForWorkspace(prisma: PrismaClient, workspaceId: string, ticketKeyById: Map<string, string>, now: number): Promise<WorkspaceUsage> {
  const rows = await prisma.spendRecord.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 5000, select: { ticketId: true, tokensIn: true, tokensOut: true, createdAt: true, providerId: true, feature: true, costEstimate: true, userId: true } });
  return aggregateUsage(rows, ticketKeyById, now);
}
