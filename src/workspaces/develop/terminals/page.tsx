//? Workspaces — Terminals page. Always-dark multi-terminal workspace, gated on
//? the account's SSH key (managed in Account settings — there is no app-load
//? login). If no key is linked the unlock card stays, but "Unlock with SSH key"
//? takes you to Account to add one. Once linked, the active SSH identity
//? (123 → test, 456 → mathijs) drives the terminals and is shown per panel.
//? Terminals are grouped per ticket; process sub-tabs switch instances.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { apiRequest, tryCatch, i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import XtermTerminal, { clearSession, copySessionBuffer, killSession, restartSession } from '../../_components/XtermTerminal';
import { EmptyState, PopMenu, Segmented, StatusPill } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { Terminal, TicketStatus } from '../../_data/types';

type Layout = 'grid' | 'tabs';

function termStatus(t: Terminal): TicketStatus {
  if (t.processes.some((p) => p.status === 'stuck')) return 'stuck';
  if (t.processes.some((p) => p.status === 'needs-input')) return 'needs-input';
  return t.processes.some((p) => p.status === 'busy') ? 'busy' : 'idle';
}

//? Remembered grid-panel height (module-level so a drag persists across remounts
//? and layout switches without threading height through page state — mirrors the
//? AI panel's rememberedAiWidth pattern in Shell.tsx). Bigger default than before.
let rememberedGridHeight = 460;
const MIN_PANEL_HEIGHT = 220;
const MAX_PANEL_HEIGHT = 900;


function TerminalPanel({ terminal, sshUser, fill = false, isMaximized = false, onToggleMaximize }: { terminal: Terminal; sshUser: string; fill?: boolean; isMaximized?: boolean; onToggleMaximize?: () => void }) {
  const translate = useTranslator();
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(rememberedGridHeight);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const proc = terminal.processes[active] ?? terminal.processes[0];
  if (!proc) return null;
  const sessionId = `${terminal.ticketId}:${proc.name}`;

  //? Drag the bottom strip to resize the panel height. Clamp to a sane range and
  //? remember the last height at module level. Pointer-capture keeps the drag
  //? tracking even when the cursor leaves the thin handle (mirrors AIPanel).
  const onHandleDown = (e: ReactPointerEvent) => {
    dragRef.current = { startY: e.clientY, startH: height };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const next = Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, dragRef.current.startH + (e.clientY - dragRef.current.startY)));
    rememberedGridHeight = next;
    setHeight(next);
  };
  const onHandleUp = () => { dragRef.current = null; setDragging(false); };

  //? #14 — the panel-menu actions now operate on the live xterm session (were `Fase 2` no-ops):
  //? restart/kill emit to the ws-term relay; clear/copyBuffer are client-side. Rename was dropped (no
  //? persistence path — the session name mirrors the snapshot process name).
  const copyBuffer = () => {
    const text = copySessionBuffer(sessionId);
    if (text.length === 0) { notify.error({ key: 'workspaces.terminals.copyEmpty' }); return; }
    void navigator.clipboard.writeText(text).then(() => { notify.success({ key: 'workspaces.terminals.copied' }); }, () => { notify.error({ key: 'workspaces.terminals.copyFailed' }); });
  };
  const menuItems = [
    { label: translate({ key: 'workspaces.terminals.restart' }), icon: 'play' as const, onClick: () => { restartSession(sessionId); } },
    { label: translate({ key: 'workspaces.terminals.clear' }), icon: 'xmark' as const, onClick: () => { clearSession(sessionId); } },
    { label: translate({ key: 'workspaces.terminals.copyBuffer' }), icon: 'copy' as const, onClick: copyBuffer },
    { divider: true },
    { label: translate({ key: 'workspaces.terminals.kill' }), icon: 'triangle-exclamation' as const, danger: true, onClick: () => { void menuHandler.confirm({ title: translate({ key: 'workspaces.terminals.killConfirmTitle', params: [{ key: 'ticket', value: terminal.ticketId }, { key: 'proc', value: proc.name }] }), content: translate({ key: 'workspaces.terminals.killConfirmContent' }) }).then((ok) => { if (ok) killSession(sessionId); }); } },
  ];
  return (
    <div style={fill ? undefined : { height }} className={`relative flex flex-col rounded-xl overflow-hidden border border-container1-border bg-terminal-bg ${fill ? 'flex-1 min-h-0' : ''}`}>
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
              <button key={p.name} type="button" onClick={() => { setActive(i); }}
                className={`rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors ${i === active ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}>
                {p.name}
              </button>
            ))}
          </div>
          {onToggleMaximize && (
            <button type="button" onClick={onToggleMaximize}
              title={translate({ key: isMaximized ? 'workspaces.terminals.restoreTitle' : 'workspaces.terminals.maximizeTitle' })}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer">
              <Icon name={isMaximized ? 'table-cells-large' : 'up-right-from-square'} />
            </button>
          )}
          <PopMenu items={menuItems} triggerClass="w-7 h-7 flex items-center justify-center rounded-lg text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer" />
        </div>
      </div>
      <XtermTerminal key={sessionId} sessionId={sessionId} className="flex-1 min-h-0" container={terminal.container} />
      <div className="flex items-center justify-between bg-terminal-surface border-t border-white/5 px-3 h-7 shrink-0 text-[11px] font-mono text-terminal-muted">
        <span>{sshUser}@{terminal.ticketId.toLowerCase()}:{proc.cwd}</span>
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-terminal-green" /> {translate({ key: 'workspaces.terminals.live' })}</span>
      </div>
      {!fill && (
        <div onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
          title={translate({ key: 'workspaces.terminals.resizeTitle' })}
          className="group shrink-0 h-2.5 flex items-center justify-center cursor-ns-resize bg-terminal-surface border-t border-white/5">
          <span className={`w-8 h-0.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-terminal-muted/50 group-hover:bg-terminal-muted'}`} />
        </div>
      )}
    </div>
  );
}

function SshLocked({ onGoToSettings }: { onGoToSettings: () => void }) {
  const translate = useTranslator();
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-2xl border border-container1-border bg-container1 p-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-warning/15 text-warning flex items-center justify-center mx-auto mb-4 text-xl"><Icon name="terminal" /></div>
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.terminals.lockedTitle' })}</div>
        <p className="text-sm text-muted mt-1.5">{translate({ key: 'workspaces.terminals.lockedDescription' })}</p>
        <div className="mt-4">
          <button type="button" onClick={onGoToSettings} className="inline-flex items-center gap-2 rounded-xl bg-primary text-title-primary px-4 h-9 text-sm font-medium hover:bg-primary-hover cursor-pointer">
            <Icon name="check" /> {translate({ key: 'workspaces.terminals.unlockWithSshKey' })}
          </button>
        </div>
        <p className="text-xs text-muted mt-3">{translate({ key: 'workspaces.terminals.takesYouToAccount' })}</p>
      </div>
    </div>
  );
}

export const template = 'workspaces';

export default function Terminals() {
  const translate = useTranslator();
  const { sshUserId, navigate, membersById, activeWorkspace } = useWorkspaces();
  const [layout, setLayout] = useState<Layout>('grid');
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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.terminals.title' })}</h1>
          {unlocked && <span className="inline-flex items-center gap-1.5 rounded-lg bg-container2 px-2 h-7 text-xs font-medium text-common"><Icon name="user" /> {translate({ key: 'workspaces.terminals.sshLabel', params: [{ key: 'name', value: sshUserName }] })}</span>}
        </div>
        {terminals.length > 0 && (
          <Segmented<Layout>
            value={layout}
            onChange={setLayout}
            options={[{ id: 'grid', label: <><Icon name="table-cells-large" /> {translate({ key: 'workspaces.terminals.layoutGrid' })}</> }, { id: 'tabs', label: <><Icon name="table-columns" /> {translate({ key: 'workspaces.terminals.layoutTabs' })}</> }]}
          />
        )}
      </div>

      {!unlocked && terminals.length === 0 && <SshLocked onGoToSettings={() => { navigate('settings'); }} />}

      {unlocked && terminals.length === 0 && (
        <EmptyState icon="terminal" title={translate({ key: 'workspaces.terminals.emptyTitle' })} sub={translate({ key: 'workspaces.terminals.emptySub' })} />
      )}

      {terminals.length > 0 && layout === 'grid' && maximizedId !== null && (
        <div className="flex-1 min-h-0 flex flex-col px-4 md:px-6 pb-6">
          {terminals.filter((t) => t.ticketId === maximizedId).map((t) => (
            <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} fill isMaximized onToggleMaximize={() => { setMaximizedId(null); }} />
          ))}
        </div>
      )}

      {terminals.length > 0 && layout === 'grid' && maximizedId === null && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {terminals.map((t) => <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} onToggleMaximize={() => { setMaximizedId(t.ticketId); }} />)}
          </div>
        </div>
      )}

      {terminals.length > 0 && layout === 'tabs' && (
        <div className="flex-1 min-h-0 flex flex-col px-4 md:px-6 pb-6">
          <div className="flex items-center gap-1 mb-3 overflow-x-auto ws-no-scrollbar">
            {terminals.map((t) => (
              <button key={t.ticketId} type="button" onClick={() => { setActiveTab(t.ticketId); }}
                className={`flex items-center gap-2 rounded-lg px-3 h-8 text-sm font-mono whitespace-nowrap cursor-pointer transition-colors ${activeTab === t.ticketId ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: `var(--color-${termStatus(t) === 'busy' ? 'primary' : (termStatus(t) === 'stuck' || termStatus(t) === 'needs-input' ? 'warning' : 'muted')})` }} />
                {t.ticketId}
              </button>
            ))}
          </div>
          {terminals.filter((t) => t.ticketId === activeTab).map((t) => <TerminalPanel key={t.ticketId} terminal={t} sshUser={sshUserName} fill />)}
        </div>
      )}
    </div>
  );
}
