//? intent: Scheduled posts — a content-lane calendar/list of every publish that's queued for a future
//? time. Reads the publish jobs the content pieces already carry (status 'scheduled' + scheduledAt, #143)
//? and lists them soonest-first, grouped by day, so a content user sees what will go out and when
//? (distinct from the Development 'Scheduled' cron page, #149). Read-only — clicking a row opens the piece.

import { useMemo } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { useWorkspaces } from '../_shell/WorkspacesContext';

export const template = 'workspaces';

//? One queued publish, flattened out of pieces[].assets[].publishJobs[].
interface ScheduledRow {
  pieceId: string;
  pieceTitle: string;
  platform: string;
  channelName: string | null;
  when: number;   // epoch ms of scheduledAt
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
          if (job.status !== 'scheduled' || !job.scheduledAt) continue;
          const when = new Date(job.scheduledAt).getTime();
          if (!Number.isFinite(when)) continue;
          out.push({ pieceId: piece.id, pieceTitle: piece.title, platform: job.platform, channelName: channelName(piece.channelId), when });
        }
      }
    }
    return out.toSorted((a, b) => a.when - b.when);
  }, [content.pieces, content.channels]);

  //? Group by calendar day for a light calendar feel (a full grid is overkill for the queue volume).
  const groups = useMemo<{ day: string; items: ScheduledRow[] }[]>(() => {
    const map = new Map<string, ScheduledRow[]>();
    for (const r of rows) {
      const day = new Date(r.when).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      const list = map.get(day) ?? [];
      list.push(r);
      map.set(day, list);
    }
    return [...map.entries()].map(([day, items]) => ({ day, items }));
  }, [rows]);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="px-5 md:px-6 pt-5 pb-3 border-b border-divider flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-title min-w-0">
          <span className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0"><Icon name="calendar-day" /></span>
          <div className="min-w-0">
            <div className="text-xl font-semibold leading-tight">{translate({ key: 'workspaces.scheduledPosts.title' })}</div>
            <div className="text-xs text-muted truncate">{translate({ key: 'workspaces.scheduledPosts.tagline' })}</div>
          </div>
        </div>
      </div>

      <div className="p-5 md:p-6 flex flex-col gap-6 max-w-3xl">
        {rows.length === 0 && (
          <div className="text-sm text-muted py-10 text-center border border-dashed border-container1-border rounded-2xl">{translate({ key: 'workspaces.scheduledPosts.empty' })}</div>
        )}

        {groups.map((g) => (
          <div key={g.day} className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted uppercase tracking-wide">{g.day}</div>
            <div className="flex flex-col gap-2">
              {g.items.map((r, i) => (
                <button key={`${r.pieceId}-${r.platform}-${String(i)}`} type="button" onClick={() => { navigate(`content/${r.pieceId}`); }} className="text-left rounded-2xl border border-container1-border bg-container1 hover:bg-container2 p-4 flex items-center gap-3 cursor-pointer transition-colors">
                  <span className="w-9 h-9 shrink-0 rounded-xl bg-primary/12 text-primary flex items-center justify-center"><Icon name="paper-plane" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-title truncate">{r.pieceTitle}</div>
                    <div className="text-xs text-muted truncate">
                      {r.platform}
                      {r.channelName ? ` · ${r.channelName}` : ''}
                    </div>
                  </div>
                  <div className="text-xs text-muted shrink-0 tabular-nums">{new Date(r.when).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
