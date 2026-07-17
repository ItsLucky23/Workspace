//? intent: a document's editor — write markdown (or let the AI draft it: generate/rewrite/summarize/
//? extend with your instruction), review the AI draft side-by-side and apply or discard it (the apply
//? is the consent — the AI never overwrites your text), attach uploaded or AI-generated images, and
//? save. Exports (PDF/Word/Excel/HTML) follow in the export phase.

import { useEffect, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import MarkdownView from '../../_components/MarkdownView';
import { MediaUploadButton } from '../../_components/MediaUploadButton';
import { EmptyState, Segmented, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export const template = 'workspaces';

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

const AI_MODES = ['generate', 'rewrite', 'summarize', 'extend'] as const;

export default function DocumentDetail({ params }: { params: Record<string, string | undefined> }) {
  const translate = useTranslator();
  const id = params.docid ?? '';
  const { documents, editDocument, runDocumentAi, applyDocumentDraft, discardDocumentDraft, genDocumentImage, navigate, activeWorkspace } = useWorkspaces();
  const doc = documents.find((d) => d.id === id);

  const [title, setTitle] = useState(doc?.title ?? '');
  const [content, setContent] = useState(doc?.content ?? '');
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [aiMode, setAiMode] = useState<string>('rewrite');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');

  //? Server refetches land here: adopt them unless the user has local unsaved edits.
  useEffect(() => {
    if (!doc || dirty) return;
    setTitle(doc.title);
    setContent(doc.content);
  }, [doc, dirty]);
  //? The AI run finished when a draft appears — release the busy flag.
  useEffect(() => { if (doc?.aiDraft !== null) setAiBusy(false); }, [doc?.aiDraft]);

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
          onKeyDown={(e) => { if (e.key === 'Enter' && !aiBusy) { setAiBusy(true); runDocumentAi(doc.id, aiMode, aiInstruction); } }}
          placeholder={translate({ key: 'workspaces.documents.aiInstructionPlaceholder' })} className={`${fieldCls} flex-1 min-w-52`}
        />
        <WsButton icon="wand-magic-sparkles" disabled={aiBusy} onClick={() => { setAiBusy(true); runDocumentAi(doc.id, aiMode, aiInstruction); }}>
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
          <div className="max-h-72 overflow-auto rounded bg-container1 p-3"><MarkdownView markdown={doc.aiDraft} /></div>
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

      {/* Assets: uploads + AI-generated images. */}
      <div className="pt-2 border-t border-divider">
        <div className="text-sm font-semibold text-title mb-2">{translate({ key: 'workspaces.documents.assetsTitle' })}</div>
        <div className="flex flex-wrap gap-2 mb-2">
          {doc.assets.map((a, i) => (
            <a key={`${a.url}-${String(i)}`} href={a.url} target="_blank" rel="noreferrer" className="block w-28">
              {a.kind === 'image' && !a.stub
                ? <img src={a.url} alt={a.label} className="w-28 h-20 object-cover rounded-lg border border-container1-border" />
                : <span className="w-28 h-20 rounded-lg border border-container1-border bg-container2 flex items-center justify-center text-muted"><Icon name={a.stub ? 'circle-question' : 'file-lines'} /></span>}
              <span className="text-[11px] text-muted truncate block mt-0.5">{a.label}</span>
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={imgPrompt} onChange={(e) => { setImgPrompt(e.target.value); }} placeholder={translate({ key: 'workspaces.documents.imagePromptPlaceholder' })} className={`${fieldCls} flex-1 min-w-52 max-w-md`} />
          <WsButton icon="image" disabled={imgPrompt.trim().length === 0} onClick={() => { genDocumentImage(doc.id, imgPrompt.trim()); setImgPrompt(''); }}>{translate({ key: 'workspaces.documents.genImage' })}</WsButton>
          <MediaUploadButton workspaceId={activeWorkspace.id} accept="image/*,application/pdf" labelKey="workspaces.documents.upload" icon="plus" onUploaded={(url, kind) => { editDocument({ documentId: doc.id, addAssetUrl: url, addAssetKind: kind, addAssetLabel: translate({ key: 'workspaces.documents.uploadedLabel' }) }); }} />
        </div>
      </div>
    </div>
  );
}
