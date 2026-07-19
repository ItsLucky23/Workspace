//? Workspaces — the ticket "Terminal" tab. Which terminals exist comes from the
//? ticket's CURRENT stage pipeline config (`ctx.stageConfigs[stageId].processes`),
//? not a per-ticket terminal catalog. A stage with no configured processes (e.g.
//? `unrefined` human-triage) has NO terminal — the empty state teaches exactly that.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../../_components/Icon';
import XtermTerminal from '../../../_components/XtermTerminal';
import { EmptyState } from '../../../_components/primitives';
import { useWorkspaces } from '../../../_shell/WorkspacesContext';

//? Remembered terminal height (module-level so a drag persists across remounts /
//? tab switches without threading it through page state — mirrors the Terminals
//? page's rememberedGridHeight).
let rememberedTerminalHeight = 320;
const MIN_TERMINAL_HEIGHT = 220;
const MAX_TERMINAL_HEIGHT = 900;

export default function TerminalPanel({ ticketId, stageId }: { ticketId: string; stageId: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const stageCfg = ctx.stageConfigs.find((s) => s.id === stageId);
  const processes = stageCfg?.processes ?? [];
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(rememberedTerminalHeight);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  //? Drag the bottom strip to resize the panel height. Clamp to a sane range and
  //? remember the last height at module level. Pointer-capture keeps the drag
  //? tracking even when the cursor leaves the thin handle (mirrors TerminalPanel).
  const onHandleDown = (e: ReactPointerEvent) => {
    dragRef.current = { startY: e.clientY, startH: height };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const next = Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, dragRef.current.startH + (e.clientY - dragRef.current.startY)));
    rememberedTerminalHeight = next;
    setHeight(next);
  };
  const onHandleUp = () => { dragRef.current = null; setDragging(false); };

  const proc = processes[active] ?? processes[0];
  if (!proc) {
    //? Stage-config driven teaching empty state: no processes in THIS stage → no terminal.
    return <EmptyState icon="terminal" title={translate({ key: 'workspaces.ticket.noTerminal' })} sub={translate({ key: 'workspaces.ticket.noTerminalStageSub' })} />;
  }
  return (
    <div className="rounded-xl overflow-hidden border border-container1-border">
      <div className="flex items-center justify-between gap-2 bg-terminal-surface px-3 h-10 text-terminal-text">
        <div className="flex items-center gap-1">
          {processes.map((p, i) => (
            <button key={p.name} type="button" onClick={() => { setActive(i); }}
              className={`rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors ${i === active ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}>
              {p.name}
            </button>
          ))}
          <span className="text-terminal-muted text-xs ml-1">· {proc.cwd}</span>
        </div>
        <button type="button" onClick={() => { ctx.navigate('terminals'); }} className="text-xs text-terminal-muted hover:text-terminal-text cursor-pointer inline-flex items-center gap-1">
          <Icon name="up-right-from-square" /> {translate({ key: 'workspaces.ticket.openInTerminals' })}
        </button>
      </div>
      <div style={{ height }}>
        <XtermTerminal key={`${ticketId}:${proc.name}`} sessionId={`${ticketId}:${proc.name}`} className="h-full" />
      </div>
      <div onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
        title={translate({ key: 'workspaces.terminals.resizeTitle' })}
        className="group h-2.5 flex items-center justify-center cursor-ns-resize bg-terminal-surface border-t border-white/5">
        <span className={`w-8 h-0.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-terminal-muted/50 group-hover:bg-terminal-muted'}`} />
      </div>
    </div>
  );
}
