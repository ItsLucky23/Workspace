//? intent: Follow ONE AI-driven ticket and steer it: answer the agent's question when
//? it needs input (THE primary action), promote the ticket when its stage is done, and
//? otherwise open the live preview. Everything else is progressive disclosure — meta
//? chips behind a phone-only "Details" disclosure, the settings grid behind a "Ticket
//? settings" disclosure in Overview, agent lifecycle + destructive ops behind the "…"
//? menu, and the heavy code/terminal/review/activity surfaces behind a 5-tab bar.

import { useEffect, useRef, useState } from 'react';

import { apiRequest, i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import ActivityPanel from './ActivityPanel';
import CodePanel from './CodePanel';
import TerminalPanel from './TerminalPanel';
import TimeTravelForm, { type TravelSpec } from './TimeTravelForm';
import MrReviewPanel from '../../../_components/MrReviewPanel';
import Icon from '../../../_components/Icon';
import { AvatarBubble, AvatarStack, Disclosure, EmptyState, LabelChip, PopMenu, StatusPill, Tabs, WsButton, type PopMenuItem, type TabDef } from '../../../_components/primitives';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { useWorkspaces } from '../../../_shell/WorkspacesContext';
import { isModuleEnabled } from '../../../_data/modules';
import type { Member, Ticket } from '../../../_data/types';
import { PRIORITY_DOT, PRIORITY_LABEL_KEY, PRIORITY_ORDER } from '../../../_functions/priority';
import { parseStructuredQuestion } from '../../../_functions/structuredQuestion';

export const template = 'workspaces';

export default function TicketPage({ params }: { params: Record<string, string | undefined> }) {
  const id = params.ticketid ?? '';
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const ticket = ctx.tickets.find((t) => t.id === id);
  const [tab, setTab] = useState('overview');
  //? Review → Code hand-off: previewing a changed file from the Review tab switches to Code and asks it to
  //? open that file in the requested editor mode. Cleared when the Code tab is opened directly (below), so a
  //? plain visit lands on the default diff view rather than resurrecting a stale preview target.
  const [codePreview, setCodePreview] = useState<{ mode: 'diff' | 'changes' | 'live'; file: string } | null>(null);

  //? KISS: 5 tabs instead of 8 — "Files & refs" merged into Code (its diff-view mode
  //? shows the same changed-file set), Links + Stage history folded into Activity as
  //? disclosures. Overview is the default and carries the essentials.
  const TABS: TabDef[] = [
    { id: 'overview', label: translate({ key: 'workspaces.ticket.tabOverview' }), icon: 'file-lines' },
    { id: 'code', label: translate({ key: 'workspaces.ticket.tabCode' }), icon: 'code-branch' },
    { id: 'terminal', label: translate({ key: 'workspaces.ticket.tabTerminal' }), icon: 'terminal' },
    { id: 'review', label: translate({ key: 'workspaces.ticket.tabReview' }), icon: 'code-merge' },
    { id: 'activity', label: translate({ key: 'workspaces.ticket.tabActivity' }), icon: 'wave-square' },
  ];

  if (!ticket) return <EmptyState icon="circle-question" title={translate({ key: 'workspaces.ticket.notFound', params: [{ key: 'id', value: id }] })} />;

  //? Status is AI-owned — the user can't change it (it'd be wrong to flip
  //? "needs input" to "busy"). Shown read-only; the user's lever is replying.
  const status = ticket.status;
  const stage = ctx.stages.find((s) => s.id === ticket.stageId);
  const nextStage = ctx.stages.find((s) => s.order === (stage?.order ?? -1) + 1);
  //? ONE primary action per screen: the answer card when the agent waits, "Promote"
  //? when the stage is done, otherwise the standing primary is "Open preview" (what a
  //? non-technical approver comes for).
  const standingPrimary = status !== 'needs-input' && status !== 'done';
  const wide = tab === 'terminal' || tab === 'code' || tab === 'review';

  return (
    <div className="flex flex-col h-full min-h-0">
      <TicketHeader ticket={ticket} />

      {/* The contextual action card — visually dominant, above everything else. */}
      {status === 'needs-input' && ticket.needsInput && <NeedsInputBanner question={ticket.needsInput} ticketKey={ticket.id} />}
      {status === 'done' && (
        <Banner
          tone="correct" icon="circle-check"
          title={translate({ key: 'workspaces.ticket.doneIn', params: [{ key: 'stage', value: stage?.name ?? translate({ key: 'workspaces.ticket.thisStage' }) }] })}
          action={nextStage && (
            <WsButton
              onClick={() => {
                void menuHandler.confirm({
                  title: translate({ key: 'workspaces.ticket.promoteConfirmTitle', params: [{ key: 'id', value: ticket.id }, { key: 'stage', value: nextStage.name }] }),
                  content: ticket.carryOver ?? translate({ key: 'workspaces.ticket.promoteConfirmContent' }),
                }).then((ok) => { if (ok) ctx.bulkMove([ticket.id], nextStage.id); });
              }}
            >
              {translate({ key: 'workspaces.ticket.promoteTo', params: [{ key: 'stage', value: nextStage.name }] })}
            </WsButton>
          )}
        />
      )}
      {/* #16 (W2) — non-blocking advisory questions: confirm the agent's assumption or correct it. */}
      {ticket.advisoryQuestions && ticket.advisoryQuestions.length > 0 && <AdvisoryList ticketKey={ticket.id} advisories={ticket.advisoryQuestions} />}

      <TicketControls ticket={ticket} primary={standingPrimary} />

      <div className="px-4 md:px-6">
        <Tabs tabs={TABS} active={tab} onChange={(id) => { if (id === 'code') setCodePreview(null); setTab(id); }} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        <div className={`mx-auto w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
          {tab === 'overview' && <OverviewTab ticket={ticket} stage={stage?.name} />}
          {tab === 'code' && <CodePanel files={ticket.files ?? []} workspaceId={ctx.activeWorkspace.id} ticketKey={ticket.id} initialMode={codePreview?.mode} initialFile={codePreview?.file} />}
          {tab === 'terminal' && <TerminalPanel ticketId={ticket.id} stageId={ticket.stageId} />}
          {tab === 'review' && <MrReviewPanel ticket={ticket} onPreviewFile={(path, mode) => { setCodePreview({ mode, file: path }); setTab('code'); }} />}
          {tab === 'activity' && <ActivityPanel ticket={ticket} />}
        </div>
      </div>
    </div>
  );
}

//? C2 agent controls + preview launcher on the ticket. Pause/resume/kill drive the engine's
//? context-methods (the engine skips the auto-turn while a live editor is open — editGuard).
//? Open preview starts the ticket's dev server (Project.devCommand) and surfaces the URL —
//? it is the standing primary action (`primary`) whenever no answer/promote card is showing.
//? Everything else (agent lifecycle, terminal, GitLab, time-travel, kill, teardown) lives
//? in the "…" menu so the ticket isn't a wall of dev-verbs.
function TicketControls({ ticket, primary }: { ticket: Ticket; primary: boolean }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [preview, setPreview] = useState<{ loading: boolean; url?: string; err?: boolean }>({ loading: false });
  //? #20 — the live agent PTY tail for this ticket (empty when no live turn is streaming).
  const [showLive, setShowLive] = useState(false);
  const liveOutput = ctx.agentTerm[ticket.id] ?? '';

  const kill = (): void => {
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.ticket.killConfirmTitle', params: [{ key: 'id', value: ticket.id }] }),
      content: translate({ key: 'workspaces.ticket.killConfirmContent' }),
    }).then((ok) => { if (ok) ctx.killTicket(ticket.id); });
  };

  const teardown = (): void => {
    /* Fase 2: no teardown-container control-op yet — confirm only, no follow-up write */
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.ticket.teardownConfirmTitle', params: [{ key: 'id', value: ticket.id }] }),
      content: translate({ key: 'workspaces.ticket.teardownConfirmContent' }),
      input: ticket.id,
    });
  };

  const openPreview = async (): Promise<void> => {
    setPreview({ loading: true });
    const res = await ctx.openPreview(ticket.id);
    if (res.ok && res.url) { setPreview({ loading: false, url: res.url }); }
    else setPreview({ loading: false, err: true });
  };

  //? T1/T3 — time-travel preview: open the ticket's app at a PAST version (a raw commit, "main minus commit X",
  //? or "as of a date"). Resolves the spec (git-only) → an ephemeral ref-preview container. The timeTravelPreview
  //? routes existed but had NO caller; this wires them.
  const timeTravel = (spec: TravelSpec): void => {
    setPreview({ loading: true });
    const settle = (r: { status: string; result?: { ok?: boolean; url?: string } }): void => {
      if (r.status === 'success' && r.result?.ok && r.result.url) { setPreview({ loading: false, url: r.result.url }); }
      else setPreview({ loading: false, err: true });
    };
    //? #25 — a raw ref goes through open-ref-preview; commit/revert/asof through timeTravelPreview.
    if (spec.kind === 'ref') {
      void apiRequest({ name: 'workspaces/openRefPreview', version: 'v1', data: { workspaceId: ctx.activeWorkspace.id, ticketKey: ticket.id, ref: spec.value } }).then(settle);
      return;
    }
    void apiRequest({ name: 'workspaces/timeTravelPreview', version: 'v1', data: { workspaceId: ctx.activeWorkspace.id, ticketKey: ticket.id, branch: ticket.branch ?? 'main', spec } }).then(settle);
  };
  const openTimeTravel = (): void => {
    void menuHandler.open(<TimeTravelForm translate={translate} onSubmit={(spec) => { void menuHandler.close(); timeTravel(spec); }} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };

  //? The "…" menu: agent lifecycle (pause/resume/critique) for whoever manages the ticket,
  //? plus the relocated header buttons (terminal, the Fase-2 GitLab no-op — de-emphasized
  //? here instead of posing as a working primary), and the destructive/dev tools (time-travel,
  //? kill, teardown) gated on the development module + admin/owner (fail-open: an unresolved
  //? role is not 'member').
  const showDevOps = isModuleEnabled(ctx.activeWorkspace.enabledSections, 'development') && ctx.activeWorkspace.role !== 'member';
  const agentMenu: PopMenuItem[] = [
    //? Same guard as the board card: without a linked repo, "pause" is a meaningless status flip —
    //? explain the blocker instead (owner report 2026-07-20).
    { label: translate({ key: 'workspaces.ticket.pauseAgent' }), icon: 'pause', onClick: () => { if (!ctx.repo.linked) { notify.warning({ key: 'workspaces.board.agentNeedsRepo' }); return; } ctx.pauseTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.ticket.resumeAgent' }), icon: 'play', onClick: () => { ctx.resumeTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.ticket.critiquePlan' }), icon: 'wand-magic-sparkles', onClick: () => { ctx.planCritique(ticket.id); } },
    { divider: true },
    { label: translate({ key: 'workspaces.ticket.openTerminal' }), icon: 'terminal', onClick: () => { ctx.navigate('terminals'); } },
    //? Fase 2: the GitLab deep-link op doesn't exist yet — HIDDEN until it does (PopMenuItem has no
    //? disabled state, and a dead menu item that swallows the click is worse than no item).
    //? Restore here with the real deep-link: { label: translate({ key: 'workspaces.ticket.gitlab' }), icon: 'up-right-from-square', onClick: ... }
  ];
  if (showDevOps) {
    agentMenu.push(
      { label: translate({ key: 'workspaces.timetravel.button' }), icon: 'clock-rotate-left', onClick: openTimeTravel },
      { divider: true },
      { label: translate({ key: 'workspaces.ticket.killAgent' }), icon: 'ban', danger: true, onClick: kill },
      //? Teardown relocated out of the Overview canvas — destructive dev-op, same gate as kill.
      { label: translate({ key: 'workspaces.ticket.teardownContainer' }), icon: 'box-archive', danger: true, onClick: teardown },
    );
  }

  return (
    <>
    <div className="px-4 md:px-6 pb-2 flex flex-wrap items-center gap-2">
      <WsButton variant={primary ? 'primary' : 'secondary'} icon="display" disabled={preview.loading} onClick={() => { void openPreview(); }}>
        {translate({ key: preview.loading ? 'workspaces.ticket.previewOpening' : 'workspaces.ticket.openPreview' })}
      </WsButton>
      <PopMenu items={agentMenu} />
      {preview.url !== undefined && <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate max-w-xs">{preview.url}</a>}
      {/* #37 — stop a running preview (closePreview existed but had no UI trigger). */}
      {preview.url !== undefined && (
        <WsButton variant="ghost" icon="circle-stop" onClick={() => { ctx.closePreview(ticket.id); setPreview({ loading: false }); }}>{translate({ key: 'workspaces.ticket.stopPreview' })}</WsButton>
      )}
      {preview.err === true && (
        <div className="flex items-center gap-1.5 text-xs text-wrong">
          <span>{translate({ key: 'workspaces.ticket.previewFailed' })}</span>
          {/* #39 — actionable pointer: a failed preview usually means the dev command isn't set. */}
          <button type="button" onClick={() => { ctx.navigate('workspace'); }} className="text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.ticket.previewSetDevCommand' })}</button>
        </div>
      )}
    </div>
    {/* #38 — inline preview (decision A: inline is primary; the URL link above opens it in a new tab). */}
    {preview.url !== undefined && (
      <div className="px-4 md:px-6 pb-3">
        <iframe title={translate({ key: 'workspaces.ticket.openPreview' })} src={preview.url} className="w-full h-[60vh] rounded-xl border border-container1-border bg-container1" />
      </div>
    )}
    {/* #20 — Live agent: tail the code agent's PTY output as the turn runs. Only offered once output arrives. */}
    {liveOutput.length > 0 && (
      <div className="px-4 md:px-6 pb-3 flex flex-col gap-2">
        <button type="button" onClick={() => { setShowLive((v) => !v); }} className="self-start text-xs text-muted hover:text-common cursor-pointer inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-correct animate-pulse" />{translate({ key: showLive ? 'workspaces.ticket.liveAgentHide' : 'workspaces.ticket.liveAgentShow' })}
        </button>
        {showLive && (
          <pre className="w-full max-h-80 overflow-auto rounded-xl border border-container1-border bg-container2/60 p-3 text-[11px] leading-snug font-mono text-common whitespace-pre-wrap break-words">{liveOutput}</pre>
        )}
      </div>
    )}
    </>
  );
}

function TicketHeader({ ticket }: { ticket: Ticket }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const linked = ctx.ticketMembers(ticket);
  const { setTicketPresence } = ctx;
  //? Realtime presence (#17): announce viewing on open + a heartbeat (< the 25s prune), retract on
  //? close. `setTicketPresence` is a stable useCallback, so this doesn't re-fire on every render.
  useEffect(() => {
    setTicketPresence(ticket.id, true);
    const hb = setInterval(() => { setTicketPresence(ticket.id, true); }, 12_000);
    return () => { clearInterval(hb); setTicketPresence(ticket.id, false); };
  }, [ticket.id, setTicketPresence]);
  const viewers = ctx.viewersOf(ticket.id).map((uid) => ctx.membersById[uid]).filter((m): m is Member => m !== undefined);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(ticket.title);
  //? Focus the title input when edit mode opens (user-initiated, so a11y-safe —
  //? avoids the `autoFocus` prop the jsx-a11y rule bans for on-load focus).
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renaming) nameRef.current?.focus(); }, [renaming]);

  const startRename = () => { setNameInput(ticket.title); setRenaming(true); };
  const commitRename = () => {
    if (!renaming) return;
    setRenaming(false);
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== ticket.title) ctx.editTicket(ticket.id, { title: trimmed });
  };

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-5 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm text-muted">
            <span className="font-mono">{ticket.id}</span>
            {ticket.issue && <span>· {ticket.issue}</span>}
            {ticket.status !== 'idle' && <StatusPill status={ticket.status} />}
          </div>
          {renaming ? (
            <input
              ref={nameRef}
              value={nameInput} onChange={(e) => { setNameInput(e.target.value); }}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
              className="w-full text-xl md:text-2xl font-semibold text-title bg-transparent border-b border-primary mt-1.5 leading-snug focus:outline-none"
            />
          ) : (
            <div className="flex items-center gap-2 mt-1.5">
              <h1 className="text-xl md:text-2xl font-semibold text-title leading-snug">{ticket.title}</h1>
              <button type="button" onClick={startRename} title={translate({ key: 'workspaces.ticket.editTitle' })} className="text-xs text-muted hover:text-title cursor-pointer shrink-0">{translate({ key: 'workspaces.workspaceSettings.edit' })}</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 pt-1">
          {viewers.length > 0 && (
            <div className="flex items-center gap-1.5" title={translate({ key: 'workspaces.ticket.viewingNow' })}>
              <span className="w-1.5 h-1.5 rounded-full bg-correct motion-safe:animate-pulse" />
              <AvatarStack users={viewers} size={24} max={4} />
            </div>
          )}
          {linked.length > 0 && <div title={translate({ key: 'workspaces.ticket.creatorAssignee' })}><AvatarStack users={linked} size={26} /></div>}
        </div>
      </div>

      {/* Meta chips + labels: one wrap-row on desktop; a collapsed "Details" disclosure
          on phone so the header stays two lines tall where space is scarce. */}
      <div className="hidden md:flex items-center gap-2 flex-wrap mt-3">
        <TicketMeta ticket={ticket} />
      </div>
      <div className="md:hidden mt-3">
        <Disclosure summary={translate({ key: 'workspaces.ticket.detailsDisclosure' })}>
          <div className="flex items-center gap-2 flex-wrap">
            <TicketMeta ticket={ticket} />
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

function TicketMeta({ ticket }: { ticket: Ticket }) {
  const translate = useTranslator();
  return (
    <>
      {ticket.branch && <MetaChip icon="diagram-project" text={ticket.branch} />}
      {ticket.mr && ticket.mr !== '—' && <MetaChip icon="code-merge" text={ticket.mr} />}
      {ticket.costLabel && <MetaChip icon="chart-column" text={ticket.costLabel} />}
      <MetaChip icon="up-right-from-square" text={translate({ key: 'workspaces.ticket.previewLive' })} tone="correct" />
      {ticket.labels.map((l) => <LabelChip key={l} name={l} />)}
    </>
  );
}

function MetaChip({ icon, text, tone }: { icon: Parameters<typeof Icon>[0]['name']; text: string; tone?: 'correct' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg bg-container2 px-2 h-7 text-xs font-medium ${tone === 'correct' ? 'text-correct' : 'text-common'}`}>
      <Icon name={icon} /> {text}
    </span>
  );
}

function Banner({ tone, icon, title, action, children }: { tone: 'warning' | 'correct'; icon: Parameters<typeof Icon>[0]['name']; title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  const ring = tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-correct/40 bg-correct/10';
  const fg = tone === 'warning' ? 'text-warning' : 'text-correct';
  return (
    <div className={`mx-4 md:mx-6 mb-2 rounded-xl border ${ring} p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon name={icon} className={`${fg} mt-0.5`} />
          <div>
            <div className="text-sm font-semibold text-title">{title}</div>
            {children}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}

//? #16 (W2) — the advisory list: NON-blocking questions the agent already proceeded past with an
//? assumption. Confirm the assumption (marks it resolved) or Correct it (a divergent answer schedules a
//? revision turn). Routes through the SAME `answerInput` op with the advisory's index.
function AdvisoryList({ ticketKey, advisories }: { ticketKey: string; advisories: { index: number; q: string; assumption: string }[] }) {
  const translate = useTranslator();
  //? F45 — pending is tracked PER ADVISORY: confirming one must not lock the others, since they are
  //? independent questions that happen to share a card.
  const { answerInput, isAnswerPending } = useWorkspaces();
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [text, setText] = useState('');
  return (
    <div className="mx-4 md:mx-6 mb-2 rounded-xl border border-container1-border bg-container1 p-4 flex flex-col gap-2">
      <div className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1.5"><Icon name="lightbulb" className="text-warning" /> {translate({ key: 'workspaces.ticket.advisoryTitle' })}</div>
      {advisories.map((a) => (
        <div key={a.index} className="rounded-lg border border-container2-border bg-container2/40 p-2.5 flex flex-col gap-1.5">
          <div className="text-sm text-title">{a.q}</div>
          {a.assumption.length > 0 && <div className="text-xs text-muted">{translate({ key: 'workspaces.ticket.advisoryAssumption', params: [{ key: 'assumption', value: a.assumption }] })}</div>}
          {correcting === a.index ? (
            <div className="flex items-center gap-2">
              <input value={text} onChange={(e) => { setText(e.target.value); }} placeholder={translate({ key: 'workspaces.ticket.advisoryCorrectPh' })} className="flex-1 h-8 px-2 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
              <WsButton icon="check" disabled={text.trim().length === 0 || isAnswerPending(ticketKey, a.index)} onClick={() => { answerInput(ticketKey, text.trim(), a.index); setCorrecting(null); setText(''); }}>{translate({ key: 'workspaces.ticket.advisorySubmit' })}</WsButton>
              <WsButton variant="ghost" onClick={() => { setCorrecting(null); setText(''); }}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <WsButton variant="secondary" icon={isAnswerPending(ticketKey, a.index) ? 'spinner' : 'check'} disabled={isAnswerPending(ticketKey, a.index)} onClick={() => { answerInput(ticketKey, a.assumption || 'ok', a.index); }}>{translate({ key: isAnswerPending(ticketKey, a.index) ? 'workspaces.ticket.sending' : 'workspaces.ticket.advisoryConfirm' })}</WsButton>
              <WsButton variant="ghost" icon="pen" onClick={() => { setCorrecting(a.index); setText(''); }}>{translate({ key: 'workspaces.ticket.advisoryCorrect' })}</WsButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

//? P-B — a structured, phone-usable answer card. The agent's question is stored in `needsInput` and
//? decoded here: an `approve` question renders Approve/Reject (+ an optional note); a `choice` question
//? renders one tap-target per option; a `free` question keeps the text input. Every path routes through the
//? SAME `answerInput` op (the Conductor records it + re-fires the parked turn) — no new verb, no schema
//? change. The card disappears when the ticket delta (needsInput cleared) broadcasts back.
//?
//? F45 — that round trip is NOT instant (socket → RBAC → conductor queue → agent resume → broadcast), and
//? until it lands the buttons used to stay live: the click looked like it did nothing, and a second tap
//? queued a second answer. `pending` locks the whole card for exactly that gap.
function NeedsInputBanner({ question, ticketKey }: { question: string; ticketKey: string }) {
  const translate = useTranslator();
  const { answerInput, isAnswerPending } = useWorkspaces();
  const pending = isAnswerPending(ticketKey);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const sq = parseStructuredQuestion(question);
  const answer = (a: string) => { const v = a.trim(); if (v.length === 0 || pending) return; answerInput(ticketKey, v); setReply(''); setNote(''); };
  const withNote = (decision: string) => { answer(note.trim().length > 0 ? `${decision}: ${note.trim()}` : decision); };
  return (
    <Banner tone="warning" icon="circle-question" title={translate({ key: 'workspaces.ticket.agentNeedsInput' })}>
      <p className="text-sm text-common mt-0.5">{sq.prompt}</p>
      {sq.kind === 'approve' && (
        <div className="flex flex-col gap-2 mt-2">
          <input
            value={note} onChange={(e) => { setNote(e.target.value); }}
            placeholder={translate({ key: 'workspaces.ticket.notePlaceholder' })}
            className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          />
          <div className="flex items-center gap-2">
            <WsButton icon={pending ? 'spinner' : 'check'} disabled={pending} onClick={() => { withNote(translate({ key: 'workspaces.ticket.approved' })); }}>{translate({ key: pending ? 'workspaces.ticket.sending' : 'workspaces.ticket.approve' })}</WsButton>
            <WsButton variant="ghost" icon="xmark" disabled={pending} onClick={() => { withNote(translate({ key: 'workspaces.ticket.rejected' })); }}>{translate({ key: 'workspaces.ticket.reject' })}</WsButton>
          </div>
        </div>
      )}
      {sq.kind === 'choice' && (
        <div className="flex flex-wrap gap-2 mt-2">
          {sq.options.map((opt) => (
            <WsButton key={opt} variant="ghost" disabled={pending} onClick={() => { answer(opt); }}>{opt}</WsButton>
          ))}
        </div>
      )}
      {sq.kind === 'free' && (
        <div className="flex items-center gap-2 mt-2">
          <input
            value={reply} onChange={(e) => { setReply(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') answer(reply); }}
            placeholder={translate({ key: 'workspaces.ticket.answerPlaceholder' })} disabled={pending}
            className="flex-1 h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors disabled:opacity-50"
          />
          <WsButton icon={pending ? 'spinner' : undefined} disabled={pending} onClick={() => { answer(reply); }}>{translate({ key: pending ? 'workspaces.ticket.sending' : 'workspaces.ticket.send' })}</WsButton>
        </div>
      )}
    </Banner>
  );
}

//? Overview = the essentials (Description + Comments) on the canvas; the settings
//? grid (priority, service/unit, stage config, carry-over, linked artifacts) sits
//? behind ONE "Ticket settings" disclosure so a first-time visitor isn't met with
//? a wall of dropdowns.
function OverviewTab({ ticket, stage }: { ticket: Ticket; stage?: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [desc, setDesc] = useState(ticket.description ?? '');
  useEffect(() => { setDesc(ticket.description ?? ''); }, [ticket.description]);
  const commitDesc = () => { if (desc !== (ticket.description ?? '')) ctx.editTicket(ticket.id, { description: desc }); };
  const priorityItems: DropdownItem[] = PRIORITY_ORDER.map((p) => ({ id: p, value: p, item: translate({ key: PRIORITY_LABEL_KEY[p] }) }));
  //? The units this ticket's project declares. 'root' is a real choice, not an empty state: it means "the
  //? whole repo is the unit", which is what a ticket touching shared code wants.
  const ticketServices = ctx.services.filter((svc) => svc.projectId === ticket.projectId);
  const serviceItems: DropdownItem[] = [
    { id: 'root', value: 'root', item: translate({ key: 'workspaces.ticket.serviceRoot' }) },
    ...ticketServices.map((svc) => ({ id: svc.id, value: svc.id, item: svc.name })),
  ];
  //? The REAL stage config for this ticket's stage (was a static "AI-driven · RAG…"
  //? string that contradicted a No-AI stage). Drives the aiEnabled label + skills.
  const stageCfg = ctx.stageConfigs.find((s) => s.id === ticket.stageId);
  const stageSkills = stageCfg ? [...stageCfg.skillKeys, ...(stageCfg.sourceIds.length > 0 ? [translate({ key: 'workspaces.ticket.sourcesCount', params: [{ key: 'count', value: stageCfg.sourceIds.length }] })] : [])] : [];
  return (
    <div className="flex flex-col gap-4">
      <Card title={translate({ key: 'workspaces.ticket.description' })}>
        <textarea
          value={desc} onChange={(e) => { setDesc(e.target.value); }}
          onBlur={commitDesc}
          placeholder={translate({ key: 'workspaces.ticket.addDescriptionPlaceholder' })}
          rows={4}
          className="w-full resize-y rounded-lg border border-container1-border bg-container2/50 px-3 py-2 text-sm text-common leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
        />
      </Card>

      <Disclosure summary={translate({ key: 'workspaces.ticket.settingsDisclosure' })}>
        <div className="flex flex-col gap-4 pt-1">
          <SettingSection label={translate({ key: 'workspaces.priority.label' })}>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PRIORITY_DOT[ticket.priority ?? 'normal']}`} />
              <Dropdown
                size="sm"
                items={priorityItems}
                value={priorityItems.find((i) => i.id === (ticket.priority ?? 'normal'))}
                onChange={(it) => {
                  const next = PRIORITY_ORDER.find((p) => p === it.id) ?? 'normal';
                  if (next !== (ticket.priority ?? 'normal')) ctx.editTicket(ticket.id, { priority: next });
                }}
              />
              {(ticket.priority ?? 'normal') === 'urgent' && (
                <span className="text-xs text-wrong">{translate({ key: 'workspaces.priority.urgentHint' })}</span>
              )}
            </div>
          </SettingSection>
          {/* Per-service CI/preview: which monorepo unit this ticket's work belongs to. It decides which
              service a preview boots and which service's CI gates the ticket — both of which silently used the
              project root before. Only shown when the project actually declares units; a single-unit repo is
              not asked a question it has no answer to. */}
          {ticketServices.length > 0 && (
            <SettingSection label={translate({ key: 'workspaces.ticket.serviceLabel' })}>
              <Dropdown
                size="sm"
                items={serviceItems}
                value={serviceItems.find((i) => i.id === (ticket.serviceId ?? 'root'))}
                onChange={(it) => {
                  const next = it.id === 'root' ? null : String(it.id);
                  if (next !== (ticket.serviceId ?? null)) ctx.editTicket(ticket.id, { serviceId: next });
                }}
              />
            </SettingSection>
          )}
          <SettingSection label={translate({ key: 'workspaces.ticket.stageConfig' })}>
            <div className="flex items-center gap-2 text-sm text-common">
              <Icon name="diagram-project" className="text-muted" />
              <span className="text-title font-medium">{stage ?? '—'}</span>
              <span className="text-muted">· {stageCfg?.aiEnabled === true ? translate({ key: 'workspaces.board.aiDrivenStage' }) : translate({ key: 'workspaces.board.noAi' })}{stageSkills.length > 0 ? ` · ${stageSkills.join(', ')}` : ''}</span>
            </div>
          </SettingSection>
          {ticket.carryOver && (
            <SettingSection label={translate({ key: 'workspaces.ticket.carryOverTitle' })}>
              <p className="text-sm text-common leading-relaxed">{ticket.carryOver}</p>
            </SettingSection>
          )}
          <LinkedArtifactsSection ticketKey={ticket.id} />
        </div>
      </Disclosure>

      <CommentsThread ticketId={ticket.id} />
    </div>
  );
}

function SettingSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-title mb-2">{label}</div>
      {children}
    </div>
  );
}

//? Linked artifacts (ADR 0034) — design/Studio artifacts this ticket implements. The Conductor injects
//? each linked artifact into the coding agent's context at stage-spawn, so linking a Designer theme or
//? a Studio spec to a ticket makes the agent build to it.
function LinkedArtifactsSection({ ticketKey }: { ticketKey: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const links = ctx.ticketArtifactLinks.filter((l) => l.ticketId === ticketKey);
  const options: DropdownItem[] = [
    ...ctx.designArtifacts.map((d) => ({ id: `design:${d.id}`, value: `design:${d.id}`, item: `${d.kind}: ${d.name}`, searchText: d.name })),
    ...ctx.studioArtifacts.map((s) => ({ id: `studio:${s.id}`, value: `studio:${s.id}`, item: `${s.kind}: ${s.title}`, searchText: s.title })),
  ];
  const onPick = (it: DropdownItem) => {
    const kind = String(it.id).startsWith('design:') ? 'design' : 'studio';
    const aid = String(it.id).slice(kind.length + 1);
    if (aid.length === 0) return;
    const name = kind === 'design' ? ctx.designArtifacts.find((d) => d.id === aid)?.name : ctx.studioArtifacts.find((s) => s.id === aid)?.title;
    ctx.linkArtifact(ticketKey, aid, kind, name);
  };
  return (
    <SettingSection label={translate({ key: 'workspaces.ticket.linkedArtifacts' })}>
      <div className="flex flex-col gap-2">
        {links.length === 0 && <div className="text-xs text-muted">{translate({ key: 'workspaces.ticket.noLinkedArtifacts' })}</div>}
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 rounded-lg border border-container1-border bg-container2/40 px-2.5 py-1.5">
            <Icon name={l.artifactKind === 'design' ? 'palette' : (l.artifactKind === 'ui-review' ? 'display' : 'bullhorn')} className="text-primary text-sm shrink-0" />
            <span className="text-sm text-common truncate flex-1">{l.name}</span>
            <button type="button" onClick={() => { ctx.unlinkArtifact(l.id); }} className="text-muted hover:text-wrong cursor-pointer shrink-0"><Icon name="xmark" className="text-xs" /></button>
          </div>
        ))}
        {options.length > 0 && <Dropdown size="sm" items={options} placeholder={translate({ key: 'workspaces.ticket.linkArtifactPlaceholder' })} onChange={onPick} />}
      </div>
    </SettingSection>
  );
}

//? Comments thread + composer, scoped to one ticket. Notes arrive newest-first
//? from the snapshot; rendered oldest→newest so the thread reads top-to-bottom.
//? Non-user / unknown authors fall back to a generic label + initials avatar.
function CommentsThread({ ticketId }: { ticketId: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [draft, setDraft] = useState('');
  const notes = ctx.ticketNotes.filter((n) => n.ticketId === ticketId).toReversed();

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    ctx.addComment(ticketId, trimmed);
    setDraft('');
  };

  return (
    <Card title={translate({ key: 'workspaces.ticket.comments' })}>
      <div className="flex flex-col gap-3">
        {notes.length === 0
          ? <div className="text-sm text-muted">{translate({ key: 'workspaces.ticket.noComments' })}</div>
          : notes.map((n) => {
            const author = ctx.membersById[n.author];
            const name = author?.name ?? translate({ key: 'workspaces.ticket.commentSystemAuthor' });
            return (
              <div key={n.id} className="flex items-start gap-2.5">
                <AvatarBubble user={author ?? { name }} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-title">{name}</span>
                    <span className="text-xs text-muted font-mono">{n.time}</span>
                  </div>
                  <p className="text-sm text-common leading-relaxed mt-0.5 whitespace-pre-wrap break-words">{n.body}</p>
                </div>
              </div>
            );
          })}
        <div className="flex items-end gap-2 pt-1">
          <textarea
            value={draft} onChange={(e) => { setDraft(e.target.value); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={translate({ key: 'workspaces.ticket.addCommentPlaceholder' })}
            rows={2}
            className="flex-1 resize-y rounded-lg border border-container1-border bg-container2/50 px-3 py-2 text-sm text-common leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          />
          <WsButton onClick={submit}>{translate({ key: 'workspaces.ticket.send' })}</WsButton>
        </div>
      </div>
    </Card>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      {title && <div className="text-sm font-semibold text-title mb-2">{title}</div>}
      {children}
    </section>
  );
}
