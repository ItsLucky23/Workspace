//? intent: The Backlog — every ticket in the workspace in one grouped list (collapsible
//? sprint sections + a virtual no-sprint "Backlog" group). Find tickets (search, quick
//? filters, person filter behind a Filters disclosure), create them (ONE primary "New
//? ticket" action — also per sprint and from the teaching empty state), and bulk-manage
//? a selection via the bottom bar. Sprint management + select mode live behind small
//? overflow menus so the first screen stays simple. Renders live snapshot rows.

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { AnimatePresence, motion } from 'motion/react';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { Collapse, SPRING_SOFT } from '../../_components/motion';
import { AvatarStack, EmptyState, FOCUS_RING, IconButton, LabelChip, PopMenu, Segmented, StatusPill, WsButton, type PopMenuItem } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { Ticket, TicketStatus } from '../../_data/types';
import { BulkActionsBar, type BulkPicker, type PickerItem } from './BulkBar';
import { NewBacklogTicketForm, SprintEditForm, SprintForm } from './forms';

type Quick = 'all' | 'unrefined' | 'needs-input' | 'done';

//? Compact relative time ("just now" / "5m" / "3h" / "2d" / "1w") from an ISO
//? timestamp — the REAL ticket recency (`lastActivityAt`, falling back to createdAt),
//? replacing the former hardcoded mock array that showed fake times per row index.
function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return 'now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${String(mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return `${String(Math.round(days / 7))}w`;
}

export const template = 'workspaces';

export default function Backlog() {
  const translate = useTranslator();
  const { openTicket, tickets, members, sprints, stages, bulkMove, bulkStatus, bulkAssign, bulkSprint, bulkArchive, sprintCreate, editSprint, quickAdd } = useWorkspaces();
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState<Quick>('all');
  const [person, setPerson] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openSprints, setOpenSprints] = useState<Record<string, boolean>>(() => Object.fromEntries(sprints.map((s) => [s.id, true])));
  const openNewSprint = () => { void menuHandler.open(<SprintForm onCreate={sprintCreate} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };
  const openNewTicket = (initialSprintId?: string) => { void menuHandler.open(<NewBacklogTicketForm quickAdd={quickAdd} sprints={sprints} members={members} initialSprintId={initialSprintId} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };

  const filtered = useMemo(() => tickets.filter((t) => {
    //? Soft-archived tickets stay out of the backlog list (same contract as the board; the
    //? archive op promises "disappears from board and backlog, restorable later").
    if (t.archived === true) return false;
    if (q && !(`${t.id} ${t.title}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (quick === 'unrefined' && t.stageId !== 'unrefined') return false;
    if (quick === 'needs-input' && t.status !== 'needs-input') return false;
    if (quick === 'done' && t.status !== 'done') return false;
    if (person !== 'all' && t.creatorId !== person && t.assigneeId !== person) return false;
    return true;
  }), [tickets, q, quick, person]);

  //? Real sprint groups + a VIRTUAL "Backlog" group (id 'backlog') collecting tickets
  //? with no sprint — without it those tickets match no real sprint row and vanish.
  //? The virtual group's sprint has no start/end/active (guarded at the render site).
  const groups = useMemo(() => {
    const real = sprints.map((s) => ({ sprint: s, rows: filtered.filter((t) => t.sprintId === s.id) }));
    const backlogGroup = {
      sprint: { id: 'backlog', name: translate({ key: 'workspaces.backlog.title' }), start: null, end: null, active: false },
      rows: filtered.filter((t) => !t.sprintId),
    };
    return [...real, backlogGroup];
  }, [filtered, sprints, translate]);

  const toggleRow = (id: string) => { setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }); };

  const personItems = [
    { id: 'all', value: 'all', item: translate({ key: 'workspaces.backlog.allPeople' }) },
    ...members.map((m) => ({ id: m.id, value: m.id, item: m.name })),
  ];

  const quickOptions: { id: Quick; label: string }[] = [
    { id: 'all', label: translate({ key: 'workspaces.backlog.filterAll' }) },
    { id: 'unrefined', label: translate({ key: 'workspaces.backlog.filterUnrefined' }) },
    { id: 'needs-input', label: translate({ key: 'workspaces.backlog.filterNeedsInput' }) },
    { id: 'done', label: translate({ key: 'workspaces.backlog.done' }) },
  ];

  //? Bulk action bar (13) — picker items resolve against the current `selected`
  //? set, then apply the [control-API] bulk op + reset the selection.
  const selectedIds = [...selected];
  const finishBulk = () => { setSelected(new Set()); setSelectMode(false); };
  const statusOptions: { value: TicketStatus; label: string }[] = [
    { value: 'idle', label: translate({ key: 'workspaces.common.statusIdle' }) },
    { value: 'needs-input', label: translate({ key: 'workspaces.common.statusNeedsInput' }) },
    { value: 'busy', label: translate({ key: 'workspaces.common.statusBusy' }) },
    { value: 'done', label: translate({ key: 'workspaces.common.statusDone' }) },
    { value: 'paused', label: translate({ key: 'workspaces.common.statusPaused' }) },
    { value: 'stuck', label: translate({ key: 'workspaces.common.statusStuck' }) },
  ];
  const moveItems: PickerItem[] = stages.map((s) => ({ label: s.name, onClick: () => { bulkMove(selectedIds, s.id); finishBulk(); } }));
  const statusItems: PickerItem[] = statusOptions.map((s) => ({ label: s.label, onClick: () => { bulkStatus(selectedIds, s.value); finishBulk(); } }));
  const assignItems: PickerItem[] = [
    { label: translate({ key: 'workspaces.board.unassigned' }), onClick: () => { bulkAssign(selectedIds, ''); finishBulk(); } },
    ...members.map((m) => ({ label: m.name, onClick: () => { bulkAssign(selectedIds, m.id); finishBulk(); } })),
  ];
  const sprintItems: PickerItem[] = [
    { label: translate({ key: 'workspaces.backlog.title' }), onClick: () => { bulkSprint(selectedIds, ''); finishBulk(); } },
    ...sprints.filter((s) => s.id !== 'backlog').map((s) => ({ label: s.name, onClick: () => { bulkSprint(selectedIds, s.id); finishBulk(); } })),
  ];
  const pickers: BulkPicker[] = [
    { icon: 'diagram-project', label: translate({ key: 'workspaces.backlog.move' }), items: moveItems },
    { icon: 'circle-check', label: translate({ key: 'workspaces.backlog.status' }), items: statusItems },
    { icon: 'users', label: translate({ key: 'workspaces.backlog.assign' }), items: assignItems },
    { icon: 'calendar-day', label: translate({ key: 'workspaces.backlog.sprint' }), items: sprintItems },
  ];
  //? Archive is destructive — the menuHandler.confirm gate stays in front of the op
  //? on BOTH the inline (sm+) button and the phone "Actions" popover.
  const archiveSelected = () => {
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.backlog.archiveConfirmTitle', params: [{ key: 'count', value: String(selected.size) }] }),
      content: translate({ key: 'workspaces.backlog.archiveConfirmContent' }),
    }).then((ok) => { if (ok) { bulkArchive(selectedIds); finishBulk(); } });
  };

  //? Secondary/rare actions live behind the header overflow menu — the header keeps
  //? ONE dominant primary action ("New ticket"). Select mode is entered here; leaving
  //? it uses the visible "Done" button that appears while it is on.
  const overflowItems: PopMenuItem[] = [
    { label: translate({ key: 'workspaces.backlog.newSprint' }), icon: 'calendar-day', onClick: openNewSprint },
    ...(selectMode ? [] : [{ label: translate({ key: 'workspaces.backlog.selectTickets' }), icon: 'circle-check', onClick: () => { setSelectMode(true); setSelected(new Set()); } }]),
  ];

  //? The quick segment counts as an active filter too: at phone width it lives INSIDE
  //? the panel, so the trigger must light up even when the panel is closed.
  const filtersActive = person !== 'all' || quick !== 'all';

  return (
    <div className={`relative flex flex-col h-full min-h-0`}>
      <div className={`flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4`}>
        <div className={`min-w-0`}>
          <div className={`flex items-baseline gap-2 min-w-0`}>
            <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.backlog.title' })}</h1>
            <span className={`text-sm text-muted whitespace-nowrap`}>{translate({ key: 'workspaces.backlog.countOfTotal', params: [{ key: 'count', value: String(filtered.length) }, { key: 'total', value: String(tickets.length) }] })}</span>
          </div>
          <p className={`hidden md:block text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.backlog.subtitle' })}</p>
        </div>
        <div className={`flex items-center gap-2 shrink-0`}>
          {selectMode && <WsButton variant="secondary" icon="check" onClick={() => { setSelectMode(false); setSelected(new Set()); }}>{translate({ key: 'workspaces.backlog.done' })}</WsButton>}
          <WsButton icon="plus" onClick={() => { openNewTicket(); }}>{translate({ key: 'workspaces.backlog.newTicket' })}</WsButton>
          <PopMenu
            ariaLabel={translate({ key: 'workspaces.backlog.moreActions' })}
            items={overflowItems}
            triggerClass={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-common hover:bg-container2 transition-colors cursor-pointer`}
          />
        </div>
      </div>

      {/* Search stays visible everywhere; the person filter (and, at phone width, the
          quick-filter segments) sit behind the Filters disclosure to keep row one calm. */}
      <div className={`flex flex-col gap-2 px-4 md:px-6 pb-3`}>
        <div className={`flex items-center gap-2`}>
          <div className={`flex items-center gap-2 rounded-xl border border-container1-border bg-container2/50 px-3 h-9 flex-1 sm:flex-initial sm:w-64`}>
            <Icon name="magnifying-glass" className={`text-muted`} />
            <input value={q} onChange={(e) => { setQ(e.target.value); }} placeholder={translate({ key: 'workspaces.backlog.searchPlaceholder' })} className={`bg-transparent text-sm text-title flex-1 min-w-0 focus:outline-none`} />
          </div>
          <div className={`hidden sm:block`}>
            <Segmented<Quick> value={quick} onChange={setQuick} options={quickOptions} />
          </div>
          <IconButton icon="filter" title={translate({ key: 'workspaces.backlog.filters' })} active={filtersOpen || filtersActive} onClick={() => { setFiltersOpen((o) => !o); }} />
        </div>
        <Collapse open={filtersOpen}>
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-container1-border bg-container1 px-3 py-2.5`}>
            <div className={`sm:hidden`}>
              <Segmented<Quick> value={quick} onChange={setQuick} options={quickOptions} />
            </div>
            <div className={`flex items-center gap-2`}>
              <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.backlog.personFilterLabel' })}</span>
              <Dropdown size="sm" value={personItems.find((p) => p.id === person)} items={personItems} onChange={(it) => { setPerson(String(it.id)); }} />
            </div>
          </div>
        </Collapse>
      </div>

      <div className={`flex-1 min-h-0 overflow-auto px-4 md:px-6 pb-24`}>
        <div className={`flex flex-col gap-3`}>
          {/* Teaching empty state: the workspace has NO tickets at all — say what this
              place is for and hand over the primary action right there. */}
          {tickets.length === 0 && (
            <EmptyState
              icon="list-check"
              title={translate({ key: 'workspaces.backlog.emptyTeachTitle' })}
              sub={translate({ key: 'workspaces.backlog.emptyTeachSub' })}
              action={<WsButton icon="plus" onClick={() => { openNewTicket(); }}>{translate({ key: 'workspaces.backlog.newTicket' })}</WsButton>}
            />
          )}
          {tickets.length > 0 && filtered.length === 0 && (
            <EmptyState
              icon="magnifying-glass"
              title={translate({ key: 'workspaces.backlog.emptyTitle' })}
              sub={translate({ key: 'workspaces.backlog.emptySub' })}
              action={<WsButton variant="secondary" icon="xmark" onClick={() => { setQ(''); setQuick('all'); setPerson('all'); }}>{translate({ key: 'workspaces.board.clearFilters' })}</WsButton>}
            />
          )}
          {filtered.length > 0 && groups.map(({ sprint, rows }) => {
            const open = openSprints[sprint.id] ?? true;
            return (
              <div key={sprint.id} className={`rounded-2xl border border-container1-border bg-container1`}>
                <div className={`w-full flex items-center rounded-t-2xl hover:bg-container1-hover transition-colors ${open ? '' : 'rounded-b-2xl'}`}>
                  <button type="button" onClick={() => { setOpenSprints((p) => ({ ...p, [sprint.id]: !open })); }}
                    className={`flex-1 min-w-0 flex items-center justify-between gap-3 px-4 h-12 cursor-pointer ${FOCUS_RING}`}>
                    <span className={`flex items-center gap-2 min-w-0`}>
                      <motion.span animate={{ rotate: open ? 0 : -90 }} transition={SPRING_SOFT} className={`inline-flex w-4 justify-center text-muted shrink-0`}><Icon name="angle-down" /></motion.span>
                      <span className={`text-sm font-semibold text-title whitespace-nowrap`}>{sprint.name}</span>
                      {sprint.start && <span className={`hidden sm:inline text-xs text-muted whitespace-nowrap`}>{sprint.start}–{sprint.end}</span>}
                      {sprint.active && <span className={`shrink-0 rounded-md bg-correct/15 text-correct px-1.5 py-0.5 text-[11px] font-medium`}>{translate({ key: 'workspaces.backlog.sprintActive' })}</span>}
                    </span>
                    <span className={`shrink-0 rounded-full bg-container2 px-2 text-xs text-muted`}>{rows.length}</span>
                  </button>
                  {/* #1 — edit a sprint (activate / rename / dates): relocated from an always-visible
                      pen icon into a small per-sprint overflow menu. Not on the synthetic Backlog group. */}
                  {sprint.id !== 'backlog' && (
                    <div className={`pr-2 shrink-0 flex items-center`}>
                      <PopMenu
                        ariaLabel={translate({ key: 'workspaces.backlog.sprintOptions' })}
                        items={[{ label: translate({ key: 'workspaces.backlog.editSprint' }), icon: 'gear', onClick: () => { void menuHandler.open(<SprintEditForm sprint={sprint} onSave={editSprint} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); } }]}
                      />
                    </div>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key={`body-${sprint.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
                      className={`overflow-hidden rounded-b-2xl border-t border-divider`}
                    >
                      {rows.length === 0 && <div className={`px-4 py-4 text-sm text-muted text-center`}>{translate({ key: 'workspaces.backlog.noTickets' })}</div>}
                      {rows.map((t) => (
                        <Row key={t.id} ticket={t} selectMode={selectMode} selected={selected.has(t.id)} onToggle={() => { toggleRow(t.id); }} onOpen={() => { openTicket(t.id); }} />
                      ))}
                      <button type="button" onClick={() => { openNewTicket(sprint.id === 'backlog' ? undefined : sprint.id); }}
                        className={`w-full flex items-center gap-2 px-4 py-2.5 border-t border-divider text-sm text-muted hover:bg-container2/40 cursor-pointer transition-colors ${FOCUS_RING}`}>
                        <Icon name="plus" /> {translate({ key: 'workspaces.backlog.addTicket' })}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          {/* "New sprint" also lives here as a discoverable row at the end of the group
              list (same op as the overflow-menu entry). */}
          {filtered.length > 0 && (
            <button type="button" onClick={openNewSprint}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-container1-border px-4 py-3 text-sm text-muted hover:text-title hover:bg-container1 cursor-pointer transition-colors ${FOCUS_RING}`}>
              <Icon name="plus" /> {translate({ key: 'workspaces.backlog.newSprint' })}
            </button>
          )}
        </div>
      </div>

      {selectMode && selected.size > 0 && (
        <BulkActionsBar count={selected.size} pickers={pickers} onArchive={archiveSelected} onClear={() => { setSelected(new Set()); }} />
      )}
    </div>
  );
}

//? One ticket row. Desktop keeps the progressive columns (stage at lg+, status at md+,
//? avatars + time at sm+); below sm the row STACKS — title + label chips on top, then a
//? wrapping meta line (id · status · avatars · time) — instead of forcing horizontal
//? scroll (the old min-w-[44rem] wrapper is gone). Row click opens the ticket; the
//? select-mode checkbox stops propagation so toggling never fires openTicket.
function Row({ ticket, selectMode, selected, onToggle, onOpen }: {
  ticket: Ticket; selectMode: boolean; selected: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const translate = useTranslator();
  const { stages, ticketMembers } = useWorkspaces();
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? id;
  const linked = ticketMembers(ticket);
  //? status 'idle' renders as "No AI" text, not a StatusPill.
  const statusCell = ticket.status === 'idle'
    ? <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.backlog.noAi' })}</span>
    : <StatusPill status={ticket.status} />;
  return (
    // e2e: the row is a bare onClick div (no role/label) nested inside ancestor rows that also carry a
    // font-mono id span, so a structural has() locator like the board's card query would over-match —
    // a data-testid gives specs an unambiguous per-row hook.
    <div data-testid="ws-backlog-row" onClick={onOpen} className={`flex items-start sm:items-center gap-3 px-4 py-2.5 border-b border-divider last:border-0 cursor-pointer transition-colors ${selected ? 'bg-primary/5' : 'hover:bg-container2/40'}`}>
      {selectMode && (
        <span onClick={(e) => { e.stopPropagation(); }} className={`flex items-center pt-1 sm:pt-0`}>
          <input type="checkbox" checked={selected} onChange={onToggle} className={`accent-primary cursor-pointer`} />
        </span>
      )}
      <span className={`hidden sm:block font-mono text-xs text-muted w-20 shrink-0`}>{ticket.id}</span>
      <div className={`flex-1 min-w-0`}>
        <div className={`text-sm text-title truncate`}>{ticket.title}</div>
        {ticket.labels.length > 0 && <div className={`flex flex-wrap gap-1 mt-1`}>{ticket.labels.map((l) => <LabelChip key={l} name={l} />)}</div>}
        <div className={`flex sm:hidden flex-wrap items-center gap-x-3 gap-y-1 mt-1.5`}>
          <span className={`font-mono text-xs text-muted`}>{ticket.id}</span>
          {statusCell}
          {linked.length > 0 && <AvatarStack users={linked} size={18} />}
          <span className={`text-xs text-muted`}>{relativeTime(ticket.lastActivityAt)}</span>
        </div>
      </div>
      <span className={`hidden lg:block text-xs text-common w-28 shrink-0 truncate`}>{stageName(ticket.stageId)}</span>
      <span className={`hidden md:flex w-28 shrink-0`}>{statusCell}</span>
      {/* AvatarStack semantics: first avatar = creator, second = assignee (ticketMembers). */}
      <span className={`hidden sm:flex w-16 shrink-0 justify-end`} title={translate({ key: 'workspaces.backlog.creatorAssignee' })}>{linked.length > 0 ? <AvatarStack users={linked} size={20} /> : <span className={`text-xs text-muted`}>—</span>}</span>
      <span className={`hidden sm:block text-xs text-muted w-10 shrink-0 text-right`}>{relativeTime(ticket.lastActivityAt)}</span>
    </div>
  );
}
