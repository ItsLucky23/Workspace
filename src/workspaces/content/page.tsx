//? intent: the Content studio — a board of your AI content pieces (script → media → assemble →
//? review → publish) with the media €-budget, so a non-technical user sees everything they've made.

import { useEffect, useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import Icon from '../_components/Icon';
import { EmptyState, WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { ContentPieceSummary } from '../_data/types';

//? #125 — create a content piece from a brief (title + brief + format), the first UI create path (the
//? board previously had no create affordance at all — only the AI's create-content proposal).
const PIECE_FORMATS = ['faceless', 'talking-head'];
function NewPieceForm({ onCreate, initialTitle = '', initialBrief = '' }: { onCreate: (input: { title: string; brief: string; format: string }) => void; initialTitle?: string; initialBrief?: string }) {
  const translate = useTranslator();
  //? #109 — a copilot directive can pre-fill title/brief (the AI-drives-UI "make a video about X" flow).
  const [title, setTitle] = useState(initialTitle);
  const [brief, setBrief] = useState(initialBrief);
  const [format, setFormat] = useState(PIECE_FORMATS[0] ?? 'faceless');
  const formatItems: DropdownItem[] = PIECE_FORMATS.map((f) => ({ id: f, value: f, item: translate({ key: `workspaces.content.format_${f.replace('-', '_')}` }) }));
  const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
  const canCreate = title.trim().length > 0 && brief.trim().length > 0;
  const submit = () => {
    if (!canCreate) return;
    onCreate({ title: title.trim(), brief: brief.trim(), format });
    void menuHandler.close();
  };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.content.newPieceTitle' })}</div>
      <input value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.content.newPieceTitlePlaceholder' })} className={fieldCls} />
      <textarea value={brief} onChange={(e) => { setBrief(e.target.value); }} rows={4} placeholder={translate({ key: 'workspaces.content.newPieceBriefPlaceholder' })} className={`${fieldCls} h-auto py-2 resize-y`} />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">{translate({ key: 'workspaces.content.newPieceFormat' })}</span>
        <Dropdown size="sm" items={formatItems} value={formatItems.find((i) => i.id === format)} onChange={(it) => { setFormat(String(it.id)); }} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="plus" disabled={!canCreate} onClick={submit}>{translate({ key: 'workspaces.content.newPieceCreate' })}</WsButton>
      </div>
    </div>
  );
}

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
  const { content, navigate, createContentPiece, runContentOp, copilotPrefill, consumeCopilotPrefill } = useWorkspaces();
  const translate = useTranslator();
  const [showArchived, setShowArchived] = useState(false);
  const openNewPiece = () => { void menuHandler.open(<NewPieceForm onCreate={createContentPiece} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); };
  //? #109 — an AI-drives-UI copilot directive that navigated here with a title/brief pre-fill auto-opens the
  //? create form with those values, then consumes the pre-fill so it fires exactly once.
  useEffect(() => {
    const title = copilotPrefill?.title ?? copilotPrefill?.brief;
    if (title === undefined) return;
    void menuHandler.open(<NewPieceForm onCreate={createContentPiece} initialTitle={copilotPrefill?.title ?? ''} initialBrief={copilotPrefill?.brief ?? ''} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
    consumeCopilotPrefill();
  }, [copilotPrefill, createContentPiece, consumeCopilotPrefill]);

  //? #129 — the board shows only live pieces; archived ones live in the Archived view (Restore to bring back).
  const byStage = useMemo(() => {
    const map = new Map<string, ContentPieceSummary[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const p of content.pieces) {
      if (p.archived) continue;
      const list = map.get(p.stageId);
      if (list) list.push(p);
      else map.set(p.stageId, [p]);
    }
    return map;
  }, [content.pieces]);
  const archivedPieces = useMemo(() => content.pieces.filter((p) => p.archived), [content.pieces]);
  const liveEmpty = content.pieces.every((p) => p.archived);

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
        {/* #129 — toggle the Archived view (Restore archived pieces). */}
        {archivedPieces.length > 0 && (
          <button type="button" onClick={() => { setShowArchived((v) => !v); }} className={`h-9 px-3 rounded-lg border text-sm flex items-center gap-2 cursor-pointer ${showArchived ? 'border-primary bg-primary/10 text-primary' : 'border-container1-border bg-container1 hover:bg-container2 text-muted hover:text-common'}`}>
            <Icon name="box-archive" /> <span className="hidden md:inline">{translate({ key: 'workspaces.content.archivedTab', params: [{ key: 'n', value: String(archivedPieces.length) }] })}</span>
          </button>
        )}
        {/* #125 — the primary create affordance (was entirely absent — only the AI could create pieces). */}
        <WsButton icon="plus" onClick={openNewPiece}>{translate({ key: 'workspaces.content.newPiece' })}</WsButton>
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
        {showArchived ? (
          /* #129 — the Archived view: soft-archived pieces with a Restore (content-unarchive) action. */
          <div className="flex flex-col gap-2 max-w-2xl">
            {archivedPieces.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-container1-border bg-container1 p-3">
                <Icon name="box-archive" className="text-muted shrink-0" />
                <span className="text-sm font-medium text-title truncate flex-1">{p.title}</span>
                <span className="text-xs text-muted shrink-0">{p.format}</span>
                <WsButton variant="secondary" icon="rotate-left" onClick={() => { runContentOp('content-unarchive', p.id); }}>{translate({ key: 'workspaces.content.restore' })}</WsButton>
              </div>
            ))}
          </div>
        ) : (liveEmpty ? (
          <div className="flex flex-col items-center gap-4">
            <EmptyState icon="wand-magic-sparkles" title={translate({ key: 'workspaces.content.empty' })} sub={translate({ key: 'workspaces.content.emptySub' })} />
            {/* #125 — empty-state CTA so a first-time user has an obvious way to create. */}
            <WsButton icon="plus" onClick={openNewPiece}>{translate({ key: 'workspaces.content.newPiece' })}</WsButton>
          </div>
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
        ))}
      </div>
    </div>
  );
}
