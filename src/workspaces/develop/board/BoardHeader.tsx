//? Board header — ONE primary action ("+ Ticket") kept visually dominant, ONE
//? Filter disclosure holding every view filter (status / assignee / sprint — the
//? sprint dropdown was folded in here from a separate header control, with
//? "Manage sprints" kept as its last entry), and an overflow ⋯ menu for the rare
//? pause-all-agents action (hidden entirely while the workspace is paused).
//? NewTicketForm opens via menuHandler and therefore renders OUTSIDE the
//? WorkspacesProvider tree — it receives its create callback as a prop, never
//? useWorkspaces() (lesson 0011).

import { useEffect, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { Popover } from '../../_components/motion';
import { Disclosure, InfoDot, InfoTip, PopMenu, WsButton, useClickAway } from '../../_components/primitives';
import { EmptyPicker } from '../../_components/SetupNotice';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { TicketPriority, TicketStatus } from '../../_data/types';
import { PRIORITY_LABEL_KEY, PRIORITY_ORDER } from '../../_functions/priority';
import { ALL_FILTERS, type BoardFilters } from './boardFilters';

const STATUS_FILTER_OPTIONS: TicketStatus[] = ['idle', 'needs-input', 'busy', 'done', 'paused', 'stuck'];
const STATUS_LABEL_KEY: Record<TicketStatus, string> = {
  idle: 'workspaces.common.statusIdle',
  'needs-input': 'workspaces.common.statusNeedsInput',
  busy: 'workspaces.common.statusBusy',
  done: 'workspaces.common.statusDone',
  paused: 'workspaces.common.statusPaused',
  stuck: 'workspaces.common.statusStuck',
};

//? Opened via menuHandler (outside the WorkspacesProvider tree, per the
//? `CreateWorkspaceForm` pattern in Shell.tsx), so it receives the create callback
//? as a prop instead of reading it from context.
//? Creation takes only a title — every new ticket enters at `unrefined` (the
//? Conductor enforces this). The title input auto-focuses on open; priority and
//? "start with AI" sit one tap away behind an Options disclosure so the dialog
//? reads title-first.
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
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`flex items-center gap-2`}>
        <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.board.newTicketTitle' })}</div>
        {/* Creating a ticket starts nothing — it lands in Unrefined with the AI off (conductor.ts:1674). */}
        <InfoTip
          align="start"
          label={translate({ key: 'workspaces.tips.board.newTicketStartTitle' })}
          title={translate({ key: 'workspaces.tips.board.newTicketStartTitle' })}
          body={translate({ key: 'workspaces.tips.board.newTicketStartBody' })}
        />
      </div>
      <input
        ref={inputRef}
        value={title} onChange={(e) => { setTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.board.newTicketTitlePlaceholder' })}
        className={`h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30`}
      />
      <Disclosure summary={translate({ key: 'workspaces.board.newTicketOptions' })}>
        <div className={`flex flex-col gap-3`}>
          <div className={`flex flex-col gap-1`}>
            <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.priority.label' })}</span>
            {/* No `size` prop: Dropdown then fills its container. `size="sm"` pins the trigger to a
                fixed 160px, which inside a form column reads as a half-finished control. */}
            <Dropdown
              items={priorityItems} value={priorityItems.find((i) => i.id === priority)}
              onChange={(it) => { setPriority(PRIORITY_ORDER.find((p) => p === it.id) ?? 'normal'); }}
            />
          </div>
          {/* O-D — start the AI pipeline immediately (advance to the first AI stage) instead of manual triage. */}
          <label className={`flex items-center gap-2 text-sm text-common cursor-pointer`}>
            <input type="checkbox" checked={startWithAi} onChange={(e) => { setStartWithAi(e.target.checked); }} className={`accent-primary`} />
            {translate({ key: 'workspaces.board.startWithAi' })}
          </label>
        </div>
      </Disclosure>
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}

//? The single Filter popover — status, assignee AND sprint dropdowns (one "Filter"
//? disclosure instead of two separate header controls). The active-filter ring on
//? the trigger and the "clear filters" link cover all three. Client-side view
//? state only — nothing is persisted (no control-API op).
function FilterMenu({ isMobile, filters, onChange }: { isMobile: boolean; filters: BoardFilters; onChange: (next: BoardFilters) => void }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(open, () => { setOpen(false); });

  const statusItems: DropdownItem[] = [
    { id: 'all', value: 'all', item: translate({ key: 'workspaces.board.allStatuses' }) },
    ...STATUS_FILTER_OPTIONS.map((s) => ({ id: s, value: s, item: translate({ key: STATUS_LABEL_KEY[s] }) })),
  ];
  const assigneeItems: DropdownItem[] = [
    { id: 'all', value: 'all', item: translate({ key: 'workspaces.board.allAssignees' }) },
    ...ctx.members.map((m) => ({ id: m.id, value: m.id, item: m.name })),
  ];
  const allSprintsItem: DropdownItem = { id: 'all', value: 'all', item: translate({ key: 'workspaces.board.allSprints' }) };
  const sprintItems: DropdownItem[] = ctx.sprints.map((s) => {
    let suffix = '';
    if (s.start) suffix = s.daysLeft ? ` · ${translate({ key: 'workspaces.board.daysLeft', params: [{ key: 'n', value: String(s.daysLeft) }] })}` : ` · ${s.start}–${s.end ?? ''}`;
    return { id: s.id, value: s.id, item: `${s.name}${suffix}` };
  });
  const selectedSprint = [allSprintsItem, ...sprintItems].find((i) => i.id === filters.sprintId) ?? allSprintsItem;
  const active = filters.status !== 'all' || filters.assigneeId !== 'all' || filters.sprintId !== 'all';

  return (
    <div className={`relative`} ref={ref}>
      <WsButton variant="secondary" icon="filter" ariaLabel={translate({ key: 'workspaces.board.filter' })} onClick={() => { setOpen((o) => !o); }} className={active ? `ring-2 ring-primary/40` : ``}>
        {isMobile ? '' : translate({ key: 'workspaces.board.filter' })}
      </WsButton>
      <Popover open={open} className={`absolute right-0 mt-1 z-30 w-64 rounded-xl border border-container1-border bg-container1 p-3 shadow-lg flex flex-col gap-3`}>
        <div className={`flex flex-col gap-1`}>
          <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.board.filterStatus' })}</span>
          <Dropdown
            items={statusItems} value={statusItems.find((i) => i.id === filters.status)}
            onChange={(it) => { onChange({ ...filters, status: STATUS_FILTER_OPTIONS.find((s) => s === it.id) ?? 'all' }); }}
          />
        </div>
        <div className={`flex flex-col gap-1`}>
          <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.board.filterAssignee' })}</span>
          <Dropdown
            items={assigneeItems} value={assigneeItems.find((i) => i.id === filters.assigneeId)}
            onChange={(it) => { onChange({ ...filters, assigneeId: String(it.id) }); }}
          />
        </div>
        <div className={`flex flex-col gap-1`}>
          <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.board.filterSprint' })}</span>
          {/* Nothing in bootstrap creates a sprint, so a fresh workspace opened a picker holding only
              "All sprints" + a smuggled-in "Manage sprints…" row. Say it is empty, permission-aware. */}
          {ctx.sprints.length === 0
            ? (
              <EmptyPicker
                icon="calendar-days"
                label={translate({ key: 'workspaces.tips.board.sprintsEmpty' })}
                fix={{ cap: 'manageSprints', view: 'backlog', cta: translate({ key: 'workspaces.tips.board.sprintsCta' }) }}
              />
            )
            : (
              <Dropdown
                items={[allSprintsItem, ...sprintItems, { id: 'manage', value: 'manage', item: translate({ key: 'workspaces.board.manageSprints' }) }]}
                value={selectedSprint}
                onChange={(it) => {
                  if (it.id === 'manage') { setOpen(false); ctx.navigate('backlog'); return; }
                  onChange({ ...filters, sprintId: String(it.id) });
                }}
              />
            )}
        </div>
        {active && (
          <button type="button" onClick={() => { onChange(ALL_FILTERS); }} className={`text-xs text-primary hover:underline text-left cursor-pointer`}>
            {translate({ key: 'workspaces.board.clearFilters' })}
          </button>
        )}
      </Popover>
    </div>
  );
}

export function BoardHeader({ isMobile, filters, onFiltersChange }: { isMobile: boolean; filters: BoardFilters; onFiltersChange: (next: BoardFilters) => void }) {
  const ctx = useWorkspaces();
  const translate = useTranslator();
  const openNewTicket = () => {
    void menuHandler.open(<NewTicketForm onCreate={ctx.quickAdd} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };
  return (
    <div className={`flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4`}>
      <div className={`flex items-baseline gap-2 min-w-0`}>
        <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.board.title' })}</h1>
        <InfoDot title={translate({ key: 'workspaces.board.legendTitle' })} body={translate({ key: 'workspaces.board.legendBody' })} align="left" />
        {!isMobile && <span className={`text-sm text-muted`}>{ctx.activeWorkspace.name}</span>}
        {/* #105/#19 — engine occupancy chip (only when something is running or queued). */}
        {ctx.capacity && (ctx.capacity.active > 0 || ctx.capacity.queued > 0) && (
          <span className={`inline-flex items-center gap-1 rounded-full bg-container2 px-2 py-0.5 text-xs text-muted tabular-nums`} title={translate({ key: 'workspaces.board.capacityTitle' })}>
            <Icon name="bolt" className={`text-primary`} />
            {translate({ key: 'workspaces.board.capacityChip', params: [{ key: 'active', value: String(ctx.capacity.active) }, { key: 'limit', value: String(ctx.capacity.limit) }, { key: 'queued', value: String(ctx.capacity.queued) }] })}
          </span>
        )}
        {/* The limit is a server env var and the pool is shared host-wide (capacity.ts:8/16) — the bare
            `title=` above says neither, and does not exist at all on a phone. */}
        {ctx.capacity && (ctx.capacity.active > 0 || ctx.capacity.queued > 0) && (
          <InfoTip
            align="start"
            label={translate({ key: 'workspaces.tips.board.capacitySourceTitle' })}
            title={translate({ key: 'workspaces.tips.board.capacitySourceTitle' })}
            body={translate({ key: 'workspaces.tips.board.capacitySourceBody' })}
          />
        )}
      </div>
      <div className={`flex items-center gap-2`}>
        <FilterMenu isMobile={isMobile} filters={filters} onChange={onFiltersChange} />
        {/* pause-all is a rare, destructive-ish global action → the overflow ⋯ menu,
            not a bare header icon; hidden entirely while the workspace is paused. */}
        {!ctx.workspacePaused && (
          <PopMenu
            ariaLabel={translate({ key: 'workspaces.board.moreActions' })}
            triggerClass={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-common hover:bg-container2 transition-colors cursor-pointer`}
            items={[{
              label: translate({ key: 'workspaces.board.pauseAll' }),
              icon: 'pause',
              onClick: () => {
                void menuHandler.confirm({
                  title: translate({ key: 'workspaces.board.pauseAllConfirmTitle' }),
                  content: translate({ key: 'workspaces.board.pauseAllConfirmContent' }),
                }).then((ok) => { if (ok) ctx.pauseAll(); });
              },
            }]}
          />
        )}
        {/* e2e: the header's primary "+ Ticket" action has the same accessible name ("Ticket") as the
            Unrefined column's inline quick-add button, so a role/name query alone is ambiguous — a
            `contents` wrapper (no layout effect) gives Playwright a stable, unambiguous hook. */}
        <span data-testid="ws-board-new-ticket" className="contents">
          <WsButton icon="plus" ariaLabel={translate({ key: 'workspaces.board.ticket' })} onClick={openNewTicket}>{isMobile ? '' : translate({ key: 'workspaces.board.ticket' })}</WsButton>
        </span>
      </div>
    </div>
  );
}
