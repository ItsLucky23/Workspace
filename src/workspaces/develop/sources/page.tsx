//? intent: Sources — what the workspace's AI works from: context docs (loaded whole,
//? frozen per commit). Primary action = upload a spec (.md/.txt → InfoSource).
//? Maintenance ops (scan repo / reindex code / reindex memory) sit together in one
//? secondary header menu; the RAG code-index status lives in a collapsed disclosure;
//? the rare per-doc AI-editable setting moved into the Details dialog. Clicking a doc
//? opens a read-only preview (right sheet, lots of content); Details opens a small
//? CENTERED overlay via menuHandler (little data). Phone-first: the header wraps
//? so Upload stays full-width tappable, grids collapse to one column.
//? (The old Skills tab is gone: capability skills were demo-only fabrications no real
//? workspace could ever populate — removed with the capability-skill layer.)

import { useEffect, useRef, useState } from 'react';

import { apiRequest, i18nNotify as notify, tryCatch, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import { Sheet } from '../../_components/motion';
import { Disclosure, EmptyState, IconButton, InfoTip, PopMenu, Toggle, WsButton, type PopMenuItem } from '../../_components/primitives';
import { SavePill, type SaveStatus } from '../../_components/settings';
import type { InfoDoc, RagIndexStatus } from '../../_data/types';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

const SOURCE_TINT: Record<InfoDoc['source'], string> = {
  generated: 'bg-primary/12 text-primary',
  git: 'bg-container2 text-muted',
  uploaded: 'bg-warning/15 text-warning',
  starter: 'bg-container2 text-common',
  'design-system': 'bg-correct/15 text-correct',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 py-2.5 border-b border-divider last:border-0`}>
      <span className={`text-xs text-muted`}>{label}</span>
      <div className={`text-sm text-title`}>{children}</div>
    </div>
  );
}

//? Rendered inside menuHandler's centered modal — ABOVE WorkspacesProvider, so the
//? toggle op is injected as a prop (lesson 0011: never useWorkspaces in here).
//? Local state keeps the toggle live across taps; `next` (not a stale doc closure)
//? is what reaches toggleSkill, so double-toggling stays correct.
function DocDetail({ doc, onSetAiEditable }: { doc: InfoDoc; onSetAiEditable: (next: boolean) => void }) {
  const translate = useTranslator();
  const [aiEditable, setAiEditable] = useState(doc.aiEditable);
  return (
    <div className={`p-5 w-full`}>
      <DetailHead title={doc.name} />
      <DetailRow label={translate({ key: 'workspaces.sources.summary' })}>{doc.summary}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.source' })}>{doc.source}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.lastUpdated' })}>{doc.updated} · {doc.note}</DetailRow>
      {doc.pendingBranches && <DetailRow label={translate({ key: 'workspaces.sources.notYetProcessed' })}><span className={`text-warning`}>{doc.pendingBranches.join(', ')}</span></DetailRow>}
      <DetailRow label={translate({ key: 'workspaces.sources.aiEditable' })}>
        <div className={`flex flex-col gap-1.5`}>
          <div className={`flex items-center gap-2`}>
            <Toggle on={aiEditable} onChange={(next) => { setAiEditable(next); onSetAiEditable(next); }} ariaLabel={doc.name} />
            {/* The label reads as a write-permission; the switch actually decides whether the doc's TEXT
                reaches the AI, and it starts OFF on everything you upload or scan. */}
            <InfoTip
              align="start"
              label={translate({ key: 'workspaces.tips.sources.aiEditableAria' })}
              title={translate({ key: 'workspaces.tips.sources.aiEditableTitle' })}
              body={translate({ key: 'workspaces.tips.sources.aiEditableBody' })}
              points={[
                { id: 'default', label: translate({ key: 'workspaces.tips.sources.aiEditableDefault' }), desc: translate({ key: 'workspaces.tips.sources.aiEditableDefaultDesc' }) },
                { id: 'not-a-lock', label: translate({ key: 'workspaces.tips.sources.aiEditableNotALock' }), desc: translate({ key: 'workspaces.tips.sources.aiEditableNotALockDesc' }) },
              ]}
            />
          </div>
          <span className={`text-xs text-muted`}>{translate({ key: 'workspaces.sources.aiEditableHint' })}</span>
        </div>
      </DetailRow>
    </div>
  );
}

function DetailHead({ title }: { title: string }) {
  const translate = useTranslator();
  return (
    <div className={`flex items-center justify-between gap-2 mb-2`}>
      <span className={`font-mono text-sm font-semibold text-title truncate`}>{title}</span>
      <IconButton icon="xmark" onClick={() => { menuHandler.close(); }} title={translate({ key: 'workspaces.knowledge.detailClose' })} size="sm" />
    </div>
  );
}

const openDetail = (el: React.ReactElement) => void menuHandler.open(el, { dimBackground: true, background: 'bg-container1', size: 'md' });

//? The RAG status, out of the header: collapsed row that keeps the headline
//? (files·chunks, or the "not indexed" hint) visible and tucks the technical
//? detail (embedder, commit) behind one tap.
function CodeIndexStatus({ ragIndex }: { ragIndex: RagIndexStatus | null }) {
  const translate = useTranslator();
  const indexed = ragIndex !== null && ragIndex.files > 0;
  return (
    <Disclosure
      summary={(
        <span className={`flex items-center gap-2 min-w-0`}>
          <Icon name="database" className={`text-muted`} />
          <span className={`shrink-0`}>{translate({ key: 'workspaces.sources.codeIndex' })}</span>
          <span className={`text-xs font-normal font-mono text-muted truncate`}>
            {indexed
              ? translate({ key: 'workspaces.sources.ragIndexed', params: [{ key: 'files', value: ragIndex.files }, { key: 'chunks', value: ragIndex.chunks }] })
              : translate({ key: 'workspaces.sources.ragNotIndexed' })}
          </span>
        </span>
      )}
    >
      {/* The tip sits in the body, not in the summary: the summary is itself a button, and a second
          trigger inside it would toggle the disclosure on every tap. */}
      <div className={`flex items-start gap-2`}>
        {indexed
          ? <div className={`font-mono text-xs text-muted min-w-0 flex-1`}>{translate({ key: 'workspaces.sources.ragEmbedder', params: [{ key: 'embedder', value: ragIndex.embedder || '—' }, { key: 'commit', value: ragIndex.commitHash ? ragIndex.commitHash.slice(0, 7) : '—' }] })}</div>
          : <div className={`text-xs text-muted min-w-0 flex-1`}>{translate({ key: 'workspaces.sources.ragNotIndexedHint' })}</div>}
        <InfoTip
          align="end"
          label={translate({ key: 'workspaces.tips.sources.codeIndexAria' })}
          title={translate({ key: 'workspaces.tips.sources.codeIndexTitle' })}
          body={translate({ key: 'workspaces.tips.sources.codeIndexBody' })}
          points={[
            { id: 'after-reload', label: translate({ key: 'workspaces.tips.sources.codeIndexAfterReload' }), desc: translate({ key: 'workspaces.tips.sources.codeIndexAfterReloadDesc' }) },
            { id: 'after-switch', label: translate({ key: 'workspaces.tips.sources.codeIndexAfterSwitch' }), desc: translate({ key: 'workspaces.tips.sources.codeIndexAfterSwitchDesc' }) },
          ]}
        />
      </div>
    </Disclosure>
  );
}

function DocCard({ doc, onOpen, onSetAiEditable }: { doc: InfoDoc; onOpen: () => void; onSetAiEditable: (next: boolean) => void }) {
  const translate = useTranslator();
  const { scanDocs, infoDocAdmin } = useWorkspaces();
  const archived = doc.archived === true;
  const menuItems: PopMenuItem[] = [{ label: translate({ key: 'workspaces.sources.details' }), onClick: () => { openDetail(<DocDetail doc={doc} onSetAiEditable={onSetAiEditable} />); } }];
  //? #66 — 'Regenerate' re-runs the doc scan (the available action in the frozen surface; no per-doc op).
  if (doc.source !== 'uploaded') menuItems.push({ label: translate({ key: 'workspaces.sources.regenerate' }), icon: 'wave-square', onClick: () => { scanDocs(); notify.success({ key: 'workspaces.sources.regenerateQueued' }); } });
  //? ADR 0310 — retiring a doc. Archive is the reversible default and needs no confirm (it is undoable
  //? from the Archived view one line below); delete destroys the content, so it is confirm-gated and
  //? marked danger. Both are last in the menu, after the read-only actions.
  menuItems.push(
    { divider: true },
    archived
      ? { label: translate({ key: 'workspaces.sources.restore' }), icon: 'arrows-rotate', onClick: () => { infoDocAdmin(doc.id, 'restore'); } }
      : { label: translate({ key: 'workspaces.sources.archive' }), icon: 'box-archive', onClick: () => { infoDocAdmin(doc.id, 'archive'); } },
    {
      label: translate({ key: 'workspaces.sources.delete' }), icon: 'trash', danger: true,
      onClick: () => {
        void menuHandler.confirm({
          title: translate({ key: 'workspaces.sources.deleteConfirmTitle', params: [{ key: 'name', value: doc.name }] }),
          content: translate({ key: 'workspaces.sources.deleteConfirmContent' }),
        }).then((ok) => { if (ok) infoDocAdmin(doc.id, 'delete'); });
      },
    },
  );
  return (
    <div className={`rounded-xl border bg-container1 p-4 flex flex-col gap-2 ${archived ? 'border-dashed border-container2-border opacity-75' : 'border-container1-border'}`}>
      <div className={`flex items-center justify-between gap-2`}>
        <button type="button" onClick={onOpen} className={`flex items-center gap-2 min-w-0 text-left cursor-pointer group`}>
          <Icon name="file-lines" className={`text-muted`} />
          <span className={`font-mono text-sm text-title truncate group-hover:underline`}>{doc.name}</span>
        </button>
        <div className={`flex items-center gap-1.5 shrink-0`}>
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${SOURCE_TINT[doc.source]}`}>{doc.source}</span>
          <PopMenu items={menuItems} ariaLabel={doc.name} />
        </div>
      </div>
      <div className={`flex items-center gap-2 text-xs text-muted min-w-0`}>
        <span className={`shrink-0`}>{translate({ key: 'workspaces.sources.updatedAt', params: [{ key: 'date', value: doc.updated }] })}</span><span>·</span><span className={`font-mono truncate`}>{doc.note}</span>
      </div>
      {doc.pendingBranches && doc.pendingBranches.length > 0 && (
        <div className={`flex items-start gap-1.5 text-xs text-warning`}>
          <Icon name="triangle-exclamation" className={`mt-0.5`} />
          <span>{translate({ key: 'workspaces.sources.notProcessedInFile', params: [{ key: 'branches', value: doc.pendingBranches.join(', ') }] })}</span>
        </div>
      )}
    </div>
  );
}

export const template = 'workspaces';

export default function Sources() {
  const translate = useTranslator();
  const { docs, toggleSkill, scanDocs, scanIndex, ragIndex, repo, activeWorkspace, addInfoDoc, indexMemory, refetch } = useWorkspaces();
  const [preview, setPreview] = useState<InfoDoc | null>(null);
  //? ADR 0310 — the archived split is a VIEW concern; the server already stopped feeding archived docs
  //? to the AI, so this is only about where they render.
  const liveDocs = docs.filter((d) => d.archived !== true);
  const archivedDocs = docs.filter((d) => d.archived === true);
  const [reindexing, setReindexing] = useState(false);
  const [generatingContextDoc, setGeneratingContextDoc] = useState<SaveStatus>('idle');
  const reindexTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  //? K2 — upload a doc (md/txt) → read its text client-side → register it as a context-doc InfoSource.
  const fileRef = useRef<HTMLInputElement>(null);
  const onUploadDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void file.text().then((text) => {
      if (text.trim().length === 0) { notify.error({ key: 'workspaces.sources.emptyFile' }); return; }
      addInfoDoc(file.name, text);
      notify.success({ key: 'workspaces.sources.uploadQueued' });
    });
  };
  const openUpload = () => { fileRef.current?.click(); };
  const startReindex = () => {
    if (reindexTimeoutRef.current !== null) clearTimeout(reindexTimeoutRef.current);
    setReindexing(true);
    scanIndex();
    reindexTimeoutRef.current = setTimeout(() => {
      reindexTimeoutRef.current = null;
      setReindexing(false);
      notify.error({ key: 'workspaces.sources.reindexFailed' });
    }, 120_000);
  };
  const generateContextDoc = () => {
    if (!repo.linked || generatingContextDoc === 'saving') return;
    setGeneratingContextDoc('saving');
    void (async () => {
      const [error, response] = await tryCatch(() => apiRequest({ name: 'workspaces/generateDocs', version: 'v1', data: { workspaceId: activeWorkspace.id } }));
      if (!error && response?.status === 'success' && response.result.ok) {
        setGeneratingContextDoc('saved');
        notify.success({ key: 'workspaces.sources.generateContextDocQueued' });
        refetch();
      } else {
        setGeneratingContextDoc('error');
        notify.error({ key: 'workspaces.sources.generateContextDocFailed' });
      }
    })();
  };
  //? Clear the pending state once the reindex delta lands (the RAG status updates).
  useEffect(() => {
    if (reindexTimeoutRef.current !== null) {
      clearTimeout(reindexTimeoutRef.current);
      reindexTimeoutRef.current = null;
    }
    setReindexing(false);
  }, [ragIndex]);
  useEffect(() => () => {
    if (reindexTimeoutRef.current !== null) clearTimeout(reindexTimeoutRef.current);
  }, []);

  //? One secondary menu for the maintenance ops — never standalone buttons next to the primary Upload.
  const maintenanceItems: PopMenuItem[] = [];
  if (repo.linked) maintenanceItems.push(
    { label: translate({ key: 'workspaces.sources.scanRepo' }), icon: 'magnifying-glass', onClick: () => { scanDocs(); } },
    { label: translate({ key: reindexing ? 'workspaces.sources.reindexing' : 'workspaces.sources.reindexCode' }), icon: 'database', onClick: reindexing ? undefined : startReindex },
  );
  maintenanceItems.push({ label: translate({ key: 'workspaces.sources.reindexMemory' }), icon: 'robot', onClick: () => { indexMemory(); } });

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <input ref={fileRef} type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" onChange={onUploadDoc} className={`hidden`} />

      {/* Header: title + one-line explainer; on phone the actions wrap to their own row so Upload stays full-width tappable. */}
      <div className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 md:px-6 py-3 md:py-4`}>
        <div className={`min-w-0`}>
          <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.sources.title' })}</h1>
          {/* The list is filtered: workspace-wide items (no project) plus the active project's own.
              The snapshot only FILTERS — a "disappeared" item is not lost. */}
          <div className={`mt-1 flex items-center gap-2`}>
            <p className={`text-sm text-muted`}>{translate({ key: 'workspaces.sources.subtitle' })}</p>
            <InfoTip
              align="start"
              label={translate({ key: 'workspaces.tips.sources.scopeAria' })}
              title={translate({ key: 'workspaces.tips.sources.scopeTitle' })}
              body={translate({ key: 'workspaces.tips.sources.scopeBody' })}
            />
          </div>
        </div>
        <div className={`flex items-center gap-2 shrink-0`}>
          <PopMenu items={maintenanceItems} label={translate({ key: 'workspaces.sources.maintenance' })} />
          <WsButton
            variant="secondary" icon="wand-magic-sparkles" disabled={!repo.linked || generatingContextDoc === 'saving'}
            title={repo.linked ? undefined : translate({ key: 'workspaces.sources.generateContextDocDisabled' })}
            onClick={generateContextDoc}
          >
            {translate({ key: 'workspaces.sources.generateContextDoc' })}
          </WsButton>
          <SavePill status={generatingContextDoc} />
          <WsButton icon="plus" onClick={openUpload} className={`flex-1 md:flex-initial`}>{translate({ key: 'workspaces.sources.uploadSpec' })}</WsButton>
        </div>
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5`}>
        <div className={`flex flex-col gap-4`}>
          <CodeIndexStatus ragIndex={ragIndex} />
          {liveDocs.length === 0 && archivedDocs.length === 0
            ? (
              <EmptyState
                icon="file-lines"
                title={translate({ key: 'workspaces.sources.emptyDocsTitle' })}
                sub={translate({ key: 'workspaces.sources.emptyDocsSub' })}
                action={(
                  <div className={`flex flex-col sm:flex-row items-center justify-center gap-2`}>
                    <WsButton icon="plus" onClick={openUpload}>{translate({ key: 'workspaces.sources.uploadSpec' })}</WsButton>
                    {repo.linked && <WsButton variant="secondary" icon="magnifying-glass" onClick={() => { scanDocs(); }}>{translate({ key: 'workspaces.sources.scanRepo' })}</WsButton>}
                  </div>
                )}
              />
            )
            : <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3`}>{liveDocs.map((d) => <DocCard key={d.id} doc={d} onOpen={() => { setPreview(d); }} onSetAiEditable={(next) => { toggleSkill(d.id, next); }} />)}</div>}
          {/* ADR 0310 — archived docs stay reachable but out of the way: they no longer feed any AI,
              so they do not belong in the main grid, and they are not destroyed, so they must not
              vanish either. A collapsed disclosure is exactly that middle ground. */}
          {archivedDocs.length > 0 && (
            <Disclosure summary={translate({ key: 'workspaces.sources.archivedCount', params: [{ key: 'n', value: String(archivedDocs.length) }] })}>
              <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3`}>
                {archivedDocs.map((d) => <DocCard key={d.id} doc={d} onOpen={() => { setPreview(d); }} onSetAiEditable={(next) => { toggleSkill(d.id, next); }} />)}
              </div>
            </Disclosure>
          )}
        </div>
      </div>

      <Sheet open={preview !== null} onClose={() => { setPreview(null); }} side="right" className={`flex flex-col`}>
        {preview && (
          <>
            <div className={`flex items-center justify-between gap-2 px-4 h-14 border-b border-divider shrink-0`}>
              <span className={`font-mono text-sm text-title truncate`}>{preview.name}</span>
              <IconButton icon="xmark" onClick={() => { setPreview(null); }} title={translate({ key: 'workspaces.knowledge.detailClose' })} size="sm" />
            </div>
            <div className={`flex-1 min-h-0 overflow-y-auto p-4`}>
              <pre className={`whitespace-pre-wrap font-mono text-xs text-common leading-relaxed`}>{preview.content}</pre>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
