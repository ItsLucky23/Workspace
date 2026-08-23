//? intent: Show where the workspace's AI effort goes — tokens per day/ticket/person/provider — plus delivery analytics, spend caps and an AI root-cause diagnosis.
//? Workspaces — Usage. The Claude coding agent runs on the Pro Max CLI
//? subscription (token VOLUME, no metered €), but metered API providers (e.g.
//? Gemini) DO carry real cost — hence the D81/#103 multi-cap €-budget editor +
//? resume-spend, folded behind the "Budgets & caps" disclosure. Default tab =
//? token usage (7-day activity + the per-ticket drill-in); Delivery (ADR 0047)
//? and People (#100 SpendRecord attribution) are secondary tabs; root-cause
//? diagnosis (ADR 0042) sits behind its own disclosure. Data comes from the
//? real SpendRecord aggregate (server aggregateUsage), not dummy rows.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { AvatarBubble, Disclosure, EmptyState, IconButton, InfoTip, SectionCard, Tabs, WsButton } from '../../_components/primitives';
import { useTrailSegment } from '../../_components/sections';
import { StatCard } from '../../_components/dataDisplay';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { Member, Ticket } from '../../_data/types';

export const template = 'workspaces';

type UsageTab = 'usage' | 'delivery' | 'people';

//? Compact token count for the always-visible per-bar labels (hover must not be the only reading).
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

//? Example symptoms so a first-time user knows what a good diagnose input looks like (audit finding: copy).
const DIAGNOSE_EXAMPLE_KEYS = ['workspaces.usage.diagnoseExample1', 'workspaces.usage.diagnoseExample2', 'workspaces.usage.diagnoseExample3'] as const;

//? One local-session diagnose call: tracked client-side (no symptom field on WorkspaceSuggestion) so the
//? panel can show feedback + a trace of what was asked, instead of the input just going blank (audit finding).
interface DiagnoseEntry {
  id: string;
  symptom: string;
  status: 'pending' | 'ready';
  suggestionId: string | null;
}

export default function Usage() {
  const { openTicket, navigate, focusSetup, tickets, membersById, usage, insights, analytics, budget, budgets, editBudget, resumeSpend, diagnoseRootCause, suggestions, acceptSuggestion, dismissSuggestion, toggleAi } = useWorkspaces();
  const translate = useTranslator();
  const [tab, setTab] = useTrailSegment<UsageTab>(0, ['usage', 'delivery', 'people'], 'usage');
  //? root-cause (ADR 0042) — a symptom → the likely-culprit merge as a rollback suggestion (AI panel).
  const [symptom, setSymptom] = useState('');
  //? Client-side trace of diagnose calls this session (audit finding: zero on-page feedback + no history).
  const [diagnoseHistory, setDiagnoseHistory] = useState<DiagnoseEntry[]>([]);
  //? Suggestion ids present right before a diagnose call — whatever's new after that is its result.
  const diagnoseBaselineRef = useRef<Set<string>>(new Set());
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
  //? THE BUG (audit finding): this strip used to watch only the legacy primary `budget`, so a secondary
  //? NAMED cap (#103 multi-cap) crossing its own alert threshold triggered nothing — the exact
  //? runaway-spend case caps exist to prevent. Now every entry in `budgets` is checked too (skipping
  //? disabled caps), and each over-threshold cap is named in the strip instead of one generic message.
  const overCaps = useMemo(() => {
    const list: { id: string; label: string; spentLabel: string; pct: number }[] = [];
    if (budget && budget.cap > 0 && (budget.spent / budget.cap) * 100 >= budget.alertPct) {
      list.push({ id: 'primary', label: translate({ key: 'workspaces.usage.budgetPrimaryLabel' }), spentLabel: `€${budget.spent.toFixed(2)} / €${budget.cap.toFixed(2)}`, pct: Math.min(100, (budget.spent / budget.cap) * 100) });
    }
    for (const b of budgets) {
      if (b.enabled === false || b.cap <= 0) continue;
      const pct = (b.spent / b.cap) * 100;
      if (pct >= b.alertPct) {
        list.push({ id: b.id ?? `cap-${String(list.length)}`, label: b.label ?? translate({ key: 'workspaces.usage.budgetUnnamedCap' }), spentLabel: `€${b.spent.toFixed(2)} / €${b.cap.toFixed(2)}`, pct: Math.min(100, pct) });
      }
    }
    return list;
  }, [budget, budgets, translate]);
  const nearCap = overCaps.length > 0;

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

  //? Match the pending diagnose entry to whichever suggestion arrived while it was in flight (realtime push).
  useEffect(() => {
    setDiagnoseHistory((history) => {
      const pendingIdx = history.findIndex((e) => e.status === 'pending');
      if (pendingIdx === -1) return history;
      const fresh = suggestions.find((s) => !diagnoseBaselineRef.current.has(s.id));
      if (!fresh) return history;
      return history.map((e, i): DiagnoseEntry => (i === pendingIdx ? { ...e, status: 'ready', suggestionId: fresh.id } : e));
    });
  }, [suggestions]);

  const handleDiagnose = () => {
    const value = symptom.trim();
    if (value.length === 0 || diagnoseHistory.some((e) => e.status === 'pending')) return;
    diagnoseBaselineRef.current = new Set(suggestions.map((s) => s.id));
    const entry: DiagnoseEntry = { id: `diag-${String(Date.now())}`, symptom: value, status: 'pending', suggestionId: null };
    setDiagnoseHistory((h) => [entry, ...h].slice(0, 5));
    diagnoseRootCause(value);
    setSymptom('');
  };
  const diagnosePendingEntry = diagnoseHistory.find((e) => e.status === 'pending');
  //? The newest ready result that hasn't been accepted/dismissed yet (locally or by a teammate elsewhere).
  const diagnoseActiveEntry = diagnosePendingEntry
    ? undefined
    : diagnoseHistory.find((e) => e.suggestionId !== null && suggestions.some((s) => s.id === e.suggestionId));
  const diagnoseActiveSuggestion = diagnoseActiveEntry ? (suggestions.find((s) => s.id === diagnoseActiveEntry.suggestionId) ?? null) : null;
  const diagnoseTraceEntries = diagnoseHistory.filter((e) => e.id !== diagnosePendingEntry?.id && e.id !== diagnoseActiveEntry?.id);

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
            {/* Near/over-threshold spend strip (status only — the full editor stays behind the disclosure).
                Named per cap (the bug fix): every over-threshold cap gets its own row so a secondary
                cap tripping its alert is never silently invisible next to a fine primary budget. */}
            {nearCap && (
              <button type="button" onClick={revealBudgets} className={`flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-left cursor-pointer`}>
                {overCaps.map((c, i) => (
                  <div key={c.id} className={`flex items-center gap-3 flex-wrap`}>
                    {i === 0
                      ? <Icon name="triangle-exclamation" className={`text-warning shrink-0`} />
                      : <span className={`w-3.5 shrink-0`} />}
                    <span className={`text-sm font-medium text-warning`}>{translate({ key: 'workspaces.usage.capAlertStripNamed', params: [{ key: 'name', value: c.label }] })}</span>
                    <span className={`font-mono tabular-nums text-sm text-title`}>{c.spentLabel}</span>
                    <span className={`flex-1 min-w-16 h-1.5 rounded-full bg-container2 overflow-hidden`}>
                      <span className={`block h-full bg-warning`} style={{ width: `${String(c.pct)}%` }} />
                    </span>
                    {i === 0 && <span className={`text-sm text-warning underline`}>{translate({ key: 'workspaces.usage.capAlertView' })}</span>}
                  </div>
                ))}
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
                    //? "created → done" is the intent; the measurement is createdAt→updatedAt over the
                    //? ACTIVE PROJECT's non-archived done tickets, so a late write to the ticket row
                    //? (edit / status move) inflates it retroactively — a comment does not (add-comment
                    //? only writes a WorkspaceNote + TicketEvent, never the Ticket row).
                    info={
                      <InfoTip
                        align="start"
                        label={translate({ key: 'workspaces.tips.insights.cycleTimeAria' })}
                        title={translate({ key: 'workspaces.tips.insights.cycleTimeTitle' })}
                        body={translate({ key: 'workspaces.tips.insights.cycleTimeBody' })}
                      />
                    }
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
                {/* The columns are a char-derived ESTIMATE for the CLI agent (no usage reported, price
                    deliberately absent → €0); only a metered provider supplies real counts. */}
                <SectionCard
                  title={
                    <span className={`flex items-center gap-1.5`}>
                      {translate({ key: 'workspaces.usage.byTicketTitle' })}
                      <InfoTip
                        align="start"
                        label={translate({ key: 'workspaces.tips.insights.tokenEstimateAria' })}
                        title={translate({ key: 'workspaces.tips.insights.tokenEstimateTitle' })}
                        body={translate({ key: 'workspaces.tips.insights.tokenEstimateBody' })}
                      />
                    </span>
                  }
                  desc={translate({ key: 'workspaces.usage.byTicketDesc' })}
                >
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
                {/* Audit finding: this caps metered API/token spend workspace-wide; content's media
                    generation spend (fal/elevenlabs/suno) has its OWN separate cap in Content settings →
                    Admin — say so instead of leaving the user to guess which spend a cap covers. */}
                <div className={`flex flex-wrap items-center gap-1.5 text-xs text-muted mb-3`}>
                  <Icon name="circle-info" />
                  <span>{translate({ key: 'workspaces.usage.budgetScopeNote' })}</span>
                  <button type="button" onClick={() => { focusSetup({ view: 'content/settings', tab: 'admin' }); }} className={`text-primary hover:underline cursor-pointer inline-flex items-center gap-1`}>
                    {translate({ key: 'workspaces.usage.budgetMediaCapsLink' })} <Icon name="arrow-right" />
                  </button>
                </div>
                {budget && (
                  <div className={`flex flex-col gap-2 mb-3`}>
                    <div className={`flex items-center justify-between text-sm`}>
                      {/* "this period" = since this cap's own windowStartAt (creation / Resume spend),
                          and every enabled cap scores the SAME workspace-wide metered spend. */}
                      <span className={`text-muted flex items-center gap-1.5`}>
                        {translate({ key: 'workspaces.usage.budgetSpent' })}
                        <InfoTip
                          align="start"
                          label={translate({ key: 'workspaces.tips.insights.spendWindowAria' })}
                          title={translate({ key: 'workspaces.tips.insights.spendWindowTitle' })}
                          body={translate({ key: 'workspaces.tips.insights.spendWindowBody' })}
                          points={[{ id: 'shared', label: translate({ key: 'workspaces.tips.insights.spendWindowSharedLabel' }), desc: translate({ key: 'workspaces.tips.insights.spendWindowSharedDesc' }) }]}
                        />
                      </span>
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
                    {/* Both enforcement values sit in the SAME `in` filter server-side, so the choice
                        between them changes nothing today — say so on the list, not per row. The single
                        gate is provisionContainers, i.e. pipeline stage runs + manual re-runs; metered
                        one-shot AI calls and media generation (own MediaBudget) run on past a full cap. */}
                    <div className={`text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1.5`}>
                      {translate({ key: 'workspaces.usage.budgetCaps' })}
                      <InfoTip
                        align="start"
                        label={translate({ key: 'workspaces.tips.insights.enforcementAria' })}
                        title={translate({ key: 'workspaces.tips.insights.enforcementTitle' })}
                        body={translate({ key: 'workspaces.tips.insights.enforcementBody' })}
                      />
                    </div>
                    {budgets.map((b) => {
                      const capLabel = `€${b.spent.toFixed(0)} / €${b.cap.toFixed(0)}`;
                      const enfItems: DropdownItem[] = [{ id: 'pauseNew', value: translate({ key: 'workspaces.usage.enfPauseNew' }) }, { id: 'pauseAll', value: translate({ key: 'workspaces.usage.enfPauseAll' }) }];
                      return (
                        <div key={b.id} className={`flex items-center gap-2 flex-wrap rounded-lg border border-container1-border bg-container1 px-3 py-2 ${b.enabled === false ? 'opacity-50' : ''}`}>
                          <span className={`text-sm font-medium text-title flex-1 min-w-0 truncate`}>{b.label ?? '—'}</span>
                          <span className={`font-mono tabular-nums text-xs text-muted`}>{capLabel}</span>
                          <Dropdown size="sm" value={enfItems.find((i) => i.id === (b.enforcement ?? 'pauseNew'))} items={enfItems} onChange={(it) => { editBudget({ budgetId: b.id, enforcement: it.id === 'pauseAll' ? 'pauseAll' : 'pauseNew' }); }} />
                          <button type="button" onClick={() => { editBudget({ budgetId: b.id, enabled: b.enabled === false }); }} className={`h-8 rounded-lg border border-container1-border bg-container1 px-2.5 text-xs text-common hover:bg-container2 cursor-pointer`}>{translate({ key: b.enabled === false ? 'workspaces.usage.budgetEnable' : 'workspaces.usage.budgetDisable' })}</button>
                          {/* ADR 0310 — retire vs remove are different intents: disable keeps the cap in
                              the list (and its history legible), delete is for caps you never want to see
                              again. Confirm-gated because the row cannot be brought back. */}
                          <IconButton
                            icon="trash" title={translate({ key: 'workspaces.usage.deleteCap' })}
                            onClick={() => {
                              void menuHandler.confirm({
                                title: translate({ key: 'workspaces.usage.deleteCapConfirmTitle', params: [{ key: 'label', value: b.label ?? '' }] }),
                                content: translate({ key: 'workspaces.usage.deleteCapConfirmContent' }),
                              }).then((ok) => { if (ok) editBudget({ budgetId: b.id, remove: true }); });
                            }}
                            className={`w-8 h-8 hover:text-wrong`}
                          />
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
                  {/* resume-spend is an updateMany over the whole workspace's WorkspaceBudget rows: EVERY
                      cap on THIS page resets, not just the primary budget it sits beside. It does NOT
                      touch the media €-cap (MediaBudget.spentCents is never zeroed anywhere), hence the
                      deep-link point, and it cannot clear the host-wide WS_HOST_SPEND_CAP_EUR ceiling. */}
                  {budget && (
                    <span className={`flex items-center gap-1.5`}>
                      <button type="button" onClick={() => { resumeSpend(); }} className={`h-9 rounded-lg border border-container1-border bg-container1 px-3 text-sm text-common hover:bg-container2 cursor-pointer`}>{translate({ key: 'workspaces.usage.budgetResume' })}</button>
                      <InfoTip
                        align="end"
                        label={translate({ key: 'workspaces.tips.insights.resumeSpendAria' })}
                        title={translate({ key: 'workspaces.tips.insights.resumeSpendTitle' })}
                        body={translate({ key: 'workspaces.tips.insights.resumeSpendBody' })}
                        points={[{ id: 'media', label: translate({ key: 'workspaces.tips.insights.resumeSpendMediaLabel' }), desc: translate({ key: 'workspaces.tips.insights.resumeSpendMediaDesc' }), onGo: () => { focusSetup({ view: 'content/settings', tab: 'admin' }); }, goLabel: translate({ key: 'workspaces.tips.insights.resumeSpendMediaGo' }) }]}
                      />
                    </span>
                  )}
                </div>
                <div className={`flex items-center gap-2 text-xs text-muted mt-3`}>
                  <Icon name="circle-question" /> {translate({ key: 'workspaces.usage.runawayNote' })}
                </div>
              </Disclosure>
            </div>

            {/* root-cause (ADR 0042): diagnose what broke → the likely-culprit merge as a rollback suggestion. */}
            <Disclosure summary={translate({ key: 'workspaces.usage.diagnoseTitle' })}>
              <div className={`text-sm text-muted mb-3`}>{translate({ key: 'workspaces.usage.diagnoseDesc' })}</div>
              {/* Example chips: a first-time user has no idea what a good symptom string looks like. */}
              <div className={`flex flex-wrap gap-1.5 mb-3`}>
                {DIAGNOSE_EXAMPLE_KEYS.map((exampleKey) => (
                  <button key={exampleKey} type="button" onClick={() => { setSymptom(translate({ key: exampleKey })); }} className={`rounded-full border border-container1-border bg-container1 px-2.5 py-1 text-xs text-common hover:bg-container2 cursor-pointer`}>
                    {translate({ key: exampleKey })}
                  </button>
                ))}
              </div>
              <div className={`flex items-center gap-2`}>
                <input value={symptom} onChange={(e) => { setSymptom(e.target.value); }} placeholder={translate({ key: 'workspaces.usage.diagnosePlaceholder' })} disabled={diagnosePendingEntry !== undefined} className={`flex-1 min-w-0 rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-60`} />
                <button type="button" disabled={symptom.trim().length === 0 || diagnosePendingEntry !== undefined} onClick={handleDiagnose} className={`shrink-0 rounded-lg bg-primary text-title-primary px-3 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}>
                  {diagnosePendingEntry === undefined ? translate({ key: 'workspaces.usage.diagnoseBtn' }) : <Icon name="spinner" className={`animate-spin`} />}
                </button>
              </div>

              {/* On-page feedback: was previously invisible (audit finding) — a pending state, then the
                  resulting suggestion rendered right here with accept/dismiss + a link to the AI panel. */}
              {diagnosePendingEntry && (
                <div className={`flex items-center gap-2 rounded-lg border border-container1-border bg-container1 px-3 py-2 mt-3 text-sm text-muted`}>
                  <Icon name="spinner" className={`animate-spin shrink-0`} />
                  <span>{translate({ key: 'workspaces.usage.diagnosePendingHint' })}</span>
                </div>
              )}
              {diagnoseActiveSuggestion && (
                <div className={`rounded-lg border border-container1-border bg-container1 p-3 mt-3`}>
                  <div className={`flex items-center gap-2 mb-1`}>
                    <Icon name="robot" className={`text-primary shrink-0`} />
                    <span className={`text-sm font-semibold text-title`}>{diagnoseActiveSuggestion.title}</span>
                  </div>
                  <p className={`text-sm text-common leading-relaxed`}>{diagnoseActiveSuggestion.body}</p>
                  {diagnoseActiveSuggestion.ticketIds.length > 0 && (
                    <div className={`flex flex-wrap gap-1.5 mt-2`}>
                      {diagnoseActiveSuggestion.ticketIds.map((t) => (
                        <button key={t} type="button" onClick={() => { openTicket(t); }} className={`rounded-md bg-container2 px-1.5 py-0.5 text-xs font-mono text-common hover:bg-container2-hover cursor-pointer`}>{t}</button>
                      ))}
                    </div>
                  )}
                  <div className={`flex items-center gap-2 mt-3`}>
                    <button type="button" onClick={() => { acceptSuggestion(diagnoseActiveSuggestion.id); }} className={`rounded-lg bg-primary px-3 h-8 text-sm font-medium text-title-primary hover:bg-primary-hover cursor-pointer`}>{translate({ key: 'workspaces.shell.accept' })}</button>
                    <button type="button" onClick={() => { dismissSuggestion(diagnoseActiveSuggestion.id); }} className={`rounded-lg px-3 h-8 text-sm font-medium text-common hover:bg-container2 cursor-pointer`}>{translate({ key: 'workspaces.shell.dismiss' })}</button>
                    <button type="button" onClick={toggleAi} className={`ml-auto rounded-lg px-3 h-8 text-sm font-medium text-primary hover:bg-container2 cursor-pointer`}>{translate({ key: 'workspaces.usage.diagnoseOpenPanel' })}</button>
                  </div>
                </div>
              )}

              {/* Trace of past diagnoses — previously the input just went blank with no record of what was asked. */}
              {diagnoseTraceEntries.length > 0 && (
                <div className={`flex flex-col gap-1 mt-3`}>
                  <div className={`text-xs font-semibold text-muted uppercase tracking-wide`}>{translate({ key: 'workspaces.usage.diagnoseHistoryTitle' })}</div>
                  {diagnoseTraceEntries.map((entry) => (
                    <div key={entry.id} className={`flex items-center gap-2 text-xs`}>
                      <span className={`truncate flex-1 min-w-0 text-common`}>{entry.symptom}</span>
                      <span className={`shrink-0 text-meta`}>{translate({ key: entry.suggestionId !== null && suggestions.some((s) => s.id === entry.suggestionId) ? 'workspaces.usage.diagnoseAwaiting' : 'workspaces.usage.diagnoseResolved' })}</span>
                    </div>
                  ))}
                </div>
              )}
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
