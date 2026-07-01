//? Workspaces — Sources page. Context docs (loaded whole, frozen per commit)
//? and Skills/MCP (queried on demand). Generated docs show which branches
//? aren't folded in yet. Clicking a doc opens a read-only preview (right sheet,
//? lots of content); Details opens a small CENTERED overlay via menuHandler
//? (little data — no big sidebar). Dummy data; desktop-first.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import { Sheet } from '../_components/motion';
import { EmptyState, Tabs, Toggle, WsButton, type TabDef } from '../_components/primitives';
import { DOCS, SKILLS } from '../_data/seed';
import type { InfoDoc, SkillEntry } from '../_data/types';

const SOURCE_TINT: Record<InfoDoc['source'], string> = {
  generated: 'bg-primary/12 text-primary',
  git: 'bg-container2 text-muted',
  uploaded: 'bg-warning/15 text-warning',
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

function HealthBanner() {
  const translate = useTranslator();
  return (
    <div className="mx-4 md:mx-6 rounded-xl border border-warning/40 bg-warning/10 p-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 text-sm min-w-0 flex-1">
        <Icon name="triangle-exclamation" className="text-warning shrink-0" />
        <span className="text-title font-medium shrink-0">{translate({ key: 'workspaces.sources.ragBehind' })}</span>
        <span className="text-muted truncate">{translate({ key: 'workspaces.sources.ragBehindHint' })}</span>
      </div>
      <WsButton variant="secondary" icon="wave-square">{translate({ key: 'workspaces.sources.reindex' })}</WsButton>
    </div>
  );
}

function DocCard({ doc, onOpen }: { doc: InfoDoc; onOpen: () => void }) {
  const translate = useTranslator();
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
        <button type="button" onClick={onOpen} className="text-xs text-primary hover:underline cursor-pointer inline-flex items-center gap-1"><Icon name="eye" /> {translate({ key: 'workspaces.sources.preview' })}</button>
        {doc.source !== 'uploaded' && <button type="button" className="text-xs text-common hover:text-title cursor-pointer inline-flex items-center gap-1"><Icon name="wave-square" /> {translate({ key: 'workspaces.sources.regenerate' })}</button>}
        <button type="button" onClick={() => { openDetail(<DocDetail doc={doc} />); }} className="text-xs text-common hover:text-title cursor-pointer ml-auto">{translate({ key: 'workspaces.sources.details' })}</button>
      </div>
    </div>
  );
}

function SkillRow({ skill, onToggle }: { skill: SkillEntry; onToggle: () => void }) {
  const translate = useTranslator();
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
      <button type="button" onClick={() => { openDetail(<SkillDetail skill={skill} />); }} className="text-xs text-common hover:text-title cursor-pointer hidden sm:inline">{translate({ key: 'workspaces.sources.details' })}</button>
      {skill.kind === 'frozen' && <button type="button" className="text-xs text-common hover:text-title cursor-pointer hidden sm:inline">{translate({ key: 'workspaces.sources.reindex' })}</button>}
      <Toggle on={skill.on} onChange={onToggle} />
    </div>
  );
}

export default function Sources() {
  const translate = useTranslator();
  const [tab, setTab] = useState('docs');
  const [skills, setSkills] = useState(SKILLS);
  const [preview, setPreview] = useState<InfoDoc | null>(null);

  const tabs: TabDef[] = [
    { id: 'docs', label: translate({ key: 'workspaces.sources.tabDocs' }), icon: 'file-lines', count: DOCS.length },
    { id: 'skills', label: translate({ key: 'workspaces.sources.tabSkills' }), icon: 'robot', count: SKILLS.length },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.sources.title' })}</h1>
        {tab === 'docs' && <WsButton variant="secondary" icon="plus">{translate({ key: 'workspaces.sources.uploadSpec' })}</WsButton>}
      </div>

      <HealthBanner />

      <div className="px-4 md:px-6 mt-3">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        {tab === 'docs' && (
          DOCS.length === 0
            ? <EmptyState icon="file-lines" title={translate({ key: 'workspaces.sources.emptyDocsTitle' })} />
            : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">{DOCS.map((d) => <DocCard key={d.id} doc={d} onOpen={() => { setPreview(d); }} />)}</div>
        )}
        {tab === 'skills' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {skills.map((s) => (
              <SkillRow key={s.id} skill={s} onToggle={() => { setSkills((prev) => prev.map((x) => (x.id === s.id ? { ...x, on: !x.on } : x))); }} />
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
