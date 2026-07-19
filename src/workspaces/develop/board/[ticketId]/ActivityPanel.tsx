//? Workspaces — the ticket "Activity" tab: the per-ticket event feed, with the two
//? read-mostly timeline surfaces that used to be their own tabs (Links, Stage
//? history) folded in as disclosures — they are lists you consult, not places you
//? work, so they don't earn tab-bar slots (KISS: 5 tabs instead of 8).

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../../_components/Icon';
import { Disclosure, EmptyState, WsButton } from '../../../_components/primitives';
import { useWorkspaces } from '../../../_shell/WorkspacesContext';
import type { ActivityEvent, Member, StageHistoryEntry, Ticket, TicketLink } from '../../../_data/types';

const ACTOR_GLYPH = (actor: string, membersById: Record<string, Member>) => (actor === 'ai' ? '🤖' : (actor === 'mr' ? '🔀' : (membersById[actor]?.name[0] ?? '·')));
const EVENT_TINT: Record<ActivityEvent['type'], string> = {
  command: 'bg-container2 text-common',
  'file-change': 'bg-primary/12 text-primary',
  'ai-message': 'bg-primary/12 text-primary',
  'status-change': 'bg-warning/15 text-warning',
  mr: 'bg-correct/15 text-correct',
  comment: 'bg-container2 text-muted',
  ci: 'bg-secondary/15 text-secondary',
};

export default function ActivityPanel({ ticket }: { ticket: Ticket }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const events = ctx.activityEvents.filter((e) => e.ticketId === ticket.id);
  const links = ticket.links ?? [];
  const history = ticket.history ?? [];
  return (
    <div className="flex flex-col gap-4">
      {events.length === 0
        ? <EmptyState icon="wave-square" title={translate({ key: 'workspaces.ticket.noActivity' })} sub={translate({ key: 'workspaces.ticket.noActivitySub' })} />
        : (
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <div key={`${e.time}-${e.actor}-${e.type}-${e.text}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-container2/50 transition-colors">
                <span className="w-6 h-6 rounded-full bg-container2 text-xs flex items-center justify-center shrink-0">{ACTOR_GLYPH(e.actor, ctx.membersById)}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${EVENT_TINT[e.type]}`}>{e.type}</span>
                <span className="text-sm text-common flex-1 min-w-0 truncate">{e.text}</span>
                <span className="text-xs text-muted font-mono shrink-0">{e.time}</span>
              </div>
            ))}
          </div>
        )}

      <Disclosure summary={<DisclosureLabel label={translate({ key: 'workspaces.ticket.relatedTickets' })} count={links.length} />}>
        <LinksSection links={links} onOpen={ctx.openTicket} />
      </Disclosure>

      <Disclosure summary={<DisclosureLabel label={translate({ key: 'workspaces.ticket.tabHistory' })} count={history.length} />}>
        <HistorySection history={history} />
      </Disclosure>
    </div>
  );
}

function DisclosureLabel({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {count > 0 && <span className="rounded-full bg-container2 px-1.5 text-xs text-muted">{count}</span>}
    </span>
  );
}

function WhyPopover({ reason }: { reason: string }) {
  const translate = useTranslator();
  return (
    <span className="relative group/why inline-flex">
      <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center cursor-help">?</span>
      <span className="pointer-events-none absolute right-0 top-6 z-30 w-64 rounded-xl border border-container1-border bg-container1 p-3 text-xs text-common shadow-lg opacity-0 translate-y-1 group-hover/why:opacity-100 group-hover/why:translate-y-0 transition-all duration-150">
        <span className="font-semibold text-title block mb-1">{translate({ key: 'workspaces.ticket.whyThisLink' })}</span>
        {reason}
      </span>
    </span>
  );
}

function LinksSection({ links, onOpen }: { links: TicketLink[]; onOpen: (id: string) => void }) {
  const translate = useTranslator();
  if (links.length === 0) {
    return (
      <EmptyState
        icon="link"
        title={translate({ key: 'workspaces.ticket.noLinks' })}
        sub={translate({ key: 'workspaces.ticket.noLinksTeachSub' })}
        //? Fase 2: ticket link picker not wired yet — kept reachable, secondary so it doesn't promise more than it does.
        action={<WsButton variant="secondary" icon="link" onClick={() => { /* Fase 2: ticket link picker not wired yet */ }}>{translate({ key: 'workspaces.ticket.linkTicket' })}</WsButton>}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-divider">
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <button type="button" onClick={() => { onOpen(l.id); }} className="font-mono text-sm text-primary hover:underline cursor-pointer">{l.id}</button>
            <span className="text-sm text-muted">{l.rel}</span>
            {l.ai && (
              <span className="ml-auto inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px] font-medium"><Icon name="robot" /> {translate({ key: 'workspaces.ticket.aiSuggested' })}</span>
                {l.reason && <WhyPopover reason={l.reason} />}
              </span>
            )}
          </div>
        ))}
      </div>
      {/* Fase 2: ticket link picker not wired yet */}
      <WsButton variant="ghost" icon="link" className="self-start" onClick={() => { /* Fase 2: ticket link picker not wired yet */ }}>{translate({ key: 'workspaces.ticket.linkTicket' })}</WsButton>
    </div>
  );
}

function HistorySection({ history }: { history: StageHistoryEntry[] }) {
  const translate = useTranslator();
  if (history.length === 0) return <EmptyState icon="list-check" title={translate({ key: 'workspaces.ticket.noStageHistory' })} />;
  return (
    <div className="flex flex-col">
      {history.map((h, i) => (
        // eslint-disable-next-line react-x/no-array-index-key -- append-only ordered history; a stage can recur, so the positional index is the entry identity
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${h.done ? 'bg-correct/15 text-correct' : 'bg-primary/12 text-primary'}`}>
              <Icon name={h.done ? 'circle-check' : 'clock'} />
            </span>
            {i < history.length - 1 && <span className="w-px flex-1 bg-divider my-1" />}
          </div>
          <div className="pb-5">
            <div className="text-sm font-semibold text-title">{h.stage}</div>
            <div className="text-sm text-common mt-0.5">{h.summary}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
