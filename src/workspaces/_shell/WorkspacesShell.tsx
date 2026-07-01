//? Workspaces — the persistent shell chrome (nav rail, top/tab bars, AI panel,
//? mobile chrome, search palette + the contextual back row). Rendered by the
//? `workspaces` template around the routed page content (`children`). Reads shared
//? state via `useWorkspaces()`; owns only its own local UI (nav-rail expand,
//? search-palette open). One instance stays mounted across the ws routes.

import { useEffect, useState } from 'react';

import { AnimatePresence, motion, MotionConfig } from 'motion/react';

import { AIPanel, MobileBottomBar, NavRail, TabBar, TopBar } from './Shell';
import { MobileHeader } from './MobileChrome';
import { useWorkspaces } from './WorkspacesContext';
import SearchPalette from '../_components/SearchPalette';
import Icon from '../_components/Icon';
import { useTranslator } from '@luckystack/core/client';

export function WorkspacesShell({ children }: { children: React.ReactNode }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [expanded, setExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  //? ⌘K / Ctrl-K opens the search palette anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => { globalThis.removeEventListener('keydown', onKey); };
  }, []);

  const noop = () => {};
  const openSearch = () => { setSearchOpen(true); };

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full w-full bg-background text-title overflow-hidden">
        <NavRail expanded={expanded} setExpanded={setExpanded} />
        <div className="flex-1 flex flex-col min-w-0">
          <MobileHeader onCmdK={openSearch} />
          <TopBar onCmdK={openSearch} onNotifications={noop} />
          <TabBar onAiToggle={ctx.toggleAi} />
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
              {/* contextual back row — only when a reference was followed */}
              <AnimatePresence initial={false}>
                {ctx.canGoBack && (
                  <motion.div key="backbar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden border-b border-divider bg-background">
                    <div className="px-4 md:px-6 py-2">
                      <button type="button" onClick={ctx.goBack} className="inline-flex items-center gap-2 rounded-lg pl-2 pr-3 h-8 text-sm text-common hover:bg-container2 cursor-pointer">
                        <Icon name="arrow-left" /> {translate({ key: 'workspaces.wsShell.back' })}{ctx.backLabel ? translate({ key: 'workspaces.wsShell.backTo', params: [{ key: 'label', value: ctx.backLabel }] }) : ''}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex-1 min-h-0">
                {children}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {ctx.aiOpen && <AIPanel key="ai" onClose={ctx.toggleAi} />}
            </AnimatePresence>
          </div>
          <MobileBottomBar onFab={noop} />
        </div>
      </div>
      <SearchPalette open={searchOpen} onClose={() => { setSearchOpen(false); }} />
    </MotionConfig>
  );
}
