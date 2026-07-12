//? Workspaces — Sources page. Context docs (loaded whole, frozen per commit)
//? and Skills/MCP (queried on demand). Generated docs show which branches
//? aren't folded in yet. Clicking a doc opens a read-only preview (right sheet,
//? lots of content); Details opens a small CENTERED overlay via menuHandler
//? (little data — no big sidebar). Docs + skills come from InfoSource rows via
//? the workspace realtime snapshot. Desktop-first.

import { useEffect, useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import { Sheet } from '../_components/motion';
import { EmptyState, PopMenu, Tabs, Toggle, WsButton, type PopMenuItem, type TabDef } from '../_components/primitives';
import type { InfoDoc, SkillEntry } from '../_data/types';
import { useWorkspaces } from '../_shell/WorkspacesContext';

//? Fase 2: no upload/reindex/regenerate ops exist yet (frozen 7+6 control-API surface).
const noop = (): void => { /* Fase 2 */ };

const SOURCE_TINT: Record<InfoDoc['source'], string> = {
  generated: 'bg-primary/12 text-primary',
  git: 'bg-container2 text-muted',
  uploaded: 'bg-warning/15 text-warning',
  starter: 'bg-container2 text-common',
  'design-system': 'bg-correct/15 text-correct',
};

function StageChips({ stages }: { stages?: string[] }) {
  const translate = useTranslator();
  if (!stages || stages.length === 0) return <span className="text-sm text-muted">{translate({ key: 'workspaces.sources.noStages' })}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {stages.map((s) => <span key={s} className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] text-common">{s}</span>)}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 border-b border-divider last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <div className="text-sm text-title">{children}</div>
    </div>
  );
}

//? Rendered inside menuHandler's centered modal.
function DocDetail({ doc }: { doc: InfoDoc }) {
  const translate = useTranslator();
  return (
    <div className="p-5 w-full">
      <DetailHead title={doc.name} />
      <DetailRow label={translate({ key: 'workspaces.sources.summary' })}>{doc.summary}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.source' })}>{doc.source}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.lastUpdated' })}>{doc.updated} · {doc.note}</DetailRow>
      {doc.pendingBranches && <DetailRow label={translate({ key: 'workspaces.sources.notYetProcessed' })}><span className="text-warning">{doc.pendingBranches.join(', ')}</span></DetailRow>}
      <DetailRow label={translate({ key: 'workspaces.sources.loadedByStages' })}><StageChips stages={doc.usedByStages} /></DetailRow>
    </div>
  );
}

function SkillDetail({ skill }: { skill: SkillEntry }) {
  const translate = useTranslator();
  return (
    <div className="p-5 w-full">
      <DetailHead title={skill.name} />
      <DetailRow label={translate({ key: 'workspaces.sources.whatItDoes' })}>{skill.description ?? '—'}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.type' })}>{skill.kind === 'frozen' ? translate({ key: 'workspaces.sources.frozenPerCommit' }) : translate({ key: 'workspaces.sources.live' })}{skill.model ? ` · ${skill.model}` : ''}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.status' })}>{skill.status}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.lastIndexed' })}>{skill.lastIndexed ?? '—'}</DetailRow>
      <DetailRow label={translate({ key: 'workspaces.sources.enabledByStages' })}><StageChips stages={skill.usedByStages} /></DetailRow>
    </div>
  );
}

function DetailHead({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <span className="font-mono text-sm font-semibold text-title truncate">{title}</span>
      <button type="button" onClick={() => menuHandler.close()} className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:bg-container2 cursor-pointer"><Icon name="xmark" /></button>
    </div>
  );
}

const openDetail = (el: React.ReactElement) => void menuHandler.open(el, { dimBackground: true, background: 'bg-container1', size: 'md' });

function DocCard({ doc, onOpen, onToggleAiEditable }: { doc: InfoDoc; onOpen: () => void; onToggleAiEditable: () => void }) {
  const translate = useTranslator();
  const menuItems: PopMenuItem[] = [{ label: translate({ key: 'workspaces.sources.details' }), onClick: () => { openDetail(<DocDetail doc={doc} />); } }];
  if (doc.source !== 'uploaded') menuItems.push({ label: translate({ key: 'workspaces.sources.regenerate' }), icon: 'wave-square', onClick: noop });
  return (
    <div className="rounded-xl border border-container1-border bg-container1 p-4 flex flex-col gap-2">
      <button type="button" onClick={onOpen} className="flex items-center justify-between gap-2 text-left cursor-pointer group">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="file-lines" className="text-muted" />
          <span className="font-mono text-sm text-title truncate group-hover:underline">{doc.name}</span>
        </div>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${SOURCE_TINT[doc.source]}`}>{doc.source}</span>
      </button>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{translate({ key: 'workspaces.sources.updatedAt', params: [{ key: 'date', value: doc.updated }] })}</span><span>·</span><span className="font-mono">{doc.note}</span>
      </div>
      {doc.pendingBranches && doc.pendingBranches.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-warning">
          <Icon name="triangle-exclamation" />
          <span>{translate({ key: 'workspaces.sources.notProcessedInFile', params: [{ key: 'branches', value: doc.pendingBranches.join(', ') }] })}</span>
        </div>
      )}
      <div className="flex items-center gap-3 mt-1">
        <div className="flex items-center gap-1.5" title={translate({ key: 'workspaces.sources.aiEditableHint' })}>
          <span className="text-[11px] text-muted">{translate({ key: 'workspaces.sources.aiEditable' })}</span>
          <Toggle on={doc.aiEditable} onChange={onToggleAiEditable} />
        </div>
        <div className="ml-auto">
          <PopMenu items={menuItems} />
        </div>
      </div>
    </div>
  );
}

function SkillRow({ skill, onToggle }: { skill: SkillEntry; onToggle: () => void }) {
  const translate = useTranslator();
  const menuItems: PopMenuItem[] = [{ label: translate({ key: 'workspaces.sources.details' }), onClick: () => { openDetail(<SkillDetail skill={skill} />); } }];
  if (skill.kind === 'frozen') menuItems.push({ label: translate({ key: 'workspaces.sources.reindex' }), icon: 'database', onClick: noop });
  return (
    <div className="flex items-center gap-3 rounded-xl border border-container1-border bg-container1 px-4 py-3">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${skill.on ? 'bg-primary/12 text-primary' : 'bg-container2 text-muted'}`}><Icon name="robot" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-title truncate">{skill.name}</span>
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${skill.kind === 'frozen' ? 'bg-secondary/12 text-secondary' : 'bg-correct/15 text-correct'}`}>{skill.kind}</span>
        </div>
        <div className="text-xs text-muted truncate">{skill.status}{skill.model ? ` · ${skill.model}` : ''}</div>
      </div>
      <Toggle on={skill.on} onChange={onToggle} />
      <PopMenu items={menuItems} />
    </div>
  );
}

export const template = 'workspaces';

export default function Sources() {
  const translate = useTranslator();
  const { docs, skills, toggleSkill, scanDocs, scanIndex, ragIndex, repo, addInfoDoc, indexMemory } = useWorkspaces();
  const [tab, setTab] = useState('docs');
  const [preview, setPreview] = useState<InfoDoc | null>(null);
  const [reindexing, setReindexing] = useState(false);
  //? K2 — upload a doc (md/txt) → read its text client-side → register it as a context-doc InfoSource.
  const fileRef = useRef<HTMLInputElement>(null);
  const onUploadDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void file.text().then((text) => { if (text.trim().length > 0) addInfoDoc(file.name, text); });
  };
  //? Clear the pending state once the reindex delta lands (the RAG status updates).
  useEffect(() => { setReindexing(false); }, [ragIndex]);

  const tabs: TabDef[] = [
    { id: 'docs', label: translate({ key: 'workspaces.sources.tabDocs' }), icon: 'file-lines', count: docs.length },
    { id: 'skills', label: translate({ key: 'workspaces.sources.tabSkills' }), icon: 'robot', count: skills.length },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.sources.title' })}</h1>
          {tab === 'docs' && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted font-mono">
              <Icon name="database" className="text-muted" />
              {ragIndex && ragIndex.files > 0
                ? (
                  <>
                    <span>{translate({ key: 'workspaces.sources.ragIndexed', params: [{ key: 'files', value: ragIndex.files }, { key: 'chunks', value: ragIndex.chunks }] })}</span>
                    <span>· {translate({ key: 'workspaces.sources.ragEmbedder', params: [{ key: 'embedder', value: ragIndex.embedder || '—' }, { key: 'commit', value: ragIndex.commitHash ? ragIndex.commitHash.slice(0, 7) : '—' }] })}</span>
                  </>
                )
                : <span>{translate({ key: 'workspaces.sources.ragNotIndexed' })}</span>}
            </div>
          )}
        </div>
        {tab === 'docs' && (
          <div className="flex items-center gap-2 shrink-0">
            {(() => {
              const items: PopMenuItem[] = [];
              if (repo.linked) items.push(
                { label: translate({ key: 'workspaces.sources.scanRepo' }), icon: 'magnifying-glass', onClick: () => { scanDocs(); } },
                { label: translate({ key: reindexing ? 'workspaces.sources.reindexing' : 'workspaces.sources.reindexCode' }), icon: 'database', onClick: reindexing ? undefined : () => { setReindexing(true); scanIndex(); } },
              );
              items.push({ label: translate({ key: 'workspaces.sources.reindexMemory' }), icon: 'robot', onClick: () => { indexMemory(); } });
              return <PopMenu items={items} />;
            })()}
            <input ref={fileRef} type="file" accept=".md,.txt,.markdown,text/plain,text/markdown" onChange={onUploadDoc} className="hidden" />
            <WsButton icon="plus" onClick={() => { fileRef.current?.click(); }}>{translate({ key: 'workspaces.sources.uploadSpec' })}</WsButton>
          </div>
        )}
      </div>

      <div className="px-4 md:px-6 mt-3">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        {tab === 'docs' && (
          docs.length === 0
            ? <EmptyState icon="file-lines" title={translate({ key: 'workspaces.sources.emptyDocsTitle' })} />
            : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">{docs.map((d) => <DocCard key={d.id} doc={d} onOpen={() => { setPreview(d); }} onToggleAiEditable={() => { toggleSkill(d.id, !d.aiEditable); }} />)}</div>
        )}
        {tab === 'skills' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {skills.map((s) => (
              <SkillRow key={s.id} skill={s} onToggle={() => { toggleSkill(s.id, !s.on); }} />
            ))}
          </div>
        )}
      </div>

      <Sheet open={preview !== null} onClose={() => { setPreview(null); }} side="right" className="flex flex-col">
        {preview && (
          <>
            <div className="flex items-center justify-between gap-2 px-4 h-14 border-b border-divider shrink-0">
              <span className="font-mono text-sm text-title truncate">{preview.name}</span>
              <button type="button" onClick={() => { setPreview(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:bg-container2 cursor-pointer"><Icon name="xmark" /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap font-mono text-xs text-common leading-relaxed">{preview.content}</pre>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
