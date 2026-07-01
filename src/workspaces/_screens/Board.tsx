//? Workspaces — the scrum board. Kanban across the 7 pipeline stages.
//?
//? Stage transitions are AI-driven (the user does NOT drag tickets); cards are
//? click-to-open. Cards carry motion `layout` + `layoutId`, wrapped in a
//? LayoutGroup, so that when the AI moves a ticket between columns (future:
//? from the Workspace-AI chat) the card animates smoothly to its new spot.
//? Columns are derived from dummy data for now. Desktop-first; mobile shows
//? read-only stage-segments.

import { useMemo, useRef, useState } from 'react';

import { LayoutGroup, motion } from 'motion/react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { Popover, SPRING_SOFT } from '../_components/motion';
import { AvatarStack, EmptyState, IconButton, LabelChip, PopMenu, StatusPill, WsButton, useClickAway, type PopMenuItem } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { PipelineStage, Ticket, TicketStatus } from '../_data/types';

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

function cardMenuItems(ticket: Ticket, ctx: ReturnType<typeof useWorkspaces>, translate: ReturnType<typeof useTranslator>): PopMenuItem[] {
  const paused = ticket.status === 'paused';
  return [
    { label: translate({ key: 'workspaces.board.openTicket' }), icon: 'up-right-from-square', onClick: () => { ctx.openTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.board.openTerminal' }), icon: 'terminal', onClick: () => { ctx.pushTo('terminals'); } },
    { label: translate({ key: 'workspaces.board.addReference' }), icon: 'link', onClick: () => { /* Fase 2: attach a TicketReference */ } },
    { divider: true },
    { label: paused ? translate({ key: 'workspaces.board.resumeAgent' }) : translate({ key: 'workspaces.board.pauseAgent' }), icon: paused ? 'play' : 'pause', onClick: () => { /* Fase 2: pause/resume the ticket's AI session */ } },
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
    <motion.div
      layout
      layoutId={ticket.id}
      transition={SPRING_SOFT}
      role="button" tabIndex={0}
      onPointerDown={() => { downAt.current = Date.now(); }}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') ctx.openTicket(ticket.id); }}
      className="group relative rounded-xl border border-container1-border bg-container1 p-3 cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-container2-border hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted">{ticket.id}</span>
        <div className="flex items-center gap-1" {...stop}>
          {ticket.status === 'idle'
            ? <span className="inline-flex items-center gap-1 text-xs text-muted"><Icon name="moon" /> {translate({ key: 'workspaces.board.noAi' })}</span>
            : <StatusPill status={ticket.status} />}
          <PopMenu
            items={cardMenuItems(ticket, ctx, translate)}
            onOpenChange={(open) => { if (!open) menuClosedAt.current = Date.now(); }}
            triggerClass="w-7 h-7 flex items-center justify-center rounded-lg text-muted opacity-0 group-hover:opacity-100 hover:bg-container2 hover:text-common cursor-pointer transition-opacity"
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
    </motion.div>
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
        {tickets.length === 0 && <div className="text-center text-xs text-muted py-6">{translate({ key: 'workspaces.board.noTickets' })}</div>}
      </div>
    </div>
  );
}

//? Opened via menuHandler (outside the WorkspacesProvider tree, per the
//? `CreateWorkspaceForm` pattern in Shell.tsx), so it receives the stage list +
//? create callback as props instead of reading them from context.
function NewTicketForm({ stages, onCreate }: { stages: PipelineStage[]; onCreate: (input: { title: string; stageId: string }) => void }) {
  const translate = useTranslator();
  const [title, setTitle] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const stageItems: DropdownItem[] = stages.map((s) => ({ id: s.id, value: s.id, item: s.name }));
  const submit = () => {
    const t = title.trim();
    if (!t || !stageId) return;
    onCreate({ title: t, stageId });
    void menuHandler.close();
  };
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.board.newTicketTitle' })}</div>
      <input
        value={title} onChange={(e) => { setTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.board.newTicketTitlePlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">{translate({ key: 'workspaces.board.newTicketStage' })}</span>
        <Dropdown size="sm" items={stageItems} defaultValue={stageItems[0]} onChange={(it) => { setStageId(String(it.id)); }} />
      </div>
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
    void menuHandler.open(<NewTicketForm stages={ctx.stages} onCreate={ctx.quickAdd} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };
  const selectedSprintItem = sprintItems.find((i) => i.id === sprintFilter) ?? allSprintsItem;
  return (
    <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
      <div className="flex items-baseline gap-2 min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.board.title' })}</h1>
        {!isMobile && <span className="text-sm text-muted">{ctx.activeWorkspace.name}</span>}
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
        {!isMobile && (
          <IconButton icon="pause" title={translate({ key: 'workspaces.board.pauseAll' })} onClick={() => void menuHandler.confirm({ title: translate({ key: 'workspaces.board.pauseAllConfirmTitle' }), content: translate({ key: 'workspaces.board.pauseAllConfirmContent' }) })} />
        )}
        <FilterMenu isMobile={isMobile} filters={filters} onChange={onFiltersChange} />
        <WsButton icon="plus" onClick={openNewTicket}>{isMobile ? '' : translate({ key: 'workspaces.board.ticket' })}</WsButton>
      </div>
    </div>
  );
}

function BoardMobile({ columns }: { columns: Columns }) {
  const translate = useTranslator();
  const { stages } = useWorkspaces();
  const [active, setActive] = useState<string>(stages.find((s) => columns[s.id]?.length)?.id ?? stages[0]?.id ?? '');
  const stage = stages.find((s) => s.id === active)!;
  const list = columns[active] ?? [];
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

export default function Board() {
  const { isMobile, stageOverrides, tickets, stages } = useWorkspaces();
  const [sprintFilter, setSprintFilter] = useState('all');
  const [filters, setFilters] = useState<BoardFilters>(ALL_FILTERS);

  const filteredTickets = useMemo(() => tickets.filter((t) => {
    if (sprintFilter !== 'all' && t.sprintId !== sprintFilter) return false;
    if (filters.status !== 'all' && t.status !== filters.status) return false;
    if (filters.assigneeId !== 'all' && t.assigneeId !== filters.assigneeId) return false;
    return true;
  }), [tickets, sprintFilter, filters]);
  const columns = useMemo(() => buildColumns(filteredTickets, stages, stageOverrides), [filteredTickets, stages, stageOverrides]);

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
      <div className="flex-1 min-h-0 overflow-x-auto ws-no-scrollbar px-4 md:px-6 pb-6">
        <LayoutGroup>
          <div className="flex gap-3 h-full">
            {stages.map((s) => <KanbanColumn key={s.id} stage={s} tickets={columns[s.id] ?? []} />)}
            {/* trailing space so the last column isn't flush against the AI panel / viewport edge */}
            <div className="w-2 shrink-0" aria-hidden />
          </div>
        </LayoutGroup>
      </div>
    </div>
  );
}
