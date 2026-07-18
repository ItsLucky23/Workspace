//? intent: Documents — the workspace's AI-drafted document library (specs, plans, briefs, sheets). See
//? every document at a glance (draft-pending badge), create a new one, and open it in the editor where
//? the AI writes drafts you approve. Exports (PDF/Word/Excel/HTML) live on the document itself.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import type { DocumentTemplateSection } from '../_data/types';
import Icon from '../_components/Icon';
import { EmptyState, WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';

//? Textarea ("Heading | hint" per line) ↔ typed sections, for the compact template editor.
function parseSectionLines(text: string): DocumentTemplateSection[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).map((l) => {
    const parts = l.split('|');
    return { heading: (parts[0] ?? '').trim(), hint: parts.slice(1).join('|').trim() };
  }).filter((s) => s.heading.length > 0);
}
function sectionsToLines(sections: DocumentTemplateSection[]): string {
  return sections.map((s) => (s.hint.length > 0 ? `${s.heading} | ${s.hint}` : s.heading)).join('\n');
}

export const template = 'workspaces';

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / (60 * 24)), 'day');
}

export default function DocumentsPage() {
  const translate = useTranslator();
  const { documents, documentTemplates, createDocument, deleteDocument, archiveDocument, saveDocTemplate, deleteDocTemplate, navigate } = useWorkspaces();
  const [newTitle, setNewTitle] = useState('');
  const [templateSlug, setTemplateSlug] = useState('');
  //? Template manager (option B — user-authorable). editSlug: '' = new, else editing/overriding that slug.
  const [showTpl, setShowTpl] = useState(false);
  //? C7 — archived documents are hidden by default but never lost.
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = documents.filter((d) => d.archived === true).length;
  const visibleDocuments = showArchived ? documents : documents.filter((d) => d.archived !== true);
  const [editSlug, setEditSlug] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplSections, setTplSections] = useState('');

  const startNewTpl = (): void => { setEditSlug(''); setTplName(''); setTplDesc(''); setTplSections(''); setShowTpl(true); };
  const startEditTpl = (slug: string): void => {
    const t = documentTemplates.find((x) => x.slug === slug);
    if (!t) return;
    setEditSlug(t.builtin ? '' : t.slug);   // a builtin edit is saved as a NEW override; keep its slug only for user templates
    setTplName(t.builtin ? `${t.name} (copy)` : t.name);
    setTplDesc(t.description); setTplSections(sectionsToLines(t.sections)); setShowTpl(true);
  };
  const saveTpl = (): void => {
    const name = tplName.trim();
    const sections = parseSectionLines(tplSections);
    if (name.length === 0 || sections.length === 0) return;
    saveDocTemplate({ ...(editSlug ? { slug: editSlug } : {}), name, description: tplDesc.trim(), sections });
    setShowTpl(false);
  };

  //? Blank + one item per template (builtins virtual + user); picking one seeds the doc's kind + skeleton.
  const templateItems = [
    { id: '', value: '', item: translate({ key: 'workspaces.documents.templateBlank' }) },
    ...documentTemplates.map((t) => ({ id: t.slug, value: t.slug, item: t.name })),
  ];

  const create = (): void => {
    const title = newTitle.trim();
    if (!title) return;
    createDocument(title, undefined, templateSlug || undefined);
    setNewTitle('');
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-lg font-semibold text-title">{translate({ key: 'workspaces.documents.title' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.documents.subtitle' })}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newTitle} onChange={(e) => { setNewTitle(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          placeholder={translate({ key: 'workspaces.documents.newPlaceholder' })} className={`${fieldCls} flex-1 max-w-sm`}
        />
        <div className="w-44 shrink-0">
          <Dropdown size="sm" value={templateItems.find((t) => t.id === templateSlug)} items={templateItems} onChange={(it) => { setTemplateSlug(String(it.id)); }} />
        </div>
        <WsButton icon="plus" onClick={create} disabled={newTitle.trim().length === 0}>{translate({ key: 'workspaces.documents.create' })}</WsButton>
        <WsButton variant="ghost" icon="sliders" onClick={() => { setShowTpl((v) => !v); }}>{translate({ key: 'workspaces.documents.manageTemplates' })}</WsButton>
      </div>

      {/* Template manager (option B — user-authorable). Inline (no portal) so it has context access. */}
      {showTpl && (
        <div className="rounded-lg border border-container1-border bg-container1 p-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            {documentTemplates.map((t) => (
              <div key={t.slug} className="flex items-center justify-between gap-2 text-sm rounded-lg border border-container1-border bg-container2/40 px-2.5 py-1.5">
                <span className="truncate">{[t.name, String(t.sections.length), ...(t.builtin ? [translate({ key: 'workspaces.documents.templateBuiltin' })] : [])].join(' · ')}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <WsButton variant="ghost" icon={t.builtin ? 'copy' : 'pen'} onClick={() => { startEditTpl(t.slug); }} title={translate({ key: t.builtin ? 'workspaces.documents.templateDuplicate' : 'workspaces.documents.templateEdit' })} />
                  {!t.builtin && <WsButton variant="ghost" icon="trash" onClick={() => { deleteDocTemplate(t.slug); }} title={translate({ key: 'workspaces.documents.templateDelete' })} />}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-divider pt-2">
            <div className="text-xs font-semibold text-title">{translate({ key: editSlug ? 'workspaces.documents.templateEdit' : 'workspaces.documents.templateNew' })}</div>
            <input value={tplName} onChange={(e) => { setTplName(e.target.value); }} placeholder={translate({ key: 'workspaces.documents.templateNamePlaceholder' })} className={fieldCls} />
            <input value={tplDesc} onChange={(e) => { setTplDesc(e.target.value); }} placeholder={translate({ key: 'workspaces.documents.templateDescPlaceholder' })} className={fieldCls} />
            <textarea value={tplSections} onChange={(e) => { setTplSections(e.target.value); }} rows={6} placeholder={translate({ key: 'workspaces.documents.templateSectionsPlaceholder' })} className={`${fieldCls} py-2 font-mono text-[13px] resize-y`} />
            <div className="flex items-center gap-2">
              <WsButton icon="check" onClick={saveTpl} disabled={tplName.trim().length === 0 || parseSectionLines(tplSections).length === 0}>{translate({ key: 'workspaces.documents.templateSave' })}</WsButton>
              <WsButton variant="ghost" icon="plus" onClick={startNewTpl}>{translate({ key: 'workspaces.documents.templateNew' })}</WsButton>
            </div>
          </div>
        </div>
      )}

      {/* GAP_SCAN C7 — archived documents are kept (with their revisions) and hidden behind this toggle. */}
      {archivedCount > 0 && (
        <button type="button" onClick={() => { setShowArchived((v) => !v); }} className="self-start text-xs text-muted hover:text-title cursor-pointer inline-flex items-center gap-1.5">
          <Icon name={showArchived ? 'eye-slash' : 'box-archive'} /> {translate({ key: showArchived ? 'workspaces.documents.hideArchived' : 'workspaces.documents.showArchived' })} ({String(archivedCount)})
        </button>
      )}

      {visibleDocuments.length === 0 && (
        <EmptyState icon="file-lines" title={translate({ key: 'workspaces.documents.emptyTitle' })} sub={translate({ key: 'workspaces.documents.emptySub' })} />
      )}

      <div className="flex flex-col gap-2">
        {visibleDocuments.map((d) => (
          <div key={d.id} className="rounded-lg border border-container1-border bg-container1 p-3 flex items-center gap-3 hover:border-primary-border transition-colors">
            <button type="button" onClick={() => { navigate(`documents/${d.id}`); }} className="flex-1 min-w-0 text-left cursor-pointer">
              <div className="flex items-center gap-2">
                <Icon name="file-lines" className="text-muted shrink-0" />
                <span className="text-sm font-semibold text-title truncate">{d.title}</span>
                {d.aiDraft !== null && <span className="text-[10px] uppercase tracking-wide rounded-full bg-warning/15 text-warning px-1.5 py-0.5 shrink-0">{translate({ key: 'workspaces.documents.draftBadge' })}</span>}
                {d.assets.length > 0 && <span className="text-[10px] rounded-full bg-container2 text-muted px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1">{String(d.assets.length)}<Icon name="image" /></span>}
              </div>
              <div className="text-xs text-muted mt-0.5 truncate">
                {[d.content.split('\n').find((l) => l.trim().length > 0 && !l.trim().startsWith('#'))?.trim() ?? translate({ key: 'workspaces.documents.noContentYet' }), timeAgo(d.updatedAt)].join(' · ')}
              </div>
            </button>
            {/* C7 — archive instead of delete: nothing is lost and the list stays clean. */}
            <button
              type="button"
              onClick={() => { archiveDocument(d.id, d.archived !== true); }}
              className="text-xs text-muted hover:text-title px-1.5 py-1 cursor-pointer shrink-0" aria-label={translate({ key: d.archived === true ? 'workspaces.documents.restore' : 'workspaces.documents.archive' })}
            >
              <Icon name={d.archived === true ? 'rotate-left' : 'box-archive'} />
            </button>
            <button
              type="button"
              onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.documents.deleteConfirmTitle' }), content: translate({ key: 'workspaces.documents.deleteConfirmBody', params: [{ key: 'title', value: d.title }] }) }).then((ok) => { if (ok) deleteDocument(d.id); }); }}
              className="text-xs text-muted hover:text-wrong px-1.5 py-1 cursor-pointer shrink-0" aria-label={translate({ key: 'workspaces.documents.delete' })}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
