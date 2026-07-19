//? intent: the Content studio — a board of your AI content pieces (script → media → assemble →
//? review → publish) with the media €-budget, so a non-technical user sees everything they've made.

import { useEffect, useMemo, useState } from 'react';

import { tryCatch } from '@luckystack/core';
import { apiRequest, useTranslator, i18nNotify as notify } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import Icon from '../_components/Icon';
import { EmptyState, WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { ContentAssetSummary, ContentPieceSummary, SocialCommentSummary } from '../_data/types';
import { backendUrl } from '../../../config';

//? `/media/<file>` is served by the backend; hosted urls pass through (mirrors the piece page's helper).
function assetHref(url: string): string {
  return url.startsWith('/media/') ? `${backendUrl}${url}` : url;
}

//? The library card's preview: image / silent video frame / a kind icon for audio-ish assets.
function LibraryThumb({ asset, pieceTitle }: { asset: ContentAssetSummary; pieceTitle: string }) {
  if (asset.kind === 'image') return <img src={assetHref(asset.url)} alt={pieceTitle} className="w-full h-full object-cover" />;
  if (asset.kind === 'render' || asset.kind === 'video') return <video src={assetHref(asset.url)} muted playsInline className="w-full h-full object-cover" />;
  return <Icon name="wave-square" className="text-2xl text-muted" />;
}

//? Gap-fix — "use in piece": a compact piece-picker under each library asset (content-import-asset).
function LibraryUsePicker({ pieces, onPick, translate }: { pieces: ContentPieceSummary[]; onPick: (pieceId: string) => void; translate: ReturnType<typeof useTranslator> }) {
  const items: DropdownItem[] = [{ id: '', value: '', item: translate({ key: 'workspaces.content.libraryUseIn' }) }, ...pieces.map((p) => ({ id: p.id, value: p.id, item: p.title }))];
  return <Dropdown size="sm" value={items[0]} items={items} onChange={(it) => { const id = String(it.id); if (id) onPick(id); }} />;
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
  const { content, navigate, createContentPiece, runContentOp, copilotPrefill, consumeCopilotPrefill, refreshComments, markCommentsRead, replyToComment, activeWorkspace } = useWorkspaces();
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

  //? Gap-fix — the WORKSPACE-WIDE media library: every ready asset across all pieces (they were
  //? locked inside their own piece; even the timeline's picker only saw the current piece's assets).
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryKind, setLibraryKind] = useState('all');
  const libraryAssets = useMemo(() => {
    const rows: { asset: ContentAssetSummary; pieceId: string; pieceTitle: string }[] = [];
    for (const p of content.pieces) for (const a of p.assets) {
      if (a.status !== 'ready' || a.stub || !a.url.startsWith('/media/')) continue;
      rows.push({ asset: a, pieceId: p.id, pieceTitle: p.title });
    }
    return rows.toReversed(); //? newest pieces last in snapshot → show newest first
  }, [content.pieces]);
  const libraryKinds = useMemo(() => ['all', ...new Set(libraryAssets.map((r) => r.asset.kind))], [libraryAssets]);
  const libraryFiltered = libraryKind === 'all' ? libraryAssets : libraryAssets.filter((r) => r.asset.kind === libraryKind);

  //? CI — the read-only comment inbox (grouped per channel, newest first; no reply surface).
  const [showComments, setShowComments] = useState(false);
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
        {/* CI — the comment-inbox toggle (unread badge). */}
        <button type="button" onClick={() => { setShowComments((v) => !v); if (!showComments) refreshComments(); }} className={`relative h-9 px-3 rounded-lg border text-sm flex items-center gap-2 cursor-pointer ${showComments ? 'border-primary bg-primary/10 text-primary' : 'border-container1-border bg-container1 hover:bg-container2 text-muted hover:text-common'}`}>
          <Icon name="comment" /> <span className="hidden md:inline">{translate({ key: 'workspaces.comments.tab' })}</span>
          {content.unreadComments > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-title-primary text-[10px] font-semibold flex items-center justify-center">{content.unreadComments}</span>}
        </button>
        {/* Gap-fix — the workspace-wide media library toggle. */}
        {libraryAssets.length > 0 && (
          <button type="button" onClick={() => { setShowLibrary((v) => !v); }} className={`h-9 px-3 rounded-lg border text-sm flex items-center gap-2 cursor-pointer ${showLibrary ? 'border-primary bg-primary/10 text-primary' : 'border-container1-border bg-container1 hover:bg-container2 text-muted hover:text-common'}`}>
            <Icon name="table-cells-large" /> <span className="hidden md:inline">{translate({ key: 'workspaces.content.libraryTab', params: [{ key: 'n', value: String(libraryAssets.length) }] })}</span>
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
        {showComments && (
          /* CI — the read-only comment inbox: per channel, newest first, mark read. NO reply controls. */
          <div className="flex flex-col gap-3 max-w-3xl mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <WsButton variant="secondary" icon="arrows-rotate" onClick={() => { refreshComments(); }}>{translate({ key: 'workspaces.comments.refresh' })}</WsButton>
              {content.unreadComments > 0 && <WsButton variant="ghost" icon="check" onClick={() => { markCommentsRead(); }}>{translate({ key: 'workspaces.comments.markAllRead' })}</WsButton>}
              <span className="text-xs text-muted">{translate({ key: 'workspaces.comments.readOnlyNote' })}</span>
            </div>
            {content.comments.length === 0 && (
              <EmptyState icon="comment" title={translate({ key: 'workspaces.comments.empty' })} sub={translate({ key: 'workspaces.comments.emptySub' })} />
            )}
            {commentGroups.map(([chanKey, rows]) => (
              <div key={chanKey || 'none'} className="flex flex-col gap-2">
                <div className="text-sm font-semibold text-title">{channelName(chanKey || null)}</div>
                {/* GAP_SCAN F5 — the inbox is no longer read-only: each comment can be replied to. The row
                    became a div because it now CONTAINS buttons (nested buttons are invalid HTML), so
                    "mark read" is its own explicit control instead of a side effect of clicking the row. */}
                {rows.map((c) => (
                  <div key={c.id} className={`rounded-lg border p-2.5 transition-colors ${c.read ? 'border-container1-border bg-container1' : 'border-primary/40 bg-primary/5'}`}>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className="rounded-full bg-container2 px-1.5 py-0.5">{c.platform}</span>
                      <span className="font-medium text-common truncate">{c.author}</span>
                      <span className="ml-auto shrink-0">{new Date(c.publishedAt).toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-common mt-1 whitespace-pre-wrap">{c.text}</div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <button type="button" onClick={() => { openReply(c.id); }} className="text-xs text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.comments.reply' })}</button>
                      {!c.read && <button type="button" onClick={() => { markCommentsRead(c.id); }} className="text-xs text-muted hover:text-title cursor-pointer">{translate({ key: 'workspaces.comments.markRead' })}</button>}
                    </div>
                    {replyFor === c.id && (
                      <div className="flex flex-col gap-2 mt-2 pl-3 border-l border-divider">
                        <textarea
                          value={replyText} onChange={(e) => { setReplyText(e.target.value); }} rows={2}
                          placeholder={translate({ key: 'workspaces.comments.replyPlaceholder' })}
                          className="rounded-lg border border-container2-border bg-container2 px-3 py-2 text-sm text-title placeholder:text-disabled focus:outline-none focus:ring-2 focus:ring-focus-ring resize-none"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* The AI writes a DRAFT; sending is always the human's click (B-23). */}
                          <WsButton variant="ghost" icon={replyBusy ? 'spinner' : 'wand-magic-sparkles'} disabled={replyBusy} onClick={() => { draftReplyFor(c.id); }}>
                            {translate({ key: replyBusy ? 'workspaces.comments.drafting' : 'workspaces.comments.draft' })}
                          </WsButton>
                          <WsButton icon="paper-plane" disabled={replyText.trim().length === 0} onClick={() => { sendReply(c.id); }}>{translate({ key: 'workspaces.comments.send' })}</WsButton>
                          <WsButton variant="ghost" onClick={() => { setReplyFor(null); setReplyText(''); }}>{translate({ key: 'workspaces.comments.cancel' })}</WsButton>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {!showComments && showLibrary ? (
          /* Gap-fix — the workspace-wide media LIBRARY: filter by kind, reuse any asset in another piece. */
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {libraryKinds.map((k) => (
                <button key={k} type="button" onClick={() => { setLibraryKind(k); }} className={`rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${libraryKind === k ? 'bg-primary/15 text-primary' : 'bg-container2 text-muted hover:text-common'}`}>
                  {k === 'all' ? translate({ key: 'workspaces.content.libraryAll' }) : k}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {libraryFiltered.map(({ asset, pieceId, pieceTitle }) => (
                <div key={asset.id} className="rounded-xl border border-container1-border bg-container1 overflow-hidden flex flex-col">
                  <button type="button" onClick={() => { navigate(`content/${pieceId}`); }} aria-label={pieceTitle} className="aspect-video bg-container2 flex items-center justify-center overflow-hidden cursor-pointer">
                    <LibraryThumb asset={asset} pieceTitle={pieceTitle} />
                  </button>
                  <div className="p-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                      <span className="rounded-full bg-container2 px-1.5 py-0.5">{asset.kind}</span>
                      <span className="truncate">{pieceTitle}</span>
                    </div>
                    <LibraryUsePicker pieces={content.pieces.filter((p) => !p.archived)} onPick={(targetId) => { runContentOp('content-import-asset', targetId, { url: asset.url, kind: asset.kind === 'video' || asset.kind === 'render' ? 'video' : 'image' }); notify.success({ key: 'workspaces.content.libraryImported' }); }} translate={translate} />
                  </div>
                </div>
              ))}
            </div>
            {libraryFiltered.length === 0 && <EmptyState icon="table-cells-large" title={translate({ key: 'workspaces.content.libraryEmpty' })} sub={''} />}
          </div>
        ) : null}
        {!showComments && !showLibrary && showArchived && (
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
        )}
        {!showComments && !showLibrary && !showArchived && (liveEmpty ? (
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
