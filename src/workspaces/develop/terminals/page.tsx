//? intent: Terminals — a live shell inside each running ticket container: watch what the AI and its
//? processes are doing, or step in and type yourself. One terminal per running ticket, shown one at a
//? time by default (phone-friendly tab strip with status dots); the grid layout + drag-resize stay
//? available as the demoted desktop view preference. Container shells need NO SSH key — the SSH-unlock
//? card only appears when no key is linked AND nothing is running, and routes to Account settings.

import { useEffect, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { EmptyState, Segmented, statusColorVar, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import TerminalPanel from './TerminalPanel';
import type { Terminal, TicketStatus } from '../../_data/types';

type Layout = 'tabs' | 'grid';

function termStatus(t: Terminal): TicketStatus {
  if (t.processes.some((p) => p.status === 'stuck')) return 'stuck';
  if (t.processes.some((p) => p.status === 'needs-input')) return 'needs-input';
  return t.processes.some((p) => p.status === 'busy') ? 'busy' : 'idle';
}

function SshLocked({ onGoToSettings }: { onGoToSettings: () => void }) {
  const translate = useTranslator();
  return (
    <div className={`flex-1 flex items-center justify-center p-6`}>
      <div className={`max-w-sm w-full rounded-2xl border border-container1-border bg-container1 p-6 text-center`}>
        <div className={`w-12 h-12 rounded-xl bg-warning/15 text-warning flex items-center justify-center mx-auto mb-4 text-xl`}><Icon name="terminal" /></div>
        <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.terminals.lockedTitle' })}</div>
        <p className={`text-sm text-muted mt-1.5`}>{translate({ key: 'workspaces.terminals.lockedDescription' })}</p>
        <div className={`mt-4`}>
          <WsButton icon="check" onClick={onGoToSettings}>{translate({ key: 'workspaces.terminals.unlockWithSshKey' })}</WsButton>
        </div>
        <p className={`text-xs text-muted mt-3`}>{translate({ key: 'workspaces.terminals.takesYouToAccount' })}</p>
      </div>
    </div>
  );
}

export const template = 'workspaces';

export default function Terminals() {
  const translate = useTranslator();
  const { sshUserId, navigate, membersById, activeWorkspace } = useWorkspaces();
  //? Tabs (one fill-height terminal at a time) is the phone-friendly DEFAULT; grid is the
  //? demoted desktop preference behind the Segmented (hidden at phone width — a view
  //? preference, not an action).
  const [layout, setLayout] = useState<Layout>('tabs');
  const [activeTab, setActiveTab] = useState('');
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const sshUserName = sshUserId ? (membersById[sshUserId]?.name ?? sshUserId) : '';
  const unlocked = sshUserId !== null;

  //? Live container terminals: one shell per RUNNING ticket container (docker exec via
  //? the ws-term relay). Polled so a container that spins up on stage-activation appears
  //? without a manual refresh. These need NO SSH key — that gate is for the legacy
  //? dev host-shell model; a container shell is isolated.
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/containerTerminals', version: 'v1', data: { workspaceId: activeWorkspace.id } }));
      if (cancelled || error || res?.status !== 'success') return;
      setTerminals(res.result.containers.map((c) => ({
        ticketId: c.ticketKey, stage: 'container', container: c.container,
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
            {unlocked && <span className={`inline-flex items-center gap-1.5 rounded-lg bg-container2 px-2 h-7 text-xs font-medium text-common`}><Icon name="user" /> {translate({ key: 'workspaces.terminals.sshLabel', params: [{ key: 'name', value: sshUserName }] })}</span>}
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

      {!unlocked && terminals.length === 0 && <SshLocked onGoToSettings={() => { navigate('settings'); }} />}

      {unlocked && terminals.length === 0 && (
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
                className={`flex items-center gap-2 rounded-lg px-3 h-8 text-sm font-mono whitespace-nowrap cursor-pointer transition-colors ${shownTab === t.ticketId ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>
                <span className={`w-1.5 h-1.5 rounded-full`} style={{ background: statusColorVar(termStatus(t)) }} />
                {t.ticketId}
              </button>
            ))}
          </div>
          {terminals.filter((t) => t.ticketId === shownTab).map((t) => <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} fill />)}
        </div>
      )}

      {terminals.length > 0 && layout === 'grid' && maximizedId !== null && (
        <div className={`flex-1 min-h-0 flex flex-col px-4 md:px-6 pb-6`}>
          {terminals.filter((t) => t.ticketId === maximizedId).map((t) => (
            <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} fill isMaximized onToggleMaximize={() => { setMaximizedId(null); }} />
          ))}
        </div>
      )}

      {terminals.length > 0 && layout === 'grid' && maximizedId === null && (
        <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-6`}>
          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-3`}>
            {terminals.map((t) => <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} onToggleMaximize={() => { setMaximizedId(t.ticketId); }} />)}
          </div>
        </div>
      )}
    </div>
  );
}
