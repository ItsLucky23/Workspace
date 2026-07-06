//? Content analytics (F5.1, ADR 0071) — a PURE fold over a channel/workspace's content pieces + media
//? spend + publish jobs. What ships (done/published), where pieces sit (by stage), what's made (by format),
//? and the metered € cost. Deterministic → testable. Views/CTR are placeholders until platform keys land.

export interface ContentAnalyticsPiece { stageId: string; status: string; format: string; archived: boolean }
export interface ContentAnalyticsSpend { feature: string; costCents: number }
export interface ContentAnalyticsPublish { status: string }

export interface ContentAnalytics {
  totalPieces: number;
  doneCount: number;
  publishedCount: number;
  byStage: { stage: string; count: number }[];
  byFormat: { format: string; count: number }[];
  totalCostCents: number;
  costByFeature: { feature: string; cents: number }[];
}

function countBy<T>(items: T[], key: (t: T) => string): { k: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) { const k = key(it); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([k, count]) => ({ k, count })).toSorted((a, b) => b.count - a.count);
}

export function computeContentAnalytics(pieces: ContentAnalyticsPiece[], spend: ContentAnalyticsSpend[], publishJobs: ContentAnalyticsPublish[]): ContentAnalytics {
  const live = pieces.filter((p) => !p.archived);
  const costByFeatureMap = new Map<string, number>();
  let totalCostCents = 0;
  for (const s of spend) { costByFeatureMap.set(s.feature, (costByFeatureMap.get(s.feature) ?? 0) + s.costCents); totalCostCents += s.costCents; }
  return {
    totalPieces: live.length,
    doneCount: live.filter((p) => p.status === 'done').length,
    publishedCount: publishJobs.filter((j) => j.status === 'done').length,
    byStage: countBy(live, (p) => p.stageId).map((e) => ({ stage: e.k, count: e.count })),
    byFormat: countBy(live, (p) => p.format).map((e) => ({ format: e.k, count: e.count })),
    totalCostCents,
    costByFeature: [...costByFeatureMap.entries()].map(([feature, cents]) => ({ feature, cents })).toSorted((a, b) => b.cents - a.cents),
  };
}
