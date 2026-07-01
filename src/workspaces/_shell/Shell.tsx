//? Workspaces — app shell chrome: nav rail, top bar, tab/session bar, AI panel,
//? mobile bottom bar. Mirrors the prototype's Shell.jsx, rebuilt on our real
//? stack (Tailwind tokens, reused Avatar/Dropdown, ctx-driven navigation).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

import { motion } from 'motion/react';

import Icon, { type IconName } from '../_components/Icon';
import { Popover, SPRING_SOFT } from '../_components/motion';
import { AvatarBubble, AvatarStack, IconButton, WsButton, useClickAway } from '../_components/primitives';
import { MEMBERS, NOTIFICATIONS, TICKETS } from '../_data/seed';
import { isTicketView, useWorkspaces, type WsView } from './WorkspacesContext';
import type { AiSuggestion, ChatMessage } from '../_data/types';

// Status lookup so the tab bar can colour its dots without re-deriving ticket logic.
const TICKET_STATUS_LOOKUP: Record<string, string> = Object.fromEntries(TICKETS.map((t) => [t.id, t.status]));

//? No-bounce spring for the AI-panel width animation — bounce would overshoot
//? the panel width and wobble the board edge.
const PANEL_TRANSITION = { type: 'spring', duration: 0.42, bounce: 0 } as const;

interface NavDef { id: WsView; icon: IconName; label: string }
export const NAV_ITEMS: NavDef[] = [
  { id: 'board', icon: 'table-columns', label: 'Board' },
  { id: 'backlog', icon: 'list-check', label: 'Backlog' },
  { id: 'terminals', icon: 'terminal', label: 'Terminals' },
  { id: 'activity', icon: 'wave-square', label: 'Activity' },
  { id: 'sources', icon: 'book-open', label: 'Sources' },
  { id: 'pipeline', icon: 'diagram-project', label: 'Pipeline' },
  { id: 'usage', icon: 'chart-column', label: 'Usage' },
];
export const NAV_BOTTOM: NavDef[] = [
  { id: 'ai', icon: 'robot', label: 'Workspace-AI' },
  { id: 'settings', icon: 'gear', label: 'Settings' },
];

const roleChip = (role: string) => (
  <span className="rounded-full bg-container2 px-2 py-0.5 text-[11px] font-medium capitalize text-muted">{role}</span>
);

/* ----------------------------------------------------------------- nav rail */
export function NavRail({ expanded, setExpanded }: { expanded: boolean; setExpanded: (fn: (e: boolean) => boolean) => void }) {
  const { view, navigate, suggestions, currentUser, aiOpen, toggleAi } = useWorkspaces();

  const renderItem = (it: NavDef) => {
    const isAi = it.id === 'ai';
    const badge = isAi ? suggestions.length : 0;
    const active = isAi ? aiOpen : view === it.id;
    return (
      <button
        key={it.id} type="button" onClick={() => { isAi ? toggleAi() : navigate(it.id); }}
        title={expanded ? undefined : it.label}
        className={`group relative flex items-center gap-3 rounded-xl h-10 px-3 transition-colors cursor-pointer ${active ? 'bg-container2 text-title' : 'text-muted hover:bg-container2 hover:text-common'}`}
      >
        <span className="relative w-5 text-center text-base">
          <Icon name={it.icon} />
          {badge > 0 && <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-primary text-title-primary text-[10px] font-semibold flex items-center justify-center">{badge}</span>}
        </span>
        {expanded && <span className="text-sm font-medium whitespace-nowrap">{it.label}</span>}
      </button>
    );
  };

  return (
    <nav className={`hidden md:flex flex-col shrink-0 border-r border-divider bg-container1 transition-all duration-200 ${expanded ? 'w-60' : 'w-[68px]'}`}>
      <div className="flex items-center justify-between gap-2 px-3 h-14">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="w-8 h-8 rounded-lg bg-primary text-title-primary flex items-center justify-center font-bold shrink-0">W</span>
          {expanded && <span className="font-semibold text-title whitespace-nowrap">Workspaces</span>}
        </div>
        <button type="button" onClick={() => { setExpanded((e) => !e); }} title={expanded ? 'Collapse' : 'Expand'} className="text-muted hover:text-common cursor-pointer w-6 h-6 flex items-center justify-center">
          <Icon name={expanded ? 'angle-left' : 'angle-right'} />
        </button>
      </div>
      <div className="flex-1 flex flex-col gap-1 px-2.5 py-2">{NAV_ITEMS.map((it) => renderItem(it))}</div>
      <div className="flex flex-col gap-1 px-2.5 py-3 border-t border-divider">
        {NAV_BOTTOM.map((it) => renderItem(it))}
        <button type="button" onClick={() => { navigate('settings'); }} title={expanded ? undefined : `${currentUser.name} · settings`}
          className="flex items-center gap-3 rounded-xl h-10 px-2.5 text-muted hover:bg-container2 transition-colors cursor-pointer">
          <AvatarBubble user={currentUser} size={24} />
          {expanded && <span className="text-sm font-medium text-common whitespace-nowrap">{currentUser.name}</span>}
        </button>
      </div>
    </nav>
  );
}

/* ----------------------------------------------------------------- top bar */
export function TopBar({ onCmdK, onNotifications }: { onCmdK: () => void; onNotifications: () => void }) {
  const { navigate, theme, setTheme, currentUser, workspaces, activeWorkspace, setActiveWorkspace, createWorkspace } = useWorkspaces();
  const [wsOpen, setWsOpen] = useState(false);
  const [avOpen, setAvOpen] = useState(false);
  const wsRef = useClickAway<HTMLDivElement>(wsOpen, () => { setWsOpen(false); });
  const avRef = useClickAway<HTMLDivElement>(avOpen, () => { setAvOpen(false); });
  const presence = [MEMBERS.sanne, MEMBERS.tom, MEMBERS.mathijs];
  const unread = NOTIFICATIONS.filter((n) => !n.read).length;
  const openCreate = () => { setWsOpen(false); void menuHandler.open(<CreateWorkspaceForm onCreate={createWorkspace} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };

  return (
    <header className="hidden md:flex items-center gap-3 h-14 px-4 border-b border-divider bg-container1">
      {/* workspace switcher — one project = one workspace */}
      <div className="flex items-center gap-1.5">
        <div className="relative" ref={wsRef}>
          <button type="button" onClick={() => { setWsOpen((o) => !o); }} className="flex items-center gap-2 rounded-xl px-2 h-9 hover:bg-container2 transition-colors cursor-pointer">
            <span className="w-6 h-6 rounded-md bg-primary text-title-primary text-xs font-bold flex items-center justify-center">{activeWorkspace.name[0]}</span>
            <span className="text-sm font-semibold text-title">{activeWorkspace.name}</span>
            <Icon name="caret-down" className={`text-xs text-muted transition-transform ${wsOpen ? 'rotate-180' : ''}`} />
          </button>
          <Popover open={wsOpen} className="absolute left-0 mt-1 w-64 rounded-xl border border-container1-border bg-container1 p-1 shadow-lg z-30">
            <div className="px-2.5 py-1.5 text-xs font-medium text-muted">Workspaces</div>
            {workspaces.map((w) => (
                <button key={w.id} type="button" onClick={() => { setActiveWorkspace(w.id); setWsOpen(false); }} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer ${w.id === activeWorkspace.id ? 'bg-container2' : 'hover:bg-container2'}`}>
                  <span className="flex items-center gap-2 text-sm text-title">
                    <span className="w-5 h-5 rounded-md bg-container2 text-[11px] font-bold flex items-center justify-center">{w.name[0]}</span>
                    {w.name}
                  </span>
                  {w.id === activeWorkspace.id ? <Icon name="check" className="text-xs text-primary" /> : roleChip(w.role)}
                </button>
              ))}
              <div className="my-1 h-px bg-divider" />
              <button type="button" onClick={openCreate} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="plus" className="w-4 text-center" /> Create workspace</button>
              <button type="button" onClick={() => { setWsOpen(false); navigate('workspace'); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="users" className="w-4 text-center" /> Manage members</button>
          </Popover>
        </div>
      </div>

      {/* search */}
      <button type="button" onClick={onCmdK} className="flex items-center gap-2 rounded-xl border border-container1-border bg-container2/50 px-3 h-9 text-sm text-muted hover:bg-container2 transition-colors cursor-pointer min-w-44">
        <Icon name="magnifying-glass" /> <span className="flex-1 text-left">Search</span>
        <kbd className="rounded-md border border-container1-border bg-container1 px-1.5 text-xs font-sans">⌘K</kbd>
      </button>

      <div className="flex-1" />

      {/* right */}
      <div className="flex items-center gap-1.5">
        <div title="Sanne, Tom viewing" className="mr-1"><AvatarStack users={presence} size={26} max={3} /></div>
        <button type="button" onClick={onNotifications} title="Notifications" className="relative inline-flex items-center justify-center w-9 h-9 rounded-xl text-common hover:bg-container2 transition-colors cursor-pointer">
          <Icon name="bell" />
          {unread > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-wrong text-white text-[10px] font-semibold flex items-center justify-center">{unread}</span>}
        </button>
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} title="Toggle theme" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); }} />
        <div className="relative" ref={avRef}>
          <button type="button" onClick={() => { setAvOpen((o) => !o); }} className="rounded-full cursor-pointer"><AvatarBubble user={currentUser} size={32} /></button>
          <Popover open={avOpen} className="absolute right-0 mt-1 w-56 rounded-xl border border-container1-border bg-container1 p-1 shadow-lg z-30">
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <AvatarBubble user={currentUser} size={36} />
              <div><div className="text-sm font-semibold text-title">{currentUser.name}</div><div className="text-xs text-muted">{currentUser.email}</div></div>
            </div>
            <div className="my-1 h-px bg-divider" />
            <button type="button" onClick={() => { setAvOpen(false); navigate('settings'); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="user" className="w-4 text-center" /> Account</button>
            <button type="button" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name={theme === 'dark' ? 'sun' : 'moon'} className="w-4 text-center" /> Theme: {theme}</button>
            <button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="language" className="w-4 text-center" /> Language: English</button>
            <div className="my-1 h-px bg-divider" />
            <button type="button" onClick={() => { setAvOpen(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-wrong hover:bg-wrong/10 cursor-pointer"><Icon name="right-from-bracket" className="w-4 text-center" /> Sign out</button>
          </Popover>
        </div>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- tab bar */
export function TabBar({ onAiToggle }: { onAiToggle: () => void }) {
  const { view, navigate, openTabs, closeTab, suggestions } = useWorkspaces();
  const statusColor = (id: string) => {
    const t = TICKET_STATUS_LOOKUP[id];
    return t ? `var(--color-${t === 'busy' ? 'primary' : t === 'done' ? 'correct' : t === 'needs-input' || t === 'stuck' ? 'warning' : 'muted'})` : 'var(--color-muted)';
  };

  return (
    <div className="hidden md:flex items-center gap-2 h-11 px-3 border-b border-divider bg-background">
      <div className="flex-1 flex items-center gap-1 overflow-x-auto ws-no-scrollbar">
        <button type="button" onClick={() => { navigate('board'); }} className={`relative flex items-center gap-2 rounded-lg px-3 h-8 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${view === 'board' ? 'text-title' : 'text-muted hover:text-common'}`}>
          {view === 'board' && <motion.span layoutId="wsActiveTab" className="absolute inset-0 rounded-lg bg-container1 shadow-sm" transition={SPRING_SOFT} />}
          <span className="relative z-10 inline-flex items-center gap-2"><Icon name="table-columns" /> Board</span>
        </button>
        {openTabs.map((id) => (
          <div key={id} onClick={() => { navigate(id); }} className={`group relative flex items-center gap-2 rounded-lg pl-3 pr-2 h-8 text-sm whitespace-nowrap cursor-pointer transition-colors ${view === id ? 'text-title' : 'text-muted hover:text-common'}`}>
            {view === id && <motion.span layoutId="wsActiveTab" className="absolute inset-0 rounded-lg bg-container1 shadow-sm" transition={SPRING_SOFT} />}
            <span className="relative z-10 w-1.5 h-1.5 rounded-full" style={{ background: statusColor(id) }} />
            <span className="relative z-10">{id}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); closeTab(id); }} className="relative z-10 w-4 h-4 flex items-center justify-center rounded text-muted hover:text-title hover:bg-container2 opacity-60 group-hover:opacity-100"><Icon name="xmark" className="text-xs" /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={onAiToggle} className="flex items-center gap-2 rounded-lg px-3 h-8 text-sm font-medium text-common hover:bg-container2 transition-colors cursor-pointer">
        <Icon name="robot" className="text-primary" /> Workspace-AI
        {suggestions.length > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-title-primary text-xs font-semibold flex items-center justify-center">{suggestions.length}</span>}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- create workspace */
//? Opened via menuHandler (outside the WorkspacesProvider tree), so it can't use
//? the context — it receives the create callback as a prop. Kept intentionally
//? simple: one project = one workspace, add the team afterwards.
function CreateWorkspaceForm({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = () => { const n = name.trim(); if (!n) return; onCreate(n); void menuHandler.close(); };
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="text-base font-semibold text-title">Create workspace</div>
      <span className="text-sm text-muted -mt-2">One project, one workspace — invite your team once it exists.</span>
      <input
        value={name} onChange={(e) => { setName(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Workspace name…"
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>Cancel</WsButton>
        <WsButton icon="plus" onClick={submit}>Create</WsButton>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- AI panel */
function PanelTab({ label, icon, on, count, onClick }: { label: string; icon: IconName; on: boolean; count?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-sm font-medium transition-colors cursor-pointer ${on ? 'bg-container2 text-title' : 'text-muted hover:text-common'}`}>
      <Icon name={icon} /> {label}
      {count != null && count > 0 && <span className="min-w-4 h-4 px-1 rounded-full bg-primary text-title-primary text-[10px] font-semibold flex items-center justify-center">{count}</span>}
    </button>
  );
}

//? Track which AI messages already finished typing this session, so a remount
//? (tab switch / panel reopen) shows them in full instead of re-typing.
const typedMessages = new Set<string>();

function useTypewriter(text: string, animate: boolean): { shown: string; typing: boolean } {
  const [shown, setShown] = useState(animate ? '' : text);
  useEffect(() => {
    if (!animate) { setShown(text); return; }
    let i = 0;
    setShown('');
    const id = setInterval(() => {
      i = Math.min(text.length, i + 2);
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => { clearInterval(id); };
  }, [text, animate]);
  return { shown, typing: shown.length < text.length };
}

function ChatBubble({ m }: { m: ChatMessage }) {
  const mine = m.role === 'user';
  const animate = !mine && !typedMessages.has(m.id);
  const { shown, typing } = useTypewriter(m.text, animate);
  useEffect(() => { if (!typing) typedMessages.add(m.id); }, [typing, m.id]);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SOFT} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <span className="w-6 h-6 shrink-0 mr-2 rounded-md bg-primary/12 text-primary text-xs flex items-center justify-center self-end"><Icon name="robot" /></span>}
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${mine ? 'bg-primary text-title-primary' : 'bg-container2 text-common'}`}>
        {mine ? m.text : shown}
        {typing && <span className="ml-0.5 inline-block w-1.5 h-3.5 align-[-2px] bg-current opacity-50 motion-safe:animate-pulse" />}
      </div>
    </motion.div>
  );
}

//? Remembered panel width (module-level so it survives close/reopen without
//? threading width through app state — keeps drag re-renders local to the panel).
let rememberedAiWidth = 340;

export function AIPanel({ onClose }: { onClose: () => void }) {
  const { suggestions, dismissSuggestion, openTicket, chat, sendChat } = useWorkspaces();
  const [tab, setTab] = useState<'chat' | 'suggestions'>('chat');
  const [draft, setDraft] = useState('');
  const [width, setWidth] = useState(rememberedAiWidth);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [chat, tab]);
  const send = () => { const t = draft.trim(); if (!t) return; sendChat(t); setDraft(''); };

  //? Drag the left edge to resize. The panel sits on the right, so dragging left
  //? (negative dx) widens it. Clamp 300–560px. Disable the spring while dragging
  //? so the edge tracks the pointer 1:1.
  const onHandleDown = (e: ReactPointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX;
    const next = Math.min(560, Math.max(300, dragRef.current.startW + dx));
    rememberedAiWidth = next;
    setWidth(next);
  };
  const onHandleUp = () => { dragRef.current = null; setDragging(false); };

  return (
    //? Animate WIDTH (not translate) so the board's flex area resizes in lock-step
    //? — no empty gap during the slide. While dragging, transition is instant.
    <motion.aside
      className="hidden lg:flex relative shrink-0 overflow-hidden border-l border-divider bg-container1"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={dragging ? { duration: 0 } : PANEL_TRANSITION}
    >
      <div
        onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
        title="Drag to resize"
        className={`absolute left-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors ${dragging ? 'bg-primary/50' : 'hover:bg-primary/30'}`}
      />
      <div style={{ width }} className="h-full flex flex-col">
        <div className="flex items-center justify-between h-14 px-4 border-b border-divider">
          <div className="flex items-center gap-2 font-semibold text-title">
            <span className="w-7 h-7 rounded-lg bg-primary/12 text-primary flex items-center justify-center"><Icon name="robot" /></span>
            Workspace-AI
          </div>
          <IconButton icon="xmark" onClick={onClose} />
        </div>
        <div className="flex items-center gap-1 px-3 h-11 border-b border-divider">
          <PanelTab label="Chat" icon="comment" on={tab === 'chat'} onClick={() => { setTab('chat'); }} />
          <PanelTab label="Suggestions" icon="robot" count={suggestions.length} on={tab === 'suggestions'} onClick={() => { setTab('suggestions'); }} />
        </div>
        {tab === 'chat' ? (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
              {chat.map((m) => <ChatBubble key={m.id} m={m} />)}
            </div>
            <div className="border-t border-divider p-3 flex items-center gap-2">
              <input
                value={draft} onChange={(e) => { setDraft(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                placeholder="Ask the AI to do something…"
                className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <button type="button" onClick={send} title="Send" className="w-9 h-9 shrink-0 rounded-xl bg-primary text-title-primary flex items-center justify-center cursor-pointer hover:bg-primary-hover"><Icon name="paper-plane" /></button>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {suggestions.length === 0 && <div className="text-center text-sm text-muted py-12">All caught up ✨</div>}
            {suggestions.map((s) => <SuggestionCard key={s.id} s={s} onOpenTicket={openTicket} onDismiss={() => { dismissSuggestion(s.id); }} />)}
          </div>
        )}
      </div>
    </motion.aside>
  );
}

function SuggestionCard({ s, onOpenTicket, onDismiss }: { s: AiSuggestion; onOpenTicket: (id: string) => void; onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-5 h-5 rounded-md bg-primary/12 text-primary text-xs flex items-center justify-center"><Icon name="robot" /></span>
        <span className="text-sm font-semibold text-title">{s.title}</span>
      </div>
      <p className="text-sm text-common leading-relaxed">{s.body}</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {s.ticketIds.map((t) => <button key={t} type="button" onClick={() => { onOpenTicket(t); }} className="rounded-md bg-container2 px-1.5 py-0.5 text-xs font-mono text-common hover:bg-container2-hover cursor-pointer">{t}</button>)}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={onDismiss} className="rounded-lg bg-primary px-3 h-8 text-sm font-medium text-title-primary hover:bg-primary-hover cursor-pointer">Accept</button>
        <button type="button" onClick={onDismiss} className="rounded-lg px-3 h-8 text-sm font-medium text-common hover:bg-container2 cursor-pointer">Dismiss</button>
        <button type="button" title="Snooze" className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:bg-container2 cursor-pointer"><Icon name="clock" /></button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- mobile bottom bar */
export function MobileBottomBar({ onFab }: { onFab: () => void }) {
  const { view, navigate, aiOpen, toggleAi } = useWorkspaces();
  const active = aiOpen ? 'ai' : ['board', 'terminals', 'activity'].includes(view) ? view : isTicketView(view) ? 'board' : view;
  const items: NavDef[] = [
    { id: 'board', icon: 'table-columns', label: 'Board' },
    { id: 'terminals', icon: 'terminal', label: 'Terminals' },
    { id: 'activity', icon: 'wave-square', label: 'Activity' },
    { id: 'ai', icon: 'robot', label: 'AI' },
  ];
  return (
    <nav className="md:hidden flex items-center justify-around h-16 border-t border-divider bg-container1 relative shrink-0">
      {items.map((it, i) => (
        <div key={it.id} className="contents">
          {i === 2 && (
            <button type="button" onClick={onFab} className="w-12 h-12 -mt-6 rounded-full bg-primary text-title-primary shadow-lg flex items-center justify-center cursor-pointer">
              <Icon name="plus" className="text-lg" />
            </button>
          )}
          <button type="button" onClick={() => { it.id === 'ai' ? toggleAi() : navigate(it.id); }} className={`flex flex-col items-center justify-center gap-1 flex-1 h-full text-xs cursor-pointer ${active === it.id ? 'text-primary' : 'text-muted'}`}>
            <Icon name={it.icon} className="text-lg" /> {it.label}
          </button>
        </div>
      ))}
    </nav>
  );
}
