//? intent: Documents — the workspace's AI-drafted document library (specs, plans, briefs, sheets). One
//? primary action: type a title and Create, then open a document in its editor where the AI drafts and
//? you approve. Templates (picker + manager) sit behind a small disclosure on the create row; per-card
//? Archive/Restore/Delete live in an overflow menu; archived docs hide behind a toggle at the list's foot.

import { useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../../_components/Icon';
import { Collapse } from '../../_components/motion';
import { EmptyState, InfoTip, PopMenu, WsButton } from '../../_components/primitives';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import TemplateManager from './TemplateManager';

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
  const { documents, documentTemplates, createDocument, deleteDocument, archiveDocument, navigate } = useWorkspaces();
  const [newTitle, setNewTitle] = useState('');
  const [templateSlug, setTemplateSlug] = useState('');
  //? KISS — the template picker + manager are secondary: disclosed under the create row, default Blank.
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTplManager, setShowTplManager] = useState(false);
  //? C7 — archived documents are hidden by default but never lost.
  const [showArchived, setShowArchived] = useState(false);
  //? Filter only earns its keep once scrolling-and-reading stops being the fastest way to find a doc.
  const [query, setQuery] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const archivedCount = documents.filter((d) => d.archived === true).length;
  const scopedDocuments = showArchived ? documents : documents.filter((d) => d.archived !== true);
  const q = query.trim().toLowerCase();
  const visibleDocuments = q.length === 0 ? scopedDocuments : scopedDocuments.filter((d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q));

  //? Blank + one item per template (builtins virtual + user); picking one seeds the doc's kind + skeleton.
  const templateItems = [
    { id: '', value: '', item: translate({ key: 'workspaces.documents.templateBlank' }) },
    ...documentTemplates.map((t) => ({ id: t.slug, value: t.slug, item: t.name })),
  ];
  //? Shown on the closed disclosure chip so a picked template stays visible (the seeding survives).
  const selectedTemplate = documentTemplates.find((t) => t.slug === templateSlug);

  const create = (): void => {
    const title = newTitle.trim();
    if (!title) return;
    createDocument(title, undefined, templateSlug || undefined);
    setNewTitle('');
  };

  return (
    <div className={`flex flex-col gap-4 p-4 md:p-6 max-w-4xl`}>
      <div className={`flex items-center justify-between gap-3 flex-wrap`}>
        <div>
          <div className={`text-lg font-semibold text-title`}>{translate({ key: 'workspaces.documents.title' })}</div>
          <div className={`text-sm text-muted`}>{translate({ key: 'workspaces.documents.subtitle' })}</div>
        </div>
      </div>

      {/* THE primary action: title → Create. Stacks at phone width; template extras are disclosed below. */}
      <div className={`flex flex-col gap-2`}>
        <div className={`flex flex-col sm:flex-row sm:items-center gap-2`}>
          <input
            ref={titleInputRef}
            value={newTitle} onChange={(e) => { setNewTitle(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            placeholder={translate({ key: 'workspaces.documents.newPlaceholder' })} className={`${fieldCls} w-full sm:flex-1 sm:max-w-md`}
          />
          <WsButton icon="plus" onClick={create} disabled={newTitle.trim().length === 0} className={`w-full sm:w-auto sm:shrink-0`}>{translate({ key: 'workspaces.documents.create' })}</WsButton>
        </div>
        <div className={`self-start inline-flex items-center gap-1.5`}>
          <button type="button" onClick={() => { setShowTemplates((v) => !v); }} className={`text-xs text-muted hover:text-title cursor-pointer inline-flex items-center gap-1.5`}>
            <Icon name="caret-down" className={`transition-transform motion-reduce:transition-none ${showTemplates ? 'rotate-180' : ''}`} />
            {selectedTemplate ? selectedTemplate.name : translate({ key: 'workspaces.documents.useTemplate' })}
          </button>
          {/* ADR 0312 — what-happens-if-i-change-it: the template becomes the doc's permanent `kind`, and on
              every AI run its sections are re-read and injected as the REQUIRED STRUCTURE *prompt* block
              (conductor.ts:3652-3658 + :3745-3747) — a request, not a validated constraint, and deleting a
              user template makes resolveTemplate return null, so later drafts silently go free-form. */}
          <InfoTip
            align="start"
            label={translate({ key: 'workspaces.tips.documents.templateTitle' })}
            title={translate({ key: 'workspaces.tips.documents.templateTitle' })}
            body={translate({ key: 'workspaces.tips.documents.templateBody' })}
          />
        </div>
        <Collapse open={showTemplates}>
          <div className={`flex flex-col gap-2`}>
            <div className={`flex items-center gap-2 flex-wrap`}>
              <div className={`w-full sm:w-56`}>
                <Dropdown size="sm" width="full" value={templateItems.find((t) => t.id === templateSlug)} items={templateItems} onChange={(it) => { setTemplateSlug(String(it.id)); }} />
              </div>
              <WsButton variant="ghost" icon="sliders" onClick={() => { setShowTplManager((v) => !v); }}>{translate({ key: 'workspaces.documents.manageTemplates' })}</WsButton>
            </div>
            {/* Template manager (option B — user-authorable). Inline (no portal) so it has context access. */}
            <Collapse open={showTplManager}>
              <TemplateManager onSaved={() => { setShowTplManager(false); }} />
            </Collapse>
          </div>
        </Collapse>
      </div>

      {/* Only earns its place once scanning the list stops being the fastest way to find a doc. */}
      {documents.length > 8 && (
        <input
          value={query} onChange={(e) => { setQuery(e.target.value); }}
          placeholder={translate({ key: 'workspaces.documents.searchPlaceholder' })} className={`${fieldCls} w-full sm:max-w-md`}
        />
      )}

      {visibleDocuments.length === 0 && q.length > 0 && (
        <EmptyState icon="file-lines" title={translate({ key: 'workspaces.search.noMatches' })} />
      )}
      {visibleDocuments.length === 0 && q.length === 0 && (
        <EmptyState
          icon="file-lines"
          title={translate({ key: 'workspaces.documents.emptyTitle' })}
          sub={translate({ key: 'workspaces.documents.emptyTeach' })}
          action={<WsButton icon="plus" onClick={() => { titleInputRef.current?.focus(); }}>{translate({ key: 'workspaces.documents.emptyAction' })}</WsButton>}
        />
      )}

      <div className={`flex flex-col gap-2`}>
        {visibleDocuments.map((d) => (
          <div key={d.id} data-testid={`ws-documents-row-${d.id}`} className={`rounded-xl border border-container1-border bg-container1 p-3 flex items-center gap-2 hover:border-primary-border transition-colors`}>
            {/* The whole card body navigates — one comfortable tap target on a phone. */}
            <button type="button" onClick={() => { navigate(`documents/${d.id}`); }} className={`flex-1 min-w-0 text-left cursor-pointer`}>
              <div className={`flex items-center gap-2`}>
                <Icon name="file-lines" className={`text-muted shrink-0`} />
                <span className={`text-sm font-semibold text-title truncate`}>{d.title}</span>
                {d.archived === true && <span className={`text-[10px] uppercase tracking-wide rounded-full bg-container2 text-muted px-1.5 py-0.5 shrink-0`}>{translate({ key: 'workspaces.documents.archivedBadge' })}</span>}
                {d.aiDraft !== null && <span className={`text-[10px] uppercase tracking-wide rounded-full bg-warning/15 text-warning px-1.5 py-0.5 shrink-0`}>{translate({ key: 'workspaces.documents.draftBadge' })}</span>}
                {d.assets.length > 0 && <span className={`text-[10px] rounded-full bg-container2 text-muted px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1`}>{String(d.assets.length)}<Icon name="image" /></span>}
              </div>
              <div className={`text-xs text-muted mt-0.5 truncate`}>
                {[d.content.split('\n').find((l) => l.trim().length > 0 && !l.trim().startsWith('#'))?.trim() ?? translate({ key: 'workspaces.documents.noContentYet' }), timeAgo(d.updatedAt)].join(' · ')}
              </div>
            </button>
            {/* C7 — archive instead of delete: Archive/Restore leads the menu, Delete stays confirm-gated. */}
            <div className={`shrink-0`}>
              <PopMenu
                ariaLabel={translate({ key: 'workspaces.documents.docActions' })}
                items={[
                  d.archived === true
                    ? { label: translate({ key: 'workspaces.documents.restore' }), icon: 'rotate-left', onClick: () => { archiveDocument(d.id, false); } }
                    : { label: translate({ key: 'workspaces.documents.archive' }), icon: 'box-archive', onClick: () => { archiveDocument(d.id, true); } },
                  { divider: true },
                  {
                    label: translate({ key: 'workspaces.documents.delete' }), icon: 'trash', danger: true,
                    onClick: () => { void menuHandler.confirm({ title: translate({ key: 'workspaces.documents.deleteConfirmTitle' }), content: translate({ key: 'workspaces.documents.deleteConfirmBody', params: [{ key: 'title', value: d.title }] }) }).then((ok) => { if (ok) deleteDocument(d.id); }); },
                  },
                ]}
              />
            </div>
          </div>
        ))}
      </div>

      {/* GAP_SCAN C7 — archived documents are kept (with their revisions) behind this foot-of-list toggle. */}
      {archivedCount > 0 && (
        <div className={`self-start inline-flex items-center gap-1.5`}>
          <button type="button" onClick={() => { setShowArchived((v) => !v); }} className={`text-xs text-muted hover:text-title cursor-pointer inline-flex items-center gap-1.5`}>
            <Icon name={showArchived ? 'eye-slash' : 'box-archive'} /> {translate({ key: showArchived ? 'workspaces.documents.hideArchived' : 'workspaces.documents.showArchived' })} ({String(archivedCount)})
          </button>
          {/* ADR 0312 — what-happens-if-i-change-it: archiving only sets `archived`; the RAG rows stay and
              retrieval has no archived filter (conductor.ts:3716-3723 vs :3724-3734, docs.ts:146). */}
          <InfoTip
            align="start"
            label={translate({ key: 'workspaces.tips.documents.archiveTitle' })}
            title={translate({ key: 'workspaces.tips.documents.archiveTitle' })}
            body={translate({ key: 'workspaces.tips.documents.archiveBody' })}
          />
        </div>
      )}
    </div>
  );
}
