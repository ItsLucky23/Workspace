//? Workspaces — search / command palette (⌘K). For now: quick actions + a
//? history of recently opened tickets + a basic id/title/source filter. The
//? real semantic search over the whole board lands here later — the layout is
//? built to host it. Rendered inside the WorkspacesProvider so it can navigate.

import { useEffect, useMemo, useRef, useState } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

import { useTranslator } from '@luckystack/core/client';

import { AnimatePresence, motion } from 'motion/react';

import Icon, { type IconName } from './Icon';
import { SPRING_POP } from './motion';
import { StatusPill, WsButton } from './primitives';
import { useWorkspaces, type WsView } from '../_shell/WorkspacesContext';
import { NAV_ITEMS } from '../_shell/Shell';
import { isSectionEnabled } from '../_data/modules';
import type { Ticket } from '../_data/types';

interface QuickAction { label: string; icon: IconName; run: () => void }

//? Title-only new-ticket prompt opened from the palette (⌘K → New ticket). Rendered
//? via `menuHandler.open` OUTSIDE the provider tree, so it receives `quickAdd` as a
//? prop (mirrors the board's NewTicketForm + Shell's CreateWorkspaceForm). New tickets
//? always enter at `unrefined` (server-enforced), so a title is the only input.
function NewTicketPrompt({ onCreate }: { onCreate: (input: { title: string }) => void }) {
  const translate = useTranslator();
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { const t = title.trim(); if (!t) return; onCreate({ title: t }); void menuHandler.close(); };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.board.newTicketTitle' })}</div>
      <input
        ref={ref} value={title} onChange={(e) => { setTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.board.newTicketTitlePlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</div>;
}

function TicketRow({ t, onClick, selected = false }: { t: Ticket; onClick: () => void; selected?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-container2 cursor-pointer text-left ${selected ? 'bg-container2' : ''}`}>
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
  const tickets = useMemo(() => (query ? ctx.tickets.filter((t) => `${t.id} ${t.title}`.toLowerCase().includes(query)).slice(0, 8) : []), [query, ctx.tickets]);
  const docs = useMemo(() => (query ? ctx.docs.filter((d) => `${d.name} ${d.summary}`.toLowerCase().includes(query)).slice(0, 5) : []), [query, ctx.docs]);
  //? GAP_SCAN C7 — the Documents module was invisible to ⌘K (only tickets + Sources context-docs were
  //? indexed), so the fastest way to a document was always the sidebar. Archived docs stay out.
  const documents = useMemo(() => (query ? ctx.documents.filter((d) => d.archived !== true && `${d.title} ${d.content}`.toLowerCase().includes(query)).slice(0, 5) : []), [query, ctx.documents]);
  const recentTickets = ctx.recent.map((id) => ctx.tickets.find((t) => t.id === id)).filter((t): t is Ticket => t !== undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const go = (view: WsView) => { ctx.navigate(view); onClose(); };
  const openTicket = (id: string) => { ctx.openTicket(id); onClose(); };
  const enabledNavItems = NAV_ITEMS.filter((it) => isSectionEnabled(ctx.activeWorkspace.enabledSections, it.id));

  const actions: QuickAction[] = [
    { label: translate({ key: 'workspaces.search.newTicket' }), icon: 'plus', run: () => { onClose(); void menuHandler.open(<NewTicketPrompt onCreate={ctx.quickAdd} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); } },
    ...enabledNavItems.map((it) => ({ label: translate({ key: `workspaces.nav.${it.id}` }), icon: it.icon, run: () => { go(it.id); } })),
    { label: ctx.aiOpen ? translate({ key: 'workspaces.search.hideWorkspaceAi' }) : translate({ key: 'workspaces.search.openWorkspaceAi' }), icon: 'robot', run: () => { ctx.toggleAi(); onClose(); } },
  ];
  const results = [
    ...tickets.map((t) => ({ kind: 'ticket' as const, id: t.id })),
    ...documents.map((d) => ({ kind: 'document' as const, id: d.id })),
    ...docs.map((d) => ({ kind: 'source' as const, id: d.id })),
  ];
  const openResult = (result: (typeof results)[number] | undefined): void => {
    if (!result) return;
    switch (result.kind) {
      case 'ticket': { openTicket(result.id); break; }
      case 'document': { go(`content/documents/${result.id}`); break; }
      case 'source': { go('sources'); break; }
    }
  };
  useEffect(() => { setSelectedIndex(0); }, [query]);

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
                  onKeyDown={(e) => {
                    switch (e.key) {
                      case 'ArrowDown': { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1))); break; }
                      case 'ArrowUp': { e.preventDefault(); setSelectedIndex((i) => Math.max(0, i - 1)); break; }
                      case 'Enter': { e.preventDefault(); openResult(results[selectedIndex]); break; }
                    }
                  }}
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
                    {tickets.length === 0 && docs.length === 0 && documents.length === 0 && <div className="text-center text-sm text-muted py-8">{translate({ key: 'workspaces.search.noMatches' })}</div>}
                    {tickets.length > 0 && <Section title={translate({ key: 'workspaces.search.tickets' })} />}
                    {tickets.map((t, i) => <TicketRow key={t.id} t={t} selected={selectedIndex === i} onClick={() => { openTicket(t.id); }} />)}
                    {documents.length > 0 && <Section title={translate({ key: 'workspaces.search.documents' })} />}
                    {documents.map((d, i) => {
                      const selected = selectedIndex === tickets.length + i;
                      return (
                        <button key={d.id} type="button" onClick={() => { go(`content/documents/${d.id}`); }} className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-container2 cursor-pointer text-left ${selected ? 'bg-container2' : ''}`}>
                          <span className="w-5 text-center text-muted"><Icon name="file-lines" /></span>
                          <div className="min-w-0 flex-1"><div className="text-sm text-title truncate">{d.title}</div><div className="text-xs text-muted truncate">{d.content.split('\n').find((l) => l.trim().length > 0) ?? ''}</div></div>
                        </button>
                      );
                    })}
                    {docs.length > 0 && <Section title={translate({ key: 'workspaces.search.sources' })} />}
                    {docs.map((d, i) => {
                      const selected = selectedIndex === tickets.length + documents.length + i;
                      return (
                        <button key={d.id} type="button" onClick={() => { go('sources'); }} className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-container2 cursor-pointer text-left ${selected ? 'bg-container2' : ''}`}>
                          <span className="w-5 text-center text-muted"><Icon name="file-lines" /></span>
                          <div className="min-w-0 flex-1"><div className="text-sm text-title truncate">{d.name}</div><div className="text-xs text-muted truncate">{d.summary}</div></div>
                        </button>
                      );
                    })}
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
