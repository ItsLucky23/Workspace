//? Workspaces — mobile-only chrome: top header (back / hamburger, workspace
//? name, search, avatar) + slide-in nav drawer. Hidden on md+ (the nav rail +
//? top bar take over there).

import { useState } from 'react';

import { AnimatePresence, motion } from 'motion/react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { SPRING_SHEET } from '../_components/motion';
import { AvatarBubble } from '../_components/primitives';
import { isSectionEnabled } from '../_data/modules';
import { menuHandler } from 'src/_functions/menuHandler';

import { CreateWorkspaceForm, NAV_BOTTOM, NAV_ITEMS } from './Shell';
import { isTicketView, useWorkspaces } from './WorkspacesContext';

export function MobileHeader({ onCmdK }: { onCmdK: () => void }) {
  const translate = useTranslator();
  const { view, navigate, openTicket, currentUser, activeWorkspace, workspaces, setActiveWorkspace, createWorkspace, notifications, unreadNotifications, markNotificationRead, markAllNotificationsRead } = useWorkspaces();
  const [drawer, setDrawer] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const onTicket = isTicketView(view);

  //? #116/#120 — tapping a notification follows its deep-link (open the ticket / view), marks it read,
  //? and closes the sheet. Falls back to just marking read when there is no deep-link.
  const openNotification = (n: (typeof notifications)[number]) => {
    const link = n.deepLink;
    if (link?.ticketId) openTicket(link.ticketId);
    else if (link?.view) navigate(link.view);
    markNotificationRead(n.id);
    setNotifOpen(false);
  };

  return (
    <>
      <header className="md:hidden flex items-center gap-2 h-14 px-3 border-b border-divider bg-container1 shrink-0">
        {onTicket ? (
          <button type="button" onClick={() => { navigate('board'); }} className="flex items-center gap-1 text-sm text-common cursor-pointer"><Icon name="angle-left" /> {translate({ key: 'workspaces.mobileChrome.board' })}</button>
        ) : (
          <button type="button" aria-label="Menu" onClick={() => { setDrawer(true); }} className="w-9 h-9 flex items-center justify-center rounded-xl text-common hover:bg-container2 cursor-pointer"><Icon name="bars" /></button>
        )}
        {/* GAP_SCAN B2 — this had a caret but no handler: on a phone there was no way to reach the
            workspace list at all. It now opens the drawer, which owns switching AND creating. */}
        <button type="button" onClick={() => { setDrawer(true); }} className="flex items-center gap-2 ml-1 min-h-11 text-sm font-semibold text-title cursor-pointer">
          <span className="w-5 h-5 rounded-md bg-primary text-title-primary text-[11px] font-bold flex items-center justify-center">{activeWorkspace.name[0]}</span>
          {activeWorkspace.name} <Icon name="caret-down" className="text-xs text-muted" />
        </button>
        <div className="flex-1" />
        <button type="button" aria-label="Search" onClick={onCmdK} className="w-9 h-9 flex items-center justify-center rounded-xl text-common hover:bg-container2 cursor-pointer"><Icon name="magnifying-glass" /></button>
        {/* #116 — the notification bell was desktop-only; a phone user can now see + clear notifications. */}
        <button type="button" onClick={() => { setNotifOpen(true); }} className="relative w-9 h-9 flex items-center justify-center rounded-xl text-common hover:bg-container2 cursor-pointer" title={translate({ key: 'workspaces.shell.notifications' })}>
          <Icon name="bell" />
          {unreadNotifications > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-wrong text-[10px] font-bold text-title-primary flex items-center justify-center">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
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
                {notifications.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted">{translate({ key: 'workspaces.shell.noNotifications' })}</div>}
                {notifications.map((n) => (
                  <button key={n.id} type="button" onClick={() => { openNotification(n); }}
                    className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors cursor-pointer hover:bg-container2 ${n.read ? '' : 'bg-primary/5'}`}>
                    <span className="text-sm font-medium text-title">{n.title}</span>
                    {n.body.length > 0 && <span className="text-xs text-muted">{n.body}</span>}
                  </button>
                ))}
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
                {[...NAV_ITEMS, ...NAV_BOTTOM].filter((it) => isSectionEnabled(activeWorkspace.enabledSections, it.id)).map((it) => (
                  <button key={it.id} type="button" onClick={() => { navigate(it.id); setDrawer(false); }}
                    className={`flex items-center gap-3 rounded-xl h-11 px-3 text-sm font-medium transition-colors cursor-pointer ${view === it.id ? 'bg-container2 text-title' : 'text-common hover:bg-container2'}`}>
                    <span className="w-5 text-center"><Icon name={it.icon} /></span> {it.label}
                  </button>
                ))}
              </div>
              {/* Gap-fix: the phone had NO way to switch workspace (desktop-only dropdown) — the drawer
                  now lists them; the active one is highlighted. */}
              {/* B2 — the workspace section is no longer gated on having 2+: a phone can now CREATE a
                  second/third workspace, which previously required a desktop (the switcher lived in a
                  `hidden md:flex` header). */}
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
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
