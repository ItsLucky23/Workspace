//? Workspaces — the ticket "Terminal" tab: what the relay ACTUALLY provides (F-016).
//?
//? Before: one tab per configured runtime/stage process ('frontend', 'backend', …), each implying "this
//? is that running process". But server/hooks/workspacesTerminal.ts `ws-term:start` reads only
//? {workspaceId, ticketKey, cols, rows} and execs a fresh `bash` at /work — the process name in the
//? session id and the displayed cwd were never honoured, so every tab was an independent blank shell.
//? A tab that claims to be a process it is not is worse than one honest tab. So:
//?   1. ONE `shell` tab — a bash in this ticket's container at /work (the only thing the relay attaches).
//?   2. the `ai-agent` tab — the throttled read-only tee of the container's `claude` PTY (#20), the same
//?      stream the Overview's live tail shows.
//? And the shell is gated on a RUNNING container for this ticket (`containerTerminals`, polled like the
//? Terminals page): a container-less ticket gets a setup notice instead of a dead xterm that exits 126.

import { useEffect, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Icon from '../../../_components/Icon';
import XtermTerminal from '../../../_components/XtermTerminal';
import { EmptyState } from '../../../_components/primitives';
import { useRememberedPanelHeight } from '../../../_components/useRememberedPanelHeight';
import { useWorkspaces } from '../../../_shell/WorkspacesContext';

//? The relay execs `bash` at /work (workspacesTerminal.ts attachDockerPty / pty-agent) — shown, not chosen.
const WORKDIR_LABEL = '· /work';
const tabCls = (on: boolean): string => `rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors ${on ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`;

export default function TicketTerminalPanel({ ticketId }: { ticketId: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const workspaceId = ctx.activeWorkspace.id;
  //? #20/relationship-fix — the inline "live agent" tail (page.tsx TicketControls) and this tab's PTY are the
  //? SAME underlying observability: `agentTerm` is a throttled, read-only tee of the container's `claude` PTY
  //? (see docs/07_ORCHESTRATOR.md §A step 7). The tail is a second tab here so nobody has to guess whether the
  //? two are different streams.
  const liveOutput = ctx.agentTerm[ticketId] ?? '';
  const hasLiveTail = liveOutput.length > 0;
  const [tab, setTab] = useState<'shell' | 'agent'>('shell');
  const { height, dragging, onPointerDown, onPointerMove, onPointerUp } = useRememberedPanelHeight('ticket-terminal', 320);

  //? Is there a running container for THIS ticket? Polled (5s) so a container that spins up on stage
  //? activation appears without a manual refresh. `null` = not known yet.
  const [hasContainer, setHasContainer] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/containerTerminals', version: 'v1', data: { workspaceId } }));
      if (cancelled || error || res?.status !== 'success') return;
      setHasContainer(res.result.containers.some((c) => c.ticketKey === ticketId));
    };
    void load();
    const timer = setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [workspaceId, ticketId]);

  const isAgentTab = hasLiveTail && tab === 'agent';
  //? No container AND no live tail → nothing to show at all; say how a terminal comes to exist.
  if (hasContainer === false && !hasLiveTail) {
    return <EmptyState icon="terminal" title={translate({ key: 'workspaces.ticket.terminalNoContainerTitle' })} sub={translate({ key: 'workspaces.ticket.terminalNoContainerSub' })} />;
  }
  return (
    <div className="rounded-xl overflow-hidden border border-container1-border">
      <div className="flex items-center justify-between gap-2 bg-terminal-surface px-3 h-10 text-terminal-text">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => { setTab('shell'); }} className={tabCls(!isAgentTab)}>{translate({ key: 'workspaces.ticket.shellTab' })}</button>
          {hasLiveTail && (
            <button type="button" onClick={() => { setTab('agent'); }} className={`${tabCls(isAgentTab)} inline-flex items-center gap-1.5`}>
              <span className="w-1.5 h-1.5 rounded-full bg-correct animate-pulse" />{translate({ key: 'workspaces.ticket.aiAgentTab' })}
            </button>
          )}
          {!isAgentTab && <span className="text-terminal-muted text-xs ml-1">{WORKDIR_LABEL}</span>}
        </div>
        <button type="button" onClick={() => { ctx.navigate('terminals'); }} className="text-xs text-terminal-muted hover:text-terminal-text cursor-pointer inline-flex items-center gap-1">
          <Icon name="up-right-from-square" /> {translate({ key: 'workspaces.ticket.openInTerminals' })}
        </button>
      </div>
      {isAgentTab && (
        <div style={{ height }} className="overflow-auto bg-container2/60">
          <div className="px-3 pt-2 text-[11px] text-muted">{translate({ key: 'workspaces.ticket.aiAgentTailHint' })}</div>
          <pre className="p-3 text-[11px] leading-snug font-mono text-common whitespace-pre-wrap break-words">{liveOutput}</pre>
        </div>
      )}
      {!isAgentTab && hasContainer === true && (
        <div style={{ height }} className="flex flex-col">
          <div className="px-3 py-1 text-[11px] text-muted bg-container2/60">{translate({ key: 'workspaces.ticket.terminalShellHint' })}</div>
          <div className="flex-1 min-h-0">
            <XtermTerminal key={`${workspaceId}:${ticketId}:shell`} sessionId={`${workspaceId}:${ticketId}:shell`} workspaceId={workspaceId} ticketKey={ticketId} className="h-full" />
          </div>
        </div>
      )}
      {!isAgentTab && hasContainer !== true && (
        <div style={{ height }} className="flex items-center justify-center bg-container2/60 px-6">
          {hasContainer === null
            ? <span className="text-sm text-muted">{translate({ key: 'workspaces.ticket.loadingEditor' })}</span>
            : <EmptyState icon="terminal" title={translate({ key: 'workspaces.ticket.terminalNoContainerTitle' })} sub={translate({ key: 'workspaces.ticket.terminalNoContainerSub' })} />}
        </div>
      )}
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        title={translate({ key: 'workspaces.terminals.resizeTitle' })}
        className="group h-2.5 flex items-center justify-center cursor-ns-resize bg-terminal-surface border-t border-white/5">
        <span className={`w-8 h-0.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-terminal-muted/50 group-hover:bg-terminal-muted'}`} />
      </div>
    </div>
  );
}
