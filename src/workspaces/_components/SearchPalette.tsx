//? Workspaces — search / command palette (⌘K). For now: quick actions + a
//? history of recently opened tickets + a basic id/title/source filter. The
//? real semantic search over the whole board lands here later — the layout is
//? built to host it. Rendered inside the WorkspacesProvider so it can navigate.

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { AnimatePresence, motion } from 'motion/react';

import Icon, { type IconName } from './Icon';
import { SPRING_POP } from './motion';
import { StatusPill } from './primitives';
import { DOCS, TICKETS } from '../_data/seed';
import { useWorkspaces, type WsView } from '../_shell/WorkspacesContext';
import type { Ticket } from '../_data/types';

interface QuickAction { label: string; icon: IconName; run: () => void }

function Section({ title }: { title: string }) {
  return <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</div>;
}

function TicketRow({ t, onClick }: { t: Ticket; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-container2 cursor-pointer text-left">
      <span className="font-mono text-xs text-muted w-16 shrink-0">{t.id}</span>
      <span className="text-sm text-title truncate flex-1">{t.title}</span>
      {t.status !== 'idle' && <StatusPill status={t.status} />}
    </button>
  );
}

export default function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    globalThis.addEventListener('keydown', onKey);
    return () => { clearTimeout(focusTimer); globalThis.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const query = q.trim().toLowerCase();
  const tickets = useMemo(() => (query ? TICKETS.filter((t) => `${t.id} ${t.title}`.toLowerCase().includes(query)).slice(0, 8) : []), [query]);
  const docs = useMemo(() => (query ? DOCS.filter((d) => `${d.name} ${d.summary}`.toLowerCase().includes(query)).slice(0, 5) : []), [query]);
  const recentTickets = ctx.recent.map((id) => TICKETS.find((t) => t.id === id)).filter((t): t is Ticket => t !== undefined);

  const go = (view: WsView) => { ctx.navigate(view); onClose(); };
  const openTicket = (id: string) => { ctx.openTicket(id); onClose(); };

  const actions: QuickAction[] = [
    { label: translate({ key: 'workspaces.search.newTicket' }), icon: 'plus', run: onClose },
    { label: translate({ key: 'workspaces.search.goToBoard' }), icon: 'table-columns', run: () => { go('board'); } },
    { label: translate({ key: 'workspaces.search.backlog' }), icon: 'list-check', run: () => { go('backlog'); } },
    { label: translate({ key: 'workspaces.search.terminals' }), icon: 'terminal', run: () => { go('terminals'); } },
    { label: translate({ key: 'workspaces.search.pipeline' }), icon: 'diagram-project', run: () => { go('pipeline'); } },
    { label: translate({ key: 'workspaces.search.sources' }), icon: 'book-open', run: () => { go('sources'); } },
    { label: translate({ key: 'workspaces.search.usage' }), icon: 'chart-column', run: () => { go('usage'); } },
    { label: ctx.aiOpen ? translate({ key: 'workspaces.search.hideWorkspaceAi' }) : translate({ key: 'workspaces.search.openWorkspaceAi' }), icon: 'robot', run: () => { ctx.toggleAi(); onClose(); } },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-50 bg-overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} />
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh] pointer-events-none">
            <motion.div
              className="pointer-events-auto w-full max-w-xl rounded-2xl border border-container1-border bg-container1 shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
              initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.98 }} transition={SPRING_POP}
            >
              <div className="flex items-center gap-3 px-4 h-12 border-b border-divider">
                <Icon name="magnifying-glass" className="text-muted" />
                <input
                  ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && tickets[0]) openTicket(tickets[0].id); }}
                  placeholder={translate({ key: 'workspaces.search.placeholder' })}
                  className="flex-1 bg-transparent text-sm text-title focus:outline-none"
                />
                <kbd className="rounded-md border border-container1-border bg-container2 px-1.5 text-xs text-muted">{translate({ key: 'workspaces.search.escKey' })}</kbd>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {!query && (
                  <>
                    <Section title={translate({ key: 'workspaces.search.quickActions' })} />
                    <div className="grid grid-cols-2 gap-1 px-1 pb-2">
                      {actions.map((a) => (
                        <button key={a.label} type="button" onClick={a.run} className="flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm text-common hover:bg-container2 cursor-pointer">
                          <span className="w-5 text-center text-muted"><Icon name={a.icon} /></span> {a.label}
                        </button>
                      ))}
                    </div>
                    {recentTickets.length > 0 && (
                      <>
                        <Section title={translate({ key: 'workspaces.search.recent' })} />
                        {recentTickets.map((t) => <TicketRow key={t.id} t={t} onClick={() => { openTicket(t.id); }} />)}
                      </>
                    )}
                  </>
                )}
                {query && (
                  <>
                    {tickets.length === 0 && docs.length === 0 && <div className="text-center text-sm text-muted py-8">{translate({ key: 'workspaces.search.noMatches' })}</div>}
                    {tickets.length > 0 && <Section title={translate({ key: 'workspaces.search.tickets' })} />}
                    {tickets.map((t) => <TicketRow key={t.id} t={t} onClick={() => { openTicket(t.id); }} />)}
                    {docs.length > 0 && <Section title={translate({ key: 'workspaces.search.sources' })} />}
                    {docs.map((d) => (
                      <button key={d.id} type="button" onClick={() => { go('sources'); }} className="w-full flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-container2 cursor-pointer text-left">
                        <span className="w-5 text-center text-muted"><Icon name="file-lines" /></span>
                        <div className="min-w-0 flex-1"><div className="text-sm text-title truncate">{d.name}</div><div className="text-xs text-muted truncate">{d.summary}</div></div>
                      </button>
                    ))}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 px-4 h-9 border-t border-divider text-xs text-muted">
                <Icon name="wand-magic-sparkles" className="text-primary" /> {translate({ key: 'workspaces.search.comingSoon' })}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
