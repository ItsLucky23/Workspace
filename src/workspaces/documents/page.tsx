//? intent: Documents — the workspace's AI-drafted document library (specs, plans, briefs, sheets). See
//? every document at a glance (draft-pending badge), create a new one, and open it in the editor where
//? the AI writes drafts you approve. Exports (PDF/Word/Excel/HTML) live on the document itself.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import { EmptyState, WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';

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
  const { documents, createDocument, deleteDocument, navigate } = useWorkspaces();
  const [newTitle, setNewTitle] = useState('');

  const create = (): void => {
    const title = newTitle.trim();
    if (!title) return;
    createDocument(title);
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
        <WsButton icon="plus" onClick={create} disabled={newTitle.trim().length === 0}>{translate({ key: 'workspaces.documents.create' })}</WsButton>
      </div>

      {documents.length === 0 && (
        <EmptyState icon="file-lines" title={translate({ key: 'workspaces.documents.emptyTitle' })} sub={translate({ key: 'workspaces.documents.emptySub' })} />
      )}

      <div className="flex flex-col gap-2">
        {documents.map((d) => (
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
