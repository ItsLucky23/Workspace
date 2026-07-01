//? Workspaces — Backlog. All tickets grouped into collapsible sprint sections
//? (one big collection you can open/close per sprint). Search + quick-filter
//? segments + a per-person filter (creator OR assignee). The first linked
//? avatar is the creator, the second the assignee. Checkboxes are hidden until
//? you enter Select mode (bulk action bar). Dummy data; desktop-first.

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { AnimatePresence, motion } from 'motion/react';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { SPRING_SOFT } from '../_components/motion';
import { AvatarStack, EmptyState, LabelChip, Segmented, StatusPill, WsButton } from '../_components/primitives';
import { MEMBERS, SPRINTS, STAGES, TICKETS, ticketAssignee, ticketCreator, ticketLinkedMembers } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { Ticket } from '../_data/types';

type Quick = 'all' | 'unrefined' | 'needs-input' | 'done';
const stageName = (id: string) => STAGES.find((s) => s.id === id)?.name ?? id;
const LAST = ['2m', '14m', '1h', '2h', '3h', '5h', '1d', '2d', '3d', '4d', '6d', '1w'];

export default function Backlog() {
  const translate = useTranslator();
  const { openTicket } = useWorkspaces();
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState<Quick>('all');
  const [person, setPerson] = useState<string>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openSprints, setOpenSprints] = useState<Record<string, boolean>>(() => Object.fromEntries(SPRINTS.map((s) => [s.id, true])));

  const filtered = useMemo(() => TICKETS.filter((t) => {
    if (q && !(`${t.id} ${t.title}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (quick === 'unrefined' && t.stageId !== 'unrefined') return false;
    if (quick === 'needs-input' && t.status !== 'needs-input') return false;
    if (quick === 'done' && t.status !== 'done') return false;
    if (person !== 'all' && ticketCreator(t) !== person && ticketAssignee(t) !== person) return false;
    return true;
  }), [q, quick, person]);

  const groups = useMemo(() => SPRINTS.map((s) => ({ sprint: s, rows: filtered.filter((t) => (t.sprintId ?? 'backlog') === s.id) })), [filtered]);

  const toggleRow = (id: string) => { setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }); };

  const personItems = [
    { id: 'all', value: 'all', item: translate({ key: 'workspaces.backlog.allPeople' }) },
    ...Object.values(MEMBERS).map((m) => ({ id: m.id, value: m.id, item: m.name })),
  ];

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.backlog.title' })}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted hidden sm:inline">{translate({ key: 'workspaces.backlog.countOfTotal', params: [{ key: 'count', value: String(filtered.length) }, { key: 'total', value: String(TICKETS.length) }] })}</span>
          <WsButton variant={selectMode ? 'primary' : 'secondary'} icon="circle-check" onClick={() => { setSelectMode((m) => !m); setSelected(new Set()); }}>{selectMode ? translate({ key: 'workspaces.backlog.done' }) : translate({ key: 'workspaces.backlog.select' })}</WsButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 pb-3">
        <div className="flex items-center gap-2 rounded-xl border border-container1-border bg-container2/50 px-3 h-9 min-w-52">
          <Icon name="magnifying-glass" className="text-muted" />
          <input value={q} onChange={(e) => { setQ(e.target.value); }} placeholder={translate({ key: 'workspaces.backlog.searchPlaceholder' })} className="bg-transparent text-sm text-title flex-1 focus:outline-none" />
        </div>
        <Segmented<Quick>
          value={quick} onChange={setQuick}
          options={[{ id: 'all', label: translate({ key: 'workspaces.backlog.filterAll' }) }, { id: 'unrefined', label: translate({ key: 'workspaces.backlog.filterUnrefined' }) }, { id: 'needs-input', label: translate({ key: 'workspaces.backlog.filterNeedsInput' }) }, { id: 'done', label: translate({ key: 'workspaces.backlog.done' }) }]}
        />
        <Dropdown size="sm" value={personItems.find((p) => p.id === person)} items={personItems} onChange={(it) => { setPerson(String(it.id)); }} />
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 md:px-6 pb-24">
        {/* min-width keeps every row + the collapse toggles from compressing; the
            area scrolls horizontally instead when the pane gets narrow. */}
        <div className="flex flex-col gap-3 min-w-[44rem]">
          {filtered.length === 0 && <EmptyState icon="list-check" title={translate({ key: 'workspaces.backlog.emptyTitle' })} sub={translate({ key: 'workspaces.backlog.emptySub' })} />}
          {filtered.length > 0 && groups.map(({ sprint, rows }) => {
            const open = openSprints[sprint.id] ?? true;
            return (
              <div key={sprint.id} className="rounded-2xl border border-container1-border bg-container1 overflow-hidden">
                <button type="button" onClick={() => { setOpenSprints((p) => ({ ...p, [sprint.id]: !open })); }}
                  className="w-full flex items-center justify-between gap-3 px-4 h-12 hover:bg-container1-hover cursor-pointer transition-colors">
                  <span className="flex items-center gap-2 min-w-0">
                    <motion.span animate={{ rotate: open ? 0 : -90 }} transition={SPRING_SOFT} className="inline-flex w-4 justify-center text-muted shrink-0"><Icon name="angle-down" /></motion.span>
                    <span className="text-sm font-semibold text-title whitespace-nowrap">{sprint.name}</span>
                    {sprint.start && <span className="text-xs text-muted whitespace-nowrap">{sprint.start}–{sprint.end}</span>}
                    {sprint.active && <span className="shrink-0 rounded-md bg-correct/15 text-correct px-1.5 py-0.5 text-[11px] font-medium">{translate({ key: 'workspaces.backlog.sprintActive' })}</span>}
                  </span>
                  <span className="shrink-0 rounded-full bg-container2 px-2 text-xs text-muted">{rows.length}</span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
                      className="overflow-hidden border-t border-divider"
                    >
                      {rows.length === 0 && <div className="px-4 py-4 text-sm text-muted text-center">{translate({ key: 'workspaces.backlog.noTickets' })}</div>}
                      {rows.map((t, i) => (
                        <Row key={t.id} ticket={t} index={i} selectMode={selectMode} selected={selected.has(t.id)} onToggle={() => { toggleRow(t.id); }} onOpen={() => { openTicket(t.id); }} />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      {selectMode && selected.size > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-20 flex items-center gap-1 rounded-2xl border border-container1-border bg-container1 shadow-lg px-2 py-1.5">
          <span className="px-2 text-sm text-title">{translate({ key: 'workspaces.backlog.selectedCount', params: [{ key: 'count', value: String(selected.size) }] })}</span>
          <div className="w-px h-5 bg-divider mx-1" />
          <BarBtn icon="diagram-project" label={translate({ key: 'workspaces.backlog.move' })} />
          <BarBtn icon="circle-check" label={translate({ key: 'workspaces.backlog.status' })} />
          <BarBtn icon="users" label={translate({ key: 'workspaces.backlog.assign' })} />
          <BarBtn icon="calendar-day" label={translate({ key: 'workspaces.backlog.sprint' })} />
          <BarBtn icon="box-archive" label={translate({ key: 'workspaces.backlog.archive' })} danger onClick={() => void menuHandler.confirm({ title: translate({ key: 'workspaces.backlog.archiveConfirmTitle', params: [{ key: 'count', value: String(selected.size) }] }), content: translate({ key: 'workspaces.backlog.archiveConfirmContent' }) }).then(() => { setSelected(new Set()); })} />
          <button type="button" onClick={() => { setSelected(new Set()); }} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:bg-container2 cursor-pointer ml-1"><Icon name="xmark" /></button>
        </div>
      )}
    </div>
  );
}

function Row({ ticket, index, selectMode, selected, onToggle, onOpen }: {
  ticket: Ticket; index: number; selectMode: boolean; selected: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const translate = useTranslator();
  const linked = ticketLinkedMembers(ticket);
  return (
    <div onClick={onOpen} className={`flex items-center gap-3 px-4 py-2.5 border-b border-divider last:border-0 cursor-pointer transition-colors ${selected ? 'bg-primary/5' : 'hover:bg-container2/40'}`}>
      {selectMode && (
        <span onClick={(e) => { e.stopPropagation(); }} className="flex items-center">
          <input type="checkbox" checked={selected} onChange={onToggle} className="accent-primary cursor-pointer" />
        </span>
      )}
      <span className="font-mono text-xs text-muted w-20 shrink-0">{ticket.id}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-title truncate">{ticket.title}</div>
        {ticket.labels.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{ticket.labels.map((l) => <LabelChip key={l} name={l} />)}</div>}
      </div>
      <span className="hidden lg:block text-xs text-common w-28 shrink-0 truncate">{stageName(ticket.stageId)}</span>
      <span className="hidden md:flex w-28 shrink-0">{ticket.status === 'idle' ? <span className="text-xs text-muted">{translate({ key: 'workspaces.backlog.noAi' })}</span> : <StatusPill status={ticket.status} />}</span>
      <span className="hidden sm:flex w-16 shrink-0 justify-end" title={translate({ key: 'workspaces.backlog.creatorAssignee' })}>{linked.length > 0 ? <AvatarStack users={linked} size={20} /> : <span className="text-xs text-muted">—</span>}</span>
      <span className="text-xs text-muted w-10 shrink-0 text-right">{LAST[index % LAST.length]}</span>
    </div>
  );
}

function BarBtn({ icon, label, danger, onClick }: { icon: Parameters<typeof Icon>[0]['name']; label: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-sm cursor-pointer transition-colors ${danger ? 'text-wrong hover:bg-wrong/10' : 'text-common hover:bg-container2'}`}>
      <Icon name={icon} /> {label}
    </button>
  );
}
