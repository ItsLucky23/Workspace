//? intent: Show where the workspace's AI effort goes — tokens per day/ticket/person/provider — plus delivery analytics, spend caps and an AI root-cause diagnosis.
//? Workspaces — Usage. The Claude coding agent runs on the Pro Max CLI
//? subscription (token VOLUME, no metered €), but metered API providers (e.g.
//? Gemini) DO carry real cost — hence the D81/#103 multi-cap €-budget editor +
//? resume-spend, folded behind the "Budgets & caps" disclosure. Default tab =
//? token usage (7-day activity + the per-ticket drill-in); Delivery (ADR 0047)
//? and People (#100 SpendRecord attribution) are secondary tabs; root-cause
//? diagnosis (ADR 0042) sits behind its own disclosure. Data comes from the
//? real SpendRecord aggregate (server aggregateUsage), not dummy rows.

import { useMemo, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { AvatarBubble, Disclosure, EmptyState, SectionCard, Tabs, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { Member, Ticket } from '../../_data/types';

export const template = 'workspaces';

type UsageTab = 'usage' | 'delivery' | 'people';

//? Compact token count for the always-visible per-bar labels (hover must not be the only reading).
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={`rounded-2xl border border-container1-border bg-container1 p-5`}>
      <div className={`text-xs text-muted`}>{label}</div>
      <div className={`text-2xl font-semibold text-title mt-1 tabular-nums`}>{value}</div>
      <div className={`text-xs text-muted mt-0.5`}>{hint}</div>
    </div>
  );
}

export default function Usage() {
  const { openTicket, navigate, tickets, membersById, usage, insights, analytics, budget, budgets, editBudget, resumeSpend, diagnoseRootCause } = useWorkspaces();
  const translate = useTranslator();
  const [tab, setTab] = useState<UsageTab>('usage');
  //? root-cause (ADR 0042) — a symptom → the likely-culprit merge as a rollback suggestion (AI panel).
  const [symptom, setSymptom] = useState('');
  //? AI/token €-budget editor (D81) — the first save creates the budget if none exists (conductor upsert).
  const [capInput, setCapInput] = useState(budget ? String(budget.cap) : '');
  const [alertInput, setAlertInput] = useState(budget ? String(budget.alertPct) : '80');
  //? #103 — a label for the "add another cap" form (multi-cap).
  const [labelInput, setLabelInput] = useState('');
  //? The near-cap status strip "opens" the collapsed Budgets disclosure by remounting it open (seed>0).
  const [budgetsSeed, setBudgetsSeed] = useState(0);
  const budgetsRef = useRef<HTMLDivElement>(null);
  const budgetSpentLabel = budget ? `€${budget.spent.toFixed(2)} / €${budget.cap.toFixed(2)}` : '';
  //? Real 7-day token activity (#16); guard the divisor so an all-zero week doesn't divide by 0.
  const maxDay = Math.max(1, ...usage.activity.map((d) => d.tokens));
  //? Same guard for the weekly-throughput chart (ADR 0047).
  const weekMax = Math.max(1, ...analytics.throughputByWeek.map((x) => x.done));
  //? Page-level teaching empty state: no per-ticket rows AND an all-zero activity week.
  const pageEmpty = usage.byTicket.length === 0 && usage.activity.every((d) => d.tokens === 0);
  const spentPct = budget && budget.cap > 0 ? Math.min(100, (budget.spent / budget.cap) * 100) : 0;
  const nearCap = budget !== null && budget.cap > 0 && (budget.spent / budget.cap) * 100 >= budget.alertPct;

  const revealBudgets = () => {
    setBudgetsSeed((s) => s + 1);
    budgetsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

  //? #100 — real per-user token/cost attribution (from the SpendRecord aggregate), keyed by userId.
  const usageByUser = useMemo(() => new Map(usage.byUser.map((u) => [u.userId, u])), [usage.byUser]);

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <div className={`px-4 md:px-6 pt-3 md:pt-4 shrink-0`}>
        <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.usage.title' })}</h1>
        <span className={`text-sm text-muted`}>{translate({ key: 'workspaces.usage.subtitle' })}</span>
        <div className={`mt-3`}>
          <Tabs
            tabs={[
              { id: 'usage', label: translate({ key: 'workspaces.usage.title' }) },
              { id: 'delivery', label: translate({ key: 'workspaces.usage.tabDelivery' }) },
              { id: 'people', label: translate({ key: 'workspaces.usage.tabPeople' }) },
            ]}
            active={tab}
            onChange={(id) => { setTab(id as UsageTab); }}
          />
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8 pt-4`}>
        {tab === 'usage' && (
          <div className={`flex flex-col gap-4`}>
            {/* Near/over-threshold spend strip (status only — the full editor stays behind the disclosure). */}
            {nearCap && (
              <button type="button" onClick={revealBudgets} className={`flex items-center gap-3 flex-wrap rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-left cursor-pointer`}>
                <Icon name="triangle-exclamation" className={`text-warning shrink-0`} />
                <span className={`text-sm font-medium text-warning`}>{translate({ key: 'workspaces.usage.capAlertStrip' })}</span>
                <span className={`font-mono tabular-nums text-sm text-title`}>{budgetSpentLabel}</span>
                <span className={`flex-1 min-w-16 h-1.5 rounded-full bg-container2 overflow-hidden`}>
                  <span className={`block h-full bg-warning`} style={{ width: `${String(spentPct)}%` }} />
                </span>
                <span className={`text-sm text-warning underline`}>{translate({ key: 'workspaces.usage.capAlertView' })}</span>
              </button>
            )}

            {pageEmpty ? (
              //? The teaching page-level empty state: what this place is for + the action that produces data.
              <SectionCard>
                <EmptyState
                  icon="chart-column"
                  title={translate({ key: 'workspaces.usage.emptyTitle' })}
                  sub={translate({ key: 'workspaces.usage.pageEmptySub' })}
                  action={<WsButton variant="primary" icon="table-columns" onClick={() => { navigate('board'); }}>{translate({ key: 'workspaces.usage.pageEmptyCta' })}</WsButton>}
                />
              </SectionCard>
            ) : (
              <>
                {/* Flow insights (#5): cycle time · throughput · tokens per ticket */}
                <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4`}>
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

                {/* Real 7-day token activity (#16) — per-bar value labels so hover isn't the only reading. */}
                <SectionCard title={translate({ key: 'workspaces.usage.activityTitle' })}>
                  <div className={`flex gap-2 sm:gap-3 h-40`}>
                    {usage.activity.map((d, i) => (
                      <div key={`${d.day}-${String(i)}`} className={`flex-1 min-w-0 h-full flex flex-col items-center gap-1`}>
                        <span className={`text-[10px] text-muted tabular-nums`}>{fmtTokens(d.tokens)}</span>
                        <div className={`w-full flex-1 flex items-end justify-center`} title={`${String(d.tokens)} ${translate({ key: 'workspaces.usage.tokens' })}`}>
                          <div className={`w-full max-w-16 rounded-t-lg bg-primary/70 hover:bg-primary transition-colors`} style={{ height: `${String((d.tokens / maxDay) * 100)}%` }} />
                        </div>
                        <span className={`text-xs text-muted`}>{d.day}</span>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                {/* The drill-in surface: per-ticket breakdown, rows open the ticket. */}
                <SectionCard title={translate({ key: 'workspaces.usage.byTicketTitle' })} desc={translate({ key: 'workspaces.usage.byTicketDesc' })}>
                  {usage.byTicket.length === 0 ? (
                    <EmptyState icon="chart-column" title={translate({ key: 'workspaces.usage.emptyTitle' })} sub={translate({ key: 'workspaces.usage.emptySub' })} />
                  ) : (
                    <div className={`overflow-x-auto`}>
                      <table className={`w-full text-sm`}>
                        <thead>
                          <tr className={`text-left text-xs text-muted border-b border-divider`}>
                            <th className={`py-2 font-medium`}>{translate({ key: 'workspaces.usage.colTicket' })}</th>
                            <th className={`py-2 font-medium text-right`}>{translate({ key: 'workspaces.usage.colTokensIn' })}</th>
                            <th className={`py-2 font-medium text-right`}>{translate({ key: 'workspaces.usage.colTokensOut' })}</th>
                            <th className={`py-2 font-medium text-right`}>{translate({ key: 'workspaces.usage.colTurns' })}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usage.byTicket.map((r) => (
                            <tr key={r.ticketKey} className={`border-b border-divider last:border-0 hover:bg-container2/40 cursor-pointer`} onClick={() => { openTicket(r.ticketKey); }}>
                              <td className={`py-2.5 font-mono text-xs text-primary`}>{r.ticketKey}</td>
                              <td className={`py-2.5 text-right font-mono text-xs text-muted tabular-nums`}>{r.tokensIn}</td>
                              <td className={`py-2.5 text-right font-mono text-xs text-muted tabular-nums`}>{r.tokensOut}</td>
                              <td className={`py-2.5 text-right text-xs text-muted tabular-nums`}>{r.turns}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SectionCard>
              </>
            )}

            {/* Per-AI breakdown — informational, rarely acted on → collapsed. Claude PTY = subscription
                (token volume only, NEVER a €); metered API providers (Gemini) show a real cost estimate. */}
            <Disclosure summary={
              <span className={`flex items-center gap-2`}>
                <span>{translate({ key: 'workspaces.usage.byAiTitle' })}</span>
                <span className={`rounded-full bg-container2 px-2 text-xs font-normal text-muted tabular-nums`}>{usage.byAi.length}</span>
              </span>
            }>
              <div className={`text-sm text-muted mb-2`}>{translate({ key: 'workspaces.usage.byAiDesc' })}</div>
              {usage.byAi.length === 0 ? (
                <EmptyState icon="chart-column" title={translate({ key: 'workspaces.usage.byAiEmptyTitle' })} sub={translate({ key: 'workspaces.usage.byAiEmptySub' })} />
              ) : (
                <div className={`flex flex-col gap-2`}>
                  {usage.byAi.map((a) => (
                    <div key={`${a.providerId}-${a.feature}`} className={`flex items-center gap-3 py-2 border-b border-divider last:border-0`}>
                      <div className={`min-w-0 flex-1`}>
                        <div className={`flex items-center gap-2 flex-wrap`}>
                          <span className={`text-sm font-medium text-title`}>{a.providerLabel}</span>
                          <span className={`rounded-full bg-container2 px-2 text-xs text-muted`}>{a.feature}</span>
                        </div>
                      </div>
                      <span className={`shrink-0 font-mono text-xs text-muted tabular-nums`}>{translate({ key: 'workspaces.usage.tokensLabel', params: [{ key: 'tokens', value: (a.tokensIn + a.tokensOut).toLocaleString() }] })}</span>
                      {a.subscription ? (
                        <span className={`shrink-0 rounded-md bg-container2 px-2 py-0.5 text-xs text-muted`}>{translate({ key: 'workspaces.usage.subscriptionBadge' })}</span>
                      ) : (
                        <span className={`shrink-0 text-sm font-medium text-title tabular-nums`}>{translate({ key: 'workspaces.usage.costValue', params: [{ key: 'n', value: a.costEstimate.toFixed(2) }] })}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Disclosure>

            {/* AI/token €-budget (D81 + #103 multi-cap): summary visible while collapsed; the full
                editor (label/cap/alert, Save, Add cap, per-cap enforcement + enable, Resume) inside. */}
            <div ref={budgetsRef}>
              <Disclosure key={String(budgetsSeed)} defaultOpen={budgetsSeed > 0} summary={
                <span className={`flex items-center gap-2 flex-wrap`}>
                  <span>{translate({ key: 'workspaces.usage.budgetsDisclosure' })}</span>
                  {budget
                    ? <span className={`font-mono tabular-nums text-xs font-normal text-muted`}>{budgetSpentLabel}</span>
                    : <span className={`text-xs font-normal text-muted`}>{translate({ key: 'workspaces.usage.budgetNone' })}</span>}
                  {budgets.length > 0 && (
                    <span className={`rounded-full bg-container2 px-2 text-xs font-normal text-muted tabular-nums`}>{budgets.length} {budgets.length === 1 ? translate({ key: 'workspaces.usage.capSingular' }) : translate({ key: 'workspaces.usage.capPlural' })}</span>
                  )}
                </span>
              }>
                <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.usage.budgetDesc' })}</div>
                {budget && (
                  <div className={`flex flex-col gap-2 mb-3`}>
                    <div className={`flex items-center justify-between text-sm`}>
                      <span className={`text-muted`}>{translate({ key: 'workspaces.usage.budgetSpent' })}</span>
                      <span className={`font-mono tabular-nums text-title`}>{budgetSpentLabel}</span>
                    </div>
                    <div className={`h-2 rounded-full bg-container2 overflow-hidden`}>
                      <div className={`h-full bg-primary`} style={{ width: `${String(spentPct)}%` }} />
                    </div>
                  </div>
                )}
                {/* #103 — the multi-cap list: every configured cap with its enforcement + an enable/disable toggle. */}
                {budgets.length > 0 && (
                  <div className={`flex flex-col gap-1.5 mb-3`}>
                    <div className={`text-xs font-semibold text-muted uppercase tracking-wide`}>{translate({ key: 'workspaces.usage.budgetCaps' })}</div>
                    {budgets.map((b) => {
                      const capLabel = `€${b.spent.toFixed(0)} / €${b.cap.toFixed(0)}`;
                      const enfItems: DropdownItem[] = [{ id: 'pauseNew', value: translate({ key: 'workspaces.usage.enfPauseNew' }) }, { id: 'pauseAll', value: translate({ key: 'workspaces.usage.enfPauseAll' }) }];
                      return (
                        <div key={b.id} className={`flex items-center gap-2 flex-wrap rounded-lg border border-container1-border bg-container1 px-3 py-2 ${b.enabled === false ? 'opacity-50' : ''}`}>
                          <span className={`text-sm font-medium text-title flex-1 min-w-0 truncate`}>{b.label ?? '—'}</span>
                          <span className={`font-mono tabular-nums text-xs text-muted`}>{capLabel}</span>
                          <Dropdown size="sm" value={enfItems.find((i) => i.id === (b.enforcement ?? 'pauseNew'))} items={enfItems} onChange={(it) => { editBudget({ budgetId: b.id, enforcement: it.id === 'pauseAll' ? 'pauseAll' : 'pauseNew' }); }} />
                          <button type="button" onClick={() => { editBudget({ budgetId: b.id, enabled: b.enabled === false }); }} className={`h-8 rounded-lg border border-container1-border bg-container1 px-2.5 text-xs text-common hover:bg-container2 cursor-pointer`}>{translate({ key: b.enabled === false ? 'workspaces.usage.budgetEnable' : 'workspaces.usage.budgetDisable' })}</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className={`flex items-end gap-2 flex-wrap`}>
                  <label className={`flex flex-col gap-1 text-xs text-muted`}>{translate({ key: 'workspaces.usage.budgetLabelLabel' })}
                    <input value={labelInput} onChange={(e) => { setLabelInput(e.target.value); }} placeholder={translate({ key: 'workspaces.usage.budgetLabelPlaceholder' })} className={`h-9 w-36 px-3 rounded-lg border border-container2-border bg-container2 text-sm text-title focus:outline-none focus:ring-2 focus:ring-focus-ring`} />
                  </label>
                  <label className={`flex flex-col gap-1 text-xs text-muted`}>{translate({ key: 'workspaces.usage.budgetCapLabel' })}
                    <input type="number" min="0" step="1" value={capInput} onChange={(e) => { setCapInput(e.target.value); }} className={`h-9 w-28 px-3 rounded-lg border border-container2-border bg-container2 text-sm text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring`} />
                  </label>
                  <label className={`flex flex-col gap-1 text-xs text-muted`}>{translate({ key: 'workspaces.usage.budgetAlertLabel' })}
                    <input type="number" min="0" max="100" step="5" value={alertInput} onChange={(e) => { setAlertInput(e.target.value); }} className={`h-9 w-24 px-3 rounded-lg border border-container2-border bg-container2 text-sm text-title tabular-nums focus:outline-none focus:ring-2 focus:ring-focus-ring`} />
                  </label>
                  <button type="button" disabled={!(Number(capInput) > 0)} onClick={() => { editBudget({ cap: Number(capInput), ...(labelInput.trim() ? { label: labelInput.trim() } : {}), ...(alertInput.trim() ? { alertPct: Number(alertInput) } : {}) }); }} className={`h-9 rounded-lg bg-primary text-title-primary px-3 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}>{translate({ key: 'workspaces.usage.budgetSave' })}</button>
                  {/* #103 — add a SEPARATE additional cap (create) rather than editing the primary one. */}
                  <button type="button" disabled={!(Number(capInput) > 0)} onClick={() => { editBudget({ create: true, cap: Number(capInput), ...(labelInput.trim() ? { label: labelInput.trim() } : {}), ...(alertInput.trim() ? { alertPct: Number(alertInput) } : {}) }); setLabelInput(''); }} className={`h-9 rounded-lg border border-container1-border bg-container1 px-3 text-sm text-common hover:bg-container2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}>{translate({ key: 'workspaces.usage.budgetAddCap' })}</button>
                  {budget && <button type="button" onClick={() => { resumeSpend(); }} className={`h-9 rounded-lg border border-container1-border bg-container1 px-3 text-sm text-common hover:bg-container2 cursor-pointer`}>{translate({ key: 'workspaces.usage.budgetResume' })}</button>}
                </div>
                <div className={`flex items-center gap-2 text-xs text-muted mt-3`}>
                  <Icon name="circle-question" /> {translate({ key: 'workspaces.usage.runawayNote' })}
                </div>
              </Disclosure>
            </div>

            {/* root-cause (ADR 0042): diagnose what broke → the likely-culprit merge as a rollback suggestion. */}
            <Disclosure summary={translate({ key: 'workspaces.usage.diagnoseTitle' })}>
              <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.usage.diagnoseDesc' })}</div>
              <div className={`flex items-center gap-2`}>
                <input value={symptom} onChange={(e) => { setSymptom(e.target.value); }} placeholder={translate({ key: 'workspaces.usage.diagnosePlaceholder' })} className={`flex-1 min-w-0 rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring`} />
                <button type="button" disabled={symptom.trim().length === 0} onClick={() => { diagnoseRootCause(symptom); setSymptom(''); }} className={`shrink-0 rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}>{translate({ key: 'workspaces.usage.diagnoseBtn' })}</button>
              </div>
            </Disclosure>
          </div>
        )}

        {/* Delivery analytics (ADR 0047): a different question — how fast do we ship. */}
        {tab === 'delivery' && (
          <SectionCard title={translate({ key: 'workspaces.usage.analyticsTitle' })} desc={translate({ key: 'workspaces.usage.analyticsDesc' })}>
            <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4`}>
              <StatCard label={translate({ key: 'workspaces.usage.cycleP85' })} value={analytics.cycleP85Hours > 0 ? `${String(analytics.cycleP85Hours)} h` : '—'} hint={`${translate({ key: 'workspaces.usage.cycleP50' })}: ${analytics.cycleP50Hours > 0 ? `${String(analytics.cycleP50Hours)} h` : '—'}`} />
              <StatCard label={translate({ key: 'workspaces.usage.stuck' })} value={String(analytics.stuckCount)} hint={translate({ key: 'workspaces.usage.openCountHint', params: [{ key: 'count', value: analytics.openCount }] })} />
              <StatCard label={translate({ key: 'workspaces.usage.weeklyThroughput' })} value={String(analytics.throughputByWeek.at(-1)?.done ?? 0)} hint={translate({ key: 'workspaces.usage.doneCountHint', params: [{ key: 'count', value: analytics.doneCount }] })} />
            </div>
            <div className={`flex items-end gap-3 h-24 mb-4`}>
              {analytics.throughputByWeek.map((w) => (
                <div key={w.weekStart} className={`flex-1 flex flex-col items-center gap-1.5`}>
                  <div className={`w-full rounded-t-md bg-primary/70`} style={{ height: `${String(Math.round((w.done / weekMax) * 100))}%` }} />
                  <span className={`text-[10px] text-muted`}>{w.weekStart.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className={`text-xs font-medium text-muted mb-1.5`}>{translate({ key: 'workspaces.usage.tokensByType' })}</div>
            <div className={`flex flex-col gap-1`}>
              {analytics.tokensByLabel.length === 0
                ? <div className={`text-sm text-disabled`}>—</div>
                : analytics.tokensByLabel.map((t) => (
                  <div key={t.label} className={`flex items-center justify-between gap-2 text-sm`}>
                    <span className={`text-title truncate`}>{t.label}</span>
                    <span className={`text-muted font-mono`}>{translate({ key: 'workspaces.usage.tokensLabel', params: [{ key: 'tokens', value: t.tokens.toLocaleString() }] })}</span>
                  </div>
                ))}
            </div>
          </SectionCard>
        )}

        {/* Per-member breakdown — who handled what, with the real #100 SpendRecord attribution badge. */}
        {tab === 'people' && (
          <SectionCard title={translate({ key: 'workspaces.usage.byPersonTitle' })} desc={translate({ key: 'workspaces.usage.byPersonDesc' })}>
            {byMember.length === 0 ? (
              <EmptyState icon="users" title={translate({ key: 'workspaces.usage.emptyTitle' })} sub={translate({ key: 'workspaces.usage.pageEmptySub' })} />
            ) : (
              <div className={`flex flex-col gap-2`}>
                {byMember.map(({ member, tickets: memberTickets }) => (
                  <div key={member.id} className={`flex items-start gap-3 py-2 border-b border-divider last:border-0`}>
                    <div className={`w-8 h-8 shrink-0`}><AvatarBubble user={member} size={32} /></div>
                    <div className={`min-w-0 flex-1`}>
                      <div className={`flex items-center gap-2 flex-wrap`}>
                        <span className={`text-sm font-medium text-title`}>{member.name}</span>
                        <span className={`rounded-full bg-container2 px-2 text-xs text-muted`}>{memberTickets.length} {memberTickets.length === 1 ? translate({ key: 'workspaces.usage.ticketSingular' }) : translate({ key: 'workspaces.usage.ticketPlural' })}</span>
                        {/* #100 — real token (+ metered cost) attribution per member from SpendRecord. */}
                        {(() => { const u = usageByUser.get(member.id); if (!u) return null; return (
                          <span className={`rounded-full bg-primary/10 text-primary px-2 text-xs tabular-nums`}>{translate({ key: 'workspaces.usage.tokensLabel', params: [{ key: 'tokens', value: (u.tokensIn + u.tokensOut).toLocaleString() }] })}{u.costEstimate > 0 ? ` · €${u.costEstimate.toFixed(2)}` : ''}</span>
                        ); })()}
                      </div>
                      <div className={`flex flex-wrap gap-1 mt-1.5`}>
                        {memberTickets.map((t) => (
                          <button key={t.id} type="button" onClick={() => { openTicket(t.id); }} className={`rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-mono text-common hover:bg-container2-hover cursor-pointer`}>{t.id}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
