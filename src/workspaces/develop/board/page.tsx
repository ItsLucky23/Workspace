//? intent: The scrum board of a Develop workspace — a kanban of tickets per pipeline
//? stage where the AI moves work forward; the user watches, creates tickets (the ONE
//? primary action, "+ Ticket" plus the inline quick-add in Unrefined), filters the
//? view through a single Filter disclosure, and steps in per card via its ⋯ menu.
//?
//? Stage transitions are AI-driven (the user does NOT drag tickets); cards are
//? click-to-open. (Cards were previously wrapped in a motion `LayoutGroup` with
//? shared `layoutId` for AI-move glides, but that shared-layout projection crashes
//? React 19's reconciler on route unmount — "removeChild is not a child" — so it
//? was removed; a future AI-move animation must use a non-layout technique.)
//? Columns are derived from the live workspace snapshot (real ticket rows per
//? stage); mobile shows the stage-pill segment bar + the active stage's list.
//? Sub-components live in sibling files: BoardHeader (header + Filter popover +
//? overflow ⋯), KanbanCard (card + its menus/pickers), OnboardingBanner.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { EmptyState } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { PipelineStage, Ticket } from '../../_data/types';

import { BoardHeader } from './BoardHeader';
import { ALL_FILTERS, type BoardFilters } from './boardFilters';
import { KanbanCard } from './KanbanCard';
import { OnboardingBanner } from './OnboardingBanner';

//? Columns are keyed by the stage's free-string id (04b §12), not a fixed enum.
type Columns = Record<string, Ticket[]>;

//? Apply the AI-driven stage overrides (from the Workspace-AI chat) on top of
//? the seed stage, so a "move DEV-#### to …" lands the card in the right column.
//? Tickets pointing at an unknown stage id are silently skipped.
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

function KanbanColumn({ stage, tickets }: { stage: PipelineStage; tickets: Ticket[] }) {
  const translate = useTranslator();
  const wipOver = stage.wipLimit != null && tickets.length > stage.wipLimit;
  return (
    //? The column is a defined surface (hairline + soft tint) with a sticky, slightly recessed
    //? header — without that frame a kanban reads as loose cards floating on the page.
    <div className={`flex flex-col w-72 shrink-0 rounded-2xl border border-container1-border/70 bg-container2/45 ${stage.aiEnabled ? '' : 'opacity-90'}`}>
      <div className={`sticky top-0 z-10 flex items-center justify-between gap-2 px-3 h-11 rounded-t-2xl border-b border-divider/70 bg-container2/60 backdrop-blur-sm ${wipOver ? 'text-warning' : ''}`}>
        <div className={`flex items-center gap-2 min-w-0`}>
          <span className={`text-xs font-bold uppercase tracking-[0.07em] text-common truncate`}>{stage.name}</span>
          <span className={`rounded-full bg-container1 px-1.5 text-xs font-semibold text-muted ring-1 ring-container1-border`}>{tickets.length}</span>
          {wipOver && <span title={translate({ key: 'workspaces.board.overWipLimit' })}><Icon name="triangle-exclamation" className={`text-warning text-xs`} /></span>}
          {stage.aiEnabled && <span title={translate({ key: 'workspaces.board.aiDrivenStage' })}><Icon name="robot" className={`text-muted text-xs`} /></span>}
        </div>
      </div>
      <div className={`flex flex-col gap-2 p-2 overflow-y-auto flex-1 min-h-0`}>
        {tickets.map((t) => <KanbanCard key={t.id} ticket={t} />)}
        {tickets.length === 0 && stage.id !== 'unrefined' && <div className={`text-center text-xs text-muted py-6`}>{translate({ key: 'workspaces.board.noTickets' })}</div>}
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
      <button type="button" onClick={() => { setAdding(true); }} className={`flex items-center gap-2 rounded-xl px-3 h-9 text-sm text-muted hover:text-common hover:bg-container2 transition-colors cursor-pointer`}>
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
      className={`h-9 px-3 rounded-xl border border-primary/50 bg-container1 text-sm text-title focus:outline-none focus:ring-2 focus:ring-primary/30`}
    />
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
    <div className={`flex-1 min-h-0 flex flex-col`}>
      <div className={`flex gap-1.5 px-4 pb-2 overflow-x-auto ws-no-scrollbar`}>
        {stages.map((s) => (
          <button key={s.id} type="button" onClick={() => { setActive(s.id); }}
            className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${s.id === active ? 'bg-primary text-title-primary' : 'bg-container2 text-muted'}`}>
            {s.name}<span className={`rounded-full px-1.5 text-xs ${s.id === active ? 'bg-white/20' : 'bg-container1'}`}>{columns[s.id]?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-2`}>
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
  const [filters, setFilters] = useState<BoardFilters>(ALL_FILTERS);

  const filteredTickets = useMemo(() => tickets.filter((t) => {
    //? Soft-archived tickets never render on the board (the snapshot ships them flagged so the
    //? backlog's Archived view can restore them). This filter was promised by the archive op's
    //? contract but never existed — surfaced the first time the assistant archived a ticket live.
    if (t.archived === true) return false;
    if (filters.sprintId !== 'all' && t.sprintId !== filters.sprintId) return false;
    if (filters.status !== 'all' && t.status !== filters.status) return false;
    if (filters.assigneeId !== 'all' && t.assigneeId !== filters.assigneeId) return false;
    return true;
  }), [tickets, filters]);
  const columns = useMemo(() => buildColumns(filteredTickets, stages, stageOverrides), [filteredTickets, stages, stageOverrides]);

  //? No pipeline stages yet — the snapshot is still loading, or this is a freshly
  //? bootstrapped workspace. This guard MUST render before BoardMobile (it would
  //? crash indexing stages[0]); it doubles as the teaching empty state that says
  //? what the board is FOR.
  if (stages.length === 0) {
    return (
      <div className={`flex flex-col h-full min-h-0`}>
        <BoardHeader isMobile={isMobile} filters={filters} onFiltersChange={setFilters} />
        <div className={`flex-1 min-h-0 flex items-center justify-center px-4`}>
          <EmptyState icon="table-columns" title={translate({ key: 'workspaces.board.emptyStagesTitle' })} sub={translate({ key: 'workspaces.board.emptyStagesTeach' })} />
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className={`flex flex-col h-full min-h-0`}>
        <BoardHeader isMobile filters={filters} onFiltersChange={setFilters} />
        {/* J1 — a fresh workspace (no tickets): the first-steps banner teaches where to start. */}
        {tickets.length === 0 && <OnboardingBanner />}
        <BoardMobile columns={columns} />
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <BoardHeader isMobile={false} filters={filters} onFiltersChange={setFilters} />
      {/* J1 — a fresh workspace (no tickets): the first-steps banner teaches where to start. */}
      {tickets.length === 0 && <OnboardingBanner />}
      {/* the horizontal scroll IS the board metaphor — confined to this column strip, never the page chrome */}
      <div className={`flex-1 min-h-0 overflow-x-auto ws-no-scrollbar px-4 md:px-6 pb-6`}>
        <div className={`flex gap-3 h-full`}>
          {stages.map((s) => <KanbanColumn key={s.id} stage={s} tickets={columns[s.id] ?? []} />)}
          {/* trailing space so the last column isn't flush against the AI panel / viewport edge */}
          <div className={`w-2 shrink-0`} aria-hidden />
        </div>
      </div>
    </div>
  );
}
