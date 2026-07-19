//? Documents — inline template manager (option B — user-authorable), extracted from page.tsx in the KISS
//? redesign. Deliberately rendered INLINE (no menuHandler portal): it needs useWorkspaces() context, and
//? menuHandler forms mount ABOVE WorkspacesProvider (lesson 0011). Semantics preserved: editing a BUILTIN
//? template saves as a NEW override (slug cleared, name gets " (copy)"); only user templates edit in place
//? and offer delete. Sections round-trip through the "Heading | hint" one-per-line textarea format.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import type { DocumentTemplateSection } from '../../_data/types';
import { WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

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

export default function TemplateManager({ onSaved }: { onSaved?: () => void }) {
  const translate = useTranslator();
  const { documentTemplates, saveDocTemplate, deleteDocTemplate } = useWorkspaces();
  //? editSlug: '' = new, else editing/overriding that slug.
  const [editSlug, setEditSlug] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplSections, setTplSections] = useState('');

  const startNewTpl = (): void => { setEditSlug(''); setTplName(''); setTplDesc(''); setTplSections(''); };
  const startEditTpl = (slug: string): void => {
    const t = documentTemplates.find((x) => x.slug === slug);
    if (!t) return;
    setEditSlug(t.builtin ? '' : t.slug);   // a builtin edit is saved as a NEW override; keep its slug only for user templates
    setTplName(t.builtin ? `${t.name} (copy)` : t.name);
    setTplDesc(t.description); setTplSections(sectionsToLines(t.sections));
  };
  const saveTpl = (): void => {
    const name = tplName.trim();
    const sections = parseSectionLines(tplSections);
    if (name.length === 0 || sections.length === 0) return;
    saveDocTemplate({ ...(editSlug ? { slug: editSlug } : {}), name, description: tplDesc.trim(), sections });
    onSaved?.();
  };

  return (
    <div className={`rounded-xl border border-container1-border bg-container1 p-3 flex flex-col gap-3`}>
      <div className={`flex flex-col gap-1`}>
        {documentTemplates.map((t) => (
          <div key={t.slug} className={`flex items-center justify-between gap-2 text-sm rounded-lg border border-container1-border bg-container2/40 px-2.5 py-1.5`}>
            <span className={`truncate`}>{[t.name, String(t.sections.length), ...(t.builtin ? [translate({ key: 'workspaces.documents.templateBuiltin' })] : [])].join(' · ')}</span>
            <div className={`flex items-center gap-1 shrink-0`}>
              <WsButton variant="ghost" icon={t.builtin ? 'copy' : 'pen'} onClick={() => { startEditTpl(t.slug); }} title={translate({ key: t.builtin ? 'workspaces.documents.templateDuplicate' : 'workspaces.documents.templateEdit' })} />
              {!t.builtin && <WsButton variant="ghost" icon="trash" onClick={() => { deleteDocTemplate(t.slug); }} title={translate({ key: 'workspaces.documents.templateDelete' })} />}
            </div>
          </div>
        ))}
      </div>
      <div className={`flex flex-col gap-2 border-t border-divider pt-2`}>
        <div className={`text-xs font-semibold text-title`}>{translate({ key: editSlug ? 'workspaces.documents.templateEdit' : 'workspaces.documents.templateNew' })}</div>
        <input value={tplName} onChange={(e) => { setTplName(e.target.value); }} placeholder={translate({ key: 'workspaces.documents.templateNamePlaceholder' })} className={fieldCls} />
        <input value={tplDesc} onChange={(e) => { setTplDesc(e.target.value); }} placeholder={translate({ key: 'workspaces.documents.templateDescPlaceholder' })} className={fieldCls} />
        <textarea value={tplSections} onChange={(e) => { setTplSections(e.target.value); }} rows={6} placeholder={translate({ key: 'workspaces.documents.templateSectionsPlaceholder' })} className={`${fieldCls} py-2 font-mono text-[13px] resize-y`} />
        <div className={`flex items-center gap-2 flex-wrap`}>
          <WsButton icon="check" onClick={saveTpl} disabled={tplName.trim().length === 0 || parseSectionLines(tplSections).length === 0}>{translate({ key: 'workspaces.documents.templateSave' })}</WsButton>
          <WsButton variant="ghost" icon="plus" onClick={startNewTpl}>{translate({ key: 'workspaces.documents.templateNew' })}</WsButton>
        </div>
      </div>
    </div>
  );
}
