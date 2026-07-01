//? Workspaces — mobile-only chrome: top header (back / hamburger, workspace
//? name, search, avatar) + slide-in nav drawer. Hidden on md+ (the nav rail +
//? top bar take over there).

import { useState } from 'react';

import { AnimatePresence, motion } from 'motion/react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { SPRING_SHEET } from '../_components/motion';
import { AvatarBubble } from '../_components/primitives';
import { NAV_BOTTOM, NAV_ITEMS } from './Shell';
import { isTicketView, useWorkspaces } from './WorkspacesContext';

export function MobileHeader({ onCmdK }: { onCmdK: () => void }) {
  const translate = useTranslator();
  const { view, navigate, currentUser, activeWorkspace } = useWorkspaces();
  const [drawer, setDrawer] = useState(false);
  const onTicket = isTicketView(view);

  return (
    <>
      <header className="md:hidden flex items-center gap-2 h-14 px-3 border-b border-divider bg-container1 shrink-0">
        {onTicket ? (
          <button type="button" onClick={() => { navigate('board'); }} className="flex items-center gap-1 text-sm text-common cursor-pointer"><Icon name="angle-left" /> {translate({ key: 'workspaces.mobileChrome.board' })}</button>
        ) : (
          <button type="button" onClick={() => { setDrawer(true); }} className="w-9 h-9 flex items-center justify-center rounded-xl text-common hover:bg-container2 cursor-pointer"><Icon name="bars" /></button>
        )}
        <button type="button" className="flex items-center gap-2 ml-1 text-sm font-semibold text-title">
          <span className="w-5 h-5 rounded-md bg-primary text-title-primary text-[11px] font-bold flex items-center justify-center">{activeWorkspace.name[0]}</span>
          {activeWorkspace.name} <Icon name="caret-down" className="text-xs text-muted" />
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onCmdK} className="w-9 h-9 flex items-center justify-center rounded-xl text-common hover:bg-container2 cursor-pointer"><Icon name="magnifying-glass" /></button>
        <AvatarBubble user={currentUser} size={30} />
      </header>

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
              {[...NAV_ITEMS, ...NAV_BOTTOM].map((it) => (
                <button key={it.id} type="button" onClick={() => { navigate(it.id); setDrawer(false); }}
                  className={`flex items-center gap-3 rounded-xl h-11 px-3 text-sm font-medium transition-colors cursor-pointer ${view === it.id ? 'bg-container2 text-title' : 'text-common hover:bg-container2'}`}>
                  <span className="w-5 text-center"><Icon name={it.icon} /></span> {it.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
