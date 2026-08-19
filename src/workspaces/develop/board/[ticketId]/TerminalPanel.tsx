//? Workspaces — the ticket "Terminal" tab: one tab per process running in this ticket's container.
//?
//? ADR 0317 — the tabs come from TWO lists, in this order:
//?   1. the PROJECT's runtime processes — what it takes to run this app (frontend, backend, a tunnel).
//?      These are the same for every ticket and every stage, because running the app is.
//?   2. the ticket's CURRENT stage processes — the per-stage extra (a test stage's fixture server).
//? Before 0317 only (2) existed, so the tabs changed as a ticket moved and were empty in every stage
//? of a real pipeline: the runtime lived in a single `devCommand` string that had no terminal at all.
//? Deduped by NAME, project-first, because the name is what the tab is called and what the process log
//? on the /work volume is keyed by — two tabs with one name would read the same log twice.

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
  const runProcesses = ctx.activeProject?.runProcesses ?? [];
  const stageProcesses = (stageCfg?.processes ?? []).filter((p) => !runProcesses.some((r) => r.name === p.name));
  const processes = [...runProcesses, ...stageProcesses];
  //? #20/relationship-fix — the inline "live agent" tail (page.tsx TicketControls) and this tab's
  //? per-process PTYs are the SAME underlying observability: `agentTerm` is a throttled, read-only tee of
  //? the container's `claude` PTY (see docs/07_ORCHESTRATOR.md §A step 7). Rather than leave a user to guess
  //? whether they're two different things, the tail is folded in HERE as one more (synthetic) process tab —
  //? appended after the real ones so its appearance/disappearance never reshuffles an already-selected index.
  const liveOutput = ctx.agentTerm[ticketId] ?? '';
  const hasLiveTail = liveOutput.length > 0;
  const [active, setActive] = useState(0);
  const isAgentTab = hasLiveTail && active === processes.length;
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
  if (!proc && !isAgentTab) {
    //? Stage-config driven teaching empty state: no processes in THIS stage AND no live agent tail → no terminal.
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
          {hasLiveTail && (
            <button type="button" onClick={() => { setActive(processes.length); }}
              className={`rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors inline-flex items-center gap-1.5 ${isAgentTab ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-correct animate-pulse" />{translate({ key: 'workspaces.ticket.aiAgentTab' })}
            </button>
          )}
          {proc && !isAgentTab && <span className="text-terminal-muted text-xs ml-1">· {proc.cwd}</span>}
        </div>
        <button type="button" onClick={() => { ctx.navigate('terminals'); }} className="text-xs text-terminal-muted hover:text-terminal-text cursor-pointer inline-flex items-center gap-1">
          <Icon name="up-right-from-square" /> {translate({ key: 'workspaces.ticket.openInTerminals' })}
        </button>
      </div>
      {isAgentTab ? (
        <div style={{ height }} className="overflow-auto bg-container2/60">
          <div className="px-3 pt-2 text-[11px] text-muted">{translate({ key: 'workspaces.ticket.aiAgentTailHint' })}</div>
          <pre className="p-3 text-[11px] leading-snug font-mono text-common whitespace-pre-wrap break-words">{liveOutput}</pre>
        </div>
      ) : proc && (
        <div style={{ height }}>
          <XtermTerminal key={`${ctx.activeWorkspace.id}:${ticketId}:${proc.name}`} sessionId={`${ctx.activeWorkspace.id}:${ticketId}:${proc.name}`} workspaceId={ctx.activeWorkspace.id} ticketKey={ticketId} className="h-full" />
        </div>
      )}
      <div onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
        title={translate({ key: 'workspaces.terminals.resizeTitle' })}
        className="group h-2.5 flex items-center justify-center cursor-ns-resize bg-terminal-surface border-t border-white/5">
        <span className={`w-8 h-0.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-terminal-muted/50 group-hover:bg-terminal-muted'}`} />
      </div>
    </div>
  );
}
