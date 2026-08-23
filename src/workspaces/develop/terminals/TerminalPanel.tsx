//? Terminals — one live terminal panel (extracted from page.tsx in the KISS pass).
//? Header: ticket key + process sub-tabs + optional maximize toggle + the per-panel PopMenu
//? (restart / clear / copy buffer / kill — kill keeps its menuHandler.confirm dialog). Body:
//? the REAL xterm session; the sessionId contract is `${workspaceId}:${ticketId}:${proc.name}`
//? keyed with key={sessionId} + the container prop — changing it orphans live ws-term relay
//? sessions. Grid mode adds the drag-resize handle (desktop-only; fill/tabs mode omits it).
//? Always-dark terminal tokens.

import { useEffect, useRef, useState } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import XtermTerminal, { clearSession, copySessionBuffer, killSession, restartSession } from '../../_components/XtermTerminal';
import { FOCUS_RING, PopMenu } from '../../_components/primitives';
import { useRememberedPanelHeight } from '../../_components/useRememberedPanelHeight';
import type { Terminal, TerminalProcess } from '../../_data/types';

//? Ad-hoc shells are still remembered per ticket across panel remounts.
const rememberedAdHocShells = new Map<string, TerminalProcess[]>();

export default function TerminalPanel({ workspaceId, terminal, viewerName, fill = false, isMaximized = false, onToggleMaximize }: { workspaceId: string; terminal: Terminal; viewerName: string; fill?: boolean; isMaximized?: boolean; onToggleMaximize?: () => void }) {
  const translate = useTranslator();
  const [active, setActive] = useState(0);
  const { height, dragging, onPointerDown, onPointerMove, onPointerUp } = useRememberedPanelHeight('terminals', 460);
  //? Ad-hoc shells opened via the trailing '+' tab (gap-fix: the process list was a fixed, read-only
  //? container snapshot with no way to pop open one more shell alongside it). Keep the names outside
  //? this panel so tabs survive unmounts when the user switches terminal tabs or layouts.
  const adHocKey = `${workspaceId}:${terminal.ticketId}`;
  const [adHocShells, setAdHocShells] = useState<TerminalProcess[]>(() => rememberedAdHocShells.get(adHocKey) ?? []);
  const [addingShell, setAddingShell] = useState(false);
  const [draftShellName, setDraftShellName] = useState('');
  //? Escape sets this just before the programmatic blur() below, so the single onBlur handler
  //? knows to cancel instead of confirm — keeps "confirm on blur" as the ONE code path (Enter
  //? and click-away both resolve through it too) instead of racing two triggers on the same input.
  const cancelShellRef = useRef(false);
  //? Focus the name field the moment it opens (user-initiated, so a11y-safe — avoids the `autoFocus`
  //? prop the jsx-a11y rule bans for on-load focus; mirrors develop/answers/page.tsx's QueueCard).
  const shellNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (addingShell) shellNameRef.current?.focus(); }, [addingShell]);
  const allProcesses = [...terminal.processes, ...adHocShells];
  const proc = allProcesses[active] ?? allProcesses[0];
  if (!proc) return null;
  const sessionId = `${workspaceId}:${terminal.ticketId}:${proc.name}`;

  //? Confirms the inline name field on blur: same sessionId contract as any snapshot-derived
  //? process (`XtermTerminal` auto-starts a fresh shell in the container the first time that id
  //? connects), just with a user-chosen name instead. Blank input cancels; a taken name gets de-duped.
  const confirmNewShell = () => {
    const name = draftShellName.trim();
    setAddingShell(false);
    setDraftShellName('');
    if (!name) return;
    const taken = new Set(allProcesses.map((p) => p.name));
    let uniqueName = name;
    let suffix = 2;
    while (taken.has(uniqueName)) { uniqueName = `${name}-${String(suffix)}`; suffix += 1; }
    setActive(allProcesses.length);
    setAdHocShells((prev) => {
      const shell: TerminalProcess = { name: uniqueName, status: 'idle', cwd: proc.cwd, exit: '', lines: [] };
      const next = [...prev, shell];
      rememberedAdHocShells.set(adHocKey, next);
      return next;
    });
  };

  //? #14 — the panel-menu actions operate on the live xterm session: restart/kill emit
  //? to the ws-term relay; clear/copyBuffer are client-side. Rename was dropped (no
  //? persistence path — the session name mirrors the snapshot process name).
  const copyBuffer = () => {
    const text = copySessionBuffer(sessionId);
    if (text.length === 0) { notify.error({ key: 'workspaces.terminals.copyEmpty' }); return; }
    void navigator.clipboard.writeText(text).then(() => { notify.success({ key: 'workspaces.terminals.copied' }); }, () => { notify.error({ key: 'workspaces.terminals.copyFailed' }); });
  };
  const menuItems = [
    { label: translate({ key: 'workspaces.terminals.restart' }), icon: 'arrows-rotate' as const, onClick: () => { restartSession(sessionId); } },
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
        </div>
        <div className={`flex items-center gap-2 min-w-0`}>
          <span className={`hidden md:inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] text-terminal-muted shrink-0`}><Icon name="user" /> {viewerName}</span>
          {/* gap-fix: scrolls instead of wrapping/clipping under the panel's overflow-hidden on a
              narrow phone with 4+ processes; h-7 tabs clear the 24px WCAG touch-target minimum. */}
          <div className={`flex items-center gap-1 min-w-0 flex-1 overflow-x-auto ws-no-scrollbar`}>
            {allProcesses.map((p, i) => (
              <button key={p.name} type="button" onClick={() => { setActive(i); }}
                className={`shrink-0 rounded-md px-2.5 h-7 text-xs font-mono whitespace-nowrap cursor-pointer transition-colors ${FOCUS_RING} ${i === active ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}>
                {p.name}
              </button>
            ))}
            {addingShell ? (
              <input
                ref={shellNameRef}
                value={draftShellName}
                onChange={(e) => { setDraftShellName(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') { cancelShellRef.current = true; e.currentTarget.blur(); }
                }}
                onBlur={() => {
                  if (cancelShellRef.current) { cancelShellRef.current = false; setAddingShell(false); setDraftShellName(''); return; }
                  confirmNewShell();
                }}
                placeholder={translate({ key: 'workspaces.terminals.newShellPlaceholder' })}
                className={`shrink-0 w-24 rounded-md px-2 h-7 text-xs font-mono bg-white/10 text-terminal-text placeholder:text-terminal-muted outline-none ${FOCUS_RING}`}
              />
            ) : (
              <button type="button" onClick={() => { setAddingShell(true); }}
                title={translate({ key: 'workspaces.terminals.newShell' })}
                aria-label={translate({ key: 'workspaces.terminals.newShell' })}
                className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer ${FOCUS_RING}`}>
                <Icon name="plus" />
              </button>
            )}
          </div>
          {onToggleMaximize && (
            <button type="button" onClick={onToggleMaximize}
              title={translate({ key: isMaximized ? 'workspaces.terminals.restoreTitle' : 'workspaces.terminals.maximizeTitle' })}
              className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer ${FOCUS_RING}`}>
              <Icon name={isMaximized ? 'table-cells-large' : 'up-right-from-square'} />
            </button>
          )}
          <PopMenu items={menuItems} triggerClass={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-terminal-muted hover:bg-white/10 hover:text-terminal-text cursor-pointer ${FOCUS_RING}`} />
        </div>
      </div>
      <XtermTerminal key={sessionId} sessionId={sessionId} workspaceId={workspaceId} ticketKey={terminal.ticketId} className={`flex-1 min-h-0`} />
      <div className={`flex items-center justify-between gap-2 bg-terminal-surface border-t border-white/5 px-3 h-7 shrink-0 text-[11px] font-mono text-terminal-muted`}>
        <span className={`inline-flex items-center gap-1 shrink-0 ml-auto`}><span className={`w-1.5 h-1.5 rounded-full bg-terminal-green`} /> {translate({ key: 'workspaces.terminals.live' })}</span>
      </div>
      {!fill && (
        <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          title={translate({ key: 'workspaces.terminals.resizeTitle' })}
          className={`group shrink-0 h-2.5 hidden md:flex items-center justify-center cursor-ns-resize bg-terminal-surface border-t border-white/5`}>
          <span className={`w-8 h-0.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-terminal-muted/50 group-hover:bg-terminal-muted'}`} />
        </div>
      )}
    </div>
  );
}
