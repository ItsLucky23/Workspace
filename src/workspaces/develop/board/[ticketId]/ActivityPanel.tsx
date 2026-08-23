//? Workspaces — the ticket "Activity" tab: the per-ticket event feed. Related-ticket and
//? stage-history disclosures were removed because the live snapshot has no producer for those
//? prototype-only fields; the event feed is the authoritative activity surface.

import { useTranslator } from '@luckystack/core/client';

import { EmptyState } from '../../../_components/primitives';
import { useWorkspaces } from '../../../_shell/WorkspacesContext';
import type { ActivityEvent, Member, Ticket } from '../../../_data/types';

const ACTOR_GLYPH = (actor: string, membersById: Record<string, Member>) => (actor === 'ai' ? '🤖' : (actor === 'mr' ? '🔀' : (membersById[actor]?.name[0] ?? '·')));
const EVENT_LABEL_KEY: Record<ActivityEvent['type'], string> = {
  command: 'workspaces.ticket.activityTypeCommand',
  'file-change': 'workspaces.ticket.activityTypeFileChange',
  'ai-message': 'workspaces.ticket.activityTypeAiMessage',
  'status-change': 'workspaces.ticket.activityTypeStatusChange',
  mr: 'workspaces.ticket.activityTypeMr',
  comment: 'workspaces.ticket.activityTypeComment',
  ci: 'workspaces.ticket.activityTypeCi',
};
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
  return (
    <div className="flex flex-col gap-4">
      {events.length === 0
        ? <EmptyState icon="wave-square" title={translate({ key: 'workspaces.ticket.noActivity' })} sub={translate({ key: 'workspaces.ticket.noActivitySub' })} />
        : (
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <div key={`${e.time}-${e.actor}-${e.type}-${e.text}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-container2/50 transition-colors">
                <span className="w-6 h-6 rounded-full bg-container2 text-xs flex items-center justify-center shrink-0">{ACTOR_GLYPH(e.actor, ctx.membersById)}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${EVENT_TINT[e.type]}`}>{translate({ key: EVENT_LABEL_KEY[e.type] })}</span>
                <span className="text-sm text-common flex-1 min-w-0 truncate">{e.text}</span>
                <span className="text-xs text-muted font-mono shrink-0">{e.time}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
