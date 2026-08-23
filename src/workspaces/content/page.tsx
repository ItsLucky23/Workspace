//? intent: the Content studio home — ONE primary action (create a new piece) above the 6-stage kanban of
//? every AI content piece (idea → script → media → assemble → review → publish); comments, the media
//? library, archived pieces and the Insights/Settings jumps live behind secondary header triggers, with
//? the media €-budget always one glance (and one tap) away.

import { useEffect, useMemo, useState } from 'react';

import { tryCatch } from '@luckystack/core';
import { apiRequest, useTranslator, i18nNotify as notify } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import Icon from '../_components/Icon';
import { Collapse } from '../_components/motion';
import { ClickableCard, EmptyState, FOCUS_RING, IconButton, InfoTip, PopMenu, WsButton, type PopMenuItem } from '../_components/primitives';
import { INPUT_CLS as fieldCls } from '../_components/settings';
import { EmptyPicker } from '../_components/SetupNotice';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { ContentPieceSummary, ContentSnapshot, SocialCommentSummary } from '../_data/types';
import { assetHref } from './[pieceId]/assetHref';

//? The library card's preview: image / silent video frame / a kind icon for audio-ish assets.
function LibraryThumb({ asset, pieceTitle }: { asset: Pick<ContentSnapshot['assetLibrary'][number], 'kind' | 'url'>; pieceTitle: string }) {
  const href = assetHref(asset.url);
  if (asset.kind === 'image' && href) return <img src={href} alt={pieceTitle} className={`w-full h-full object-cover`} />;
  if ((asset.kind === 'render' || asset.kind === 'video') && href) return <video src={href} muted playsInline className={`w-full h-full object-cover`} />;
  return <Icon name="wave-square" className={`text-2xl text-muted`} />;
}

//? Gap-fix — "use in piece": a compact piece-picker under each library asset (content-import-asset).
function LibraryUsePicker({ pieces, onPick, translate }: { pieces: ContentPieceSummary[]; onPick: (pieceId: string) => void; translate: ReturnType<typeof useTranslator> }) {
  //? With every piece archived the picker holds only its own placeholder, and choosing it silently does
  //? nothing — say WHAT is missing instead of offering a dropdown that cannot be used.
  if (pieces.length === 0) return <EmptyPicker icon="file-lines" label={translate({ key: 'workspaces.tips.content.noLivePieces' })} />;
  const items: DropdownItem[] =[{ id: '', value: '', item: translate({ key: 'workspaces.content.libraryUseIn' }) }, ...pieces.map((p) => ({ id: p.id, value: p.id, item: p.title }))];
  return <Dropdown size="sm" width="full" value={items[0]} items={items} onChange={(it) => { const id = String(it.id); if (id) onPick(id); }} />;
}

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
  const canCreate = title.trim().length > 0 && brief.trim().length > 0;
  const submit = () => {
    if (!canCreate) return;
    onCreate({ title: title.trim(), brief: brief.trim(), format });
    void menuHandler.close();
  };
  return (
    <div className={`w-full flex flex-col gap-3 p-5`}>
      <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.content.newPieceTitle' })}</div>
      <input value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.content.newPieceTitlePlaceholder' })} className={fieldCls} />
      <textarea value={brief} onChange={(e) => { setBrief(e.target.value); }} rows={4} placeholder={translate({ key: 'workspaces.content.newPieceBriefPlaceholder' })} className={`${fieldCls} h-auto py-2 resize-y`} />
      <div className={`flex flex-col gap-1`}>
        <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.content.newPieceFormat' })}</span>
        <Dropdown size="sm" width="full" items={formatItems} value={formatItems.find((i) => i.id === format)} onChange={(it) => { setFormat(String(it.id)); }} />
      </div>
      <div className={`flex items-center justify-end gap-2`}>
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
    <ClickableCard onClick={onOpen}>
      <div className={`flex items-start justify-between gap-2`}>
        <span className={`text-sm font-medium text-title line-clamp-2`}>{piece.title}</span>
        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[piece.status] ?? 'bg-muted'}`} />
      </div>
      <div className={`mt-2`}>
        <span className={`inline-block rounded-md bg-container2 px-1.5 py-0.5 text-[11px] font-medium text-muted capitalize`}>{piece.format}</span>
      </div>
    </ClickableCard>
  );
}

//? One kanban column (also used for pieces whose stageId the fixed list doesn't know — they render as an
//? extra column named after the raw id rather than being dropped).
function StageColumn({ label, pieces, onOpenPiece }: { label: string; pieces: ContentPieceSummary[]; onOpenPiece: (id: string) => void }) {
  return (
    <div className={`w-64 shrink-0 flex flex-col`}>
      <div className={`flex items-center justify-between gap-2 px-1 pb-2`}>
        <span className={`text-sm font-semibold text-title`}>{label}</span>
        <span className={`rounded-full bg-container2 px-2 text-xs text-muted tabular-nums`}>{pieces.length}</span>
      </div>
      <div className={`flex flex-col gap-2`}>
        {pieces.map((p) => <PieceCard key={p.id} piece={p} onOpen={() => { onOpenPiece(p.id); }} />)}
        {pieces.length === 0 && (
          <div className={`rounded-xl border border-dashed border-divider py-6 text-center text-xs text-disabled`}>
            <Icon name="wand-magic-sparkles" className={`opacity-50`} />
          </div>
        )}
      </div>
    </div>
  );
}

//? A secondary view's header: what this section IS + the way back to the board (exactly one view is
//? active at a time; the board is always the default).
function PanelHeader({ icon, label, badge, onClose, closeTitle }: { icon: string; label: string; badge?: number; onClose: () => void; closeTitle: string }) {
  return (
    <div className={`flex items-center gap-2`}>
      <Icon name={icon} className={`text-muted`} />
      <span className={`text-base font-semibold text-title`}>{label}</span>
      {badge !== undefined && badge > 0 && <span className={`rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-semibold tabular-nums`}>{badge}</span>}
      <IconButton icon="xmark" title={closeTitle} onClick={onClose} className={`ml-auto`} />
    </div>
  );
}

//? Exactly one of these is on screen; 'board' is the home view.
type ContentView = 'board' | 'comments' | 'library' | 'archived';

export default function Content() {
  const { content, navigate, focusSetup, createContentPiece, runContentOp, copilotPrefill, consumeCopilotPrefill, refreshComments, markCommentsRead, replyToComment, activeWorkspace, setAssetStarred } = useWorkspaces();
  const translate = useTranslator();
  const [view, setView] = useState<ContentView>('board');
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
  //? Stage ids the fixed column list doesn't know still get a column (don't drop those pieces).
  const extraStageIds = useMemo(() => [...byStage.keys()].filter((id) => !STAGES.some((s) => s.id === id)), [byStage]);
  const archivedPieces = useMemo(() => content.pieces.filter((p) => p.archived), [content.pieces]);
  const liveEmpty = content.pieces.every((p) => p.archived);

  //? G4 — use the same workspace-wide library as the document picker: starred assets first,
  //? then newest, with one shared star marker across every surface.
  const [libraryKind, setLibraryKind] = useState('all');
  const libraryAssets = content.assetLibrary;
  const libraryKinds = useMemo(() => ['all', ...new Set(libraryAssets.map((asset) => asset.kind))], [libraryAssets]);
  const libraryFiltered = libraryKind === 'all' ? libraryAssets : libraryAssets.filter((asset) => asset.kind === libraryKind);

  //? If a secondary view's data empties out from under it (last piece restored / library drained), fall
  //? back to the board instead of stranding the user on a blank panel whose trigger no longer renders.
  useEffect(() => {
    if (view === 'archived' && archivedPieces.length === 0) setView('board');
    if (view === 'library' && libraryAssets.length === 0) setView('board');
  }, [view, archivedPieces.length, libraryAssets.length]);

  //? GAP_SCAN F5 — the reply composer: which comment is open, the text (AI-drafted or typed), and whether a
  //? draft is in flight. The text is ALWAYS the user's to edit before it can be sent.
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const openReply = (commentId: string): void => { setReplyFor(commentId); setReplyText(''); };
  const draftReplyFor = (commentId: string): void => {
    if (replyBusy) return;
    setReplyBusy(true);
    void tryCatch(() => apiRequest({ name: 'workspaces/commentReplyDraft', version: 'v1', data: { workspaceId: activeWorkspace.id, commentId } })).then(([err, res]) => {
      setReplyBusy(false);
      if (!err && res?.status === 'success') setReplyText(res.result.text);
      else notify.error({ key: 'workspaces.comments.draftFailed' });
    });
  };
  const sendReply = (commentId: string): void => {
    const text = replyText.trim();
    if (text.length === 0) return;
    replyToComment(commentId, text);
    setReplyFor(null);
    setReplyText('');
  };
  const channelName = (id: string | null): string => content.channels.find((c) => c.id === id)?.name ?? translate({ key: 'workspaces.comments.noChannel' });
  const commentGroups = useMemo(() => {
    const groups = new Map<string, SocialCommentSummary[]>();
    for (const c of content.comments) {
      const key = c.channelId ?? '';
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    return [...groups.entries()];
  }, [content.comments]);

  //? Media €-budget (F0.2) — a compact always-visible chip (also on phones); tap → the full figures.
  const [budgetOpen, setBudgetOpen] = useState(false);
  const budget = content.mediaBudget;
  const pct = budget.enabled && budget.capCents > 0 ? Math.min(100, Math.round((budget.spentCents / budget.capCents) * 100)) : 0;

  //? Rare actions live behind ONE overflow trigger: the library + archived secondary views (only when
  //? they have content) and the Insights/Settings route jumps.
  const overflowItems: PopMenuItem[] = [
    ...(libraryAssets.length > 0 ? [{ label: translate({ key: 'workspaces.content.libraryTab', params: [{ key: 'n', value: String(libraryAssets.length) }] }), icon: 'table-cells-large', onClick: () => { setView('library'); } }] : []),
    ...(archivedPieces.length > 0 ? [{ label: translate({ key: 'workspaces.content.archivedTab', params: [{ key: 'n', value: String(archivedPieces.length) }] }), icon: 'box-archive', onClick: () => { setView('archived'); } }] : []),
    ...(libraryAssets.length > 0 || archivedPieces.length > 0 ? [{ divider: true }] : []),
    { label: translate({ key: 'workspaces.content.insights' }), icon: 'chart-column', onClick: () => { navigate('content/insights'); } },
    { label: translate({ key: 'workspaces.content.settings' }), icon: 'gear', onClick: () => { navigate('content/settings'); } },
  ];

  const closeTitle = translate({ key: 'workspaces.content.backToBoard' });

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <div className={`px-4 md:px-6 py-3 md:py-4 flex flex-wrap items-center gap-x-4 gap-y-2`}>
        <div className={`mr-auto min-w-0`}>
          <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.content.title' })}</h1>
          <span className={`text-sm text-muted`}>{translate({ key: 'workspaces.content.subtitle' })}</span>
        </div>
        <div className={`flex items-center gap-2`}>
          {/* F0.2 — the compact budget chip: spend at a glance at every width; tap for the detail. */}
          <button
            type="button" onClick={() => { setBudgetOpen((v) => !v); }} title={translate({ key: 'workspaces.content.budgetTitle' })}
            className={`h-9 flex items-center gap-2 rounded-xl border px-3 text-xs cursor-pointer transition-colors ${budgetOpen ? 'border-primary bg-primary/10' : 'border-container1-border bg-container1 hover:bg-container2'}`}
          >
            <span className={`font-medium tabular-nums ${budget.overAlert ? 'text-warning' : 'text-title'}`}>{euros(budget.spentCents)}</span>
            {budget.enabled && (
              <span className={`w-10 h-1.5 rounded-full bg-container2 overflow-hidden`}>
                <span className={`block h-full rounded-full ${budget.overAlert ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${String(pct)}%` }} />
              </span>
            )}
          </button>
          {/* CI — the comment-inbox trigger; the unread badge stays visible without opening the inbox. */}
          <button
            type="button"
            onClick={() => { if (view === 'comments') { setView('board'); } else { refreshComments(); setView('comments'); } }}
            aria-label={translate({ key: 'workspaces.comments.tab' })}
            className={`relative h-9 px-3 rounded-lg border text-sm flex items-center gap-2 cursor-pointer ${view === 'comments' ? 'border-primary bg-primary/10 text-primary' : 'border-container1-border bg-container1 hover:bg-container2 text-muted hover:text-common'}`}
          >
            <Icon name="comment" /> <span className={`hidden md:inline`}>{translate({ key: 'workspaces.comments.tab' })}</span>
            {content.unreadComments > 0 && <span className={`absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-title-primary text-[10px] font-semibold flex items-center justify-center`}>{content.unreadComments}</span>}
          </button>
          <PopMenu items={overflowItems} ariaLabel={translate({ key: 'workspaces.content.moreMenu' })} triggerClass={`inline-flex items-center justify-center w-9 h-9 rounded-lg border border-container1-border bg-container1 text-muted hover:bg-container2 hover:text-common transition-colors cursor-pointer`} />
          {/* #125 — THE primary action (was entirely absent — only the AI could create pieces). */}
          <WsButton icon="plus" onClick={openNewPiece}>{translate({ key: 'workspaces.content.newPiece' })}</WsButton>
        </div>
      </div>
      {/* The budget detail — disclosed from the chip: exact figures, or the no-cap state. Read-only by
          design (audit finding: this same figure shows up here, in AdminTab and on insights/usage with
          no link between any of them) — Content settings → Admin owns the write path. */}
      <Collapse open={budgetOpen} className={`mx-4 md:mx-6`}>
        <div className={`mb-3 max-w-md rounded-xl border border-container1-border bg-container1 px-3 py-2`}>
          <div className={`flex items-center justify-between gap-3 text-xs`}>
            <span className={`text-muted flex items-center gap-1.5`}>
              {translate({ key: 'workspaces.content.budgetTitle' })}
              {/* Where the € comes from: this is the media budget's OWN running counter, so it only starts
                  counting once a budget row exists (recordMediaSpend debits with updateMany — a silent
                  no-op without one); placeholders are booked like real generations, and nothing ever
                  resets it. The all-time media total is the separate analytics sum on Insights. */}
              <InfoTip
                align="start"
                label={translate({ key: 'workspaces.tips.content.budgetSourceTitle' })}
                title={translate({ key: 'workspaces.tips.content.budgetSourceTitle' })}
                body={translate({ key: 'workspaces.tips.content.budgetSourceBody' })}
                points={[
                  { id: 'nobudget', label: translate({ key: 'workspaces.tips.content.budgetSourceNoBudget' }), desc: translate({ key: 'workspaces.tips.content.budgetSourceNoBudgetDesc' }), onGo: () => { navigate('content/insights'); }, goLabel: translate({ key: 'workspaces.tips.content.budgetSourceInsightsGo' }) },
                  { id: 'stub', label: translate({ key: 'workspaces.tips.content.budgetSourceStub' }), desc: translate({ key: 'workspaces.tips.content.budgetSourceStubDesc' }) },
                  { id: 'lifetime', label: translate({ key: 'workspaces.tips.content.budgetSourceLifetime' }), desc: translate({ key: 'workspaces.tips.content.budgetSourceLifetimeDesc' }) },
                ]}
              />
            </span>
            <span className={`text-title font-medium tabular-nums flex items-center gap-1.5`}>
              {budget.enabled ? `${euros(budget.spentCents)} ${translate({ key: 'workspaces.content.budgetOf' })} ${euros(budget.capCents)}` : translate({ key: 'workspaces.content.budgetNoCap' })}
              {/* This cap may not be the only limit: the operator CAN configure a server-wide ceiling
                  (WS_HOST_SPEND_CAP_EUR — blank by default) that is checked first and refuses a generation
                  before it starts, even here with no cap. The snapshot doesn't say whether one exists, so
                  the copy stays conditional. */}
              <InfoTip
                align="end"
                label={translate({ key: 'workspaces.tips.content.budgetLimitsTitle' })}
                title={translate({ key: 'workspaces.tips.content.budgetLimitsTitle' })}
                body={translate({ key: 'workspaces.tips.content.budgetLimitsBody' })}
                points={[
                  { id: 'host', label: translate({ key: 'workspaces.tips.content.budgetLimitsHost' }), desc: translate({ key: 'workspaces.tips.content.budgetLimitsHostDesc' }) },
                  { id: 'blocked', label: translate({ key: 'workspaces.tips.content.budgetLimitsBlocked' }), desc: translate({ key: 'workspaces.tips.content.budgetLimitsBlockedDesc' }) },
                ]}
              />
            </span>
          </div>
          {budget.enabled && (
            <div className={`mt-1.5 h-1.5 rounded-full bg-container2 overflow-hidden`}>
              <div className={`h-full rounded-full ${budget.overAlert ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${String(pct)}%` }} />
            </div>
          )}
          <button
            type="button"
            onClick={() => { focusSetup({ view: 'content/settings', tab: 'admin' }); }}
            className={`mt-2 text-xs text-primary hover:underline cursor-pointer flex items-center gap-1`}
          >
            {translate({ key: 'workspaces.content.budgetManageCaps' })} <Icon name="arrow-right" />
          </button>
        </div>
      </Collapse>

      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8`}>
        {view === 'comments' && (
          /* CI + GAP_SCAN F5 — the comment inbox: per channel, newest first; reply = AI-DRAFT (on request)
             then the human's explicit send (B-23). Mark-read is its own control, never a row side effect
             (rows contain buttons; nested buttons are invalid HTML). */
          <div className={`flex flex-col gap-3 max-w-3xl`}>
            <PanelHeader icon="comment" label={translate({ key: 'workspaces.comments.tab' })} badge={content.unreadComments} onClose={() => { setView('board'); }} closeTitle={closeTitle} />
            <div className={`flex items-center gap-2 flex-wrap`}>
              <WsButton variant="secondary" icon="arrows-rotate" onClick={() => { refreshComments(); }}>{translate({ key: 'workspaces.comments.refresh' })}</WsButton>
              {content.unreadComments > 0 && <WsButton variant="ghost" icon="check" onClick={() => { markCommentsRead(); }}>{translate({ key: 'workspaces.comments.markAllRead' })}</WsButton>}
              <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.comments.replyNote' })}</span>
            </div>
            {content.comments.length === 0 && (
              <EmptyState icon="comment" title={translate({ key: 'workspaces.comments.empty' })} sub={translate({ key: 'workspaces.comments.emptySub' })} />
            )}
            {commentGroups.map(([chanKey, rows]) => (
              <div key={chanKey || 'none'} className={`flex flex-col gap-2`}>
                <div className={`text-sm font-semibold text-title`}>{channelName(chanKey || null)}</div>
                {rows.map((c) => (
                  <div key={c.id} className={`rounded-lg border p-2.5 transition-colors ${c.read ? 'border-container1-border bg-container1' : 'border-primary/40 bg-primary/5'}`}>
                    <div className={`flex items-center gap-2 text-xs text-muted`}>
                      <span className={`rounded-full bg-container2 px-1.5 py-0.5`}>{c.platform}</span>
                      <span className={`font-medium text-common truncate`}>{c.author}</span>
                      <span className={`ml-auto shrink-0`}>{new Date(c.publishedAt).toLocaleString()}</span>
                    </div>
                    <div className={`text-sm text-common mt-1 whitespace-pre-wrap`}>{c.text}</div>
                    <div className={`flex items-center gap-3 mt-1.5`}>
                      <button type="button" onClick={() => { openReply(c.id); }} className={`text-xs text-primary hover:underline cursor-pointer`}>{translate({ key: 'workspaces.comments.reply' })}</button>
                      {!c.read && <button type="button" onClick={() => { markCommentsRead(c.id); }} className={`text-xs text-muted hover:text-title cursor-pointer`}>{translate({ key: 'workspaces.comments.markRead' })}</button>}
                    </div>
                    <Collapse open={replyFor === c.id}>
                      <div className={`flex flex-col gap-2 mt-2 pl-3 border-l border-divider`}>
                        <textarea
                          value={replyText} onChange={(e) => { setReplyText(e.target.value); }} rows={2}
                          placeholder={translate({ key: 'workspaces.comments.replyPlaceholder' })}
                          className={`rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none`}
                        />
                        <div className={`flex items-center gap-2 flex-wrap`}>
                          {/* The AI writes a DRAFT; sending is always the human's click (B-23). */}
                          <WsButton variant="ghost" icon={replyBusy ? 'spinner' : 'wand-magic-sparkles'} disabled={replyBusy} onClick={() => { draftReplyFor(c.id); }}>
                            {translate({ key: replyBusy ? 'workspaces.comments.drafting' : 'workspaces.comments.draft' })}
                          </WsButton>
                          <WsButton icon="paper-plane" disabled={replyText.trim().length === 0} onClick={() => { sendReply(c.id); }}>{translate({ key: 'workspaces.comments.send' })}</WsButton>
                          <WsButton variant="ghost" onClick={() => { setReplyFor(null); setReplyText(''); }}>{translate({ key: 'workspaces.comments.cancel' })}</WsButton>
                        </div>
                      </div>
                    </Collapse>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {view === 'library' && (
          /* Gap-fix — the workspace-wide media LIBRARY: filter by kind, reuse any asset in another piece. */
          <div className={`flex flex-col gap-3`}>
            <PanelHeader icon="table-cells-large" label={translate({ key: 'workspaces.content.libraryTab', params: [{ key: 'n', value: String(libraryAssets.length) }] })} onClose={() => { setView('board'); }} closeTitle={closeTitle} />
            <div className={`flex flex-wrap gap-1.5`}>
              {libraryKinds.map((k) => (
                <button key={k} type="button" onClick={() => { setLibraryKind(k); }} className={`rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${libraryKind === k ? 'bg-primary/15 text-primary' : 'bg-container2 text-muted hover:text-common'}`}>
                  {k === 'all' ? translate({ key: 'workspaces.content.libraryAll' }) : k}
                </button>
              ))}
            </div>
            <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3`}>
              {libraryFiltered.map((asset) => (
                <div key={asset.id} className={`rounded-xl border border-container1-border bg-container1 overflow-hidden flex flex-col`}>
                  <button type="button" onClick={() => { navigate(`content/${asset.pieceId}`); }} aria-label={asset.pieceTitle} className={`aspect-video bg-container2 flex items-center justify-center overflow-hidden cursor-pointer ${FOCUS_RING}`}>
                    <LibraryThumb asset={asset} pieceTitle={asset.pieceTitle} />
                  </button>
                  <div className={`p-2 flex flex-col gap-1.5`}>
                    <div className={`flex items-center gap-1.5 text-[11px] text-muted`}>
                      <span className={`rounded-full bg-container2 px-1.5 py-0.5`}>{asset.kind}</span>
                      <span className={`truncate flex-1`}>{asset.pieceTitle}</span>
                      <button type="button" onClick={() => { setAssetStarred(asset.id, !asset.starred); }} title={translate({ key: 'workspaces.content.libraryStar' })} className={`text-[11px] cursor-pointer shrink-0 ${asset.starred ? 'text-warning' : 'text-disabled hover:text-muted'}`}>
                        <Icon name="star" />
                      </button>
                    </div>
                    <LibraryUsePicker pieces={content.pieces.filter((p) => !p.archived)} onPick={(targetId) => { runContentOp('content-import-asset', targetId, { url: asset.url, kind: asset.kind === 'video' || asset.kind === 'render' ? 'video' : 'image' }); notify.success({ key: 'workspaces.content.libraryImported' }); }} translate={translate} />
                  </div>
                </div>
              ))}
            </div>
            {libraryFiltered.length === 0 && <EmptyState icon="table-cells-large" title={translate({ key: 'workspaces.content.libraryEmpty' })} sub={''} />}
          </div>
        )}
        {view === 'archived' && (
          /* #129 — the Archived view: soft-archived pieces with a Restore (content-unarchive) action. */
          <div className={`flex flex-col gap-3 max-w-2xl`}>
            <PanelHeader icon="box-archive" label={translate({ key: 'workspaces.content.archivedTab', params: [{ key: 'n', value: String(archivedPieces.length) }] })} onClose={() => { setView('board'); }} closeTitle={closeTitle} />
            {archivedPieces.map((p) => (
              <div key={p.id} className={`flex items-center gap-3 rounded-xl border border-container1-border bg-container1 p-3`}>
                <Icon name="box-archive" className={`text-muted shrink-0`} />
                <span className={`text-sm font-medium text-title truncate flex-1`}>{p.title}</span>
                <span className={`text-xs text-muted shrink-0`}>{p.format}</span>
                <WsButton variant="secondary" icon="arrows-rotate" onClick={() => { runContentOp('content-unarchive', p.id); }}>{translate({ key: 'workspaces.content.restore' })}</WsButton>
              </div>
            ))}
          </div>
        )}
        {view === 'board' && (liveEmpty ? (
          /* The teaching empty state: what this place IS + the one action that starts everything. */
          <EmptyState
            icon="wand-magic-sparkles"
            title={translate({ key: 'workspaces.content.empty' })}
            sub={translate({ key: 'workspaces.content.emptyTeach' })}
            action={<WsButton icon="plus" onClick={openNewPiece}>{translate({ key: 'workspaces.content.newPiece' })}</WsButton>}
          />
        ) : (
          /* The stage board scrolls horizontally INSIDE its own container — the page body never does. */
          <div className={`overflow-x-auto pb-2`}>
            <div className={`flex gap-4 min-w-max`}>
              {STAGES.map((s) => (
                <StageColumn key={s.id} label={translate({ key: s.key })} pieces={byStage.get(s.id) ?? []} onOpenPiece={(id) => { navigate(`content/${id}`); }} />
              ))}
              {extraStageIds.map((id) => (
                <StageColumn key={id} label={id} pieces={byStage.get(id) ?? []} onOpenPiece={(pid) => { navigate(`content/${pid}`); }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
