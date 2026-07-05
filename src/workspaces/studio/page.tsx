//? intent: Studio — the AI design + marketing tool. A user writes a product BRIEF; the AI designer/
//? marketer roles generate a landing page, marketing copy, a brand kit, and a go-to-market strategy,
//? each live-previewed. Built on the pluggable AI-provider layer (ADR 0007) + the AgentRole registry.

import { useEffect, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Icon from '../_components/Icon';
import { WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { StudioArtifact, StudioArtifactKind, StudioBrief } from '../_data/types';

export const template = 'workspaces';

const KINDS: { kind: StudioArtifactKind; icon: string; role: 'designer' | 'marketer' }[] = [
  { kind: 'landing', icon: 'window-maximize', role: 'designer' },
  { kind: 'copy', icon: 'pen-nib', role: 'marketer' },
  { kind: 'brand', icon: 'palette', role: 'designer' },
  { kind: 'strategy', icon: 'chess-knight', role: 'marketer' },
];

const inputCls = 'w-full h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

//? ---- content readers (the AI content is `unknown`; read defensively, no casts to `any`) ----
function asRecord(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
function asStr(v: unknown): string { return typeof v === 'string' ? v : ''; }
function asStrArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }

export default function Studio() {
  const translate = useTranslator();
  const { studioBriefs, studioArtifacts, generateArtifact, deleteBrief, deleteArtifact } = useWorkspaces();
  const [selectedId, setSelectedId] = useState<string | null>(studioBriefs[0]?.id ?? null);
  const [editing, setEditing] = useState<boolean>(studioBriefs.length === 0);
  const [busyKind, setBusyKind] = useState<StudioArtifactKind | null>(null);

  useEffect(() => {
    if (selectedId && !studioBriefs.some((b) => b.id === selectedId)) setSelectedId(studioBriefs[0]?.id ?? null);
    if (!selectedId && studioBriefs[0]) setSelectedId(studioBriefs[0].id);
  }, [studioBriefs, selectedId]);

  const selected = studioBriefs.find((b) => b.id === selectedId) ?? null;
  const artifacts = studioArtifacts.filter((a) => a.briefId === selectedId);

  const runGenerate = async (kind: StudioArtifactKind) => {
    if (!selected) return;
    setBusyKind(kind);
    await generateArtifact(selected.id, kind);
    setBusyKind(null);
  };

  const removeBrief = (b: StudioBrief) => void menuHandler.confirm({
    title: translate({ key: 'workspaces.studio.deleteBriefTitle', params: [{ key: 'name', value: b.name }] }),
    content: translate({ key: 'workspaces.studio.deleteBriefBody' }),
  }).then((ok) => { if (ok) { deleteBrief(b.id); if (selectedId === b.id) setSelectedId(null); } });

  return (
    <div className="flex h-full min-h-0">
      {/* ---- Left rail: briefs ---- */}
      <div className="w-64 shrink-0 border-r border-divider flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0">
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.studio.briefs' })}</div>
          <button type="button" onClick={() => { setEditing(true); setSelectedId(null); }} className="text-muted hover:text-primary cursor-pointer" title={translate({ key: 'workspaces.studio.newBrief' })}><Icon name="plus" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-1">
          {studioBriefs.length === 0 && <div className="text-xs text-muted px-2 py-4 text-center">{translate({ key: 'workspaces.studio.noBriefs' })}</div>}
          {studioBriefs.map((b) => (
            <div key={b.id} onClick={() => { setSelectedId(b.id); setEditing(false); }} className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${selectedId === b.id && !editing ? 'bg-container1' : 'hover:bg-container1/60'}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-title truncate">{b.name}</div>
                <div className="text-xs text-muted truncate">{b.productName}</div>
              </div>
              <button type="button" onClick={(e) => { e.stopPropagation(); removeBrief(b); }} className="text-muted hover:text-wrong opacity-0 group-hover:opacity-100 cursor-pointer shrink-0"><Icon name="trash-can" className="text-xs" /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Main ---- */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {selected && !editing
          ? (
            <div className="p-5 md:p-6 flex flex-col gap-5 max-w-5xl">
              {/* brief header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-semibold text-title">{selected.productName}</div>
                  <div className="text-sm text-muted mt-0.5">{selected.name} · {selected.audience || translate({ key: 'workspaces.studio.noAudience' })}</div>
                </div>
                <WsButton variant="secondary" icon="pen" onClick={() => { setEditing(true); }}>{translate({ key: 'workspaces.studio.editBrief' })}</WsButton>
              </div>

              {/* generate row */}
              <div>
                <div className="text-sm font-medium text-title mb-2">{translate({ key: 'workspaces.studio.generate' })}</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {KINDS.map(({ kind, icon }) => (
                    <button key={kind} type="button" disabled={busyKind !== null} onClick={() => { void runGenerate(kind); }}
                      className={`flex items-center gap-2 rounded-xl border border-container1-border bg-container1 px-3 py-2.5 text-sm text-title hover:border-primary hover:bg-container1-hover transition-colors ${busyKind === null ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                      <Icon name={busyKind === kind ? 'spinner' : icon} className={busyKind === kind ? 'animate-spin text-primary' : 'text-primary'} />
                      <span className="truncate">{translate({ key: `workspaces.studio.kind.${kind}` })}</span>
                    </button>
                  ))}
                </div>
                {busyKind && <div className="text-xs text-muted mt-2 flex items-center gap-1.5"><Icon name="spinner" className="animate-spin" />{translate({ key: 'workspaces.studio.generating' })}</div>}
              </div>

              {/* artifacts */}
              <div className="flex flex-col gap-4">
                {artifacts.length === 0 && !busyKind && <div className="text-sm text-muted py-8 text-center border border-dashed border-container1-border rounded-2xl">{translate({ key: 'workspaces.studio.noArtifacts' })}</div>}
                {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} onDelete={() => { deleteArtifact(a.id); }} />)}
              </div>
            </div>
          )
          : <BriefForm key={selected?.id ?? 'new'} brief={editing ? selected : null} onSaved={() => { setEditing(false); }} onCancel={studioBriefs.length > 0 ? () => { setEditing(false); if (!selectedId) setSelectedId(studioBriefs[0]?.id ?? null); } : undefined} />}
      </div>
    </div>
  );
}

//? ---- Brief form ----
function BriefForm({ brief, onSaved, onCancel }: { brief: StudioBrief | null; onSaved: () => void; onCancel?: () => void }) {
  const translate = useTranslator();
  const { saveBrief } = useWorkspaces();
  const [name, setName] = useState(brief?.name ?? '');
  const [productName, setProductName] = useState(brief?.productName ?? '');
  const [audience, setAudience] = useState(brief?.audience ?? '');
  const [tone, setTone] = useState(brief?.tone ?? '');
  const [goals, setGoals] = useState(brief?.goals ?? '');
  const [notes, setNotes] = useState(brief?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const canSave = name.trim().length > 0 && productName.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    await saveBrief({ ...(brief ? { id: brief.id } : {}), name: name.trim(), productName: productName.trim(), audience: audience.trim(), tone: tone.trim(), goals: goals.trim(), notes: notes.trim() });
    setSaving(false);
    onSaved();
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, area = false) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {area
        ? <textarea value={value} onChange={(e) => { set(e.target.value); }} placeholder={placeholder} rows={3} className={`${inputCls} h-auto py-2 resize-y`} />
        : <input value={value} onChange={(e) => { set(e.target.value); }} placeholder={placeholder} className={inputCls} />}
    </div>
  );

  return (
    <div className="p-5 md:p-6 max-w-2xl flex flex-col gap-4">
      <div className="text-lg font-semibold text-title">{translate({ key: brief ? 'workspaces.studio.editBrief' : 'workspaces.studio.newBrief' })}</div>
      <div className="text-sm text-muted -mt-2">{translate({ key: 'workspaces.studio.briefIntro' })}</div>
      {field(translate({ key: 'workspaces.studio.fieldName' }), name, setName, translate({ key: 'workspaces.studio.fieldNamePlaceholder' }))}
      {field(translate({ key: 'workspaces.studio.fieldProduct' }), productName, setProductName, translate({ key: 'workspaces.studio.fieldProductPlaceholder' }))}
      {field(translate({ key: 'workspaces.studio.fieldAudience' }), audience, setAudience, translate({ key: 'workspaces.studio.fieldAudiencePlaceholder' }))}
      {field(translate({ key: 'workspaces.studio.fieldTone' }), tone, setTone, translate({ key: 'workspaces.studio.fieldTonePlaceholder' }))}
      {field(translate({ key: 'workspaces.studio.fieldGoals' }), goals, setGoals, translate({ key: 'workspaces.studio.fieldGoalsPlaceholder' }), true)}
      {field(translate({ key: 'workspaces.studio.fieldNotes' }), notes, setNotes, translate({ key: 'workspaces.studio.fieldNotesPlaceholder' }), true)}
      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && <WsButton variant="ghost" onClick={onCancel}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>}
        <WsButton icon="check" onClick={() => { void save(); }} disabled={!canSave || saving}>{translate({ key: 'workspaces.studio.saveBrief' })}</WsButton>
      </div>
    </div>
  );
}

//? ---- Artifact card (renders by kind) ----
function ArtifactCard({ artifact, onDelete }: { artifact: StudioArtifact; onDelete: () => void }) {
  const translate = useTranslator();
  const c = asRecord(artifact.content);
  return (
    <div className="rounded-2xl border border-container1-border bg-container1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-divider">
        <Icon name={KINDS.find((k) => k.kind === artifact.kind)?.icon ?? 'file'} className="text-primary" />
        <div className="text-sm font-medium text-title flex-1 truncate">{artifact.title}</div>
        {artifact.status === 'error' && <span className="text-xs text-wrong">{translate({ key: 'workspaces.studio.failed' })}</span>}
        <button type="button" onClick={onDelete} className="text-muted hover:text-wrong cursor-pointer" title={translate({ key: 'workspaces.studio.deleteArtifact' })}><Icon name="trash-can" className="text-xs" /></button>
      </div>
      <div className="p-4">
        {artifact.status === 'error'
          ? <div className="text-sm text-muted">{artifact.error ?? translate({ key: 'workspaces.studio.failed' })}</div>
          : <ArtifactBody kind={artifact.kind} c={c} />}
      </div>
    </div>
  );
}

//? Render the artifact body by kind (avoids a nested ternary at the call site).
function ArtifactBody({ kind, c }: { kind: StudioArtifactKind; c: Record<string, unknown> }): React.ReactNode {
  if (kind === 'landing') return <LandingPreview html={asStr(c.html)} />;
  if (kind === 'brand') return <BrandPreview c={c} />;
  if (kind === 'copy') return <CopyPreview c={c} />;
  return <StrategyPreview markdown={asStr(c.markdown)} />;
}

function LandingPreview({ html }: { html: string }) {
  const translate = useTranslator();
  const [full, setFull] = useState(false);
  if (html.trim().length === 0) return <div className="text-sm text-muted">{translate({ key: 'workspaces.studio.empty' })}</div>;
  return (
    <div className="flex flex-col gap-2">
      <div className={`rounded-xl border border-container1-border overflow-hidden bg-white ${full ? 'h-[70vh]' : 'h-96'}`}>
        {/* sandboxed: no scripts run — a safe visual preview of the generated page */}
        <iframe title="landing-preview" srcDoc={html} sandbox="" className="w-full h-full border-0" />
      </div>
      <div className="flex items-center gap-2">
        <WsButton variant="ghost" icon={full ? 'compress' : 'expand'} onClick={() => { setFull((v) => !v); }}>{translate({ key: full ? 'workspaces.studio.collapse' : 'workspaces.studio.expand' })}</WsButton>
        <WsButton variant="ghost" icon="copy" onClick={() => { void navigator.clipboard.writeText(html); }}>{translate({ key: 'workspaces.studio.copyHtml' })}</WsButton>
      </div>
    </div>
  );
}

function BrandPreview({ c }: { c: Record<string, unknown> }) {
  const translate = useTranslator();
  const palette = Array.isArray(c.palette) ? c.palette.map((x) => asRecord(x)) : [];
  const typo = asRecord(c.typography);
  const taglines = asStrArr(c.taglines);
  const logoIdeas = asStrArr(c.logoIdeas);
  return (
    <div className="flex flex-col gap-4">
      {palette.length > 0 && (
        <div>
          <div className="text-xs text-muted mb-1.5">{translate({ key: 'workspaces.studio.palette' })}</div>
          <div className="flex flex-wrap gap-2">
            {palette.map((p, i) => (
              <div key={`${asStr(p.hex)}-${String(i)}`} className="flex flex-col items-center gap-1">
                <div className="w-14 h-14 rounded-lg border border-container1-border" style={{ backgroundColor: asStr(p.hex) }} />
                <span className="text-[11px] text-muted">{asStr(p.name)}</span>
                <span className="text-[10px] text-disabled font-mono">{asStr(p.hex)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(asStr(typo.heading) || asStr(typo.body)) && (
        <div className="text-sm text-common"><span className="text-muted">{translate({ key: 'workspaces.studio.typography' })}: </span>{asStr(typo.heading)} / {asStr(typo.body)}</div>
      )}
      {asStr(c.voice) && <div className="text-sm text-common"><span className="text-muted">{translate({ key: 'workspaces.studio.voice' })}: </span>{asStr(c.voice)}</div>}
      {taglines.length > 0 && <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.studio.taglines' })}</div><ul className="list-disc list-inside text-sm text-common">{taglines.map((t, i) => <li key={`${t.slice(0,12)}-${String(i)}`}>{t}</li>)}</ul></div>}
      {logoIdeas.length > 0 && <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.studio.logoIdeas' })}</div><ul className="list-disc list-inside text-sm text-common">{logoIdeas.map((t, i) => <li key={`${t.slice(0,12)}-${String(i)}`}>{t}</li>)}</ul></div>}
    </div>
  );
}

function CopyPreview({ c }: { c: Record<string, unknown> }) {
  const sections = Array.isArray(c.sections) ? c.sections.map((x) => asRecord(x)) : [];
  if (sections.length === 0) return <div className="text-sm text-muted">—</div>;
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {sections.map((s, i) => (
        <div key={`${asStr(s.channel)}-${String(i)}`} className="rounded-xl border border-container1-border bg-container2/30 p-3">
          <div className="text-sm font-medium text-title mb-1.5">{asStr(s.channel)}</div>
          <ul className="flex flex-col gap-1.5">{asStrArr(s.items).map((it, j) => <li key={`${it.slice(0,12)}-${String(j)}`} className="text-sm text-common">{it}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function StrategyPreview({ markdown }: { markdown: string }) {
  const translate = useTranslator();
  if (markdown.trim().length === 0) return <div className="text-sm text-muted">{translate({ key: 'workspaces.studio.empty' })}</div>;
  //? Minimal, safe markdown render — headings + bullets + paragraphs, no HTML injection.
  return <div className="text-sm text-common leading-relaxed">{markdown.split('\n').map((line, i) => renderMdLine(line, i))}</div>;
}

function renderMdLine(line: string, key: number): React.ReactNode {
  const t = line.trim();
  if (t.length === 0) return <div key={key} className="h-2" />;
  if (t.startsWith('### ')) return <div key={key} className="text-sm font-semibold text-title mt-2">{t.slice(4)}</div>;
  if (t.startsWith('## ')) return <div key={key} className="text-base font-semibold text-title mt-3">{t.slice(3)}</div>;
  if (t.startsWith('# ')) return <div key={key} className="text-lg font-semibold text-title mt-3">{t.slice(2)}</div>;
  if (t.startsWith('- ') || t.startsWith('* ')) return <div key={key} className="flex gap-2 pl-2"><span className="text-muted">•</span><span>{stripInline(t.slice(2))}</span></div>;
  return <div key={key}>{stripInline(t)}</div>;
}
//? strip **bold**/`code` markers for a plain readable render (no dangerouslySetInnerHTML).
function stripInline(s: string): string { return s.replaceAll(/\*\*(.+?)\*\*/g, '$1').replaceAll(/`(.+?)`/g, '$1'); }
