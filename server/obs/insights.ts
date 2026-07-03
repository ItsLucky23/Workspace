//? Insights (#5) — the workspace-level flow metrics an operator/PM reads: how long a ticket takes
//? (cycle time), how many ship per week (throughput), and the average token cost per ticket. A PURE
//? aggregate over the ticket rows + the already-computed usage, so the snapshot can emit it and it's
//? unit-testable with no DB. All advisory — never gates anything.

import type { WorkspaceUsage, WorkspaceInsights } from '../../src/workspaces/_data/types';

export type { WorkspaceInsights } from '../../src/workspaces/_data/types';

//? Minimal ticket shape the aggregate needs (createdAt→updatedAt is the cycle proxy; a ticket has
//? no explicit doneAt, so a `done` ticket's last update stands in for completion time).
export interface InsightTicket { status: string; archived: boolean; createdAt: Date; updatedAt: Date }

const HOUR = 60 * 60 * 1000;

//? Roll ticket rows + usage into the insights. `now` injected for deterministic tests.
export function computeInsights(tickets: InsightTicket[], usage: WorkspaceUsage, now: number): WorkspaceInsights {
  const windowStart = now - 7 * 24 * HOUR;
  let cycleSum = 0;
  let doneCount = 0;
  let throughput7d = 0;
  let openCount = 0;
  for (const t of tickets) {
    if (t.archived) continue;
    if (t.status === 'done') {
      doneCount += 1;
      cycleSum += Math.max(0, t.updatedAt.getTime() - t.createdAt.getTime());
      if (t.updatedAt.getTime() >= windowStart) throughput7d += 1;
    } else {
      openCount += 1;
    }
  }
  const avgCycleHours = doneCount > 0 ? Math.round((cycleSum / doneCount / HOUR) * 10) / 10 : 0;
  //? Cost per ticket = mean tokens across the tickets that actually ran turns (not all tickets).
  const ticketsWithUsage = usage.byTicket.length;
  const avgTokensPerTicket = ticketsWithUsage > 0 ? Math.round(usage.totalTokens / ticketsWithUsage) : 0;
  return { avgCycleHours, throughput7d, avgTokensPerTicket, doneCount, openCount };
}
