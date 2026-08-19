//? Workspaces — the persistent shell chrome (nav rail, top/tab bars, AI panel,
//? mobile chrome, search palette + the contextual back row). Rendered by the
//? `workspaces` template around the routed page content (`children`). Reads shared
//? state via `useWorkspaces()`; owns only its own local UI (nav-rail expand,
//? search-palette open). One instance stays mounted across the ws routes.

import { useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { AnimatePresence, motion, MotionConfig } from 'motion/react';

import { AIPanel, MobileBottomBar, NavRail, NAV_ITEMS, OfflineBanner, PausedBanner, TabBar, TopBar } from './Shell';
import { MobileHeader } from './MobileChrome';
import { Onboarding } from './Onboarding';
import { useWorkspaces } from './WorkspacesContext';
import SearchPalette from '../_components/SearchPalette';
import SetupChecklist from '../_components/SetupChecklist';
import { PageTransition, Sheet } from '../_components/motion';
import Icon from '../_components/Icon';
import { GATEABLE_SECTIONS, isSectionEnabled } from '../_data/modules';
import { WsButton } from '../_components/primitives';
import { useTranslator } from '@luckystack/core/client';

//? Where the setup checklist may appear: the two category INDEX pages a user lands on. Showing it
//? above every view would make it a nag; showing it on only one would hide it from a content-only
//? workspace, whose board is gated away.
const LANDING_VIEWS = new Set(['board', 'content']);

//? Paths the module gate must never bounce, because what they hold is not what their path suggests.
//? `content/settings` is the only one today: its Admin tab carries the workspace-wide AI and media
//? provider keys, which every module needs and only this page can set.
const UNGATED_PATHS: readonly string[] = ['content/settings'];

//? The views where the FAB's context-dependent "new" means a CONTENT piece; every other view
//? creates a ticket (falling back to a piece when the dev module is off for this workspace).
const CONTENT_FAB_VIEWS = new Set<string>(['content', 'scheduled-posts', 'sources', 'marketing', 'studio', 'knowledge']);

//? Mobile FAB action — a minimal bottom-sheet: one title input, creating the thing that fits the
//? current view (board/backlog/… → quick-add ticket, content-ish views → content piece).
//? Reuses the shared `Sheet` primitive (bottom slide + backdrop) instead of a raw conditional div —
//? every sibling sheet in this app already animates in; this one popped in/out instantly.
function MobileFabSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const translate = useTranslator();
  const { view, activeWorkspace, quickAdd, createContentPiece, navigate } = useWorkspaces();
  const [title, setTitle] = useState('');
  const devOn = isSectionEnabled(activeWorkspace.enabledSections, 'board');
  const kind: 'ticket' | 'piece' = CONTENT_FAB_VIEWS.has(view) || !devOn ? 'piece' : 'ticket';
  const submit = () => {
    const t = title.trim();
    if (t.length === 0) return;
    if (kind === 'ticket') {
      quickAdd({ title: t });
      if (view !== 'board' && view !== 'backlog') navigate('board');
    } else {
      createContentPiece({ title: t, brief: t });
      if (view !== 'content') navigate('content');
    }
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} side="bottom" className="md:hidden p-4 pb-6 flex flex-col gap-3">
      <div className="text-sm font-medium text-title">{translate({ key: kind === 'ticket' ? 'workspaces.wsShell.fabNewTicket' : 'workspaces.wsShell.fabNewPiece' })}</div>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the sheet exists only to type this title; focusing it is the intent */}
      <input autoFocus value={title} onChange={(e) => { setTitle(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={translate({ key: 'workspaces.wsShell.fabTitlePlaceholder' })} className="h-11 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg text-sm text-muted hover:text-common cursor-pointer">{translate({ key: 'workspaces.wsShell.fabCancel' })}</button>
        <WsButton icon="plus" disabled={title.trim().length === 0} onClick={submit}>{translate({ key: 'workspaces.wsShell.fabCreate' })}</WsButton>
      </div>
    </Sheet>
  );
}

export function WorkspacesShell({ children }: { children: React.ReactNode }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [expanded, setExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);

  //? ⌘K / Ctrl-K opens the search palette anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => { globalThis.removeEventListener('keydown', onKey); };
  }, []);

  //? Module gating (modules.ts): if the active view is a section this workspace has
  //? turned OFF (e.g. a content-only workspace defaulting to the hidden 'board'),
  //? redirect to the first still-visible nav section so the user never lands on a
  //? section their modules don't include. Ticket views + non-gateable views pass through.
  const { loading, workspaces, activeWorkspace, view, navigate } = ctx;
  const location = useLocation();
  useEffect(() => {
    if (loading || workspaces.length === 0) return;
    //? `/workspaces/content/settings` derives the view `content`, which is gateable — so this guard
    //? bounced every visitor whose workspace has no Content module. That page holds the workspace-WIDE
    //? provider keys (the AI key, the media keys) behind its Admin tab, so the bounce made the single
    //? most important setting in the product unreachable on a Development-only workspace — including
    //? from the setup checklist's very first row, and from five other "fix this" buttons that all
    //? point at it. It is a settings page that happens to live under a content path, not content.
    if (UNGATED_PATHS.some((path) => location.pathname.startsWith(`/workspaces/${path}`))) return;
    if (!GATEABLE_SECTIONS.includes(view) || isSectionEnabled(activeWorkspace.enabledSections, view)) return;
    const firstEnabled = NAV_ITEMS.find((it) => isSectionEnabled(activeWorkspace.enabledSections, it.id));
    if (firstEnabled) navigate(firstEnabled.id);
  }, [loading, workspaces.length, activeWorkspace, view, navigate, location.pathname]);

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
              {/* emergency-stop banner — persistent across every view, mobile + desktop */}
              {/* B1 — connection/queued-write state, above every view (phone + desktop). */}
              <OfflineBanner />
              <PausedBanner />
              {/* ADR 0314 — the standing "finish setting up this workspace" list, on the landing view
                  only. It retires itself once everything measurable is done, and it is the front door
                  the per-feature SetupNotice/EmptyPicker affordances never had: those explain a gap
                  once you have already walked into it. */}
              {LANDING_VIEWS.has(ctx.view) && <SetupChecklist />}
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
          <MobileBottomBar onFab={() => { setFabOpen(true); }} />
        </div>
      </div>
      <MobileFabSheet open={fabOpen} onClose={() => { setFabOpen(false); }} />
      <SearchPalette open={searchOpen} onClose={() => { setSearchOpen(false); }} />
    </MotionConfig>
  );
}
