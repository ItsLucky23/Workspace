//? intent: Workspaces — Activity: the live, workspace-wide chronological feed of everything
//? that happens across tickets (commands, file changes, AI messages, status moves, merges,
//? CI, comments). Scan the timeline and click a ticket id to jump into that ticket; the
//? who/what filter sits on its own compact row so the header never cramps at phone width.
//? Renders the real TicketEvent projection from the workspace snapshot.
//?
//? KISS pass: title + Live badge + a one-line "what is this" sub; the Segmented filter moved
//? out of the title row onto its own scrollable line (its only secondary control, one tap
//? away); the empty state TEACHES what lands here and points at the Board, and a
//? filtered-to-zero state offers a one-tap reset back to All.

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';
import { AnimatePresence, motion } from 'motion/react';

import Icon from '../../_components/Icon';
import { AvatarBubble, EmptyState, InfoTip, Segmented, WsButton } from '../../_components/primitives';
import { timeAgo } from '../../_functions/timeAgo';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import type { ActivityEvent, Member } from '../../_data/types';

type Filter = 'all' | 'ai' | 'people' | 'merges';

const EVENT_TINT: Record<ActivityEvent['type'], string> = {
  command: 'bg-container2 text-common',
  'file-change': 'bg-primary/12 text-primary',
  'ai-message': 'bg-primary/12 text-primary',
  'status-change': 'bg-warning/15 text-warning',
  mr: 'bg-correct/15 text-correct',
  //? `muted` on `container2` at 11px lands at ~4.07:1 — under the minimum. `meta` is the token for
  //? small text that must stay readable on a tinted surface.
  comment: 'bg-container2 text-meta',
  ci: 'bg-secondary/15 text-secondary',
};
const EVENT_LABEL: Record<ActivityEvent['type'], string> = {
  command: 'workspaces.activity.labelCommand', 'file-change': 'workspaces.activity.labelFile', 'ai-message': 'workspaces.activity.labelAi', 'status-change': 'workspaces.activity.labelStatus', mr: 'workspaces.activity.labelMerge', comment: 'workspaces.activity.labelComment', ci: 'workspaces.activity.labelCi',
};

const FILTER_LABEL: Record<Filter, string> = {
  all: 'workspaces.activity.filterAll',
  ai: 'workspaces.activity.filterAi',
  people: 'workspaces.activity.filterPeople',
  merges: 'workspaces.activity.filterMerges',
};

//? Deliberate matching semantics (do not "simplify"): 'merges' catches BOTH the GitLab actor
//? and merge-typed events from anyone; 'people' is everyone who is not the AI and not GitLab
//? (unknown/fallback actors included); 'ai' is the agent actor only.
function matches(e: ActivityEvent, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'ai') return e.actor === 'ai';
  if (f === 'merges') return e.actor === 'mr' || e.type === 'mr';
  return e.actor !== 'ai' && e.actor !== 'mr';
}

//? Four actor branches by design: AI agent → robot on primary tint, GitLab → merge icon on
//? correct tint, a known member → their avatar, anything else → a neutral user fallback.
function ActorBadge({ actor, membersById }: { actor: string; membersById: Record<string, Member> }) {
  if (actor === 'ai') return <span className={`w-7 h-7 rounded-full bg-primary/12 text-primary flex items-center justify-center shrink-0`}><Icon name="robot" className={`text-xs`} /></span>;
  if (actor === 'mr') return <span className={`w-7 h-7 rounded-full bg-correct/15 text-correct flex items-center justify-center shrink-0`}><Icon name="code-merge" className={`text-xs`} /></span>;
  const member = membersById[actor];
  if (member) return <div className={`w-7 h-7 shrink-0`}><AvatarBubble user={member} size={28} /></div>;
  return <span className={`w-7 h-7 rounded-full bg-container2 text-muted flex items-center justify-center shrink-0`}><Icon name="user" className={`text-xs`} /></span>;
}

function actorName(actor: string, translate: ReturnType<typeof useTranslator>, membersById: Record<string, Member>): string {
  if (actor === 'ai') return translate({ key: 'workspaces.activity.actorAgent' });
  //? 'GitLab' is a product name, not a translatable string — hardcoded on purpose.
  if (actor === 'mr') return 'GitLab';
  return membersById[actor]?.name ?? actor;
}

export const template = 'workspaces';

export default function Activity() {
  const translate = useTranslator();
  const { openTicket, navigate, activityEvents, membersById } = useWorkspaces();
  const [filter, setFilter] = useState<Filter>('all');
  const events = useMemo(() => activityEvents.filter((e) => matches(e, filter)), [activityEvents, filter]);

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      {/* Header: what this page IS (title + live signal + one-line teach), then the filter on
          its own row — the old title-row placement wrapped awkwardly at phone width. */}
      <div className={`px-4 md:px-6 py-3 md:py-4 shrink-0`}>
        <div className={`flex items-center gap-3 flex-wrap`}>
          <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.activity.title' })}</h1>
          <span className={`inline-flex items-center gap-1.5 rounded-full bg-correct/15 text-correct px-2 h-6 text-xs font-medium`}><span className={`w-1.5 h-1.5 rounded-full bg-correct motion-safe:animate-pulse`} /> {translate({ key: 'workspaces.activity.live' })}</span>
        </div>
        <p className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.activity.sub' })}</p>
        <div className={`mt-3 flex items-center gap-2`}>
          <div className={`min-w-0 overflow-x-auto ws-no-scrollbar`}>
            <Segmented<Filter>
              value={filter} onChange={setFilter}
              options={[{ id: 'all', label: translate({ key: FILTER_LABEL.all }) }, { id: 'ai', label: translate({ key: FILTER_LABEL.ai }) }, { id: 'people', label: translate({ key: FILTER_LABEL.people }) }, { id: 'merges', label: translate({ key: FILTER_LABEL.merges }) }]}
            />
          </div>
          {/* The filter narrows the fixed 50-event window the snapshot ships — it never fetches older
              history, so a filtered-to-zero result does NOT mean those events don't exist. */}
          <InfoTip
            align="start"
            label={translate({ key: 'workspaces.tips.insights.activityWindowAria' })}
            title={translate({ key: 'workspaces.tips.insights.activityWindowTitle' })}
            body={translate({ key: 'workspaces.tips.insights.activityWindowBody' })}
          />
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8`}>
        <div className={`max-w-3xl mx-auto w-full`}>
          {/* Truly nothing yet: teach what this feed is and point at where work STARTS (the
              board) — this page has no in-page create on purpose. */}
          {activityEvents.length === 0 && (
            <EmptyState
              icon="wave-square"
              title={translate({ key: 'workspaces.activity.emptyTeachTitle' })}
              sub={translate({ key: 'workspaces.activity.emptyTeachSub' })}
              action={<WsButton variant="secondary" icon="table-columns" onClick={() => { navigate('board'); }}>{translate({ key: 'workspaces.activity.openBoard' })}</WsButton>}
            />
          )}
          {/* Events exist but the active filter hides them all: lighter variant + one-tap reset. */}
          {activityEvents.length > 0 && events.length === 0 && (
            <EmptyState
              icon="filter"
              title={translate({ key: 'workspaces.activity.emptyFilterTitle', params: [{ key: 'f', value: translate({ key: FILTER_LABEL[filter] }) }] })}
              sub={translate({ key: 'workspaces.activity.emptySub' })}
              action={<WsButton variant="ghost" icon="arrows-rotate" onClick={() => { setFilter('all'); }}>{translate({ key: 'workspaces.activity.resetFilter' })}</WsButton>}
            />
          )}
          {/* Filtering swaps the visible subset instantly by default — on a page branded "Live"
              with a pulsing badge, that static jump undercuts the live framing. Fade+lift rows
              out/in on the same composite key so a filter change reads as a transition, not a snap. */}
          <AnimatePresence initial={false}>
            {events.map((e, i) => (
              <motion.div
                key={`${e.at}-${e.actor}-${e.type}-${e.text}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className={`flex gap-3`}
              >
                <div className={`flex flex-col items-center`}>
                  <ActorBadge actor={e.actor} membersById={membersById} />
                  {i < events.length - 1 && <span className={`w-px flex-1 bg-divider my-1`} />}
                </div>
                <div className={`pb-5 min-w-0 flex-1`}>
                  <div className={`flex items-center gap-2 flex-wrap`}>
                    <span className={`text-sm font-medium text-title`}>{actorName(e.actor, translate, membersById)}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${EVENT_TINT[e.type]}`}>{translate({ key: EVENT_LABEL[e.type] })}</span>
                    {/* The page's one op-triggering control: openTicket (back-stack push, opens a
                        ticket tab) — never swap this for chrome navigation. Padded with a matching
                        negative margin so the hit target clears the ~24px minimum without shifting
                        the row's baseline alignment. */}
                    <button type="button" onClick={() => { openTicket(e.ticketId); }} className={`font-mono text-xs text-primary hover:underline cursor-pointer px-1 py-0.5 -my-0.5 -mx-1 rounded`}>{e.ticketId}</button>
                    <span className={`text-xs text-muted`} title={e.at}>· {timeAgo(e.at)}</span>
                  </div>
                  <div className={`text-sm text-common mt-1 break-words`}>{e.text}</div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
