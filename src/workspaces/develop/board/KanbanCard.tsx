//? Board card + its ⋯ menu, and the two menuHandler pickers it opens (manual stage
//? move, artifact reference). The pickers receive `ctx` as a PROP because
//? menuHandler-opened forms render OUTSIDE the WorkspacesProvider tree — calling
//? useWorkspaces() inside them crashes (lesson 0011).

import { useRef, useState } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { AvatarStack, LabelChip, PopMenu, StatusPill, WsButton, type PopMenuItem } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { Ticket } from '../../_data/types';
import { PRIORITY_DOT, PRIORITY_LABEL_KEY, isBadgedPriority } from '../../_functions/priority';

//? #9 — a manual per-card stage move (discoverability for board-first users; the board is otherwise
//? AI-driven). A small stage picker opened from the card menu → moveTicket. Kept as its own component
//? so it can use hooks (cardMenuItems is a plain function).
function StageMovePicker({ ticket, ctx }: { ticket: Ticket; ctx: ReturnType<typeof useWorkspaces> }) {
  const translate = useTranslator();
  const [stageId, setStageId] = useState(ticket.stageId);
  const items: DropdownItem[] = ctx.stages.map((s) => ({ id: s.id, value: s.id, item: s.name }));
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.board.moveToStageTitle', params: [{ key: 'id', value: ticket.id }] })}</div>
      <Dropdown size="sm" items={items} value={items.find((i) => i.id === stageId)} onChange={(it) => { setStageId(String(it.id)); }} />
      <div className={`flex items-center justify-end gap-2`}>
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="arrow-right" disabled={stageId === ticket.stageId} onClick={() => { ctx.moveTicket(ticket.id, stageId); void menuHandler.close(); }}>{translate({ key: 'workspaces.board.moveToStageConfirm' })}</WsButton>
      </div>
    </div>
  );
}

//? #6 — attach a design/studio artifact to a ticket as a reference (the 'Add reference' card action was
//? a dead no-op). Lists the workspace's studio + design library artifacts → linkArtifact.
function ArtifactLinkPicker({ ticket, ctx }: { ticket: Ticket; ctx: ReturnType<typeof useWorkspaces> }) {
  const translate = useTranslator();
  const items: { id: string; kind: string; label: string }[] = [
    ...ctx.studioArtifacts.map((a) => ({ id: a.id, kind: a.kind, label: a.title })),
    ...ctx.designArtifacts.map((a) => ({ id: a.id, kind: a.kind, label: a.name })),
  ];
  return (
    <div className={`w-full flex flex-col gap-2 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.board.addReferenceTitle', params: [{ key: 'id', value: ticket.id }] })}</div>
      {items.length === 0 && <div className={`text-sm text-muted py-4 text-center`}>{translate({ key: 'workspaces.board.noArtifacts' })}</div>}
      <div className={`max-h-80 overflow-y-auto flex flex-col gap-1`}>
        {items.map((a) => (
          <button key={`${a.kind}-${a.id}`} type="button" onClick={() => { ctx.linkArtifact(ticket.id, a.id, a.kind, a.label); void menuHandler.close(); }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-container2 cursor-pointer`}>
            <Icon name="link" className={`text-muted`} />
            <span className={`text-sm text-title truncate`}>{a.label}</span>
            <span className={`text-xs text-muted ml-auto shrink-0`}>{a.kind}</span>
          </button>
        ))}
      </div>
      <div className={`flex justify-end`}><WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton></div>
    </div>
  );
}

function cardMenuItems(ticket: Ticket, ctx: ReturnType<typeof useWorkspaces>, translate: ReturnType<typeof useTranslator>): PopMenuItem[] {
  const paused = ticket.status === 'paused';
  return [
    { label: translate({ key: 'workspaces.board.openTicket' }), icon: 'up-right-from-square', onClick: () => { ctx.openTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.board.openTerminal' }), icon: 'terminal', onClick: () => { ctx.pushTo('terminals'); } },
    //? #9 — manual stage move (opens a stage picker).
    { label: translate({ key: 'workspaces.board.moveToStage' }), icon: 'arrow-right-arrow-left', onClick: () => { void menuHandler.open(<StageMovePicker ticket={ticket} ctx={ctx} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); } },
    { label: translate({ key: 'workspaces.board.addReference' }), icon: 'link', onClick: () => { void menuHandler.open(<ArtifactLinkPicker ticket={ticket} ctx={ctx} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); } },
    { divider: true },
    {
      label: paused ? translate({ key: 'workspaces.board.resumeAgent' }) : translate({ key: 'workspaces.board.pauseAgent' }), icon: paused ? 'play' : 'pause',
      onClick: () => {
        //? Without a linked repository no agent can ever run, so pausing was a pure visual status
        //? flip (owner report 2026-07-20). Explain the blocker instead of silently toggling; resume
        //? stays allowed so an already-paused ticket can be restored to its clean state.
        if (!paused && !ctx.repo.linked) { notify.warning({ key: 'workspaces.board.agentNeedsRepo' }); return; }
        if (paused) ctx.resumeTicket(ticket.id); else ctx.pauseTicket(ticket.id);
      },
    },
    { label: translate({ key: 'workspaces.board.copyDevId' }), icon: 'copy', onClick: () => void navigator.clipboard.writeText(ticket.id) },
    { divider: true },
    {
      label: translate({ key: 'workspaces.board.archive' }), icon: 'box-archive', danger: true,
      onClick: () => {
        void menuHandler.confirm({
          title: translate({ key: 'workspaces.board.archiveConfirmTitle', params: [{ key: 'id', value: ticket.id }] }),
          content: translate({ key: 'workspaces.board.archiveConfirmContent' }),
        }).then((ok) => { if (ok) ctx.archiveTicket(ticket.id); });
      },
    },
  ];
}

export function KanbanCard({ ticket }: { ticket: Ticket }) {
  const ctx = useWorkspaces();
  const translate = useTranslator();
  const linked = ctx.ticketMembers(ticket);
  const stop = { onClick: (e: React.MouseEvent) => { e.stopPropagation(); } };
  const downAt = useRef(0);
  const menuClosedAt = useRef(0);
  //? Open the ticket only on a deliberate, quick click: not after a text
  //? selection (slow press / non-empty selection), and not when the click is
  //? really just dismissing this card's open ⋯ menu.
  const handleClick = () => {
    if (Date.now() - menuClosedAt.current < 250) return;
    if (Date.now() - downAt.current > 350) return;
    if ((globalThis.getSelection()?.toString() ?? '') !== '') return;
    ctx.openTicket(ticket.id);
  };
  return (
    <div
      role="button" tabIndex={0}
      onPointerDown={() => { downAt.current = Date.now(); }}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter') ctx.openTicket(ticket.id); }}
      className={`group relative rounded-xl border border-container1-border bg-container1 p-3 cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-container2-border hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40`}
    >
      <div className={`flex items-center justify-between gap-2`}>
        <span className={`flex items-center gap-1.5 min-w-0`}>
          {isBadgedPriority(ticket.priority) && (
            <span
              title={translate({ key: PRIORITY_LABEL_KEY[ticket.priority] })}
              className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[ticket.priority]}`}
            />
          )}
          <span className={`font-mono text-xs text-muted`}>{ticket.id}</span>
        </span>
        <div className={`flex items-center gap-1`} {...stop}>
          {ticket.status === 'idle'
            ? (
              //? The chip means "no agent is running on this ticket" (NOT "this stage has AI off").
              //? Without a linked repo the tooltip explains why one never will.
              <span title={ctx.repo.linked ? undefined : translate({ key: 'workspaces.board.agentNeedsRepo' })} className={`inline-flex items-center gap-1 text-xs text-muted`}><Icon name="moon" /> {translate({ key: 'workspaces.board.noAi' })}</span>
            )
            : <StatusPill status={ticket.status} />}
          <PopMenu
            items={cardMenuItems(ticket, ctx, translate)}
            onOpenChange={(open) => { if (!open) menuClosedAt.current = Date.now(); }}
            triggerClass={`w-7 h-7 flex items-center justify-center rounded-lg text-muted opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 hover:bg-container2 hover:text-common cursor-pointer transition-opacity`}
          />
        </div>
      </div>
      <div className={`text-sm font-medium text-title mt-1.5 leading-snug`}>{ticket.title}</div>
      {ticket.labels.length > 0 && (
        <div className={`flex flex-wrap gap-1 mt-2`}>{ticket.labels.map((l) => <LabelChip key={l} name={l} />)}</div>
      )}
      <div className={`flex items-center justify-between gap-2 mt-3`}>
        {linked.length > 0 ? <AvatarStack users={linked} size={20} /> : <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.board.unassigned' })}</span>}
        <div className={`flex items-center gap-2`}>
          {ticket.costLabel && <span className={`rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-mono text-muted`}>{ticket.costLabel}</span>}
          {ticket.hasTerminal && (
            <span className={`inline-flex items-center gap-1 text-[11px] text-primary`}>
              <span className={`w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse`} /> {translate({ key: 'workspaces.board.terminal' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
