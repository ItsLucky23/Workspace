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

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { SPRING_SOFT } from '../_components/motion';
import { AvatarStack, EmptyState, IconButton, LabelChip, PopMenu, StatusPill, WsButton, type PopMenuItem } from '../_components/primitives';
import { SPRINTS, STAGES, TICKETS, ticketLinkedMembers } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { PipelineStage, StageId, Ticket } from '../_data/types';

type Columns = Record<StageId, Ticket[]>;

//? Apply the AI-driven stage overrides (from the Workspace-AI chat) on top of
//? the seed stage, so a "move DEV-#### to …" lands the card in a new column and
//? the shared layoutId animates it there.
function buildColumns(tickets: Ticket[], overrides: Record<string, StageId>): Columns {
  const cols = Object.fromEntries(STAGES.map((s) => [s.id, [] as Ticket[]])) as Columns;
  for (const t of tickets) {
    const stage = overrides[t.id] ?? t.stageId;
    cols[stage].push(t);
  }
  return cols;
}

function cardMenuItems(ticket: Ticket, ctx: ReturnType<typeof useWorkspaces>): PopMenuItem[] {
  const paused = ticket.status === 'paused';
  return [
    { label: 'Open ticket', icon: 'up-right-from-square', onClick: () => ctx.openTicket(ticket.id) },
    { label: 'Open terminal', icon: 'terminal', onClick: () => ctx.pushTo('terminals') },
    { label: 'Add reference…', icon: 'link', onClick: () => {} },
    { divider: true },
    { label: paused ? 'Resume agent' : 'Pause agent', icon: paused ? 'play' : 'pause', onClick: () => {} },
    { label: 'Copy DEV-ID', icon: 'copy', onClick: () => void navigator.clipboard.writeText(ticket.id) },
    { divider: true },
    {
      label: 'Archive', icon: 'box-archive', danger: true,
      onClick: () => void menuHandler.confirm({ title: `Archive ${ticket.id}?`, content: 'It will move out of the active board.' }),
    },
  ];
}

function KanbanCard({ ticket }: { ticket: Ticket }) {
  const ctx = useWorkspaces();
  const linked = ticketLinkedMembers(ticket);
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation() };
  const downAt = useRef(0);
  const menuClosedAt = useRef(0);
  //? Open the ticket only on a deliberate, quick click: not after a text
  //? selection (slow press / non-empty selection), and not when the click is
  //? really just dismissing this card's open ⋯ menu.
  const handleClick = () => {
    if (Date.now() - menuClosedAt.current < 250) return;
    if (Date.now() - downAt.current > 350) return;
    if ((window.getSelection()?.toString() ?? '') !== '') return;
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
            ? <span className="inline-flex items-center gap-1 text-xs text-muted"><Icon name="moon" /> no AI</span>
            : <StatusPill status={ticket.status} />}
          <PopMenu
            items={cardMenuItems(ticket, ctx)}
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
        {linked.length > 0 ? <AvatarStack users={linked} size={20} /> : <span className="text-xs text-muted">Unassigned</span>}
        <div className="flex items-center gap-2">
          {ticket.costLabel && <span className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-mono text-muted">{ticket.costLabel}</span>}
          {ticket.hasTerminal && (
            <span className="inline-flex items-center gap-1 text-[11px] text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse" /> terminal
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function KanbanColumn({ stage, tickets }: { stage: PipelineStage; tickets: Ticket[] }) {
  const wipOver = stage.wipLimit != null && tickets.length > stage.wipLimit;
  return (
    <div className={`flex flex-col w-72 shrink-0 rounded-2xl bg-container2/40 ${stage.aiEnabled ? '' : 'opacity-90'}`}>
      <div className={`flex items-center justify-between gap-2 px-3 h-11 ${wipOver ? 'text-warning' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-title truncate">{stage.name}</span>
          <span className="rounded-full bg-container2 px-1.5 text-xs text-muted">{tickets.length}</span>
          {wipOver && <span title="Over WIP limit"><Icon name="triangle-exclamation" className="text-warning text-xs" /></span>}
          {stage.aiEnabled && <span title="AI-driven stage"><Icon name="robot" className="text-muted text-xs" /></span>}
        </div>
      </div>
      <div className="flex flex-col gap-2 px-2 pb-2 overflow-y-auto flex-1 min-h-0">
        {tickets.map((t) => <KanbanCard key={t.id} ticket={t} />)}
        {tickets.length === 0 && <div className="text-center text-xs text-muted py-6">No tickets</div>}
      </div>
    </div>
  );
}

function BoardHeader({ isMobile }: { isMobile: boolean }) {
  const ctx = useWorkspaces();
  const sprintItems = SPRINTS.map((s) => {
    let suffix = '';
    if (s.start) suffix = s.daysLeft ? ` · ${String(s.daysLeft)}d left` : ` · ${s.start}–${s.end ?? ''}`;
    return { id: s.id, value: s.id, item: `${s.name}${suffix}` };
  });
  return (
    <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
      <div className="flex items-baseline gap-2 min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold text-title">Board</h1>
        {!isMobile && <span className="text-sm text-muted">{ctx.activeWorkspace.name}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Dropdown
          size="sm"
          defaultValue={sprintItems[0]}
          items={[...sprintItems, { id: 'manage', value: 'manage', item: '⚙ Manage sprints…' }]}
          onChange={(it) => { if (it.id === 'manage') ctx.navigate('backlog'); }}
        />
        {!isMobile && (
          <IconButton icon="pause" title="Pause all agents" onClick={() => void menuHandler.confirm({ title: 'Pause all agents?', content: 'Every running agent in this workspace will pause. You can resume any time.' })} />
        )}
        <WsButton variant="secondary" icon="filter">{isMobile ? '' : 'Filter'}</WsButton>
        <WsButton icon="plus">{isMobile ? '' : 'Ticket'}</WsButton>
      </div>
    </div>
  );
}

function BoardMobile({ columns }: { columns: Columns }) {
  const [active, setActive] = useState<StageId>(STAGES.find((s) => columns[s.id].length)?.id ?? STAGES[0]!.id);
  const stage = STAGES.find((s) => s.id === active)!;
  const list = columns[active];
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto ws-no-scrollbar">
        {STAGES.map((s) => (
          <button key={s.id} type="button" onClick={() => setActive(s.id)}
            className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${s.id === active ? 'bg-primary text-title-primary' : 'bg-container2 text-muted'}`}>
            {s.name}<span className={`rounded-full px-1.5 text-xs ${s.id === active ? 'bg-white/20' : 'bg-container1'}`}>{columns[s.id].length}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
        {list.map((t) => <KanbanCard key={t.id} ticket={t} />)}
        {list.length === 0 && <EmptyState icon="table-columns" title={`Nothing in ${stage.name}`} sub="Pull tickets from GitLab to get started." />}
      </div>
    </div>
  );
}

export default function Board() {
  const { isMobile, stageOverrides } = useWorkspaces();
  const columns = useMemo(() => buildColumns(TICKETS, stageOverrides), [stageOverrides]);

  if (isMobile) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <BoardHeader isMobile />
        <BoardMobile columns={columns} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <BoardHeader isMobile={false} />
      <div className="flex-1 min-h-0 overflow-x-auto ws-no-scrollbar px-4 md:px-6 pb-6">
        <LayoutGroup>
          <div className="flex gap-3 h-full">
            {STAGES.map((s) => <KanbanColumn key={s.id} stage={s} tickets={columns[s.id]} />)}
            {/* trailing space so the last column isn't flush against the AI panel / viewport edge */}
            <div className="w-2 shrink-0" aria-hidden />
          </div>
        </LayoutGroup>
      </div>
    </div>
  );
}
