//? Workspaces — the scrum board. Kanban across the 7 pipeline stages.
//?
//? Stage transitions are AI-driven (the user does NOT drag tickets); cards are
//? click-to-open. (Cards were previously wrapped in a motion `LayoutGroup` with
//? shared `layoutId` for AI-move glides, but that shared-layout projection crashes
//? React 19's reconciler on route unmount — "removeChild is not a child" — so it
//? was removed; a future AI-move animation must use a non-layout technique.)
//? Columns are derived from the live workspace snapshot (real ticket rows per
//? stage); mobile shows read-only stage-segments.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon, { type IconName } from '../../_components/Icon';
import { Popover } from '../../_components/motion';
import { AvatarStack, EmptyState, IconButton, LabelChip, PopMenu, StatusPill, WsButton, useClickAway, type PopMenuItem } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { PipelineStage, Ticket, TicketPriority, TicketStatus } from '../../_data/types';
import { PRIORITY_DOT, PRIORITY_LABEL_KEY, PRIORITY_ORDER, isBadgedPriority } from '../../_functions/priority';

//? Filters applied client-side on top of the live snapshot (no control-API op — this
//? is purely a view concern, nothing is persisted).
interface BoardFilters { status: TicketStatus | 'all'; assigneeId: string }
const ALL_FILTERS: BoardFilters = { status: 'all', assigneeId: 'all' };

const STATUS_FILTER_OPTIONS: TicketStatus[] = ['idle', 'needs-input', 'busy', 'done', 'paused', 'stuck'];
const STATUS_LABEL_KEY: Record<TicketStatus, string> = {
  idle: 'workspaces.common.statusIdle',
  'needs-input': 'workspaces.common.statusNeedsInput',
  busy: 'workspaces.common.statusBusy',
  done: 'workspaces.common.statusDone',
  paused: 'workspaces.common.statusPaused',
  stuck: 'workspaces.common.statusStuck',
};

//? Columns are keyed by the stage's free-string id (04b §12), not a fixed enum.
type Columns = Record<string, Ticket[]>;

//? Apply the AI-driven stage overrides (from the Workspace-AI chat) on top of
//? the seed stage, so a "move DEV-#### to …" lands the card in a new column and
//? the shared layoutId animates it there.
function buildColumns(tickets: Ticket[], stages: PipelineStage[], overrides: Record<string, string>): Columns {
  const cols: Columns = Object.fromEntries(stages.map((s) => [s.id, [] as Ticket[]]));
  for (const t of tickets) {
    const stage = overrides[t.id] ?? t.stageId;
    const list = cols[stage];
    if (!list) continue;
    list.push(t);
  }
  return cols;
}

//? #9 — a manual per-card stage move (discoverability for board-first users; the board is otherwise
//? AI-driven). A small stage picker opened from the card menu → moveTicket. Kept as its own component
//? so it can use hooks (cardMenuItems is a plain function).
function StageMovePicker({ ticket, ctx }: { ticket: Ticket; ctx: ReturnType<typeof useWorkspaces> }) {
  const translate = useTranslator();
  const [stageId, setStageId] = useState(ticket.stageId);
  const items: DropdownItem[] = ctx.stages.map((s) => ({ id: s.id, value: s.id, item: s.name }));
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.board.moveToStageTitle', params: [{ key: 'id', value: ticket.id }] })}</div>
      <Dropdown size="sm" items={items} value={items.find((i) => i.id === stageId)} onChange={(it) => { setStageId(String(it.id)); }} />
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="arrow-right" disabled={stageId === ticket.stageId} onClick={() => { ctx.moveTicket(ticket.id, stageId); void menuHandler.close(); }}>{translate({ key: 'workspaces.board.moveToStageConfirm' })}</WsButton>
      </div>
    </div>
  );
}

//? #6 — attach a design/studio artifact to a ticket as a reference (the 'Add reference' card action was
//? a dead no-op). Lists the workspace's studio + design library artifacts → linkArtifact.
function ArtifactLinkPicker({ ticket, ctx }: { ticket: Ticket; ctx: ReturnType<typeof useWorkspaces> }) {
  const translate = useTranslator();
  const items: { id: string; kind: string; label: string }[] = [
    ...ctx.studioArtifacts.map((a) => ({ id: a.id, kind: a.kind, label: a.title })),
    ...ctx.designArtifacts.map((a) => ({ id: a.id, kind: a.kind, label: a.name })),
  ];
  return (
    <div className="w-full flex flex-col gap-2 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.board.addReferenceTitle', params: [{ key: 'id', value: ticket.id }] })}</div>
      {items.length === 0 && <div className="text-sm text-muted py-4 text-center">{translate({ key: 'workspaces.board.noArtifacts' })}</div>}
      <div className="max-h-80 overflow-y-auto flex flex-col gap-1">
        {items.map((a) => (
          <button key={`${a.kind}-${a.id}`} type="button" onClick={() => { ctx.linkArtifact(ticket.id, a.id, a.kind, a.label); void menuHandler.close(); }} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-container2 cursor-pointer">
            <Icon name="link" className="text-muted" />
            <span className="text-sm text-title truncate">{a.label}</span>
            <span className="text-xs text-muted ml-auto shrink-0">{a.kind}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-end"><WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton></div>
    </div>
  );
}

function cardMenuItems(ticket: Ticket, ctx: ReturnType<typeof useWorkspaces>, translate: ReturnType<typeof useTranslator>): PopMenuItem[] {
  const paused = ticket.status === 'paused';
  return [
    { label: translate({ key: 'workspaces.board.openTicket' }), icon: 'up-right-from-square', onClick: () => { ctx.openTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.board.openTerminal' }), icon: 'terminal', onClick: () => { ctx.pushTo('terminals'); } },
    //? #9 — manual stage move (opens a stage picker).
    { label: translate({ key: 'workspaces.board.moveToStage' }), icon: 'arrow-right-arrow-left', onClick: () => { void menuHandler.open(<StageMovePicker ticket={ticket} ctx={ctx} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); } },
    { label: translate({ key: 'workspaces.board.addReference' }), icon: 'link', onClick: () => { void menuHandler.open(<ArtifactLinkPicker ticket={ticket} ctx={ctx} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); } },
    { divider: true },
    { label: paused ? translate({ key: 'workspaces.board.resumeAgent' }) : translate({ key: 'workspaces.board.pauseAgent' }), icon: paused ? 'play' : 'pause', onClick: () => { if (paused) ctx.resumeTicket(ticket.id); else ctx.pauseTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.board.copyDevId' }), icon: 'copy', onClick: () => void navigator.clipboard.writeText(ticket.id) },
    { divider: true },
    {
      label: translate({ key: 'workspaces.board.archive' }), icon: 'box-archive', danger: true,
      onClick: () => {
        void menuHandler.confirm({
          title: translate({ key: 'workspaces.board.archiveConfirmTitle', params: [{ key: 'id', value: ticket.id }] }),
          content: translate({ key: 'workspaces.board.archiveConfirmContent' }),
        }).then((ok) => { if (ok) ctx.archiveTicket(ticket.id); });
      },
    },
  ];
}

function KanbanCard({ ticket }: { ticket: Ticket }) {
  const ctx = useWorkspaces();
  const translate = useTranslator();
  const linked = ctx.ticketMembers(ticket);
  const stop = { onClick: (e: React.MouseEvent) => { e.stopPropagation(); } };
  const downAt = useRef(0);
  const menuClosedAt = useRef(0);
  //? Open the ticket only on a deliberate, quick click: not after a text
  //? selection (slow press / non-empty selection), and not when the click is
  //? really just dismissing this card's open ⋯ menu.
  const handleClick = () => {
    if (Date.now() - menuClosedAt.current < 250) return;
    if (Date.now() - downAt.current > 350) return;
    if ((globalThis.getSelection()?.toString() ?? '') !== '') return;
    ctx.openTicket(ticket.id);
  };
  return (
    <div
      role="button" tabIndex={0}
      onPointerDown={() => { downAt.current = Date.now(); }}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') ctx.openTicket(ticket.id); }}
      className="group relative rounded-xl border border-container1-border bg-container1 p-3 cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-container2-border hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          {isBadgedPriority(ticket.priority) && (
            <span
              title={translate({ key: PRIORITY_LABEL_KEY[ticket.priority] })}
              className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[ticket.priority]}`}
            />
          )}
          <span className="font-mono text-xs text-muted">{ticket.id}</span>
        </span>
        <div className="flex items-center gap-1" {...stop}>
          {ticket.status === 'idle'
            ? <span className="inline-flex items-center gap-1 text-xs text-muted"><Icon name="moon" /> {translate({ key: 'workspaces.board.noAi' })}</span>
            : <StatusPill status={ticket.status} />}
          <PopMenu
            items={cardMenuItems(ticket, ctx, translate)}
            onOpenChange={(open) => { if (!open) menuClosedAt.current = Date.now(); }}
            triggerClass="w-7 h-7 flex items-center justify-center rounded-lg text-muted opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 hover:bg-container2 hover:text-common cursor-pointer transition-opacity"
          />
        </div>
      </div>
      <div className="text-sm font-medium text-title mt-1.5 leading-snug">{ticket.title}</div>
      {ticket.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">{ticket.labels.map((l) => <LabelChip key={l} name={l} />)}</div>
      )}
      <div className="flex items-center justify-between gap-2 mt-3">
        {linked.length > 0 ? <AvatarStack users={linked} size={20} /> : <span className="text-xs text-muted">{translate({ key: 'workspaces.board.unassigned' })}</span>}
        <div className="flex items-center gap-2">
          {ticket.costLabel && <span className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-mono text-muted">{ticket.costLabel}</span>}
          {ticket.hasTerminal && (
            <span className="inline-flex items-center gap-1 text-[11px] text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse" /> {translate({ key: 'workspaces.board.terminal' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({ stage, tickets }: { stage: PipelineStage; tickets: Ticket[] }) {
  const translate = useTranslator();
  const wipOver = stage.wipLimit != null && tickets.length > stage.wipLimit;
  return (
    <div className={`flex flex-col w-72 shrink-0 rounded-2xl bg-container2/40 ${stage.aiEnabled ? '' : 'opacity-90'}`}>
      <div className={`flex items-center justify-between gap-2 px-3 h-11 ${wipOver ? 'text-warning' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-title truncate">{stage.name}</span>
          <span className="rounded-full bg-container2 px-1.5 text-xs text-muted">{tickets.length}</span>
          {wipOver && <span title={translate({ key: 'workspaces.board.overWipLimit' })}><Icon name="triangle-exclamation" className="text-warning text-xs" /></span>}
          {stage.aiEnabled && <span title={translate({ key: 'workspaces.board.aiDrivenStage' })}><Icon name="robot" className="text-muted text-xs" /></span>}
        </div>
      </div>
      <div className="flex flex-col gap-2 px-2 pb-2 overflow-y-auto flex-1 min-h-0">
        {tickets.map((t) => <KanbanCard key={t.id} ticket={t} />)}
        {tickets.length === 0 && stage.id !== 'unrefined' && <div className="text-center text-xs text-muted py-6">{translate({ key: 'workspaces.board.noTickets' })}</div>}
        {stage.id === 'unrefined' && <UnrefinedAddCard />}
      </div>
    </div>
  );
}

//? Trello-style inline add at the bottom of the Unrefined column. New tickets can
//? only enter here (Conductor forces `unrefined`); a click reveals an auto-focused
//? input, Enter creates + clears for rapid entry, Escape/empty-blur collapses.
function UnrefinedAddCard() {
  const translate = useTranslator();
  const { quickAdd } = useWorkspaces();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    quickAdd({ title: t });
    setDraft('');
  };
  if (!adding) {
    return (
      <button type="button" onClick={() => { setAdding(true); }} className="flex items-center gap-2 rounded-xl px-3 h-9 text-sm text-muted hover:text-common hover:bg-container2 transition-colors cursor-pointer">
        <Icon name="plus" /> {translate({ key: 'workspaces.board.ticket' })}
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      value={draft} onChange={(e) => { setDraft(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
      onBlur={() => { if (!draft.trim()) setAdding(false); }}
      placeholder={translate({ key: 'workspaces.board.newTicketTitlePlaceholder' })}
      className="h-9 px-3 rounded-xl border border-primary/50 bg-container1 text-sm text-title focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
  );
}

//? Opened via menuHandler (outside the WorkspacesProvider tree, per the
//? `CreateWorkspaceForm` pattern in Shell.tsx), so it receives the stage list +
//? create callback as props instead of reading them from context.
//? Creation takes only a title — every new ticket enters at `unrefined` (the
//? Conductor enforces this). The title input auto-focuses on open.
function NewTicketForm({ onCreate }: { onCreate: (input: { title: string; priority?: TicketPriority; startWithAi?: boolean }) => void }) {
  const translate = useTranslator();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [startWithAi, setStartWithAi] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const priorityItems: DropdownItem[] = PRIORITY_ORDER.map((p) => ({ id: p, value: p, item: translate({ key: PRIORITY_LABEL_KEY[p] }) }));
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onCreate({ title: t, priority, ...(startWithAi ? { startWithAi: true } : {}) });
    void menuHandler.close();
  };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.board.newTicketTitle' })}</div>
      <input
        ref={inputRef}
        value={title} onChange={(e) => { setTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.board.newTicketTitlePlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">{translate({ key: 'workspaces.priority.label' })}</span>
        <Dropdown
          size="sm" items={priorityItems} value={priorityItems.find((i) => i.id === priority)}
          onChange={(it) => { setPriority(PRIORITY_ORDER.find((p) => p === it.id) ?? 'normal'); }}
        />
      </div>
      {/* O-D — start the AI pipeline immediately (advance to the first AI stage) instead of manual triage. */}
      <label className="flex items-center gap-2 text-sm text-common cursor-pointer">
        <input type="checkbox" checked={startWithAi} onChange={(e) => { setStartWithAi(e.target.checked); }} className="accent-primary" />
        {translate({ key: 'workspaces.board.startWithAi' })}
      </label>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}

//? Simple client-side status/assignee filter popover — a view concern only,
//? nothing is persisted (no control-API op).
function FilterMenu({ isMobile, filters, onChange }: { isMobile: boolean; filters: BoardFilters; onChange: (next: BoardFilters) => void }) {
  const translate = useTranslator();
  const { members } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(open, () => { setOpen(false); });

  const statusItems: DropdownItem[] = [
    { id: 'all', value: 'all', item: translate({ key: 'workspaces.board.allStatuses' }) },
    ...STATUS_FILTER_OPTIONS.map((s) => ({ id: s, value: s, item: translate({ key: STATUS_LABEL_KEY[s] }) })),
  ];
  const assigneeItems: DropdownItem[] = [
    { id: 'all', value: 'all', item: translate({ key: 'workspaces.board.allAssignees' }) },
    ...members.map((m) => ({ id: m.id, value: m.id, item: m.name })),
  ];
  const active = filters.status !== 'all' || filters.assigneeId !== 'all';

  return (
    <div className="relative" ref={ref}>
      <WsButton variant="secondary" icon="filter" onClick={() => { setOpen((o) => !o); }} className={active ? 'ring-2 ring-primary/40' : ''}>
        {isMobile ? '' : translate({ key: 'workspaces.board.filter' })}
      </WsButton>
      <Popover open={open} className="absolute right-0 mt-1 z-30 w-64 rounded-xl border border-container1-border bg-container1 p-3 shadow-lg flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{translate({ key: 'workspaces.board.filterStatus' })}</span>
          <Dropdown
            size="sm" items={statusItems} value={statusItems.find((i) => i.id === filters.status)}
            onChange={(it) => { onChange({ ...filters, status: STATUS_FILTER_OPTIONS.find((s) => s === it.id) ?? 'all' }); }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{translate({ key: 'workspaces.board.filterAssignee' })}</span>
          <Dropdown
            size="sm" items={assigneeItems} value={assigneeItems.find((i) => i.id === filters.assigneeId)}
            onChange={(it) => { onChange({ ...filters, assigneeId: String(it.id) }); }}
          />
        </div>
        {active && (
          <button type="button" onClick={() => { onChange(ALL_FILTERS); }} className="text-xs text-primary hover:underline text-left cursor-pointer">
            {translate({ key: 'workspaces.board.clearFilters' })}
          </button>
        )}
      </Popover>
    </div>
  );
}

function BoardHeader({
  isMobile, sprintFilter, onSprintFilterChange, filters, onFiltersChange,
}: {
  isMobile: boolean;
  sprintFilter: string;
  onSprintFilterChange: (sprintId: string) => void;
  filters: BoardFilters;
  onFiltersChange: (next: BoardFilters) => void;
}) {
  const ctx = useWorkspaces();
  const translate = useTranslator();
  const allSprintsItem: DropdownItem = { id: 'all', value: 'all', item: translate({ key: 'workspaces.board.allSprints' }) };
  const sprintItems: DropdownItem[] = ctx.sprints.map((s) => {
    let suffix = '';
    if (s.start) suffix = s.daysLeft ? ` · ${translate({ key: 'workspaces.board.daysLeft', params: [{ key: 'n', value: String(s.daysLeft) }] })}` : ` · ${s.start}–${s.end ?? ''}`;
    return { id: s.id, value: s.id, item: `${s.name}${suffix}` };
  });
  const openNewTicket = () => {
    void menuHandler.open(<NewTicketForm onCreate={ctx.quickAdd} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };
  const selectedSprintItem = sprintItems.find((i) => i.id === sprintFilter) ?? allSprintsItem;
  return (
    <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
      <div className="flex items-baseline gap-2 min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.board.title' })}</h1>
        {!isMobile && <span className="text-sm text-muted">{ctx.activeWorkspace.name}</span>}
        {/* #105/#19 — engine occupancy chip (only when something is running or queued). */}
        {ctx.capacity && (ctx.capacity.active > 0 || ctx.capacity.queued > 0) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-container2 px-2 py-0.5 text-xs text-muted tabular-nums" title={translate({ key: 'workspaces.board.capacityTitle' })}>
            <Icon name="bolt" className="text-primary" />
            {translate({ key: 'workspaces.board.capacityChip', params: [{ key: 'active', value: String(ctx.capacity.active) }, { key: 'limit', value: String(ctx.capacity.limit) }, { key: 'queued', value: String(ctx.capacity.queued) }] })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Dropdown
          size="sm"
          value={selectedSprintItem}
          items={[allSprintsItem, ...sprintItems, { id: 'manage', value: 'manage', item: translate({ key: 'workspaces.board.manageSprints' }) }]}
          onChange={(it) => {
            if (it.id === 'manage') { ctx.navigate('backlog'); return; }
            onSprintFilterChange(String(it.id));
          }}
        />
        {!ctx.workspacePaused && (
          <IconButton
            icon="pause"
            title={translate({ key: 'workspaces.board.pauseAll' })}
            onClick={() => void menuHandler.confirm({
              title: translate({ key: 'workspaces.board.pauseAllConfirmTitle' }),
              content: translate({ key: 'workspaces.board.pauseAllConfirmContent' }),
            }).then((ok) => { if (ok) ctx.pauseAll(); })}
          />
        )}
        <FilterMenu isMobile={isMobile} filters={filters} onChange={onFiltersChange} />
        <WsButton icon="plus" onClick={openNewTicket}>{isMobile ? '' : translate({ key: 'workspaces.board.ticket' })}</WsButton>
      </div>
    </div>
  );
}

//? J1 — first-steps onboarding banner for a fresh workspace (no tickets yet). Names the 3 things a novice
//? does first — connect a repo, create a ticket, ask the AI — with a one-click "create first ticket" CTA.
function OnboardingBanner() {
  const translate = useTranslator();
  const { quickAdd, navigate, toggleAi } = useWorkspaces();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const steps: { icon: IconName; text: string; action: () => void; cta: string }[] = [
    { icon: 'link', text: translate({ key: 'workspaces.firstSteps.step1' }), action: () => { navigate('settings'); }, cta: translate({ key: 'workspaces.firstSteps.step1Cta' }) },
    { icon: 'plus', text: translate({ key: 'workspaces.firstSteps.step2' }), action: () => { quickAdd({ title: translate({ key: 'workspaces.firstSteps.firstTicket' }) }); }, cta: translate({ key: 'workspaces.firstSteps.step2Cta' }) },
    { icon: 'robot', text: translate({ key: 'workspaces.firstSteps.step3' }), action: () => { toggleAi(); }, cta: translate({ key: 'workspaces.firstSteps.step3Cta' }) },
  ];
  return (
    <div className="mx-4 md:mx-6 mb-3 rounded-2xl border border-primary-border bg-primary/8 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.firstSteps.title' })}</div>
        <button type="button" onClick={() => { setDismissed(true); }} className="text-muted hover:text-title cursor-pointer text-xs">{translate({ key: 'workspaces.firstSteps.dismiss' })}</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <div key={s.cta} className="rounded-xl border border-container2-border bg-container1 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-title"><span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span><Icon name={s.icon} className="text-muted" /></div>
            <div className="text-xs text-common">{s.text}</div>
            <button type="button" onClick={s.action} className="self-start text-xs font-medium text-primary hover:underline cursor-pointer">{s.cta} →</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardMobile({ columns }: { columns: Columns }) {
  const translate = useTranslator();
  const { stages } = useWorkspaces();
  const [active, setActive] = useState<string>(stages.find((s) => columns[s.id]?.length)?.id ?? stages[0]?.id ?? '');
  const stage = stages.find((s) => s.id === active);
  const list = columns[active] ?? [];
  if (!stage) return null;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto ws-no-scrollbar">
        {stages.map((s) => (
          <button key={s.id} type="button" onClick={() => { setActive(s.id); }}
            className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${s.id === active ? 'bg-primary text-title-primary' : 'bg-container2 text-muted'}`}>
            {s.name}<span className={`rounded-full px-1.5 text-xs ${s.id === active ? 'bg-white/20' : 'bg-container1'}`}>{columns[s.id]?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
        {list.map((t) => <KanbanCard key={t.id} ticket={t} />)}
        {list.length === 0 && <EmptyState icon="table-columns" title={translate({ key: 'workspaces.board.mobileEmptyTitle', params: [{ key: 'stage', value: stage.name }] })} sub={translate({ key: 'workspaces.board.mobileEmptySub' })} />}
      </div>
    </div>
  );
}

export const template = 'workspaces';

export default function Board() {
  const { isMobile, stageOverrides, tickets, stages } = useWorkspaces();
  const translate = useTranslator();
  const [sprintFilter, setSprintFilter] = useState('all');
  const [filters, setFilters] = useState<BoardFilters>(ALL_FILTERS);

  const filteredTickets = useMemo(() => tickets.filter((t) => {
    if (sprintFilter !== 'all' && t.sprintId !== sprintFilter) return false;
    if (filters.status !== 'all' && t.status !== filters.status) return false;
    if (filters.assigneeId !== 'all' && t.assigneeId !== filters.assigneeId) return false;
    return true;
  }), [tickets, sprintFilter, filters]);
  const columns = useMemo(() => buildColumns(filteredTickets, stages, stageOverrides), [filteredTickets, stages, stageOverrides]);

  //? No pipeline stages yet — the snapshot is still loading, or this is a freshly
  //? bootstrapped workspace. Render an empty state instead of indexing stages[0]
  //? (BoardMobile would otherwise crash the phone-first board on load).
  if (stages.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <BoardHeader isMobile={isMobile} sprintFilter={sprintFilter} onSprintFilterChange={setSprintFilter} filters={filters} onFiltersChange={setFilters} />
        <div className="flex-1 min-h-0 flex items-center justify-center px-4">
          <EmptyState icon="table-columns" title={translate({ key: 'workspaces.board.emptyStagesTitle' })} sub={translate({ key: 'workspaces.board.emptyStagesSub' })} />
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <BoardHeader isMobile sprintFilter={sprintFilter} onSprintFilterChange={setSprintFilter} filters={filters} onFiltersChange={setFilters} />
        <BoardMobile columns={columns} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <BoardHeader isMobile={false} sprintFilter={sprintFilter} onSprintFilterChange={setSprintFilter} filters={filters} onFiltersChange={setFilters} />
      {/* J1 — a fresh workspace (no tickets): a first-steps banner so a novice knows where to start. */}
      {tickets.length === 0 && <OnboardingBanner />}
      <div className="flex-1 min-h-0 overflow-x-auto ws-no-scrollbar px-4 md:px-6 pb-6">
        <div className="flex gap-3 h-full">
          {stages.map((s) => <KanbanColumn key={s.id} stage={s} tickets={columns[s.id] ?? []} />)}
          {/* trailing space so the last column isn't flush against the AI panel / viewport edge */}
          <div className="w-2 shrink-0" aria-hidden />
        </div>
      </div>
    </div>
  );
}
