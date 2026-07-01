//? Workspaces — Terminals page. Always-dark multi-terminal workspace, gated on
//? the account's SSH key (managed in Account settings — there is no app-load
//? login). If no key is linked the unlock card stays, but "Unlock with SSH key"
//? takes you to Account to add one. Once linked, the active SSH identity
//? (123 → test, 456 → mathijs) drives the terminals and is shown per panel.
//? Terminals are grouped per ticket; process sub-tabs switch instances.

import { useState } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import XtermTerminal from '../_components/XtermTerminal';
import { EmptyState, PopMenu, Segmented, StatusPill } from '../_components/primitives';
import { MEMBERS, TERMINALS } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { Terminal, TicketStatus } from '../_data/types';

type Layout = 'grid' | 'tabs';

function termStatus(t: Terminal): TicketStatus {
  if (t.processes.some((p) => p.status === 'stuck')) return 'stuck';
  if (t.processes.some((p) => p.status === 'needs-input')) return 'needs-input';
  return t.processes.some((p) => p.status === 'busy') ? 'busy' : 'idle';
}

function TerminalPanel({ terminal, sshUser, className }: { terminal: Terminal; sshUser: string; className?: string }) {
  const [active, setActive] = useState(0);
  const proc = terminal.processes[active] ?? terminal.processes[0]!;
  const sessionId = `${terminal.ticketId}:${proc.name}`;
  const menuItems = [
    { label: 'Restart', icon: 'play' as const, onClick: () => {} },
    { label: 'Clear', icon: 'xmark' as const, onClick: () => {} },
    { label: 'Rename', icon: 'file-lines' as const, onClick: () => {} },
    { label: 'Copy buffer', icon: 'copy' as const, onClick: () => {} },
    { divider: true },
    { label: 'Kill', icon: 'triangle-exclamation' as const, danger: true, onClick: () => void menuHandler.confirm({ title: `Kill ${terminal.ticketId} · ${proc.name}?`, content: 'The process is terminated. You can restart it after.' }) },
  ];
  return (
    <div className={`flex flex-col rounded-xl overflow-hidden border border-container1-border bg-terminal-bg ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2 bg-terminal-surface px-3 h-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-terminal-text">{terminal.ticketId}</span>
          <span className="text-xs text-terminal-muted truncate">· {terminal.stage}</span>
          <StatusPill status={proc.status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-mono text-terminal-muted"><Icon name="user" /> {sshUser}</span>
          <div className="flex items-center gap-1">
            {terminal.processes.map((p, i) => (
              <button key={p.name} type="button" onClick={() => setActive(i)}
                className={`rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors ${i === active ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}>
                {p.name}
              </button>
            ))}
          </div>
          <PopMenu items={menuItems} triggerClass="w-7 h-7 flex items-center justify-center rounded-lg text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer" />
        </div>
      </div>
      <XtermTerminal key={sessionId} sessionId={sessionId} className="flex-1 min-h-0" />
      <div className="flex items-center justify-between bg-terminal-surface border-t border-white/5 px-3 h-7 shrink-0 text-[11px] font-mono text-terminal-muted">
        <span>{sshUser}@{terminal.ticketId.toLowerCase()}:{proc.cwd}</span>
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-terminal-green" /> live</span>
      </div>
    </div>
  );
}

function SshLocked({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-2xl border border-container1-border bg-container1 p-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-warning/15 text-warning flex items-center justify-center mx-auto mb-4 text-xl"><Icon name="terminal" /></div>
        <div className="text-base font-semibold text-title">Terminals locked</div>
        <p className="text-sm text-muted mt-1.5">Opening a terminal is shell access to a container, so it needs an SSH key linked to your account.</p>
        <div className="mt-4">
          <button type="button" onClick={onGoToSettings} className="inline-flex items-center gap-2 rounded-xl bg-primary text-title-primary px-4 h-9 text-sm font-medium hover:bg-primary-hover cursor-pointer">
            <Icon name="check" /> Unlock with SSH key
          </button>
        </div>
        <p className="text-xs text-muted mt-3">Takes you to Account → SSH keys.</p>
      </div>
    </div>
  );
}

export default function Terminals() {
  const { sshUserId, navigate } = useWorkspaces();
  const [layout, setLayout] = useState<Layout>('grid');
  const [activeTab, setActiveTab] = useState(TERMINALS[0]?.ticketId ?? '');
  const sshUserName = sshUserId ? (MEMBERS[sshUserId]?.name ?? sshUserId) : '';
  const unlocked = sshUserId !== null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold text-title">Terminals</h1>
          {unlocked && <span className="inline-flex items-center gap-1.5 rounded-lg bg-container2 px-2 h-7 text-xs font-medium text-common"><Icon name="user" /> ssh: {sshUserName}</span>}
        </div>
        {unlocked && TERMINALS.length > 0 && (
          <Segmented<Layout>
            value={layout}
            onChange={setLayout}
            options={[{ id: 'grid', label: <><Icon name="table-cells-large" /> Grid</> }, { id: 'tabs', label: <><Icon name="table-columns" /> Tabs</> }]}
          />
        )}
      </div>

      {!unlocked && <SshLocked onGoToSettings={() => navigate('settings')} />}

      {unlocked && TERMINALS.length === 0 && (
        <EmptyState icon="terminal" title="No terminals running" sub="Activate a ticket to attach a live terminal." />
      )}

      {unlocked && TERMINALS.length > 0 && layout === 'grid' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {TERMINALS.map((t) => <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} className="h-80" />)}
          </div>
        </div>
      )}

      {unlocked && TERMINALS.length > 0 && layout === 'tabs' && (
        <div className="flex-1 min-h-0 flex flex-col px-4 md:px-6 pb-6">
          <div className="flex items-center gap-1 mb-3 overflow-x-auto ws-no-scrollbar">
            {TERMINALS.map((t) => (
              <button key={t.ticketId} type="button" onClick={() => setActiveTab(t.ticketId)}
                className={`flex items-center gap-2 rounded-lg px-3 h-8 text-sm font-mono whitespace-nowrap cursor-pointer transition-colors ${activeTab === t.ticketId ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: `var(--color-${termStatus(t) === 'busy' ? 'primary' : termStatus(t) === 'stuck' || termStatus(t) === 'needs-input' ? 'warning' : 'muted'})` }} />
                {t.ticketId}
              </button>
            ))}
          </div>
          {TERMINALS.filter((t) => t.ticketId === activeTab).map((t) => <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} className="flex-1 min-h-0" />)}
        </div>
      )}
    </div>
  );
}
