//? Workspaces — the persistent shell chrome (nav rail, top/tab bars, AI panel,
//? mobile chrome, search palette + the contextual back row). Rendered by the
//? `workspaces` template around the routed page content (`children`). Reads shared
//? state via `useWorkspaces()`; owns only its own local UI (nav-rail expand,
//? search-palette open). One instance stays mounted across the ws routes.

import { useEffect, useState } from 'react';

import { AnimatePresence, motion, MotionConfig } from 'motion/react';

import { AIPanel, MobileBottomBar, NavRail, TabBar, TopBar } from './Shell';
import { MobileHeader } from './MobileChrome';
import { Onboarding } from './Onboarding';
import { useWorkspaces } from './WorkspacesContext';
import SearchPalette from '../_components/SearchPalette';
import { PageTransition } from '../_components/motion';
import Icon from '../_components/Icon';
import { useTranslator } from '@luckystack/core/client';

//? Intentional no-op for handlers whose feature lands in Fase 2 (the mobile FAB
//? action). Module-scoped so it's a stable prop reference.
const noop = (): void => { /* Fase 2: mobile FAB */ };

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

  const openSearch = () => { setSearchOpen(true); };

  //? Until the first snapshot lands we don't yet know whether the user has a
  //? workspace, so render a neutral spinner — NOT the shell chrome (which would
  //? flash a "has-workspace" board for a frame before onboarding takes over) and
  //? NOT onboarding (which would flash for existing users). Only once `loading`
  //? clears do we branch: zero workspaces → onboarding takeover; otherwise → shell.
  if (ctx.loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <span className="w-6 h-6 rounded-full border-2 border-container2-border border-t-primary animate-spin" />
      </div>
    );
  }
  if (ctx.workspaces.length === 0) return <Onboarding />;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full w-full bg-background text-title overflow-hidden">
        <NavRail expanded={expanded} setExpanded={setExpanded} />
        <div className="flex-1 flex flex-col min-w-0">
          <MobileHeader onCmdK={openSearch} />
          <TopBar onCmdK={openSearch} />
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
              {/* open-ticket tabs — inside the content column so they don't overlap the AI panel */}
              <TabBar />
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
                {/* Consistent premium page-enter animation for every routed page (one place). */}
                <PageTransition routeKey={ctx.view}>
                  {children}
                </PageTransition>
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
