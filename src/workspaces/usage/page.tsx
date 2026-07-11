//? Workspaces — Usage. No monetary budget/cap/alert (we run Claude via the Pro
//? Max CLI subscription, not a metered API), so this is about token volume +
//? time + who handled what. Activity chart, per-ticket breakdown (tokens +
//? time, no cost), and a per-member breakdown with counters. Dummy data.

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { AvatarBubble, EmptyState } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { Member, Ticket } from '../_data/types';

function Card({ title, desc, children, className }: { title: string; desc?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-container1-border bg-container1 p-5 ${className ?? ''}`}>
      <div className="mb-4">
        <div className="text-base font-semibold text-title">{title}</div>
        {desc && <div className="text-sm text-muted mt-0.5">{desc}</div>}
      </div>
      {children}
    </section>
  );
}

export const template = 'workspaces';

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold text-title mt-1 tabular-nums">{value}</div>
      <div className="text-xs text-muted mt-0.5">{hint}</div>
    </div>
  );
}

export default function Usage() {
  const { openTicket, tickets, membersById, usage, insights, analytics, budget, editBudget, resumeSpend } = useWorkspaces();
  const translate = useTranslator();
  //? AI/token €-budget editor (D81) — the first save creates the budget if none exists (conductor upsert).
  const [capInput, setCapInput] = useState(budget ? String(budget.cap) : '');
  const [alertInput, setAlertInput] = useState(budget ? String(budget.alertPct) : '80');
  const budgetSpentLabel = budget ? `€${budget.spent.toFixed(2)} / €${budget.cap.toFixed(2)}` : '';
  //? Real 7-day token activity (#16); guard the divisor so an all-zero week doesn't divide by 0.
  const maxDay = Math.max(1, ...usage.activity.map((d) => d.tokens));

  const byMember = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const handler = t.assigneeId ?? t.creatorId;
      if (!handler) continue;
      const list = map.get(handler) ?? [];
      list.push(t);
      map.set(handler, list);
    }
    return [...map.entries()]
      .map(([uid, ticketList]) => ({ member: membersById[uid], tickets: ticketList }))
      .filter((x): x is { member: Member; tickets: Ticket[] } => Boolean(x.member))
      .toSorted((a, b) => b.tickets.length - a.tickets.length);
  }, [tickets, membersById]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.usage.title' })}</h1>
        <span className="text-sm text-muted">{translate({ key: 'workspaces.usage.subtitle' })}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="flex flex-col gap-4">
          {/* Flow insights (#5): cycle time · throughput · cost per ticket */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label={translate({ key: 'workspaces.usage.insightCycle' })}
              value={insights.avgCycleHours > 0 ? `${String(insights.avgCycleHours)} h` : '—'}
              hint={translate({ key: 'workspaces.usage.insightCycleHint', params: [{ key: 'count', value: insights.doneCount }] })}
            />
            <StatCard
              label={translate({ key: 'workspaces.usage.insightThroughput' })}
              value={String(insights.throughput7d)}
              hint={translate({ key: 'workspaces.usage.insightThroughputHint' })}
            />
            <StatCard
              label={translate({ key: 'workspaces.usage.insightCost' })}
              value={insights.avgTokensPerTicket > 0 ? String(insights.avgTokensPerTicket) : '—'}
              hint={translate({ key: 'workspaces.usage.insightCostHint' })}
            />
          </div>

          {/* AI/token €-budget (D81): current spend vs cap + an editor (first save creates it) + resume. */}
          <Card title={translate({ key: 'workspaces.usage.budgetTitle' })} desc={translate({ key: 'workspaces.usage.budgetDesc' })}>
            {budget
              ? (
                <div className="flex flex-col gap-2 mb-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">{translate({ key: 'workspaces.usage.budgetSpent' })}</span>
                    <span className="font-mono tabular-nums text-title">{budgetSpentLabel}</span>
                  </div>
                  <div className="h-2 rounded-full bg-container2 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${String(Math.min(100, budget.cap > 0 ? (budget.spent / budget.cap) * 100 : 0))}%` }} />
                  </div>
                </div>
              )
              : <div className="text-sm text-muted mb-3">{translate({ key: 'workspaces.usage.budgetNone' })}</div>}
            <div className="flex items-end gap-2 flex-wrap">
              <label className="flex flex-col gap-1 text-xs text-muted">{translate({ key: 'workspaces.usage.budgetCapLabel' })}
                <input type="number" min="0" step="1" value={capInput} onChange={(e) => { setCapInput(e.target.value); }} className="h-9 w-28 px-3 rounded-lg border border-container2-border bg-container2 text-sm text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">{translate({ key: 'workspaces.usage.budgetAlertLabel' })}
                <input type="number" min="0" max="100" step="5" value={alertInput} onChange={(e) => { setAlertInput(e.target.value); }} className="h-9 w-24 px-3 rounded-lg border border-container2-border bg-container2 text-sm text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring" />
              </label>
              <button type="button" disabled={!(Number(capInput) > 0)} onClick={() => { editBudget(Number(capInput), alertInput.trim() ? Number(alertInput) : undefined); }} className="h-9 rounded-lg bg-primary text-title-primary px-3 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">{translate({ key: 'workspaces.usage.budgetSave' })}</button>
              {budget && <button type="button" onClick={() => { resumeSpend(); }} className="h-9 rounded-lg border border-container1-border bg-container1 px-3 text-sm text-common hover:bg-container2 cursor-pointer">{translate({ key: 'workspaces.usage.budgetResume' })}</button>}
            </div>
          </Card>

          {/* Delivery analytics (ADR 0047): cycle p50/p85 · weekly throughput · stuck · tokens by type */}
          <Card title={translate({ key: 'workspaces.usage.analyticsTitle' })} desc={translate({ key: 'workspaces.usage.analyticsDesc' })}>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <StatCard label={translate({ key: 'workspaces.usage.cycleP85' })} value={analytics.cycleP85Hours > 0 ? `${String(analytics.cycleP85Hours)} h` : '—'} hint={`p50 ${analytics.cycleP50Hours > 0 ? `${String(analytics.cycleP50Hours)} h` : '—'}`} />
              <StatCard label={translate({ key: 'workspaces.usage.stuck' })} value={String(analytics.stuckCount)} hint={`${String(analytics.openCount)} open`} />
              <StatCard label={translate({ key: 'workspaces.usage.weeklyThroughput' })} value={String(analytics.throughputByWeek.at(-1)?.done ?? 0)} hint={`${String(analytics.doneCount)} done`} />
            </div>
            <div className="flex items-end gap-3 h-24 mb-4">
              {analytics.throughputByWeek.map((w) => {
                const max = Math.max(1, ...analytics.throughputByWeek.map((x) => x.done));
                return (
                  <div key={w.weekStart} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full rounded-t-md bg-primary/70" style={{ height: `${String(Math.round((w.done / max) * 100))}%` }} />
                    <span className="text-[10px] text-muted">{w.weekStart.slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-xs font-medium text-muted mb-1.5">{translate({ key: 'workspaces.usage.tokensByType' })}</div>
            <div className="flex flex-col gap-1">
              {analytics.tokensByLabel.length === 0
                ? <div className="text-sm text-disabled">—</div>
                : analytics.tokensByLabel.map((t) => {
                  const tokLabel = `${String(t.tokens)} tok`;
                  return (
                    <div key={t.label} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-title truncate">{t.label}</span>
                      <span className="text-muted font-mono">{tokLabel}</span>
                    </div>
                  );
                })}
            </div>
          </Card>

          <Card title={translate({ key: 'workspaces.usage.activityTitle' })}>
            <div className="flex items-end gap-3 h-36">
              {usage.activity.map((d, i) => (
                <div key={`${d.day}-${String(i)}`} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full flex items-end justify-center h-full" title={`${String(d.tokens)} ${translate({ key: 'workspaces.usage.tokens' })}`}>
                    <div className="w-full max-w-16 rounded-t-lg bg-primary/70 hover:bg-primary transition-colors" style={{ height: `${String((d.tokens / maxDay) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-muted">{d.day}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <Card title={translate({ key: 'workspaces.usage.byTicketTitle' })} desc={translate({ key: 'workspaces.usage.byTicketDesc' })}>
              {usage.byTicket.length === 0 ? (
                <EmptyState icon="chart-simple" title={translate({ key: 'workspaces.usage.emptyTitle' })} sub={translate({ key: 'workspaces.usage.emptySub' })} />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-divider">
                      <th className="py-2 font-medium">{translate({ key: 'workspaces.usage.colTicket' })}</th>
                      <th className="py-2 font-medium text-right">{translate({ key: 'workspaces.usage.colTokensIn' })}</th>
                      <th className="py-2 font-medium text-right">{translate({ key: 'workspaces.usage.colTokensOut' })}</th>
                      <th className="py-2 font-medium text-right">{translate({ key: 'workspaces.usage.colTurns' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byTicket.map((r) => (
                      <tr key={r.ticketKey} className="border-b border-divider last:border-0 hover:bg-container2/40 cursor-pointer" onClick={() => { openTicket(r.ticketKey); }}>
                        <td className="py-2.5 font-mono text-xs text-primary">{r.ticketKey}</td>
                        <td className="py-2.5 text-right font-mono text-xs text-muted tabular-nums">{r.tokensIn}</td>
                        <td className="py-2.5 text-right font-mono text-xs text-muted tabular-nums">{r.tokensOut}</td>
                        <td className="py-2.5 text-right text-xs text-muted tabular-nums">{r.turns}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title={translate({ key: 'workspaces.usage.byPersonTitle' })} desc={translate({ key: 'workspaces.usage.byPersonDesc' })}>
              <div className="flex flex-col gap-2">
                {byMember.map(({ member, tickets }) => (
                  <div key={member.id} className="flex items-start gap-3 py-2 border-b border-divider last:border-0">
                    <div className="w-8 h-8 shrink-0"><AvatarBubble user={member} size={32} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-title">{member.name}</span>
                        <span className="rounded-full bg-container2 px-2 text-xs text-muted">{tickets.length} {tickets.length === 1 ? translate({ key: 'workspaces.usage.ticketSingular' }) : translate({ key: 'workspaces.usage.ticketPlural' })}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tickets.map((t) => (
                          <button key={t.id} type="button" onClick={() => { openTicket(t.id); }} className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-mono text-common hover:bg-container2-hover cursor-pointer">{t.id}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Per-AI usage breakdown (tokens + cost per provider/role). Claude PTY = subscription (token
              volume only); metered API providers (Gemini) show a real € cost. Card-list → reflows mobile+desktop. */}
          <Card title={translate({ key: 'workspaces.usage.byAiTitle' })} desc={translate({ key: 'workspaces.usage.byAiDesc' })}>
            {usage.byAi.length === 0 ? (
              <EmptyState icon="chart-simple" title={translate({ key: 'workspaces.usage.byAiEmptyTitle' })} sub={translate({ key: 'workspaces.usage.byAiEmptySub' })} />
            ) : (
              <div className="flex flex-col gap-2">
                {usage.byAi.map((a) => {
                  const tokLabel = `${String(a.tokensIn + a.tokensOut)} tok`;
                  const costLabel = `€${a.costEstimate.toFixed(2)}`;
                  return (
                    <div key={`${a.providerId}-${a.feature}`} className="flex items-center gap-3 py-2 border-b border-divider last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-title">{a.providerLabel}</span>
                          <span className="rounded-full bg-container2 px-2 text-xs text-muted">{a.feature}</span>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-muted tabular-nums">{tokLabel}</span>
                      {a.subscription ? (
                        <span className="shrink-0 rounded-md bg-container2 px-2 py-0.5 text-xs text-muted">{translate({ key: 'workspaces.usage.subscriptionBadge' })}</span>
                      ) : (
                        <span className="shrink-0 text-sm font-medium text-title tabular-nums">{costLabel}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="flex items-center gap-2 text-xs text-muted">
            <Icon name="circle-question" /> {translate({ key: 'workspaces.usage.runawayNote' })}
          </div>
        </div>
      </div>
    </div>
  );
}
