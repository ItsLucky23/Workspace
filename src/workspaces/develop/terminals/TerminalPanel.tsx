//? Terminals — one live terminal panel (extracted from page.tsx in the KISS pass).
//? Header: ticket key + stage + StatusPill + process sub-tabs + optional maximize
//? toggle + the per-panel PopMenu (restart / clear / copy buffer / kill — kill keeps
//? its menuHandler.confirm dialog). Body: the REAL xterm session; the sessionId
//? contract is `${ticketId}:${proc.name}` keyed with key={sessionId} + the container
//? prop — changing it orphans live ws-term relay sessions. Footer: ssh identity +
//? cwd (collapses to just the live dot on phone). Grid mode adds the drag-resize
//? handle (desktop-only; fill/tabs mode omits it). Always-dark terminal tokens.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import XtermTerminal, { clearSession, copySessionBuffer, killSession, restartSession } from '../../_components/XtermTerminal';
import { PopMenu, StatusPill } from '../../_components/primitives';
import type { Terminal } from '../../_data/types';

//? Remembered grid-panel height (module-level so a drag persists across remounts
//? and layout switches without threading height through page state — mirrors the
//? AI panel's rememberedAiWidth pattern in Shell.tsx).
let rememberedGridHeight = 460;
const MIN_PANEL_HEIGHT = 220;
const MAX_PANEL_HEIGHT = 900;

export default function TerminalPanel({ terminal, sshUser, fill = false, isMaximized = false, onToggleMaximize }: { terminal: Terminal; sshUser: string; fill?: boolean; isMaximized?: boolean; onToggleMaximize?: () => void }) {
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

  //? #14 — the panel-menu actions operate on the live xterm session: restart/kill emit
  //? to the ws-term relay; clear/copyBuffer are client-side. Rename was dropped (no
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
      <div className={`flex items-center justify-between gap-2 bg-terminal-surface px-3 h-10 shrink-0`}>
        <div className={`flex items-center gap-2 min-w-0`}>
          <span className={`font-mono text-xs text-terminal-text`}>{terminal.ticketId}</span>
          <span className={`text-xs text-terminal-muted truncate`}>· {terminal.stage}</span>
          <StatusPill status={proc.status} />
        </div>
        <div className={`flex items-center gap-2`}>
          <span className={`hidden md:inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-mono text-terminal-muted`}><Icon name="user" /> {sshUser}</span>
          <div className={`flex items-center gap-1`}>
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
              className={`w-7 h-7 flex items-center justify-center rounded-lg text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer`}>
              <Icon name={isMaximized ? 'table-cells-large' : 'up-right-from-square'} />
            </button>
          )}
          <PopMenu items={menuItems} triggerClass={`w-7 h-7 flex items-center justify-center rounded-lg text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer`} />
        </div>
      </div>
      <XtermTerminal key={sessionId} sessionId={sessionId} className={`flex-1 min-h-0`} container={terminal.container} />
      <div className={`flex items-center justify-between gap-2 bg-terminal-surface border-t border-white/5 px-3 h-7 shrink-0 text-[11px] font-mono text-terminal-muted`}>
        <span className={`hidden sm:block min-w-0 truncate`}>{sshUser}@{terminal.ticketId.toLowerCase()}:{proc.cwd}</span>
        <span className={`inline-flex items-center gap-1 shrink-0 ml-auto`}><span className={`w-1.5 h-1.5 rounded-full bg-terminal-green`} /> {translate({ key: 'workspaces.terminals.live' })}</span>
      </div>
      {!fill && (
        <div onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
          title={translate({ key: 'workspaces.terminals.resizeTitle' })}
          className={`group shrink-0 h-2.5 hidden md:flex items-center justify-center cursor-ns-resize bg-terminal-surface border-t border-white/5`}>
          <span className={`w-8 h-0.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-terminal-muted/50 group-hover:bg-terminal-muted'}`} />
        </div>
      )}
    </div>
  );
}
