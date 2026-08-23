//? Workspaces — mobile-only chrome: top header (back / hamburger, workspace
//? name, search, avatar) + slide-in nav drawer. Hidden on md+ (the nav rail +
//? top bar take over there).

import { useState } from 'react';

import { AnimatePresence, motion } from 'motion/react';

import { apiRequest, i18nNotify as notify, useTranslator, useUpdateLanguage, getActiveLanguage } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { SPRING_SHEET } from '../_components/motion';
import { AvatarBubble, IconButton } from '../_components/primitives';
import { isSectionEnabled } from '../_data/modules';
import { menuHandler } from 'src/_functions/menuHandler';

import { CreateProjectForm, CreateWorkspaceForm, formatUnreadCount, GROUP_ORDER, NAV_BOTTOM, NAV_ITEMS, NotificationList, openWorkspaceNotification } from './Shell';
import { isTicketView, useWorkspaces } from './WorkspacesContext';

const LANGUAGES = ['en', 'nl', 'de', 'fr'] as const;
type Language = typeof LANGUAGES[number];
const isLanguage = (value: string): value is Language => LANGUAGES.includes(value as Language);

export function MobileHeader({ onCmdK }: { onCmdK: () => void }) {
  const translate = useTranslator();
  const { view, navigate, openTicket, currentUser, activeWorkspace, workspaces, setActiveWorkspace, createWorkspace, notifications, unreadNotifications, markNotificationRead, markAllNotificationsRead, toggleAi, projects, activeProjectId, setActiveProject, createProject, createFromTemplate, templates, theme, setTheme, signOut } = useWorkspaces();
  const updateLanguage = useUpdateLanguage();
  const initialLanguage = getActiveLanguage();
  const [activeLang, setActiveLang] = useState<Language>(() => (isLanguage(initialLanguage) ? initialLanguage : 'en'));
  const [drawer, setDrawer] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const onTicket = isTicketView(view);

  //? #116/#120 — notification navigation, iconography and unread formatting are shared with desktop.

  return (
    <>
      <header className="md:hidden flex items-center gap-2 h-14 px-3 border-b border-divider bg-container1 shrink-0">
        {onTicket ? (
          <button type="button" onClick={() => { navigate('board'); }} className="flex items-center gap-1 text-sm text-common cursor-pointer"><Icon name="angle-left" /> {translate({ key: 'workspaces.mobileChrome.board' })}</button>
        ) : (
          <IconButton icon="bars" onClick={() => { setDrawer(true); }} title={translate({ key: 'workspaces.shell.menu' })} size="touch" />
        )}
        {/* GAP_SCAN B2 — this had a caret but no handler: on a phone there was no way to reach the
            workspace list at all. It now opens the drawer, which owns switching AND creating. */}
        <button type="button" onClick={() => { setDrawer(true); }} className="flex items-center gap-2 ml-1 min-h-11 text-sm font-semibold text-title cursor-pointer">
          <span className="w-5 h-5 rounded-md bg-primary text-title-primary text-[11px] font-bold flex items-center justify-center">{activeWorkspace.name[0]}</span>
          {activeWorkspace.name} <Icon name="caret-down" className="text-xs text-muted" />
        </button>
        <div className="flex-1" />
        <IconButton icon="magnifying-glass" onClick={onCmdK} title={translate({ key: 'workspaces.shell.search' })} size="touch" />
        {/* #116 — the notification bell was desktop-only; a phone user can now see + clear notifications.
            Kept as a raw button (not IconButton): the unread-count badge needs a child slot the shared
            primitive doesn't expose — bumped to the same 44px touch target by hand. */}
        <button type="button" onClick={() => { setNotifOpen(true); }} className="relative w-11 h-11 flex items-center justify-center rounded-xl text-common hover:bg-container2 cursor-pointer" title={translate({ key: 'workspaces.shell.notifications' })}>
          <Icon name="bell" />
          {unreadNotifications > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-wrong text-[10px] font-bold text-title-primary flex items-center justify-center">{formatUnreadCount(unreadNotifications)}</span>}
        </button>
        <AvatarBubble user={currentUser} size={30} />
      </header>

      <AnimatePresence>
        {notifOpen && (
          <>
            <motion.div className="md:hidden fixed inset-0 z-40 bg-overlay" onClick={() => { setNotifOpen(false); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            <motion.div className="md:hidden fixed inset-x-0 bottom-0 z-50 max-h-[70vh] bg-container1 border-t border-divider rounded-t-2xl p-4 flex flex-col gap-2"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={SPRING_SHEET}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.shell.notifications' })}</span>
                {unreadNotifications > 0 && <button type="button" onClick={markAllNotificationsRead} className="text-xs font-medium text-primary hover:text-primary-hover cursor-pointer">{translate({ key: 'workspaces.shell.markAllRead' })}</button>}
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col gap-1">
                <NotificationList
                  notifications={notifications}
                  empty={translate({ key: 'workspaces.shell.noNotifications' })}
                  onOpen={(n) => { openWorkspaceNotification(n, { openTicket, navigate, markNotificationRead, close: () => { setNotifOpen(false); } }); }}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div className="md:hidden fixed inset-0 z-40 bg-overlay" onClick={() => { setDrawer(false); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            <motion.div className="md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-container1 border-r border-divider p-3 flex flex-col gap-1"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={SPRING_SHEET}>
              <div className="flex items-center gap-2 px-2 h-12 mb-1">
                <span className="w-8 h-8 rounded-lg bg-primary text-title-primary flex items-center justify-center font-bold">{translate({ key: 'workspaces.mobileChrome.logoInitial' })}</span>
                <span className="font-semibold text-title">{translate({ key: 'workspaces.mobileChrome.appName' })}</span>
              </div>
              {/* Gap-fix: the drawer now module-gates like the desktop rail (it showed Board on a
                  design-only workspace, and tapping it bounced straight back). */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-1">
                {/* UI restructure — the drawer mirrors the rail's five groups with a small header per
                    group, instead of one flat list of fifteen. On a phone the whole group is shown (no
                    accordion): tapping twice to reach a page is worse than scrolling once. */}
                {GROUP_ORDER.map((g) => {
                  const items = NAV_ITEMS.filter((it) => it.group === g && isSectionEnabled(activeWorkspace.enabledSections, it.id));
                  if (items.length === 0) return null;
                  return (
                    <div key={g} className="flex flex-col gap-1">
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-disabled">{translate({ key: `workspaces.nav.${g}` })}</div>
                      {items.map((it) => (
                        <button key={it.id} type="button" onClick={() => { navigate(it.id); setDrawer(false); }}
                          className={`flex items-center gap-3 rounded-xl h-11 px-3 text-sm font-medium transition-colors cursor-pointer ${view === it.id ? 'bg-container2 text-title' : 'text-common hover:bg-container2'}`}>
                          <span className="w-5 text-center"><Icon name={it.icon} /></span> {translate({ key: `workspaces.nav.${it.id}` })}
                        </button>
                      ))}
                    </div>
                  );
                })}
                {/* F-022 — 'ai' is the panel toggle, not a route (there is no /workspaces/ai); the rail and the
                    bottom bar special-case it, the drawer navigated to the error page. */}
                {NAV_BOTTOM.filter((it) => isSectionEnabled(activeWorkspace.enabledSections, it.id)).map((it) => (
                  <button key={it.id} type="button" onClick={() => { if (it.id === 'ai') toggleAi(); else navigate(it.id); setDrawer(false); }}
                    className={`flex items-center gap-3 rounded-xl h-11 px-3 text-sm font-medium transition-colors cursor-pointer ${view === it.id ? 'bg-container2 text-title' : 'text-common hover:bg-container2'}`}>
                    <span className="w-5 text-center"><Icon name={it.icon} /></span> {translate({ key: `workspaces.nav.${it.id}` })}
                  </button>
                ))}
              </div>
              {/* Gap-fix: the phone had NO way to switch workspace (desktop-only dropdown) — the drawer
                  now lists them; the active one is highlighted. */}
              {/* B2 — the workspace section is no longer gated on having 2+: a phone can now CREATE a
                  second/third workspace, which previously required a desktop (the switcher lived in a
                  `hidden md:flex` header). */}
              {/* F-023 — phone-first product, desktop-only ProjectSwitcher: the drawer now lists the workspace's
                  projects (tap = switch) and can create one via the same form the TopBar opens. */}
              {projects.length > 0 && (
                <div className="shrink-0 border-t border-divider pt-2 flex flex-col gap-1 max-h-44 overflow-y-auto">
                  <span className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{translate({ key: 'workspaces.mobileChrome.projects' })}</span>
                  {projects.map((p) => (
                    <button key={p.id} type="button" onClick={() => { setActiveProject(p.id); setDrawer(false); }}
                      className={`flex items-center gap-2.5 rounded-xl h-10 px-3 text-sm font-medium transition-colors cursor-pointer ${p.id === activeProjectId ? 'bg-container2 text-title' : 'text-common hover:bg-container2'}`}>
                      <span className="w-6 h-6 flex items-center justify-center shrink-0"><Icon name="diagram-project" className="text-xs text-secondary" /></span>
                      <span className="truncate">{p.name}</span>
                      {p.id === activeProjectId && <Icon name="check" className="ml-auto text-xs text-primary" />}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setDrawer(false); void menuHandler.open(<CreateProjectForm onCreate={createProject} templates={templates} onCreateFromTemplate={createFromTemplate} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); }}
                    className="flex items-center gap-2.5 rounded-xl h-11 px-3 text-sm font-medium text-common hover:bg-container2 transition-colors cursor-pointer">
                    <span className="w-6 h-6 flex items-center justify-center shrink-0"><Icon name="plus" /></span>
                    <span className="truncate">{translate({ key: 'workspaces.shell.createProject' })}</span>
                  </button>
                </div>
              )}
              <div className="shrink-0 border-t border-divider pt-2 flex flex-col gap-1 max-h-56 overflow-y-auto">
                  <span className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{translate({ key: 'workspaces.mobileChrome.switchWorkspace' })}</span>
                  {workspaces.map((w) => (
                    <button key={w.id} type="button" onClick={() => { setActiveWorkspace(w.id); setDrawer(false); }}
                      className={`flex items-center gap-2.5 rounded-xl h-10 px-3 text-sm font-medium transition-colors cursor-pointer ${w.id === activeWorkspace.id ? 'bg-container2 text-title' : 'text-common hover:bg-container2'}`}>
                      <span className="w-6 h-6 rounded-md bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">{w.name[0]}</span>
                      <span className="truncate">{w.name}</span>
                      {w.id === activeWorkspace.id && <Icon name="check" className="ml-auto text-xs text-primary" />}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setDrawer(false); void menuHandler.open(<CreateWorkspaceForm onCreate={createWorkspace} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); }}
                    className="flex items-center gap-2.5 rounded-xl h-11 px-3 text-sm font-medium text-common hover:bg-container2 transition-colors cursor-pointer">
                    <span className="w-6 h-6 flex items-center justify-center shrink-0"><Icon name="plus" /></span>
                  <span className="truncate">{translate({ key: 'workspaces.shell.createWorkspace' })}</span>
                </button>
              </div>
              <div className="shrink-0 border-t border-divider pt-2 flex flex-col gap-1">
                <div className="flex items-center gap-2 px-3 py-2">
                  <AvatarBubble user={currentUser} size={28} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-title truncate">{currentUser.name}</div><div className="text-xs text-muted truncate">{currentUser.email}</div></div>
                </div>
                <button type="button" onClick={() => { setDrawer(false); navigate('settings'); }} className="flex items-center gap-3 rounded-xl h-11 px-3 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name="user" className="w-5 text-center" /> {translate({ key: 'workspaces.shell.account' })}</button>
                <button type="button" onClick={() => { const nextTheme = theme === 'dark' ? 'light' : 'dark'; setTheme(nextTheme); void apiRequest({ name: 'settings/updateUser', version: 'v1', data: { theme: nextTheme } }).then((response) => { if (response.status !== 'success') notify.error({ key: 'settings.failedUpdateUser' }); }); }} className="flex items-center gap-3 rounded-xl h-11 px-3 text-sm text-common hover:bg-container2 cursor-pointer"><Icon name={theme === 'dark' ? 'sun' : 'moon'} className="w-5 text-center" /> {translate({ key: 'workspaces.shell.themeLabel', params: [{ key: 'theme', value: theme }] })}</button>
                <div className="flex items-center gap-3 px-3 py-2 text-sm text-common"><Icon name="language" className="w-5 text-center" /><span>{translate({ key: 'workspaces.account.language' })}</span><div className="flex items-center gap-1 ml-auto">{LANGUAGES.map((code) => <button key={code} type="button" onClick={() => { const previous = activeLang; setActiveLang(code); updateLanguage(code); void apiRequest({ name: 'settings/updateUser', version: 'v1', data: { language: code } }).then((response) => { if (response.status === 'success') return; setActiveLang(previous); updateLanguage(previous); notify.error({ key: 'settings.failedUpdateUser' }); }); }} className={`rounded-md px-1.5 py-0.5 text-xs uppercase cursor-pointer ${activeLang === code ? 'bg-primary text-common-primary' : 'text-muted hover:bg-container2 hover:text-common'}`}>{code}</button>)}</div></div>
                <button type="button" onClick={() => { setDrawer(false); signOut(); }} className="flex items-center gap-3 rounded-xl h-11 px-3 text-sm text-wrong hover:bg-wrong/10 cursor-pointer"><Icon name="right-from-bracket" className="w-5 text-center" /> {translate({ key: 'workspaces.shell.signOut' })}</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
