//? intent: a document's editor — write markdown (or let the AI draft it: generate/rewrite/summarize/
//? extend with your instruction), review the AI draft side-by-side and apply or discard it (the apply
//? is the consent — the AI never overwrites your text), attach uploaded or AI-generated images, and
//? save. Exports (PDF/Word/Excel/HTML) follow in the export phase.

import { useEffect, useState } from 'react';

import { i18nNotify as notify, tryCatch, useTranslator } from '@luckystack/core/client';

import Dropdown from 'src/_components/dropdown/Dropdown';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import MarkdownView from '../../_components/MarkdownView';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { EmptyState, Segmented, WsButton } from '../../_components/primitives';
import DiffView from '../../board/[ticketId]/DiffView';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { lineDiff, diffStat } from '../lineDiff';

export const template = 'workspaces';

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

const AI_MODES = ['generate', 'rewrite', 'summarize', 'extend'] as const;

//? Icon for a non-image asset tile, reflecting the uploaded-source extract state (pending/failed/ok).
function fileAssetIcon(stub: boolean, extractStatus?: string): string {
  if (stub) return 'circle-question';
  if (extractStatus === 'pending') return 'clock';
  if (extractStatus === 'failed') return 'triangle-exclamation';
  return 'file-lines';
}

export default function DocumentDetail({ params }: { params: Record<string, string | undefined> }) {
  const translate = useTranslator();
  const id = params.docid ?? '';
  const { documents, content: contentSnapshot, editDocument, runDocumentAi, applyDocumentDraft, discardDocumentDraft, genDocumentImage, exportDocument, restoreDocumentRevision, navigate, activeWorkspace } = useWorkspaces();
  const doc = documents.find((d) => d.id === id);

  const [title, setTitle] = useState(doc?.title ?? '');
  const [content, setContent] = useState(doc?.content ?? '');
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [aiMode, setAiMode] = useState<string>('rewrite');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');
  //? C2 — the workspace's already-approved, ready image assets: reusing one costs nothing.
  const [showReuse, setShowReuse] = useState(false);
  const reusableAssets = contentSnapshot.pieces
    .flatMap((piece) => piece.assets.map((a) => ({ ...a, pieceTitle: piece.title })))
    .filter((a) => a.status === 'ready' && !a.stub && (a.kind === 'image' || a.kind === 'thumbnail'))
    .map((a) => ({ id: a.id, url: a.url, label: a.pieceTitle }))
    .slice(0, 12);
  const [exporting, setExporting] = useState<string | null>(null);
  //? Draft review: rendered preview vs a line diff against the current content (apply = consent, B-23).
  const [draftView, setDraftView] = useState<'diff' | 'preview'>('diff');

  //? Server refetches land here: adopt them unless the user has local unsaved edits.
  useEffect(() => {
    if (!doc || dirty) return;
    setTitle(doc.title);
    setContent(doc.content);
  }, [doc, dirty]);
  //? An export finished when a new export asset lands in the refetched snapshot.
  const exports = (doc?.assets ?? []).filter((a) => a.kind === 'export');
  useEffect(() => { setExporting(null); }, [exports.length]);

  if (!doc) {
    return (
      <div className="p-6">
        <EmptyState icon="file-lines" title={translate({ key: 'workspaces.documents.notFound' })} action={<WsButton icon="arrow-left" onClick={() => { navigate('documents'); }}>{translate({ key: 'workspaces.documents.backToList' })}</WsButton>} />
      </div>
    );
  }

  const save = (): void => {
    editDocument({ documentId: doc.id, title: title.trim() || doc.title, content });
    setDirty(false);
  };

  const runAi = (): void => {
    if (aiBusy) return;
    setAiBusy(true);
    void (async () => {
      const [error, errorCode] = await tryCatch(() => runDocumentAi(doc.id, aiMode, aiInstruction));
      setAiBusy(false);
      if (error || errorCode !== null) notify.error({ key: errorCode ?? 'common.unknownError' });
    })();
  };

  const modeItems = AI_MODES.map((m) => ({ id: m, value: m, item: translate({ key: `workspaces.documents.mode.${m}` }) }));

  return (
    <div className="flex flex-col gap-3 p-4 md:p-6 max-w-4xl">
      <div className="flex items-center gap-2 flex-wrap">
        <WsButton variant="ghost" icon="arrow-left" onClick={() => { navigate('documents'); }} title={translate({ key: 'workspaces.documents.backToList' })} />
        <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} className={`${fieldCls} flex-1 min-w-40 font-semibold`} aria-label={translate({ key: 'workspaces.documents.titleLabel' })} />
        <WsButton icon="check" onClick={save} disabled={!dirty}>{translate({ key: 'workspaces.documents.save' })}</WsButton>
      </div>

      {/* AI bar: mode + instruction → a DRAFT (apply = consent, B-23). */}
      <div className="rounded-lg border border-container1-border bg-container1 p-2.5 flex items-center gap-2 flex-wrap">
        <div className="w-36 shrink-0">
          <Dropdown size="sm" value={modeItems.find((m) => m.id === aiMode)} items={modeItems} onChange={(it) => { setAiMode(String(it.id)); }} />
        </div>
        <input
          value={aiInstruction} onChange={(e) => { setAiInstruction(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') runAi(); }}
          placeholder={translate({ key: 'workspaces.documents.aiInstructionPlaceholder' })} className={`${fieldCls} flex-1 min-w-52`}
        />
        <WsButton icon="wand-magic-sparkles" disabled={aiBusy} onClick={runAi}>
          {translate({ key: aiBusy ? 'workspaces.documents.aiBusy' : 'workspaces.documents.aiRun' })}
        </WsButton>
      </div>

      {/* Pending AI draft: preview + apply/discard. */}
      {doc.aiDraft !== null && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold text-title flex items-center gap-2">
              <Icon name="wand-magic-sparkles" className="text-warning" />
              {translate({ key: 'workspaces.documents.draftTitle' })}
              <span className="text-xs text-muted font-normal">{doc.aiDraftLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <WsButton icon="check" onClick={() => { applyDocumentDraft(doc.id); setDirty(false); }}>{translate({ key: 'workspaces.documents.applyDraft' })}</WsButton>
              <WsButton variant="ghost" icon="trash" onClick={() => { discardDocumentDraft(doc.id); }}>{translate({ key: 'workspaces.documents.discardDraft' })}</WsButton>
            </div>
          </div>
          {(() => {
            const diff = lineDiff(doc.content, doc.aiDraft);
            const stat = diffStat(diff);
            const statLabel = `+${String(stat.added)} −${String(stat.removed)}`;
            return (
              <>
                <div className="flex items-center gap-2">
                  <Segmented
                    options={[{ id: 'diff', label: translate({ key: 'workspaces.documents.draftDiff' }) }, { id: 'preview', label: translate({ key: 'workspaces.documents.draftPreview' }) }]}
                    value={draftView} onChange={setDraftView}
                  />
                  <span className="text-xs text-muted">{statLabel}</span>
                </div>
                <div className="max-h-72 overflow-auto rounded bg-container1 p-3">
                  {draftView === 'diff' ? <DiffView lines={diff} /> : <MarkdownView markdown={doc.aiDraft} />}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Editor / preview. */}
      <div className="flex items-center justify-between">
        <Segmented
          options={[{ id: 'edit', label: translate({ key: 'workspaces.documents.tabEdit' }) }, { id: 'preview', label: translate({ key: 'workspaces.documents.tabPreview' }) }]}
          value={tab} onChange={setTab}
        />
      </div>
      {tab === 'edit'
        ? <textarea value={content} onChange={(e) => { setContent(e.target.value); setDirty(true); }} rows={18} placeholder={translate({ key: 'workspaces.documents.contentPlaceholder' })} className={`${fieldCls} min-h-96 py-2 font-mono text-[13px] leading-relaxed resize-y`} />
        : <div className="rounded-lg border border-container1-border bg-container1 p-4 min-h-96"><MarkdownView markdown={content} /></div>}

      {/* EXP — export the markdown source to a target format; results appear under attachments. */}
      <div className="pt-2 border-t border-divider">
        <div className="text-sm font-semibold text-title mb-2">{translate({ key: 'workspaces.documents.exportTitle' })}</div>
        <div className="flex flex-wrap gap-2">
          {(['md', 'html', 'pdf', 'docx', 'xlsx'] as const).map((f) => (
            <WsButton key={f} variant="secondary" icon="file-lines" onClick={() => { setExporting(f); exportDocument(doc.id, f); }} disabled={exporting !== null}>
              {translate({ key: exporting === f ? 'workspaces.documents.exporting' : `workspaces.documents.format.${f}` })}
            </WsButton>
          ))}
        </div>
        {exports.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {exports.map((a, i) => (
              <a key={`${a.url}-${String(i)}`} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline rounded-lg border border-container1-border bg-container1 px-2.5 py-1.5">
                <Icon name="up-right-from-square" />
                {a.label.toUpperCase()}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Assets: uploads + AI-generated images. */}
      <div className="pt-2 border-t border-divider">
        <div className="text-sm font-semibold text-title mb-2">{translate({ key: 'workspaces.documents.assetsTitle' })}</div>
        <div className="flex flex-wrap gap-2 mb-2">
          {doc.assets.filter((a) => a.kind !== 'export').map((a, i) => (
            <a key={`${a.url}-${String(i)}`} href={a.url} target="_blank" rel="noreferrer" className="block w-28">
              {a.kind === 'image' && !a.stub
                ? <img src={a.url} alt={a.label} className="w-28 h-20 object-cover rounded-lg border border-container1-border" />
                : <span className={`w-28 h-20 rounded-lg border border-container1-border bg-container2 flex items-center justify-center ${a.extractStatus === 'failed' ? 'text-warning' : 'text-muted'}`}><Icon name={fileAssetIcon(a.stub === true, a.extractStatus)} /></span>}
              <span className="text-[11px] text-muted truncate block mt-0.5">{a.label}</span>
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={imgPrompt} onChange={(e) => { setImgPrompt(e.target.value); }} placeholder={translate({ key: 'workspaces.documents.imagePromptPlaceholder' })} className={`${fieldCls} flex-1 min-w-52 max-w-md`} />
          <WsButton icon="image" disabled={imgPrompt.trim().length === 0} onClick={() => { genDocumentImage(doc.id, imgPrompt.trim()); setImgPrompt(''); }}>{translate({ key: 'workspaces.documents.genImage' })}</WsButton>
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*,.pdf,.docx,.txt,.md" labelKey="workspaces.documents.upload" icon="plus" onUploaded={(url, kind) => { editDocument({ documentId: doc.id, addAssetUrl: url, addAssetKind: kind, addAssetLabel: translate({ key: 'workspaces.documents.uploadedLabel' }) }); }} />
          {/* GAP_SCAN C2 — reuse before regenerate: the workspace's already-approved media is offered
              first, so an existing visual costs nothing instead of a fresh image-gen. */}
          {reusableAssets.length > 0 && (
            <button type="button" onClick={() => { setShowReuse((v) => !v); }} className="text-xs text-primary hover:underline cursor-pointer">
              {translate({ key: showReuse ? 'workspaces.documents.reuseHide' : 'workspaces.documents.reuseExisting' })} ({String(reusableAssets.length)})
            </button>
          )}
        </div>
        {showReuse && (
          <div className="flex gap-2 flex-wrap mt-1">
            {reusableAssets.map((a) => (
              <button key={a.id} type="button" onClick={() => { genDocumentImage(doc.id, imgPrompt.trim(), a.id); setImgPrompt(''); setShowReuse(false); }}
                className="w-28 shrink-0 text-left cursor-pointer" title={translate({ key: 'workspaces.documents.reuseThis' })}>
                <img src={a.url} alt={a.label} className="w-28 h-20 object-cover rounded-lg border border-container1-border hover:border-primary-border transition-colors" />
                <span className="text-[11px] text-muted truncate block mt-0.5">{a.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* History: prior revisions (restore snapshots current first, so it's undoable). */}
      {doc.revisions.length > 0 && (
        <div className="pt-2 border-t border-divider">
          <div className="text-sm font-semibold text-title mb-2">{translate({ key: 'workspaces.documents.historyTitle' })}</div>
          <div className="flex flex-col gap-1">
            {doc.revisions.slice(0, 12).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-xs rounded-lg border border-container1-border bg-container1 px-2.5 py-1.5">
                <span className="text-muted truncate">{`${new Date(r.createdAt).toLocaleString()} · ${r.note}`}</span>
                <WsButton variant="ghost" icon="clock-rotate-left" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.documents.restoreConfirmTitle' }), content: translate({ key: 'workspaces.documents.restoreConfirmBody' }) }).then((ok) => { if (ok) restoreDocumentRevision(doc.id, r.id); }); }}>{translate({ key: 'workspaces.documents.restore' })}</WsButton>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
