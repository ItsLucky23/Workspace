//? intent: Scheduled posts — a read-only content-lane queue of every publish that's set for a future
//? time. Reads the publish jobs the content pieces already carry (status 'scheduled' + scheduledAt, #143)
//? and lists them soonest-first, grouped by day (distinct from the Development 'Scheduled' cron page, #149).
//? One action: tap a row to open the piece (that's where rescheduling lives). Failed jobs stay visible with
//? a FAILED badge (A2) and reveal their error + attempt count via an inline disclosure; the empty state
//? teaches how the queue fills up and points to the content board.

import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { Collapse } from '../../_components/motion';
import { EmptyState, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export const template = 'workspaces';

//? One queued publish, flattened out of pieces[].assets[].publishJobs[].
interface ScheduledRow {
  pieceId: string;
  pieceTitle: string;
  platform: string;
  channelName: string | null;
  when: number;   // epoch ms of scheduledAt
  //? GAP_SCAN A2 — a FAILED post stays visible here (it used to be filtered out and vanish silently).
  failed: boolean;
  error?: string;
  attempts?: number;
}

//? One scheduled/failed publish. The whole row is the page's single action (open the piece); a failed
//? row with detail grows an inline "why it failed" disclosure BELOW the row (badge inline, detail
//? progressive — never a side panel or tooltip, so it stays phone-friendly).
function RowCard({ row, onOpen }: { row: ScheduledRow; onOpen: () => void }) {
  const translate = useTranslator();
  const [showDetail, setShowDetail] = useState(false);
  const hasDetail = row.failed && (row.error != null || row.attempts != null);
  return (
    <div className={`rounded-2xl border border-container1-border bg-container1 overflow-hidden`}>
      <button type="button" onClick={onOpen} className={`w-full text-left hover:bg-container2 p-4 flex items-center gap-3 cursor-pointer transition-colors`}>
        <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${row.failed ? 'bg-wrong/12 text-wrong' : 'bg-primary/12 text-primary'}`}><Icon name={row.failed ? 'triangle-exclamation' : 'paper-plane'} /></span>
        <div className={`min-w-0 flex-1`}>
          <div className={`text-sm font-medium text-title truncate flex items-center gap-2`}>
            <span className={`truncate`}>{row.pieceTitle}</span>
            {row.failed && <span className={`shrink-0 text-[10px] uppercase tracking-wide rounded-full bg-wrong/15 text-wrong px-1.5 py-0.5`}>{translate({ key: 'workspaces.scheduledPosts.failed' })}</span>}
          </div>
          <div className={`text-xs text-muted truncate`}>
            {row.platform}
            {row.channelName ? ` · ${row.channelName}` : ''}
          </div>
        </div>
        <div className={`text-xs text-muted shrink-0 tabular-nums`}>{new Date(row.when).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
      </button>
      {hasDetail && (
        <>
          <button type="button" onClick={() => { setShowDetail((o) => !o); }} className={`w-full flex items-center justify-between gap-2 px-4 py-2 border-t border-divider text-xs font-medium text-wrong cursor-pointer hover:bg-container2 transition-colors`}>
            <span className={`min-w-0 truncate text-left`}>{translate({ key: 'workspaces.scheduledPosts.whyFailed' })}</span>
            <Icon name="caret-down" className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${showDetail ? 'rotate-180' : ''}`} />
          </button>
          <Collapse open={showDetail}>
            <div className={`px-4 pb-3 flex flex-col gap-1.5`}>
              {row.error != null && <div className={`text-xs text-common break-words`}>{row.error}</div>}
              {row.attempts != null && <div className={`text-xs text-muted`}>{translate({ key: 'workspaces.scheduledPosts.attempts', params: [{ key: 'count', value: String(row.attempts) }] })}</div>}
            </div>
          </Collapse>
        </>
      )}
    </div>
  );
}

export default function ScheduledPosts() {
  const translate = useTranslator();
  const { content, navigate } = useWorkspaces();

  //? Flatten every 'scheduled' publish job (with a future-or-any scheduledAt) into a sorted list.
  const rows = useMemo<ScheduledRow[]>(() => {
    const channelName = (id: string | null): string | null => (id ? (content.channels.find((c) => c.id === id)?.name ?? null) : null);
    const out: ScheduledRow[] = [];
    for (const piece of content.pieces) {
      for (const asset of piece.assets) {
        for (const job of asset.publishJobs ?? []) {
          //? A2 — show queued AND failed jobs; a stopped channel must be visible, not filtered away.
          if (job.status !== 'scheduled' && job.status !== 'error') continue;
          if (!job.scheduledAt) continue;
          const when = new Date(job.scheduledAt).getTime();
          if (!Number.isFinite(when)) continue;
          out.push({
            pieceId: piece.id, pieceTitle: piece.title, platform: job.platform,
            channelName: channelName(piece.channelId), when, failed: job.status === 'error',
            ...(job.error ? { error: job.error } : {}), ...(job.attempts ? { attempts: job.attempts } : {}),
          });
        }
      }
    }
    return out.toSorted((a, b) => a.when - b.when);
  }, [content.pieces, content.channels]);

  //? Group by calendar day for a light calendar feel (a full grid is overkill for the queue volume).
  //? `relation` flags the group the user actually cares about first (today, then tomorrow) so its
  //? label can stand out from the flat scroll of muted day strings.
  const groups = useMemo<{ day: string; items: ScheduledRow[]; relation: 'today' | 'tomorrow' | null }[]>(() => {
    const dayKey = (d: Date): string => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const now = new Date();
    const todayKey = dayKey(now);
    const tomorrowKey = dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const map = new Map<string, ScheduledRow[]>();
    for (const r of rows) {
      const day = dayKey(new Date(r.when));
      const list = map.get(day) ?? [];
      list.push(r);
      map.set(day, list);
    }
    return [...map.entries()].map(([day, items]) => ({
      day, items,
      relation: day === todayKey ? 'today' : (day === tomorrowKey ? 'tomorrow' : null),
    }));
  }, [rows]);

  return (
    <div className={`h-full min-h-0 overflow-y-auto`}>
      <div className={`px-5 md:px-6 pt-5 pb-3 border-b border-divider flex flex-wrap items-center gap-3`}>
        <div className={`flex items-center gap-2 text-title min-w-0 flex-1`}>
          <span className={`w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0`}><Icon name="calendar-day" /></span>
          <div className={`min-w-0`}>
            <div className={`text-xl font-semibold leading-tight`}>{translate({ key: 'workspaces.scheduledPosts.title' })}</div>
            <div className={`text-xs text-muted truncate`}>{translate({ key: 'workspaces.scheduledPosts.tagline' })}</div>
          </div>
        </div>
        {rows.length > 0 && (
          //? Persistent escape hatch to where scheduling actually happens — previously this only
          //? existed inside the empty state, so it vanished the moment the queue had items (finding).
          <WsButton variant="secondary" icon="wand-magic-sparkles" onClick={() => { navigate('content'); }}>
            {translate({ key: 'workspaces.scheduledPosts.goToContent' })}
          </WsButton>
        )}
      </div>

      <div className={`p-5 md:p-6 flex flex-col gap-6 max-w-4xl`}>
        {rows.length === 0 && (
          //? Teaching empty state: says what fills this page and hands over the primary action
          //? (scheduling happens on a content piece, not here).
          <EmptyState
            icon="calendar-day"
            title={translate({ key: 'workspaces.scheduledPosts.emptyTitle' })}
            sub={translate({ key: 'workspaces.scheduledPosts.emptyHint' })}
            action={<WsButton onClick={() => { navigate('content'); }}>{translate({ key: 'workspaces.scheduledPosts.goToContent' })}</WsButton>}
          />
        )}

        {groups.map((g) => (
          <div key={g.day} className={`flex flex-col gap-2`}>
            <div className={`flex items-center gap-2`}>
              {g.relation != null && (
                <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full bg-primary/12 text-primary px-2 py-0.5`}>
                  {translate({ key: g.relation === 'today' ? 'workspaces.scheduledPosts.today' : 'workspaces.scheduledPosts.tomorrow' })}
                </span>
              )}
              <div className={`text-xs font-medium text-muted uppercase tracking-wide`}>{g.day}</div>
            </div>
            <div className={`flex flex-col gap-2`}>
              {g.items.map((r, i) => (
                <RowCard key={`${r.pieceId}-${r.platform}-${String(i)}`} row={r} onOpen={() => { navigate(`content/${r.pieceId}`); }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
