//? Workspaces — Activity. A workspace-wide, chronological feed of TicketEvents
//? (commands, file-changes, AI messages, status/stage moves, MRs, comments)
//? across every ticket. Filter by who/what; click a ticket to open it. Mirrors
//? the append-only TicketEvent log. Dummy data; desktop-first.

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { AvatarBubble, EmptyState, Segmented } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { ActivityEvent, Member } from '../_data/types';

type Filter = 'all' | 'ai' | 'people' | 'merges';

const EVENT_TINT: Record<ActivityEvent['type'], string> = {
  command: 'bg-container2 text-common',
  'file-change': 'bg-primary/12 text-primary',
  'ai-message': 'bg-primary/12 text-primary',
  'status-change': 'bg-warning/15 text-warning',
  mr: 'bg-correct/15 text-correct',
  comment: 'bg-container2 text-muted',
};
const EVENT_LABEL: Record<ActivityEvent['type'], string> = {
  command: 'workspaces.activity.labelCommand', 'file-change': 'workspaces.activity.labelFile', 'ai-message': 'workspaces.activity.labelAi', 'status-change': 'workspaces.activity.labelStatus', mr: 'workspaces.activity.labelMerge', comment: 'workspaces.activity.labelComment',
};

function matches(e: ActivityEvent, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'ai') return e.actor === 'ai';
  if (f === 'merges') return e.actor === 'mr' || e.type === 'mr';
  return e.actor !== 'ai' && e.actor !== 'mr';
}

function ActorBadge({ actor, membersById }: { actor: string; membersById: Record<string, Member> }) {
  if (actor === 'ai') return <span className="w-7 h-7 rounded-full bg-primary/12 text-primary flex items-center justify-center shrink-0"><Icon name="robot" className="text-xs" /></span>;
  if (actor === 'mr') return <span className="w-7 h-7 rounded-full bg-correct/15 text-correct flex items-center justify-center shrink-0"><Icon name="code-merge" className="text-xs" /></span>;
  const member = membersById[actor];
  if (member) return <div className="w-7 h-7 shrink-0"><AvatarBubble user={member} size={28} /></div>;
  return <span className="w-7 h-7 rounded-full bg-container2 text-muted flex items-center justify-center shrink-0"><Icon name="user" className="text-xs" /></span>;
}

function actorName(actor: string, translate: ReturnType<typeof useTranslator>, membersById: Record<string, Member>): string {
  if (actor === 'ai') return translate({ key: 'workspaces.activity.actorAgent' });
  if (actor === 'mr') return 'GitLab';
  return membersById[actor]?.name ?? actor;
}

export default function Activity() {
  const translate = useTranslator();
  const { openTicket, activityEvents, membersById } = useWorkspaces();
  const [filter, setFilter] = useState<Filter>('all');
  const events = useMemo(() => activityEvents.filter((e) => matches(e, filter)), [activityEvents, filter]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.activity.title' })}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-correct/15 text-correct px-2 h-6 text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-correct motion-safe:animate-pulse" /> {translate({ key: 'workspaces.activity.live' })}</span>
        </div>
        <Segmented<Filter>
          value={filter} onChange={setFilter}
          options={[{ id: 'all', label: translate({ key: 'workspaces.activity.filterAll' }) }, { id: 'ai', label: translate({ key: 'workspaces.activity.filterAi' }) }, { id: 'people', label: translate({ key: 'workspaces.activity.filterPeople' }) }, { id: 'merges', label: translate({ key: 'workspaces.activity.filterMerges' }) }]}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="max-w-3xl mx-auto w-full">
          {events.length === 0 && <EmptyState icon="wave-square" title={translate({ key: 'workspaces.activity.emptyTitle' })} sub={translate({ key: 'workspaces.activity.emptySub' })} />}
          {events.map((e, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <ActorBadge actor={e.actor} membersById={membersById} />
                {i < events.length - 1 && <span className="w-px flex-1 bg-divider my-1" />}
              </div>
              <div className="pb-5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-title">{actorName(e.actor, translate, membersById)}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${EVENT_TINT[e.type]}`}>{translate({ key: EVENT_LABEL[e.type] })}</span>
                  <button type="button" onClick={() => { openTicket(e.ticketId); }} className="font-mono text-xs text-primary hover:underline cursor-pointer">{e.ticketId}</button>
                  <span className="text-xs text-muted">· {e.time}</span>
                </div>
                <div className="text-sm text-common mt-1 break-words">{e.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
