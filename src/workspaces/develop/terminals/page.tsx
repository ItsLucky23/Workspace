//? intent: Terminals — a live shell inside each running ticket container: watch what the AI and its
//? processes are doing, or step in and type yourself. One terminal per running ticket, shown one at a
//? time by default (phone-friendly tab strip with status dots); the grid layout + drag-resize stay
//? available as the demoted desktop view preference. Access uses the logged-in session, workspace RBAC
//? and the exact server-derived ticket-container identity; SSH keys are not an additional gate.

import { useEffect, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { AnimatePresence, motion } from 'motion/react';

import Icon from '../../_components/Icon';
import { SPRING_SOFT } from '../../_components/motion';
import { EmptyState, FOCUS_RING, Segmented, statusColorVar } from '../../_components/primitives';
import { SetupNotice } from '../../_components/SetupNotice';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import TerminalPanel from './TerminalPanel';
import type { Terminal, TicketStatus } from '../../_data/types';

type Layout = 'tabs' | 'grid';

function termStatus(t: Terminal): TicketStatus {
  if (t.processes.some((p) => p.status === 'stuck')) return 'stuck';
  if (t.processes.some((p) => p.status === 'needs-input')) return 'needs-input';
  return t.processes.some((p) => p.status === 'busy') ? 'busy' : 'idle';
}

export const template = 'workspaces';

export default function Terminals() {
  const translate = useTranslator();
  const { currentUser, navigate, activeWorkspace, readiness } = useWorkspaces();
  //? Tabs (one fill-height terminal at a time) is the phone-friendly DEFAULT; grid is the
  //? demoted desktop preference behind the Segmented (hidden at phone width — a view
  //? preference, not an action).
  const [layout, setLayout] = useState<Layout>('tabs');
  const [activeTab, setActiveTab] = useState('');
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  //? Live container terminals: one shell per RUNNING ticket container (docker exec via
  //? the ws-term relay). Polled so a container that spins up on stage-activation appears
  //? without a manual refresh. Authorization is enforced by the server from the session,
  //? workTickets capability and exact workspace/ticket container labels.
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/containerTerminals', version: 'v1', data: { workspaceId: activeWorkspace.id } }));
      if (cancelled || error || res?.status !== 'success') return;
      setTerminals(res.result.containers.map((c) => ({
        ticketId: c.ticketKey, stage: 'container',
        processes: [{ name: 'shell', status: 'idle' as const, cwd: '/work', exit: '', lines: [] }],
      })));
    };
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeWorkspace.id]);

  //? Tabs mode always shows a panel: fall back to the FIRST terminal when nothing is
  //? selected yet or the selected container stopped (the old '' state rendered an empty
  //? view until a tab was clicked).
  const shownTab = terminals.some((t) => t.ticketId === activeTab) ? activeTab : (terminals[0]?.ticketId ?? '');

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <div className={`flex items-start justify-between gap-3 px-4 md:px-6 py-3 md:py-4`}>
        <div className={`min-w-0`}>
          <div className={`flex items-center gap-3 flex-wrap`}>
            <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.terminals.title' })}</h1>
          </div>
          <p className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.terminals.subtitle' })}</p>
        </div>
        {terminals.length > 0 && (
          <div className={`hidden md:block shrink-0`}>
            <Segmented<Layout>
              value={layout}
              onChange={setLayout}
              options={[{ id: 'tabs', label: <><Icon name="table-columns" /> {translate({ key: 'workspaces.terminals.layoutTabs' })}</> }, { id: 'grid', label: <><Icon name="table-cells-large" /> {translate({ key: 'workspaces.terminals.layoutGrid' })}</> }]}
            />
          </div>
        )}
      </div>

      {/* A container shell only exists once a ticket provisions one — which silently can't happen when Docker
          is down (host) or no repo is linked (nothing to clone). Name the real reason instead of "no tickets". */}
      {terminals.length === 0 && !readiness.docker && (
        <SetupNotice
          icon="server"
          title={translate({ key: 'workspaces.setup.docker.title' })}
          body={translate({ key: 'workspaces.setup.docker.why' })}
          hint={translate({ key: 'workspaces.setup.docker.hint' })}
        />
      )}
      {terminals.length === 0 && readiness.docker && !readiness.repoLinked && (
        <SetupNotice
          icon="terminal"
          title={translate({ key: 'workspaces.setup.repo.title' })}
          body={translate({ key: 'workspaces.setup.repo.why' })}
          fix={{ cap: 'workspaceSettings', view: 'workspace', tab: 'repository', cta: translate({ key: 'workspaces.setup.repo.cta' }) }}
        />
      )}
      {terminals.length === 0 && readiness.docker && readiness.repoLinked && (
        <EmptyState
          icon="terminal"
          title={translate({ key: 'workspaces.terminals.emptyTitle' })}
          sub={translate({ key: 'workspaces.terminals.emptyBody' })}
          action={
            <button type="button" onClick={() => { navigate('pipeline'); }} className={`text-sm font-medium text-primary hover:underline cursor-pointer`}>
              {translate({ key: 'workspaces.terminals.emptyHint' })}
            </button>
          }
        />
      )}

      {terminals.length > 0 && layout === 'tabs' && (
        <div className={`flex-1 min-h-0 flex flex-col px-4 md:px-6 pb-6`}>
          <div className={`flex items-center gap-1 mb-3 shrink-0 overflow-x-auto ws-no-scrollbar`}>
            {terminals.map((t) => (
              <button key={t.ticketId} type="button" onClick={() => { setActiveTab(t.ticketId); }}
                className={`flex items-center gap-2 rounded-lg px-3 h-8 text-sm font-mono whitespace-nowrap cursor-pointer transition-colors ${FOCUS_RING} ${shownTab === t.ticketId ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>
                <span className={`w-1.5 h-1.5 rounded-full`} style={{ background: statusColorVar(termStatus(t)) }} />
                {t.ticketId}
              </button>
            ))}
          </div>
          {terminals.filter((t) => t.ticketId === shownTab).map((t) => <TerminalPanel key={t.ticketId} workspaceId={activeWorkspace.id} terminal={t} viewerName={currentUser.name} fill />)}
        </div>
      )}

      {/* gap-fix: maximize/restore used to swap the whole content area with an unconditional
          replace — the same jarring 'options block' pop the audit flagged elsewhere, at page-region
          scale. A fade+scale AnimatePresence around the two branches makes both directions read as
          one panel growing/shrinking instead of a hard cut (a shared layoutId was ruled out — see
          board/page.tsx's note on that crashing React 19's reconciler across an unmount boundary). */}
      {terminals.length > 0 && layout === 'grid' && (
        // mode="wait": both branches are flex-1 flex items, so overlapping an exit+enter would
        // double up in the flex row for a frame (see PageTransition's identical note in motion.tsx).
        <AnimatePresence mode="wait" initial={false}>
          {maximizedId === null ? (
            <motion.div key="grid" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={SPRING_SOFT}
              className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-6`}>
              <div className={`grid grid-cols-1 xl:grid-cols-2 gap-3`}>
                {terminals.map((t) => <TerminalPanel key={t.ticketId} workspaceId={activeWorkspace.id} terminal={t} viewerName={currentUser.name} onToggleMaximize={() => { setMaximizedId(t.ticketId); }} />)}
              </div>
            </motion.div>
          ) : (
            <motion.div key="maximized" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={SPRING_SOFT}
              className={`flex-1 min-h-0 flex flex-col px-4 md:px-6 pb-6`}>
              {terminals.filter((t) => t.ticketId === maximizedId).map((t) => (
                <TerminalPanel key={t.ticketId} workspaceId={activeWorkspace.id} terminal={t} viewerName={currentUser.name} fill isMaximized onToggleMaximize={() => { setMaximizedId(null); }} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
