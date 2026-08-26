//? Delivery analytics (ADR 0047, G1 — un-defers PRODUCT_ANALYTICS). A PURE, on-request fold over the
//? ticket rows + the already-aggregated usage: cycle-time (p50/p85 — p85 is the "how long does it really
//? take" default, robust to outliers), weekly throughput, stuck-points, and token cost by label. NO new
//? write path / model / verb (invariant: it folds the append-only log). Cost is in TOKENS, never € (#9).
//? Deterministic (`now` injected) — unit-testable with no DB.

import type { WorkspaceUsage, WorkspaceAnalytics } from '../../src/workspaces/_data/types';
import { dayKeyInTz, zonedDay, zonedToUtc } from '../util/dateTz';

const HOUR = 60 * 60 * 1000;

export interface AnalyticsTicket { key: string; status: string; archived: boolean; labels: string[]; createdAt: Date; updatedAt: Date }

//? The value at percentile `p` (0..1) of a sorted-ascending number array (nearest-rank). 0 for empty.
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? 0;
}
const round1 = (n: number): number => Math.round(n * 10) / 10;
//? A stuck-ish ticket needs operator attention (not shipping, not archived).
const STUCK = new Set(['stuck', 'paused', 'needs-input']);

//? Fold tickets + usage → the delivery analytics. `usage.byTicket` carries per-ticket tokens keyed by
//? the DEV-#### key; tickets carry the labels (the work TYPE) — join them for tokens-by-label.
export function computeAnalytics(tickets: AnalyticsTicket[], usage: WorkspaceUsage, now: number, timezone = 'UTC'): WorkspaceAnalytics {
  const cycleHours: number[] = [];
  let doneCount = 0;
  let openCount = 0;
  let stuckCount = 0;
  //? 4 weekly buckets (oldest→newest). D55 — the boundaries are the workspace's OWN midnights, so
  //? "this week" means the team's week (PRODUCT_ANALYTICS §"Bucketing in the workspace timezone") and
  //? the weekStart label is a team calendar day. Boundaries are built in CALENDAR space (day ± n, which
  //? Date.UTC normalises across month ends) rather than by subtracting 24h blocks, so a DST transition
  //? inside a window can't slide a boundary onto the neighbouring day.
  const today = zonedDay(new Date(now), timezone);
  const dayStart = (offsetDays: number): number => zonedToUtc({ ...today, day: today.day + offsetDays }, timezone).getTime();
  const weeks = [3, 2, 1, 0].map((back) => ({ start: dayStart(-7 * back - 6), end: dayStart(-7 * back + 1), done: 0, label: '' }));
  for (const w of weeks) w.label = dayKeyInTz(new Date(w.start), timezone);

  for (const t of tickets) {
    if (t.archived) continue;
    if (t.status === 'done') {
      doneCount += 1;
      const done = t.updatedAt.getTime();
      cycleHours.push(Math.max(0, done - t.createdAt.getTime()) / HOUR);
      for (const w of weeks) if (done >= w.start && done < w.end) w.done += 1;
    } else {
      openCount += 1;
      if (STUCK.has(t.status)) stuckCount += 1;
    }
  }
  const cycleSorted = cycleHours.toSorted((a, b) => a - b);

  //? tokens-by-label: attribute each ticket's tokens to each of its labels (a ticket with 2 labels
  //? counts under both — the operator reads "where do tokens go by work type"). Unlabelled → 'unlabelled'.
  const tokensByKey = new Map(usage.byTicket.map((u) => [u.ticketKey, u.tokensIn + u.tokensOut]));
  const byLabel = new Map<string, number>();
  for (const t of tickets) {
    const tokens = tokensByKey.get(t.key) ?? 0;
    if (tokens === 0) continue;
    const labels = t.labels.length > 0 ? t.labels : ['unlabelled'];
    for (const l of labels) byLabel.set(l, (byLabel.get(l) ?? 0) + tokens);
  }
  const tokensByLabel = [...byLabel.entries()].map(([label, tokens]) => ({ label, tokens })).toSorted((a, b) => b.tokens - a.tokens).slice(0, 12);

  return {
    cycleP50Hours: round1(percentile(cycleSorted, 0.5)),
    cycleP85Hours: round1(percentile(cycleSorted, 0.85)),
    throughputByWeek: weeks.map((w) => ({ weekStart: w.label, done: w.done })),
    stuckCount, doneCount, openCount,
    tokensByLabel,
    totalTokens: usage.totalTokens,
  };
}
