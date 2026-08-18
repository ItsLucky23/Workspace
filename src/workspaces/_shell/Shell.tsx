//? Workspaces — app shell chrome: nav rail, top bar, tab/session bar, AI panel,
//? mobile bottom bar. Mirrors the prototype's Shell.jsx, rebuilt on our real
//? stack (Tailwind tokens, reused Avatar/Dropdown, ctx-driven navigation).

/* eslint-disable react-refresh/only-export-components -- shell module: the NAV_ITEMS/NAV_BOTTOM data is intentionally co-located with the shell chrome components (dev-only fast-refresh rule) */
import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

import { apiRequest, tryCatch as tryCatchClient, i18nNotify as notify, useSession, useTranslator, useUpdateLanguage, getActiveLanguage } from '@luckystack/core/client';

import { uploadMedia } from '../_functions/uploadMedia';
import { backendUrl } from '../../../config';
import type { SessionLayout } from '../../../config';

import { motion } from 'motion/react';

import Icon, { type IconName } from '../_components/Icon';
import { ModulePicker } from '../_components/ModulePicker';
import { Glossary } from '../_components/Glossary';
import { Collapse, Popover, SPRING_SOFT } from '../_components/motion';
import { AvatarBubble, AvatarStack, IconButton, WsButton, useClickAway } from '../_components/primitives';
import { SetupNotice } from '../_components/SetupNotice';
import { WORKSPACE_MODULES, isSectionEnabled, sectionsForModules, type WorkspaceModuleId } from '../_data/modules';
import { NAV_CATEGORIES, type NavCategory } from '../_data/nav';
import { WORKSPACE_PACK_CHOICES } from '../_data/packs';
import { isTicketView, useWorkspaces, type WsView } from './WorkspacesContext';
import type { AiRun, AiSuggestion, ChatMessage, ChatPlan, ChatProposal, CopilotDirective, NotificationItem } from '../_data/types';

//? The CSS color token for a ticket's live status dot.
function statusColor(status: string | undefined): string {
  let tint: string;
  switch (status) {
    case 'busy': { tint = 'primary'; break; }
    case 'done': { tint = 'correct'; break; }
    case 'needs-input':
    case 'stuck': { tint = 'warning'; break; }
    default: { tint = 'muted'; }
  }
  return `var(--color-${tint})`;
}

//? The icon shown per notification type in the notifications panel.
function notificationIcon(type: NotificationItem['type']): IconName {
  switch (type) {
    case 'needs-input': { return 'circle-question'; }
    case 'merge': { return 'code-merge'; }
    case 'ai-suggestion': { return 'robot'; }
    case 'assignment': { return 'user'; }
    case 'container-failure': { return 'triangle-exclamation'; }
    default: { return 'bell'; }
  }
}

//? No-bounce spring for the AI-panel width animation — bounce would overshoot
//? the panel width and wobble the board edge.
const PANEL_TRANSITION = { type: 'spring', duration: 0.42, bounce: 0 } as const;

//? Nav grouping — module-based IA (supersedes the five verb destinations of ADR 0068/F4.1). The rail
//? mirrors the folder structure under src/workspaces/ (develop / content / insights) and the URL space
//? (/workspaces/<category>/<view>), so nav, folders and URLs tell one story:
//?
//?   Develop  — everything about building YOUR project (board, answers, backlog, pipeline,
//?              terminals, designer, interviewer, sources, schedules)
//?   Content  — the content lane: what you make and where it goes out (pieces, documents,
//?              marketing, scheduled posts, studio)
//?   Insights — what came of it (activity, usage, knowledge)
//?
//? Designer + Interviewer are repo-bound tools (visual editor over the product's own UI; repo-aware
//? planning chat), so they live under Develop, not the content lane. Category definitions come from
//? ../_data/nav.ts (shared with the provider's URL mapping). Group headers render when the rail is
//? expanded; collapsed shows a thin divider between groups. Groups render in GROUP_ORDER.
//?
//? Develop carries the most pages, so its items also carry an optional `sub` band (work / machine /
//? tools). In the EXPANDED rail an open group renders a thin sub-header before the first item of each
//? band; the collapsed rail is unchanged (category icons only). Only Develop uses sub-bands today.
type NavGroup = NavCategory;
interface NavDef { id: WsView; icon: IconName; label: string; group?: NavGroup; sub?: string }

//? Sub-band → its i18n key (Develop only). A band with no mapping renders no header.
const SUB_LABEL_KEY: Record<string, string> = {
  work: 'workspaces.nav.subWork',
  machine: 'workspaces.nav.subMachine',
  tools: 'workspaces.nav.subTools',
};

export const GROUP_ORDER: NavGroup[] = NAV_CATEGORIES;
export const GROUP_LABELS: Record<NavGroup, string> = { develop: 'Develop', content: 'Content', insights: 'Insights' };
//? The icon + landing page for each group. Clicking a group always DOES something (it navigates to its
//? first available item) instead of only toggling a menu — a nav item that does nothing on click reads as
//? broken.
export const GROUP_ICONS: Record<NavGroup, IconName> = { develop: 'code-branch', content: 'wand-magic-sparkles', insights: 'chart-column' };
export const NAV_ITEMS: NavDef[] = [
  //? Develop › work — the live state of the work…
  { id: 'board', icon: 'table-columns', label: 'Board', group: 'develop', sub: 'work' },
  //? The cross-ticket answer inbox. It sits first-class in the rail rather than under a bell, because on
  //? a phone-first product where the human's whole job is answering, "what is waiting on me?" IS the work.
  { id: 'answers', icon: 'circle-question', label: 'Answers', group: 'develop', sub: 'work' },
  { id: 'backlog', icon: 'list-check', label: 'Backlog', group: 'develop', sub: 'work' },
  //? Develop › machine — the pipeline that moves the work, the automations that react to it, the schedules.
  { id: 'pipeline', icon: 'diagram-project', label: 'Pipeline', group: 'develop', sub: 'machine' },
  { id: 'automations', icon: 'bolt', label: 'Automations', group: 'develop', sub: 'machine' },
  { id: 'scheduled', icon: 'clock', label: 'Schedules', group: 'develop', sub: 'machine' },
  //? Develop › tools — the repo-bound browsers + editors.
  //? The whole-codebase browser (owner decision 2026-07-20): the linked repo's baseline tree, read-only,
  //? as a first-class destination — previously the code was only reachable inside a ticket's live editor.
  { id: 'code', icon: 'code', label: 'Code', group: 'develop', sub: 'tools' },
  { id: 'terminals', icon: 'terminal', label: 'Terminals', group: 'develop', sub: 'tools' },
  { id: 'designer', icon: 'palette', label: 'Designer', group: 'develop', sub: 'tools' },
  //? The live component-library reference (moved out of the Designer into its own destination).
  { id: 'components', icon: 'table-cells-large', label: 'Components', group: 'develop', sub: 'tools' },
  { id: 'interviewer', icon: 'comments', label: 'Interviewer', group: 'develop', sub: 'tools' },
  { id: 'sources', icon: 'book-open', label: 'Sources', group: 'develop', sub: 'tools' },
  //? Content — the content lane: what you make and where it goes out.
  { id: 'content', icon: 'wand-magic-sparkles', label: 'Content', group: 'content' },
  { id: 'documents', icon: 'file-lines', label: 'Documents', group: 'content' },
  { id: 'marketing', icon: 'bullhorn', label: 'Marketing', group: 'content' },
  { id: 'scheduled-posts', icon: 'calendar-day', label: 'Scheduled posts', group: 'content' },
  //? Studio (brief → landing page + brand kit) is back in the nav after the restructure.
  { id: 'studio', icon: 'display', label: 'Studio', group: 'content' },
  //? Insights — what came of it.
  { id: 'activity', icon: 'wave-square', label: 'Activity', group: 'insights' },
  { id: 'usage', icon: 'chart-column', label: 'Usage', group: 'insights' },
  { id: 'knowledge', icon: 'diagram-project', label: 'Knowledge', group: 'insights' },
];
export const NAV_BOTTOM: NavDef[] = [
  { id: 'ai', icon: 'robot', label: 'Workspace-AI' },
  { id: 'settings', icon: 'gear', label: 'Settings' },
];

const roleChip = (role: string) => (
  <span className="rounded-full bg-container2 px-2 py-0.5 text-[11px] font-medium capitalize text-muted">{role}</span>
);

const LANGUAGES = ['en', 'nl', 'de', 'fr'] as const;
type Language = typeof LANGUAGES[number];
const isLanguage = (value: string): value is Language => LANGUAGES.includes(value as Language);

/* ----------------------------------------------------------------- nav rail */
export function NavRail({ expanded, setExpanded }: { expanded: boolean; setExpanded: (fn: (e: boolean) => boolean) => void }) {
  const { view, navigate, suggestions, currentUser, activeWorkspace, aiOpen, toggleAi, theme, setTheme, signOut, viewCounts } = useWorkspaces();
  const { session } = useSession<SessionLayout>();
  const translate = useTranslator();
  const updateLanguage = useUpdateLanguage();
  const initialLanguage = getActiveLanguage();
  const [activeLang, setActiveLang] = useState<Language>(() => (isLanguage(initialLanguage) ? initialLanguage : 'en'));
  const [userOpen, setUserOpen] = useState(false);
  useEffect(() => {
    if (session?.language !== undefined && isLanguage(session.language)) setActiveLang(session.language);
  }, [session?.language]);
  //? null = "follow the current view" (the group holding it is open). A string pins the user's own choice;
  //? '' means they collapsed everything on purpose.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const userRef = useClickAway<HTMLDivElement>(userOpen, () => { setUserOpen(false); });

  const renderItem = (it: NavDef) => {
    const isAi = it.id === 'ai';
    const badge = isAi ? suggestions.length : 0;
    //? #119 — how many OTHER members are on this view now (live presence) → a small activity count.
    const present = isAi ? 0 : (viewCounts[it.id] ?? 0);
    const active = isAi ? aiOpen : view === it.id;
    return (
      <button
        key={it.id} type="button" onClick={() => { if (isAi) { toggleAi(); } else { navigate(it.id); } }}
        title={expanded ? undefined : it.label}
        className={`group relative flex items-center gap-3 rounded-xl h-10 px-3 transition-colors cursor-pointer ${active ? 'bg-container2 text-title' : 'text-muted hover:bg-container2 hover:text-common'}`}
      >
        <span className="relative w-5 text-center text-base">
          <Icon name={it.icon} />
          {badge > 0 && <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-primary text-title-primary text-[10px] font-semibold flex items-center justify-center">{badge}</span>}
          {badge === 0 && present > 0 && <span title={translate({ key: 'workspaces.shell.viewPresence', params: [{ key: 'n', value: String(present) }] })} className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-secondary text-common-secondary text-[10px] font-semibold flex items-center justify-center">{present}</span>}
        </span>
        {expanded && <span className="text-sm font-medium whitespace-nowrap">{it.label}</span>}
      </button>
    );
  };

  return (
    <nav className={`relative hidden md:flex flex-col shrink-0 border-r border-divider bg-container1 transition-all duration-200 ${expanded ? 'w-60' : 'w-[68px]'}`}>
      {/* Brand row — always the "W" mark (+ label when expanded). No clipping, no
          hover-swap: the collapse/expand control is a separate always-visible pill
          that hangs on the rail's right border (below). */}
      <div className={`flex items-center gap-2 px-3 h-14 ${expanded ? '' : 'justify-center'}`}>
        <span className="w-8 h-8 rounded-lg bg-primary text-title-primary flex items-center justify-center font-bold shrink-0">{translate({ key: 'workspaces.shell.brandInitial' })}</span>
        {expanded && <span className="font-semibold text-title whitespace-nowrap">{translate({ key: 'workspaces.shell.brand' })}</span>}
      </div>
      {/* Collapse/expand toggle: an absolute pill anchored ON the rail's right border
          line (half-overhanging via -right-3), always visible so it never looks buggy. */}
      <button
        type="button" onClick={() => { setExpanded((e) => !e); }}
        title={translate({ key: expanded ? 'workspaces.shell.collapse' : 'workspaces.shell.expand' })}
        className="absolute -right-3 top-4 z-10 w-6 h-6 rounded-full border border-container1-border bg-container1 text-muted hover:text-common hover:bg-container2 flex items-center justify-center shadow-sm cursor-pointer transition-colors"
      >
        <Icon name={expanded ? 'angle-left' : 'angle-right'} className="text-xs" />
      </button>
      <div className="flex-1 flex flex-col gap-1 px-2.5 py-2 overflow-y-auto">
        {/* UI restructure — FIVE destinations instead of fifteen. A group expands to show its pages; the
            group holding the current view is open by default, so you always see where you are without
            hunting. Clicking a group also NAVIGATES to its first page: a nav item that only toggles a
            menu reads as broken. */}
        {GROUP_ORDER.map((g) => {
          //? Module gating (modules.ts): hide the nav items whose section is off for this
          //? workspace. Non-gateable items (usage) + legacy workspaces (empty set) stay on.
          const items = NAV_ITEMS.filter((it) => it.group === g && isSectionEnabled(activeWorkspace.enabledSections, it.id));
          if (items.length === 0) return null;
          const holdsView = items.some((it) => it.id === view);
          const open = openGroup === g || (openGroup === null && holdsView);
          const first = items[0];
          return (
            <div key={g} className="flex flex-col gap-1">
              <button
                type="button"
                title={expanded ? undefined : translate({ key: `workspaces.nav.${g}` })}
                onClick={() => {
                  setOpenGroup(open ? '' : g);
                  //? Only navigate when opening, and only when the current view is elsewhere — re-clicking
                  //? the group you are already in should not yank you off the page you are reading.
                  //? Collapsed there is no sub-list to reveal, so a click must always go somewhere.
                  if ((!expanded || !open) && !holdsView && first) navigate(first.id);
                }}
                className={`flex w-full items-center gap-3 rounded-xl h-10 px-2.5 transition-colors cursor-pointer ${holdsView ? 'bg-container2 text-title' : 'text-common hover:bg-container2'}`}
              >
                <span className="w-5 text-center shrink-0"><Icon name={GROUP_ICONS[g]} /></span>
                {expanded && <span className="flex-1 min-w-0 text-left text-sm font-medium truncate">{translate({ key: `workspaces.nav.${g}` })}</span>}
                {expanded && items.length > 1 && <Icon name="angle-down" className={`text-xs text-muted transition-transform ${open ? 'rotate-180' : ''}`} />}
              </button>
              {/* Sub-navigation, EXPANDED RAIL ONLY. A first attempt also rendered the sub-items while
                  collapsed, which produced 19 icons where there used to be 15 — the opposite of the point.
                  Collapsed, the group icons ARE the navigation; clicking one opens its first page. Develop's
                  items carry a `sub` band, so a thin sub-header renders before the first item of each band. */}
              {expanded && (
                <Collapse open={open}>
                  <div className="flex flex-col gap-1 pl-3 border-l border-divider ml-3">
                    {items.map((it, i) => {
                      const subKey = it.sub !== undefined && it.sub !== items[i - 1]?.sub ? SUB_LABEL_KEY[it.sub] : undefined;
                      return (
                        <Fragment key={it.id}>
                          {subKey !== undefined && (
                            <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-disabled select-none">{translate({ key: subKey })}</div>
                          )}
                          {renderItem(it)}
                        </Fragment>
                      );
                    })}
                  </div>
                </Collapse>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-3 border-t border-divider">
        {/* Only the Workspace-AI toggle lives here now; Account/Settings moved into
            the user dropdown below (no separate gear icon — item 4). */}
        {NAV_BOTTOM.filter((it) => it.id !== 'settings').map((it) => renderItem(it))}
        <div className="relative" ref={userRef}>
          <button type="button" onClick={() => { setUserOpen((o) => !o); }} title={expanded ? undefined : translate({ key: 'workspaces.shell.userSettingsTitle', params: [{ key: 'name', value: currentUser.name }] })}
            className={`flex w-full items-center gap-3 rounded-xl h-10 px-2.5 transition-colors cursor-pointer ${userOpen ? 'bg-container2 text-title' : 'text-muted hover:bg-container2'}`}>
            <AvatarBubble user={currentUser} size={24} />
            {expanded && <span className="flex-1 min-w-0 text-left text-sm font-medium text-common truncate">{currentUser.name}</span>}
            {expanded && <Icon name="caret-down" className={`text-xs transition-transform ${userOpen ? 'rotate-180' : ''}`} />}
          </button>
          <Popover open={userOpen} className="absolute bottom-full left-0 mb-1 w-56 rounded-xl border border-container1-border bg-container1 p-1 shadow-lg z-30">
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <AvatarBubble user={currentUser} size={36} />
              <div className="min-w-0"><div className="text-sm font-semibold text-title truncate">{currentUser.name}</div><div className="text-xs text-muted truncate">{currentUser.email}</div></div>
            </div>
            <div className="my-1 h-px bg-divider" />
            <button type="button" onClick={() => { setUserOpen(false); navigate('settings'); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="user" className="w-4 text-center" /> {translate({ key: 'workspaces.shell.account' })}</button>
            <button
              type="button"
              onClick={() => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(nextTheme);
                void apiRequest({ name: 'settings/updateUser', version: 'v1', data: { theme: nextTheme } }).then((response) => {
                  if (response.status !== 'success') notify.error({ key: 'settings.failedUpdateUser' });
                });
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="w-4 text-center" /> {translate({ key: 'workspaces.shell.themeLabel', params: [{ key: 'theme', value: theme }] })}
            </button>
            <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-sm text-common">
              <Icon name="language" className="w-4 text-center" />
              <div className="flex items-center gap-1">
                {LANGUAGES.map((code) => (
                  <button
                    key={code} type="button"
                    onClick={() => {
                      const previousLanguage = activeLang;
                      setActiveLang(code);
                      updateLanguage(code);
                      void apiRequest({ name: 'settings/updateUser', version: 'v1', data: { language: code } }).then((response) => {
                        if (response.status === 'success') return;
                        setActiveLang(previousLanguage);
                        updateLanguage(previousLanguage);
                        notify.error({ key: 'settings.failedUpdateUser' });
                      });
                    }}
                    className={`rounded-md px-1.5 py-0.5 text-xs uppercase cursor-pointer transition-colors ${activeLang === code ? 'bg-primary text-common-primary' : 'text-muted hover:bg-container2 hover:text-common'}`}
                  >{code}</button>
                ))}
              </div>
            </div>
            <div className="my-1 h-px bg-divider" />
            <button type="button" onClick={() => { setUserOpen(false); signOut(); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-wrong hover:bg-wrong/10 cursor-pointer"><Icon name="right-from-bracket" className="w-4 text-center" /> {translate({ key: 'workspaces.shell.signOut' })}</button>
          </Popover>
        </div>
      </div>
    </nav>
  );
}

/* ----------------------------------------------------------------- top bar */
export function TopBar({ onCmdK }: { onCmdK: () => void }) {
  const {
    navigate, openTicket, workspaces, activeWorkspace, setActiveWorkspace, createWorkspace, members, presentUserIds,
    notifications, unreadNotifications, markNotificationRead, markAllNotificationsRead,
  } = useWorkspaces();
  //? #120 — a notification's deep-link is a real destination: open its ticket (or navigate to its view),
  //? then mark read + close the popover. Falls back to just marking read when there is no deep-link.
  const openNotification = (n: (typeof notifications)[number]) => {
    const link = n.deepLink;
    if (link?.ticketId) openTicket(link.ticketId);
    else if (link?.view) navigate(link.view);
    markNotificationRead(n.id);
    setNotifOpen(false);
  };
  const translate = useTranslator();
  const [wsOpen, setWsOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const wsRef = useClickAway<HTMLDivElement>(wsOpen, () => { setWsOpen(false); });
  const notifRef = useClickAway<HTMLDivElement>(notifOpen, () => { setNotifOpen(false); });
  //? #117 — live presence: the members actually present now (from the relay), not a static slice.
  const presentSet = new Set(presentUserIds);
  const presence = members.filter((m) => presentSet.has(m.id));
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
            <div className="px-2.5 py-1.5 text-xs font-medium text-muted">{translate({ key: 'workspaces.shell.brand' })}</div>
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
              <button type="button" onClick={openCreate} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="plus" className="w-4 text-center" /> {translate({ key: 'workspaces.shell.createWorkspace' })}</button>
              <button type="button" onClick={() => { setWsOpen(false); navigate('workspace'); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="users" className="w-4 text-center" /> {translate({ key: 'workspaces.shell.manageMembers' })}</button>
          </Popover>
        </div>
        {/* Breadcrumb glyph: a Project lives INSIDE the Workspace, but both switchers rendered as the
            same tinted-square + name + caret shape with nothing showing containment — this static
            separator reads the pair as a path, not two independent pickers. */}
        <span aria-hidden="true" className="text-sm text-disabled select-none">/</span>
        {/* project switcher (ADR 0035 multi-project) */}
        <ProjectSwitcher />
      </div>

      {/* search */}
      <button type="button" onClick={onCmdK} className="flex flex-1 max-w-xl items-center gap-2 rounded-xl border border-container1-border bg-container2/50 px-3 h-9 text-sm text-muted hover:bg-container2 transition-colors cursor-pointer">
        <Icon name="magnifying-glass" /> <span className="flex-1 text-left">{translate({ key: 'workspaces.shell.search' })}</span>
        <kbd className="rounded-md border border-container1-border bg-container1 px-1.5 text-xs font-sans">{translate({ key: 'workspaces.shell.searchShortcut' })}</kbd>
      </button>

      <div className="flex-1" />

      {/* right */}
      <div className="flex items-center gap-1.5">
        {/* J3 — glossary: plain-language definitions of the app's terms for a novice. */}
        <button type="button" onClick={() => void menuHandler.open(<Glossary />)} title={translate({ key: 'workspaces.glossary.title' })} className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-common hover:bg-container2 transition-colors cursor-pointer">
          <Icon name="circle-question" />
        </button>
        {presence.length > 0 && <div title={translate({ key: 'workspaces.shell.presenceViewing' })} className="mr-1"><AvatarStack users={presence} size={26} max={3} /></div>}
        <div className="relative" ref={notifRef}>
          <button type="button" onClick={() => { setNotifOpen((o) => !o); }} title={translate({ key: 'workspaces.shell.notifications' })} className="relative inline-flex items-center justify-center w-9 h-9 rounded-xl text-common hover:bg-container2 transition-colors cursor-pointer">
            <Icon name="bell" />
            {unreadNotifications > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-wrong text-white text-[10px] font-semibold flex items-center justify-center">{unreadNotifications}</span>}
          </button>
          <Popover open={notifOpen} className="absolute right-0 mt-1 w-80 rounded-xl border border-container1-border bg-container1 p-1 shadow-lg z-30">
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className="text-xs font-medium text-muted">{translate({ key: 'workspaces.shell.notifications' })}</span>
              {unreadNotifications > 0 && (
                <button type="button" onClick={markAllNotificationsRead} className="text-xs font-medium text-primary hover:text-primary-hover cursor-pointer">
                  {translate({ key: 'workspaces.shell.markAllRead' })}
                </button>
              )}
            </div>
            <div className="my-1 h-px bg-divider" />
            <div className="max-h-80 overflow-y-auto flex flex-col gap-0.5">
              {notifications.length === 0 && (
                <div className="px-2.5 py-4 text-center text-sm text-muted">{translate({ key: 'workspaces.shell.noNotifications' })}</div>
              )}
              {notifications.map((n) => (
                <button
                  key={n.id} type="button" onClick={() => { openNotification(n); }}
                  className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer hover:bg-container2 ${n.read ? '' : 'bg-primary/5'}`}
                >
                  <span className={`w-5 h-5 mt-0.5 rounded-md flex items-center justify-center shrink-0 ${n.read ? 'bg-container2 text-muted' : 'bg-primary/12 text-primary'}`}>
                    <Icon name={notificationIcon(n.type)} className="text-xs" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-title truncate">{n.title}</span>
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                    </span>
                    <span className="block text-xs text-muted line-clamp-2">{n.body}</span>
                  </span>
                </button>
              ))}
            </div>
          </Popover>
        </div>
        {/* Theme toggle + account/sign-out moved to the leftbar user dropdown (item 4). */}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------- paused banner */
//? Emergency-stop banner. `workspacePaused` is workspace-wide state, so this lives in
//? the persistent shell chrome above the routed page and is reachable on EVERY view on
//? BOTH mobile + desktop. Resume-all is non-destructive → direct call (no confirm).
//? Renders nothing when the workspace isn't paused.
//? GAP_SCAN B1 — realtime write reliability. An approve/answer tap made while the socket is down used to
//? vanish silently; those writes are now parked (WorkspacesProvider) and this banner is the visible half:
//? it says the connection is gone, how many actions are waiting, and offers an explicit retry. The parked
//? writes also replay automatically on reconnect.
export function OfflineBanner() {
  const { offline, queuedWrites, retryQueuedWrites } = useWorkspaces();
  const translate = useTranslator();
  if (!offline && queuedWrites === 0) return null;
  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2 border-b border-warning/40 bg-warning/10 shrink-0">
      <Icon name={offline ? 'wifi' : 'rotate'} className="text-warning shrink-0" />
      <span className="flex-1 min-w-0 text-sm text-title">
        {translate({ key: offline ? 'workspaces.wsShell.offline' : 'workspaces.wsShell.offlineReconnected' })}
        {queuedWrites > 0 ? ` · ${translate({ key: 'workspaces.wsShell.offlineQueued' })}: ${String(queuedWrites)}` : ''}
      </span>
      {queuedWrites > 0 && (
        <button type="button" onClick={retryQueuedWrites} className="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-primary px-3 min-h-11 md:h-8 md:min-h-0 text-sm font-medium text-title-primary hover:bg-primary-hover cursor-pointer">
          <Icon name="rotate" /> {translate({ key: 'workspaces.wsShell.offlineRetry' })}
        </button>
      )}
    </div>
  );
}

export function PausedBanner() {
  const { workspacePaused, resumeAll } = useWorkspaces();
  const translate = useTranslator();
  if (!workspacePaused) return null;
  return (
    <div className="flex items-center gap-3 px-4 md:px-6 py-2 border-b border-warning/40 bg-warning/10 shrink-0">
      <Icon name="pause" className="text-warning shrink-0" />
      <span className="flex-1 min-w-0 text-sm text-title">{translate({ key: 'workspaces.board.pausedBanner' })}</span>
      <button
        type="button"
        onClick={() => { resumeAll(); }}
        className="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-primary px-3 h-8 text-sm font-medium text-title-primary hover:bg-primary-hover cursor-pointer"
      >
        <Icon name="play" /> {translate({ key: 'workspaces.board.resumeAll' })}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- tab bar */
//? Open-ticket tabs only (no board/AI buttons — those live in the nav rail). Lives
//? INSIDE the content column, so it spans only the content width and butts up against
//? the AI panel's left edge instead of running over it. Hidden when nothing is open.
export function TabBar() {
  const { view, navigate, openTabs, closeTab, tickets } = useWorkspaces();
  //? Status lookup so the tab bar can colour its dots without re-deriving ticket logic.
  const statusLookup: Record<string, string> = Object.fromEntries(tickets.map((t) => [t.id, t.status]));

  if (openTabs.length === 0) return null;

  return (
    <div className="hidden md:flex items-center gap-1 h-11 px-3 border-b border-divider bg-background shrink-0">
      <div className="flex-1 flex items-center gap-1 overflow-x-auto ws-no-scrollbar">
        {openTabs.map((id) => (
          <div key={id} onClick={() => { navigate(id); }} className={`group relative flex items-center gap-2 rounded-lg pl-3 pr-2 h-8 text-sm whitespace-nowrap cursor-pointer transition-colors ${view === id ? 'text-title' : 'text-muted hover:text-common'}`}>
            {view === id && <span className="absolute inset-0 rounded-lg bg-container1 shadow-sm" />}
            <span className="relative z-10 w-1.5 h-1.5 rounded-full" style={{ background: statusColor(statusLookup[id]) }} />
            <span className="relative z-10">{id}</span>
            <button type="button" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(id); }} className="relative z-10 w-4 h-4 flex items-center justify-center rounded text-muted hover:text-title hover:bg-container2 opacity-60 group-hover:opacity-100"><Icon name="xmark" className="text-xs" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- create workspace */
//? Opened via menuHandler (outside the WorkspacesProvider tree), so it can't use
//? the context — it receives the create callback as a prop. Kept intentionally
//? simple: one project = one workspace, add the team afterwards.
//? G5 — the pipeline tiers offered at creation. `professional` stays the default so nothing changes for
//? someone who does not care; the lighter tiers exist because a 7-stage pipeline is ceremony a solo project
//? never asked for.
const PIPELINE_TIERS = ['simple', 'advanced', 'professional'] as const;

export function CreateWorkspaceForm({ onCreate }: { onCreate: (name: string, enabledSections?: string[], presetKey?: string, packId?: string) => void }) {
  const translate = useTranslator();
  const [name, setName] = useState('');
  const [tier, setTier] = useState<string>('professional');
  //? #19 — the PACK is the first question now, because it answers "what is this workspace for?" and then
  //? fills in the modules + tier itself. Picking one is optional; "start empty" keeps the old behaviour.
  const [pack, setPack] = useState<string>('');
  //? Default all modules on (full experience); deselect the lanes you don't want.
  const [modules, setModules] = useState<WorkspaceModuleId[]>(WORKSPACE_MODULES.map((m) => m.id));
  const toggleModule = (id: WorkspaceModuleId) => { setModules((cur) => (cur.includes(id) ? cur.filter((m) => m !== id) : [...cur, id])); };
  //? Choosing a pack SETS the modules + tier, so the two lower sections reflect it and stay editable —
  //? the pack is a starting point, never a lock-in.
  const choosePack = (packId: string): void => {
    setPack(packId);
    const chosen = WORKSPACE_PACK_CHOICES.find((p) => p.id === packId);
    if (!chosen) return;
    setModules(chosen.modules);
    setTier(chosen.preset);
  };
  const submit = () => { const n = name.trim(); if (!n || modules.length === 0) return; onCreate(n, sectionsForModules(modules), tier, pack || undefined); void menuHandler.close(); };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.shell.createWorkspace' })}</div>
      <span className="text-sm text-muted -mt-2">{translate({ key: 'workspaces.shell.createWorkspaceSubtitle' })}</span>
      <input
        value={name} onChange={(e) => { setName(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.shell.workspaceNamePlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      {/* #19 — what is this workspace FOR? Answering that seeds real starting content (skills, a channel,
          starter documents, a first ticket) instead of handing someone an empty workspace. */}
      <div className="text-xs font-medium text-muted mt-1">{translate({ key: 'workspaces.packs.heading' })}</div>
      <div className="grid grid-cols-2 gap-2">
        {WORKSPACE_PACK_CHOICES.map((p) => (
          <button key={p.id} type="button" onClick={() => { choosePack(p.id); }}
            className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left cursor-pointer transition-colors ${pack === p.id ? 'border-primary-border bg-primary/10' : 'border-container1-border bg-container2/50 hover:bg-container2'}`}>
            <Icon name={p.icon} className={pack === p.id ? 'text-primary mt-0.5' : 'text-muted mt-0.5'} />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-title">{translate({ key: p.labelKey })}</span>
              <span className="block text-xs text-muted">{translate({ key: p.descKey })}</span>
            </span>
          </button>
        ))}
      </div>
      {/* Modules are first-class (no "advanced" fold): a pack pre-checks them, and the checkboxes
          below let you add or drop lanes before creating. */}
      <div className="flex flex-col gap-2 mt-1">
        <div className="text-xs font-medium text-muted">{translate({ key: 'workspaces.modules.pickHeading' })}</div>
        <ModulePicker selected={modules} onToggle={toggleModule} />
        {/* G5 — how much pipeline to start with. Only meaningful with the development module on. */}
        {modules.includes('development') && (
          <>
            <div className="text-xs font-medium text-muted mt-1">{translate({ key: 'workspaces.modules.tierHeading' })}</div>
            <div className="flex flex-wrap gap-2">
              {PIPELINE_TIERS.map((t) => (
                <button key={t} type="button" onClick={() => { setTier(t); }}
                  className={`rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${tier === t ? 'border-primary-border bg-primary/10 text-primary' : 'border-container1-border bg-container2/50 text-common hover:bg-container2'}`}>
                  {translate({ key: `workspaces.modules.tier_${t}` })}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit} disabled={name.trim().length === 0 || modules.length === 0}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}

//? Multi-project (ADR 0035) + G2 greenfield wizard: create a new project in the active workspace. Two modes:
//? "From a template" (greenfield — picks a stack template → `createFromTemplate`, which inits a real repo +
//? seed tree, G1) or "Link a repo" (name + git URL → `createProject`). The Conductor seeds the default
//? pipeline; the client refetches + can switch to it.
//? templates + onCreateFromTemplate are PASSED IN (not via useWorkspaces): this form renders inside the
//? menuHandler portal, which lives ABOVE the WorkspacesProvider (MenuHandlerProvider > Router), so calling
//? useWorkspaces() here throws. The call site (ProjectSwitcher, inside the provider) injects both.
function CreateProjectForm({ onCreate, templates, onCreateFromTemplate }: { onCreate: (input: { name: string; gitUrl?: string; preset?: string }) => void; templates: { key: string; label: string; description: string }[]; onCreateFromTemplate: (input: { name: string; template: string; brief?: string; preset?: string }) => void }) {
  const translate = useTranslator();
  const [mode, setMode] = useState<'template' | 'link'>('template');
  const [name, setName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [template, setTemplate] = useState(templates[0]?.key ?? '');
  const [brief, setBrief] = useState('');
  //? The pipeline TIER, asked here too (owner decision 2026-08-18). It was only ever askable when
  //? creating a WORKSPACE, so every project after the first silently got the full 7-stage flow.
  const [tier, setTier] = useState<string>('professional');
  const canSubmit = name.trim().length > 0 && (mode === 'link' || template.length > 0);
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (mode === 'template') { if (template.length === 0) return; onCreateFromTemplate({ name: n, template, preset: tier, ...(brief.trim() ? { brief: brief.trim() } : {}) }); }
    else onCreate({ name: n, preset: tier, ...(gitUrl.trim() ? { gitUrl: gitUrl.trim() } : {}) });
    void menuHandler.close();
  };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.shell.createProject' })}</div>
      {/* G2 — mode toggle: greenfield template vs link an existing repo. */}
      <div className="flex items-center gap-1 rounded-lg bg-container2/60 p-1">
        <button type="button" onClick={() => { setMode('template'); }} className={`flex-1 rounded-md px-3 py-1.5 text-sm cursor-pointer ${mode === 'template' ? 'bg-primary text-common-primary' : 'text-common hover:bg-container2'}`}>{translate({ key: 'workspaces.shell.fromTemplate' })}</button>
        <button type="button" onClick={() => { setMode('link'); }} className={`flex-1 rounded-md px-3 py-1.5 text-sm cursor-pointer ${mode === 'link' ? 'bg-primary text-common-primary' : 'text-common hover:bg-container2'}`}>{translate({ key: 'workspaces.shell.linkRepo' })}</button>
      </div>
      <input
        value={name} onChange={(e) => { setName(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.shell.projectNamePh' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      {mode === 'template' ? (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <button key={t.key} type="button" onClick={() => { setTemplate(t.key); }} className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left cursor-pointer ${template === t.key ? 'border-primary bg-primary/10' : 'border-container1-border bg-container2/50 hover:bg-container2'}`}>
              <span className="text-sm font-medium text-title">{t.label}</span>
              <span className="text-xs text-muted">{t.description}</span>
            </button>
          ))}
          {/* DESIGN_DOCS_PROGRAM 4.1 — describe the app → the AI scaffolds the real starting UI from it. */}
          <textarea
            value={brief} onChange={(e) => { setBrief(e.target.value); }}
            placeholder={translate({ key: 'workspaces.shell.projectBriefPh' })} rows={3}
            className="px-3 py-2 rounded-lg border border-container1-border bg-container2/50 text-sm text-title resize-y focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>
      ) : (
        <input
          value={gitUrl} onChange={(e) => { setGitUrl(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={translate({ key: 'workspaces.shell.projectGitUrlPh' })}
          className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      )}
      {/* How much pipeline this project starts with — the same three tiers the workspace form offers,
          and now changeable afterwards from the Pipeline page. */}
      <div className="text-xs font-medium text-muted mt-1">{translate({ key: 'workspaces.modules.tierHeading' })}</div>
      <div className="flex flex-wrap gap-2">
        {PIPELINE_TIERS.map((t) => (
          <button key={t} type="button" onClick={() => { setTier(t); }}
            className={`rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${tier === t ? 'border-primary-border bg-primary/10 text-primary' : 'border-container1-border bg-container2/50 text-common hover:bg-container2'}`}>
            {translate({ key: `workspaces.modules.tier_${t}` })}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit} disabled={!canSubmit}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}

//? Multi-service (ADR 0035): declare a build/deploy unit within a project (name + path).
function AddServiceForm({ projectId, onCreate }: { projectId: string; onCreate: (input: { projectId: string; name: string; path?: string }) => void }) {
  const translate = useTranslator();
  const [name, setName] = useState('');
  const [servicePath, setServicePath] = useState('');
  const submit = () => { const n = name.trim(); if (!n) return; onCreate({ projectId, name: n, ...(servicePath.trim() ? { path: servicePath.trim() } : {}) }); void menuHandler.close(); };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.shell.addService' })}</div>
      <input
        value={name} onChange={(e) => { setName(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.shell.serviceNamePh' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <input
        value={servicePath} onChange={(e) => { setServicePath(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={translate({ key: 'workspaces.shell.servicePathPh' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
      />
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" onClick={submit}>{translate({ key: 'workspaces.shell.create' })}</WsButton>
      </div>
    </div>
  );
}

//? Multi-project (ADR 0035): the project switcher — sits next to the workspace switcher
//? in the TopBar. Switches the active project (board/pipeline/sources re-scope), creates
//? a new project, and lists/adds/removes the active project's services. Hidden until at
//? least one project has loaded.
function ProjectSwitcher() {
  const { projects, activeProject, activeProjectId, setActiveProject, createProject, createFromTemplate, templates, services, createService, deleteService } = useWorkspaces();
  const translate = useTranslator();
  const [open, setOpen] = useState(false);
  const ref = useClickAway<HTMLDivElement>(open, () => { setOpen(false); });
  if (projects.length === 0) return null;
  const openCreate = () => { setOpen(false); void menuHandler.open(<CreateProjectForm onCreate={createProject} templates={templates} onCreateFromTemplate={createFromTemplate} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };
  const openAddService = () => { if (!activeProjectId) return; setOpen(false); void menuHandler.open(<AddServiceForm projectId={activeProjectId} onCreate={createService} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setOpen((o) => !o); }} className="flex items-center gap-2 rounded-xl px-2 h-9 hover:bg-container2 transition-colors cursor-pointer">
        <Icon name="diagram-project" className="text-sm text-secondary" />
        <span className="text-sm font-medium text-title max-w-40 truncate">{activeProject?.name ?? '—'}</span>
        <Icon name="caret-down" className={`text-xs text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <Popover open={open} className="absolute left-0 mt-1 w-64 rounded-xl border border-container1-border bg-container1 p-1 shadow-lg z-30">
        <div className="px-2.5 py-1.5 text-xs font-medium text-muted">{translate({ key: 'workspaces.shell.projects' })}</div>
        {projects.map((p) => (
          <button key={p.id} type="button" onClick={() => { setActiveProject(p.id); setOpen(false); }} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer ${p.id === activeProjectId ? 'bg-container2' : 'hover:bg-container2'}`}>
            <span className="flex items-center gap-2 text-sm text-title truncate"><Icon name="diagram-project" className="text-xs text-muted" /> {p.name}</span>
            {p.id === activeProjectId && <Icon name="check" className="text-xs text-primary" />}
          </button>
        ))}
        <button type="button" onClick={openCreate} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="plus" className="w-4 text-center" /> {translate({ key: 'workspaces.shell.createProject' })}</button>
        <div className="my-1 h-px bg-divider" />
        <div className="px-2.5 py-1.5 text-xs font-medium text-muted">{translate({ key: 'workspaces.shell.services' })}</div>
        {services.length === 0
          ? <div className="px-2.5 pb-1 text-xs text-disabled">{translate({ key: 'workspaces.shell.noServices' })}</div>
          : services.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 hover:bg-container2">
              <span className="flex items-center gap-2 text-sm text-title truncate"><Icon name="diagram-project" className="text-xs text-muted" /> {s.name} <span className="text-xs text-disabled truncate">{s.path}</span></span>
              <button type="button" onClick={() => { deleteService(s.id); }} className="text-muted hover:text-wrong cursor-pointer shrink-0"><Icon name="trash" className="text-xs" /></button>
            </div>
          ))}
        <button type="button" onClick={openAddService} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="plus" className="w-4 text-center" /> {translate({ key: 'workspaces.shell.addService' })}</button>
      </Popover>
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

function ChatExecutionActions({ m, onReject, onAccept, acceptLabel, alignEnd = false }: { m: ChatMessage; onReject: () => void; onAccept: () => void; acceptLabel: string; alignEnd?: boolean }) {
  const translate = useTranslator();
  const align = alignEnd ? 'self-end' : 'shrink-0';
  if (m.executing) return <span className={`text-xs text-muted inline-flex items-center gap-1 ${align}`}><Icon name="spinner" className="animate-spin" /> {translate({ key: 'workspaces.shell.aiExecuting' })}</span>;
  if (m.accepted) return <span className={`text-xs text-correct inline-flex items-center gap-1 ${align}`}><Icon name="check" /> {translate({ key: 'workspaces.shell.aiAccepted' })}</span>;
  if (m.declined) return <span className={`text-xs text-muted inline-flex items-center gap-1 ${align}`}><Icon name="xmark" /> {translate({ key: 'workspaces.shell.aiDeclined' })}</span>;
  return (
    <span className={`flex items-center gap-1.5 ${align}`}>
      {m.executionError && <span className="text-xs text-wrong">{translate({ key: 'workspaces.shell.aiExecutionFailed' })}</span>}
      <button type="button" onClick={onReject} className="text-xs font-medium px-2 py-1 rounded-lg text-muted hover:text-title hover:bg-container2-hover cursor-pointer">{translate({ key: 'workspaces.shell.aiReject' })}</button>
      <button type="button" onClick={onAccept} className="text-xs font-medium px-2.5 py-1 rounded-lg bg-primary text-title-primary hover:bg-primary-hover cursor-pointer">{acceptLabel}</button>
    </span>
  );
}

function ChatBubble({ m, onAccept, onAcceptPlan, onReject, onApplyCopilot }: { m: ChatMessage; onAccept: (id: string, p: ChatProposal) => void; onAcceptPlan: (id: string, plan: ChatPlan) => void; onReject: (id: string) => void; onApplyCopilot: (d: CopilotDirective) => void }) {
  const translate = useTranslator();
  const mine = m.role === 'user';
  const animate = !mine && !typedMessages.has(m.id) && !m.pending;
  const { shown, typing } = useTypewriter(m.text, animate);
  useEffect(() => { if (!typing) typedMessages.add(m.id); }, [typing, m.id]);
  const p = m.proposal;
  const plan = m.plan;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_SOFT} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}>
        {!mine && <span className="w-6 h-6 shrink-0 mr-2 rounded-md bg-primary/12 text-primary text-xs flex items-center justify-center self-end"><Icon name="robot" /></span>}
        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${mine ? 'bg-primary text-title-primary' : 'bg-container2 text-common'}`}>
          {m.pending
            ? <span className="inline-flex gap-1 py-1">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-current opacity-40 motion-safe:animate-pulse" style={{ animationDelay: `${String(i * 150)}ms` }} />)}</span>
            : (mine ? m.text : shown)}
          {typing && <span className="ml-0.5 inline-block w-1.5 h-3.5 align-[-2px] bg-current opacity-50 motion-safe:animate-pulse" />}
        </div>
      </div>
      {p && (
        <div className="mt-1.5 ml-8 max-w-[80%] rounded-xl border border-primary-border bg-primary/8 p-2.5 flex items-center gap-2">
          <Icon name="wand-magic-sparkles" className="text-primary shrink-0" />
          <span className="text-xs text-title flex-1 min-w-0">{p.summary}</span>
          <ChatExecutionActions m={m} onReject={() => { onReject(m.id); }} onAccept={() => { onAccept(m.id, p); }} acceptLabel={translate({ key: 'workspaces.shell.aiAccept' })} />
        </div>
      )}
      {plan && (
        <div className="mt-1.5 ml-8 max-w-[80%] rounded-xl border border-primary-border bg-primary/8 p-2.5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Icon name="wand-magic-sparkles" className="text-primary shrink-0" />
            <span className="text-xs font-medium text-title flex-1 min-w-0">{plan.summary}</span>
          </div>
          <div className="flex flex-col gap-1">
            {plan.steps.map((s, i) => (
              <div key={`${s.op}:${s.summary}`} className="flex items-center gap-2 text-xs text-common">
                <span className="w-4 h-4 shrink-0 rounded bg-primary/15 text-primary text-[10px] flex items-center justify-center">{i + 1}</span>
                <span className="min-w-0 truncate">{s.summary}</span>
              </div>
            ))}
          </div>
          <ChatExecutionActions m={m} onReject={() => { onReject(m.id); }} onAccept={() => { onAcceptPlan(m.id, plan); }} acceptLabel={translate({ key: 'workspaces.shell.aiApprovePlan' })} alignEnd />
        </div>
      )}
      {/* #109 — AI-drives-UI copilot directive: a single "Apply" navigates (+ pre-fills) the target page. */}
      {m.copilot && (
        <div className="mt-1.5 ml-8 max-w-[80%] rounded-xl border border-primary-border bg-primary/8 p-2.5 flex items-center gap-2">
          <Icon name="wand-magic-sparkles" className="text-primary shrink-0" />
          <span className="text-xs text-title flex-1 min-w-0">{m.copilot.note}</span>
          <button type="button" onClick={() => { if (m.copilot) onApplyCopilot(m.copilot); }} className="text-xs font-medium px-2.5 py-1 rounded-lg bg-primary text-title-primary hover:bg-primary-hover cursor-pointer shrink-0">{translate({ key: 'workspaces.shell.aiApply' })}</button>
        </div>
      )}
    </motion.div>
  );
}

//? Remembered panel width (module-level so it survives close/reopen without
//? threading width through app state — keeps drag re-renders local to the panel).
let rememberedAiWidth = 340;

//? VO (DOCUMENTS_AND_SKILLS) — phone-first voice input: record via the PWA mic (MediaRecorder), upload
//? the clip, transcribe it (provider-abstracted STT), and hand the transcript back to prefill the chat.
//? Gracefully hidden when the browser has no mic/MediaRecorder (typing stays the path). One clip → one
//? transcript; no new verb (invariant #2). Own state machine: idle → recording → transcribing.
function VoiceMicButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const supported = 'MediaRecorder' in globalThis && typeof navigator !== 'undefined' && typeof navigator.mediaDevices.getUserMedia === 'function';
  if (!supported) return null;

  const stop = (): void => { recRef.current?.stop(); };
  const start = async (): Promise<void> => {
    const [err, stream] = await tryCatchClient(() => navigator.mediaDevices.getUserMedia({ audio: true }));
    if (err || !stream) { notify.error({ key: 'workspaces.voice.micDenied' }); return; }
    chunksRef.current = [];
    const rec = new MediaRecorder(stream);
    recRef.current = rec;
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      void (async () => {
        setState('transcribing');
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-${String(chunksRef.current.length)}.webm`, { type: 'audio/webm' });
        const uploaded = await uploadMedia(file, activeWorkspace.id);
        if (!uploaded) { setState('idle'); notify.error({ key: 'workspaces.voice.failed' }); return; }
        const [rerr, res] = await tryCatchClient(() => apiRequest({ name: 'workspaces/voiceTranscribe', version: 'v1', data: { workspaceId: activeWorkspace.id, audioUrl: uploaded.url } }));
        setState('idle');
        if (!rerr && res?.status === 'success') {
          const text = res.result.text.trim();
          if (text.length > 0) onTranscript(text);
          else notify.error({ key: 'workspaces.voice.empty' });
        } else notify.error({ key: 'workspaces.voice.failed' });
      })();
    };
    rec.start();
    setState('recording');
  };

  const busy = state === 'transcribing';
  return (
    <button
      type="button" disabled={busy}
      onClick={() => { if (state === 'recording') stop(); else void start(); }}
      title={translate({ key: state === 'recording' ? 'workspaces.voice.stop' : 'workspaces.voice.record' })}
      aria-label={translate({ key: state === 'recording' ? 'workspaces.voice.stop' : 'workspaces.voice.record' })}
      className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center cursor-pointer disabled:opacity-60 ${state === 'recording' ? 'bg-wrong text-title-primary animate-pulse' : 'bg-container2 text-common hover:bg-container2-hover'}`}
    >
      <Icon name={busy ? 'spinner' : (state === 'recording' ? 'stop' : 'microphone')} className={busy ? 'animate-spin' : ''} />
    </button>
  );
}

export function AIPanel({ onClose }: { onClose: () => void }) {
  const { suggestions, dismissSuggestion, acceptSuggestion, openTicket, chat, sendChat, acceptChatProposal, acceptChatPlan, rejectChatProposal, applyCopilot, aiRuns, isMobile, activeWorkspace, readiness } = useWorkspaces();
  const translate = useTranslator();
  const [tab, setTab] = useState<'chat' | 'suggestions' | 'activity'>('chat');
  const [draft, setDraft] = useState('');
  //? VO — "speak replies" opt-in: TTS-play each NEW assistant message (persisted per browser).
  const [speak, setSpeak] = useState(() => globalThis.localStorage.getItem('ws-voice-speak') === '1');
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!speak) return;
    const last = chat.at(-1);
    if (last?.role !== 'ai' || last.pending === true || last.text.trim().length === 0 || last.id === lastSpokenRef.current) return;
    lastSpokenRef.current = last.id;
    const text = last.text;
    void (async () => {
      const [err, res] = await tryCatchClient(() => apiRequest({ name: 'workspaces/voiceSynthesize', version: 'v1', data: { workspaceId: activeWorkspace.id, text } }));
      if (err || res?.status !== 'success' || res.result.stub) return;
      const audio = new Audio(`${backendUrl}${res.result.url}`);
      void audio.play().catch(() => { /* autoplay may be blocked until a user gesture */ });
    })();
  }, [chat, speak, activeWorkspace.id]);
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

  //? P-A — phone-first: on mobile the panel is a full-screen sheet (no width-drag, opacity fade); on desktop
  //? it's the resizable right-hand aside (animated WIDTH so the board's flex area resizes in lock-step). This
  //? makes the chat + approvals inbox actually reachable on a phone (the mobile "AI" tab previously showed
  //? nothing — the panel was `hidden lg:flex`).
  const anim = isMobile
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { width: 0, opacity: 0 }, animate: { width, opacity: 1 }, exit: { width: 0, opacity: 0 } };
  return (
    <motion.aside
      className={`relative shrink-0 overflow-hidden border-l border-divider bg-container1 ${isMobile ? 'fixed inset-0 z-50 flex' : 'hidden lg:flex'}`}
      {...anim}
      transition={dragging ? { duration: 0 } : PANEL_TRANSITION}
    >
      {!isMobile && (
        <div
          onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
          title={translate({ key: 'workspaces.shell.dragToResize' })}
          className={`absolute left-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize transition-colors ${dragging ? 'bg-primary/50' : 'hover:bg-primary/30'}`}
        />
      )}
      <div style={isMobile ? undefined : { width }} className={`h-full flex flex-col ${isMobile ? 'w-full' : ''}`}>
        <div className="flex items-center justify-between h-14 px-4 border-b border-divider">
          <div className="flex items-center gap-2 font-semibold text-title">
            <span className="w-7 h-7 rounded-lg bg-primary/12 text-primary flex items-center justify-center"><Icon name="robot" /></span>
            {translate({ key: 'workspaces.shell.workspaceAi' })}
          </div>
          <IconButton icon="xmark" onClick={onClose} />
        </div>
        <div className="flex items-center gap-1 px-3 h-11 border-b border-divider">
          <PanelTab label={translate({ key: 'workspaces.shell.chat' })} icon="comment" on={tab === 'chat'} onClick={() => { setTab('chat'); }} />
          <PanelTab label={translate({ key: 'workspaces.shell.suggestions' })} icon="robot" count={suggestions.length} on={tab === 'suggestions'} onClick={() => { setTab('suggestions'); }} />
          <PanelTab label={translate({ key: 'workspaces.shell.activity' })} icon="wave-square" count={aiRuns.length} on={tab === 'activity'} onClick={() => { setTab('activity'); }} />
        </div>
        {tab === 'chat' ? (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
              {/* No usable AI provider (no Claude CLI on the host AND no Gemini key) → every AI feature fails
                  or returns nothing. Say so where the user is about to ask, with the in-app fix + host hint. */}
              {!readiness.aiText && (
                <SetupNotice
                  variant="card"
                  icon="robot"
                  title={translate({ key: 'workspaces.setup.ai.title' })}
                  body={translate({ key: 'workspaces.setup.ai.why' })}
                  fix={{ cap: 'workspaceSettings', view: 'content/settings', tab: 'admin', cta: translate({ key: 'workspaces.setup.ai.cta' }) }}
                  hint={translate({ key: 'workspaces.setup.ai.hint' })}
                />
              )}
              {chat.map((m) => <ChatBubble key={m.id} m={m} onAccept={acceptChatProposal} onAcceptPlan={acceptChatPlan} onReject={rejectChatProposal} onApplyCopilot={applyCopilot} />)}
              {/* Q4 — capability starter-questions: surface what the product can do, tappable to ask. Shown
                  while the conversation is empty (just the greeting). The AI answers from the product-knowledge. */}
              {chat.length <= 1 && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <div className="text-xs text-muted px-1">{translate({ key: 'workspaces.shell.tryAsking' })}</div>
                  {(['capVideos', 'capNewProject', 'capPublish', 'capDesign'] as const).map((k) => (
                    <button key={k} type="button" onClick={() => { sendChat(translate({ key: `workspaces.shell.${k}` })); }} className="text-left text-sm text-common rounded-lg border border-container1-border bg-container2/40 px-3 py-1.5 hover:bg-container2 cursor-pointer">{translate({ key: `workspaces.shell.${k}` })}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-divider p-3 flex items-center gap-2">
              {/* VO — voice input: record → STT → prefill the chat draft (phone-first, PWA mic). */}
              <VoiceMicButton onTranscript={(t) => { setDraft((d) => (d.trim().length > 0 ? `${d} ${t}` : t)); }} />
              {/* VO — "speak replies" opt-in (TTS the Assistant's answers aloud). */}
              <button type="button" onClick={() => { setSpeak((s) => { const next = !s; globalThis.localStorage.setItem('ws-voice-speak', next ? '1' : '0'); return next; }); }} title={translate({ key: speak ? 'workspaces.voice.speakOn' : 'workspaces.voice.speakOff' })} aria-label={translate({ key: speak ? 'workspaces.voice.speakOn' : 'workspaces.voice.speakOff' })} className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center cursor-pointer ${speak ? 'bg-primary/15 text-primary' : 'bg-container2 text-muted hover:text-common'}`}><Icon name="volume-high" /></button>
              <input
                value={draft} onChange={(e) => { setDraft(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                placeholder={translate({ key: 'workspaces.shell.askAiPlaceholder' })}
                className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <button type="button" onClick={send} title={translate({ key: 'workspaces.shell.send' })} className="w-9 h-9 shrink-0 rounded-xl bg-primary text-title-primary flex items-center justify-center cursor-pointer hover:bg-primary-hover"><Icon name="paper-plane" /></button>
            </div>
          </>
        ) : (tab === 'suggestions' ? (
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {suggestions.length === 0 && <div className="text-center text-sm text-muted py-12">{translate({ key: 'workspaces.shell.allCaughtUp' })}</div>}
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.id} s={s} onOpenTicket={openTicket}
                onAccept={() => { acceptSuggestion(s.id); }}
                onDismiss={() => { dismissSuggestion(s.id); }}
              />
            ))}
          </div>
        ) : (
          <AiActivityFeed runs={aiRuns} />
        ))}
      </div>
    </motion.aside>
  );
}

//? The central AI-activity feed — every AI run (theme/design/interviewer/marketing/…) with its
//? prompt (our side) + reasoning/output + status. Lives IN the Workspace-AI panel (no second AI window).
function AiActivityFeed({ runs }: { runs: AiRun[] }) {
  const translate = useTranslator();
  if (runs.length === 0) return <div className="flex-1 overflow-y-auto p-3"><div className="text-center text-sm text-muted py-12">{translate({ key: 'workspaces.shell.noActivity' })}</div></div>;
  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      <div className="text-xs text-muted px-1 mb-1">{translate({ key: 'workspaces.shell.activityHint' })}</div>
      {runs.map((r) => <AiRunCard key={r.id} run={r} />)}
    </div>
  );
}

function AiRunCard({ run }: { run: AiRun }) {
  const translate = useTranslator();
  const [open, setOpen] = useState(false);
  const meta = `${new Date(run.createdAt).toLocaleTimeString()} · ${(run.ms / 1000).toFixed(1)}s · ${run.providerId}`;
  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-3">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${run.status === 'ok' ? 'bg-correct' : 'bg-wrong'}`} />
        <span className="text-sm font-medium text-title truncate flex-1">{run.label}</span>
      </div>
      <div className="text-[11px] text-muted mt-0.5">{meta}</div>
      <button type="button" onClick={() => { setOpen((o) => !o); }} className="text-[11px] text-primary hover:text-primary-hover cursor-pointer mt-1">{translate({ key: open ? 'workspaces.shell.hideDetails' : 'workspaces.shell.showDetails' })}</button>
      <Collapse open={open}>
        <div className="mt-2 flex flex-col gap-2">
          <div><div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">{translate({ key: 'workspaces.shell.ourPrompt' })}</div><div className="text-xs text-common whitespace-pre-wrap max-h-40 overflow-y-auto rounded-lg bg-container1 p-2">{run.prompt}</div></div>
          {run.status === 'ok'
            ? <div><div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">{translate({ key: 'workspaces.shell.reasoning' })}</div><div className="text-xs text-common whitespace-pre-wrap max-h-60 overflow-y-auto rounded-lg bg-container1 p-2">{run.output}</div></div>
            : <div className="text-xs text-wrong">{run.error ?? translate({ key: 'workspaces.shell.aiError' })}</div>}
        </div>
      </Collapse>
    </div>
  );
}

function SuggestionCard({ s, onOpenTicket, onAccept, onDismiss }: { s: AiSuggestion; onOpenTicket: (id: string) => void; onAccept: () => void; onDismiss: () => void }) {
  const translate = useTranslator();
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
        <button type="button" onClick={onAccept} className="rounded-lg bg-primary px-3 h-8 text-sm font-medium text-title-primary hover:bg-primary-hover cursor-pointer">{translate({ key: 'workspaces.shell.accept' })}</button>
        <button type="button" onClick={onDismiss} className="rounded-lg px-3 h-8 text-sm font-medium text-common hover:bg-container2 cursor-pointer">{translate({ key: 'workspaces.shell.dismiss' })}</button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- mobile bottom bar */
export function MobileBottomBar({ onFab }: { onFab: () => void }) {
  const { view, navigate, activeWorkspace, aiOpen, toggleAi } = useWorkspaces();
  let active = view;
  if (aiOpen) active = 'ai';
  else if (isTicketView(view)) active = 'board';
  //? Module gating: drop the dev-only sections a content/design workspace turned off;
  //? 'ai' is non-gateable and always kept.
  const items: NavDef[] = [
    { id: 'board', icon: 'table-columns', label: 'Board' },
    { id: 'terminals', icon: 'terminal', label: 'Terminals' },
    { id: 'activity', icon: 'wave-square', label: 'Activity' },
    { id: 'ai', icon: 'robot', label: 'AI' },
  ].filter((it) => isSectionEnabled(activeWorkspace.enabledSections, it.id));
  return (
    <nav className="md:hidden flex items-center justify-around h-16 border-t border-divider bg-container1 relative shrink-0">
      {items.map((it, i) => (
        <div key={it.id} className="contents">
          {i === 2 && (
            <button type="button" onClick={onFab} aria-label="New" className="w-12 h-12 -mt-6 rounded-full bg-primary text-title-primary shadow-lg flex items-center justify-center cursor-pointer">
              <Icon name="plus" className="text-lg" />
            </button>
          )}
          <button type="button" onClick={() => { if (it.id === 'ai') { toggleAi(); } else { navigate(it.id); } }} className={`flex flex-col items-center justify-center gap-1 flex-1 h-full text-xs cursor-pointer ${active === it.id ? 'text-primary' : 'text-muted'}`}>
            <Icon name={it.icon} className="text-lg" /> {it.label}
          </button>
        </div>
      ))}
    </nav>
  );
}
