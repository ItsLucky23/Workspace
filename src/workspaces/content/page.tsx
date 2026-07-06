//? intent: the Content studio — a board of your AI content pieces (script → media → assemble →
//? review → publish) with the media €-budget, so a non-technical user sees everything they've made.

import { useMemo } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { EmptyState } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { ContentPieceSummary } from '../_data/types';

export const template = 'workspaces';

//? The fixed content-pipeline columns (mirrors server CONTENT_STAGES) + their i18n key.
const STAGES: { id: string; key: string }[] = [
  { id: 'idea', key: 'workspaces.content.stageIdea' },
  { id: 'script', key: 'workspaces.content.stageScript' },
  { id: 'generate', key: 'workspaces.content.stageGenerate' },
  { id: 'assemble', key: 'workspaces.content.stageAssemble' },
  { id: 'review', key: 'workspaces.content.stageReview' },
  { id: 'publish', key: 'workspaces.content.stagePublish' },
];

//? Status → a semantic theme token (never an arbitrary color).
const STATUS_DOT: Record<string, string> = {
  idle: 'bg-muted', busy: 'bg-primary', done: 'bg-correct', 'needs-input': 'bg-warning', paused: 'bg-muted', stuck: 'bg-wrong',
};

const euros = (cents: number): string => `€${(cents / 100).toFixed(2)}`;

function PieceCard({ piece, onOpen }: { piece: ContentPieceSummary; onOpen: () => void }) {
  return (
    <button
      type="button" onClick={onOpen}
      className="w-full text-left rounded-xl border border-container1-border bg-container1 p-3 hover:bg-container2/50 hover:border-container2-border transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-title line-clamp-2">{piece.title}</span>
        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[piece.status] ?? 'bg-muted'}`} />
      </div>
      <div className="mt-2">
        <span className="inline-block rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-medium text-muted capitalize">{piece.format}</span>
      </div>
    </button>
  );
}

export default function Content() {
  const { content, navigate } = useWorkspaces();
  const translate = useTranslator();

  const byStage = useMemo(() => {
    const map = new Map<string, ContentPieceSummary[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const p of content.pieces) {
      const list = map.get(p.stageId);
      if (list) list.push(p);
      else map.set(p.stageId, [p]);
    }
    return map;
  }, [content.pieces]);

  const budget = content.mediaBudget;
  const pct = budget.enabled && budget.capCents > 0 ? Math.min(100, Math.round((budget.spentCents / budget.capCents) * 100)) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.content.title' })}</h1>
          <span className="text-sm text-muted">{translate({ key: 'workspaces.content.subtitle' })}</span>
        </div>
        <div className="flex items-center gap-3">
        <button type="button" onClick={() => { navigate('content/insights'); }} title={translate({ key: 'workspaces.content.insights' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 hover:bg-container2 text-muted hover:text-common text-sm flex items-center gap-2 cursor-pointer">
          <Icon name="chart-column" /> <span className="hidden md:inline">{translate({ key: 'workspaces.content.insights' })}</span>
        </button>
        <button type="button" onClick={() => { navigate('content/settings'); }} title={translate({ key: 'workspaces.content.settings' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 hover:bg-container2 text-muted hover:text-common text-sm flex items-center gap-2 cursor-pointer">
          <Icon name="gear" /> <span className="hidden md:inline">{translate({ key: 'workspaces.content.settings' })}</span>
        </button>
        {/* Media €-budget summary (F0.2) — always visible so a cost-sensitive user sees spend at a glance. */}
        <div className="hidden sm:block rounded-xl border border-container1-border bg-container1 px-3 py-2 min-w-52">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted">{translate({ key: 'workspaces.content.budgetTitle' })}</span>
            <span className="text-title font-medium tabular-nums">
              {budget.enabled ? `${euros(budget.spentCents)} ${translate({ key: 'workspaces.content.budgetOf' })} ${euros(budget.capCents)}` : translate({ key: 'workspaces.content.budgetNoCap' })}
            </span>
          </div>
          {budget.enabled && (
            <div className="mt-1.5 h-1.5 rounded-full bg-container2 overflow-hidden">
              <div className={`h-full rounded-full ${budget.overAlert ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${String(pct)}%` }} />
            </div>
          )}
        </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 md:px-6 pb-8">
        {content.pieces.length === 0 ? (
          <EmptyState icon="wand-magic-sparkles" title={translate({ key: 'workspaces.content.empty' })} sub={translate({ key: 'workspaces.content.emptySub' })} />
        ) : (
          <div className="flex gap-4 min-w-max">
            {STAGES.map((s) => {
              const pieces = byStage.get(s.id) ?? [];
              return (
                <div key={s.id} className="w-64 shrink-0 flex flex-col">
                  <div className="flex items-center justify-between gap-2 px-1 pb-2">
                    <span className="text-sm font-semibold text-title">{translate({ key: s.key })}</span>
                    <span className="rounded-full bg-container2 px-2 text-xs text-muted tabular-nums">{pieces.length}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {pieces.map((p) => <PieceCard key={p.id} piece={p} onOpen={() => { navigate(`content/${p.id}`); }} />)}
                    {pieces.length === 0 && (
                      <div className="rounded-xl border border-dashed border-divider py-6 text-center text-xs text-disabled">
                        <Icon name="wand-magic-sparkles" className="opacity-50" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
