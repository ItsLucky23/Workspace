//? intent: The ticket's live editor, full-page — the real openvscode-server (browser VS Code) running
//? INSIDE the ticket's container, given the whole screen instead of a Code-tab pane. Opened from the Code
//? tab's "live" mode via "Open full-page"; it launches the editor on mount and embeds it, with a back link
//? to the ticket. Reuses the shared launch plumbing (../liveEditor) so it never diverges from the in-tab one.

import { Suspense, useEffect } from 'react';

import { useNavigate } from 'react-router-dom';

import { useTranslator } from '@luckystack/core/client';

import { loadThemeId } from 'src/_components/editor/editorThemes';

import Icon from '../../../../_components/Icon';
import { EmptyState, WsButton } from '../../../../_components/primitives';
import { useWorkspaces } from '../../../../_shell/WorkspacesContext';
import { LazyVsCodeEmbed, useLiveEditor } from '../liveEditor';

export const template = 'workspaces';

export default function TicketEditorPage({ params }: { params: Record<string, string | undefined> }) {
  const id = params.ticketid ?? '';
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const navigate = useNavigate();
  const ticket = ctx.tickets.find((t) => t.id === id);
  const theme = loadThemeId(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const { liveUrl, launching, err, launch } = useLiveEditor(ctx.activeWorkspace.id, id);

  //? Launch on mount — this route's whole purpose is the live editor. `launch` is stable per
  //? (workspaceId, ticketKey), so it fires once for this ticket rather than on every render.
  useEffect(() => { void launch(); }, [launch]);

  const back = () => { void navigate(`/workspaces/develop/board/${id}`); };

  if (!ticket) return <EmptyState icon="circle-question" title={translate({ key: 'workspaces.ticket.notFound', params: [{ key: 'id', value: id }] })} />;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-divider shrink-0">
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-common cursor-pointer">
          <Icon name="arrow-left" /> {translate({ key: 'workspaces.ticket.backToTicket' })}
        </button>
        <div className="min-w-0 text-sm font-semibold text-title truncate">{translate({ key: 'workspaces.ticket.editorFullTitle', params: [{ key: 'id', value: ticket.id }] })}</div>
      </div>

      <div className="flex-1 min-h-0 p-4 md:p-6">
        {err === null ? (liveUrl ? (
          <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-muted">{translate({ key: 'workspaces.ticket.loadingEditor' })}</div>}>
            <LazyVsCodeEmbed theme={theme} initialUrl={liveUrl} />
          </Suspense>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted">{translate({ key: launching ? 'workspaces.ticket.editorLaunching' : 'workspaces.ticket.editorLaunchHint' })}</div>
        )) : (
          <EmptyState
            icon="triangle-exclamation"
            title={translate({ key: err === 'editor.notActivated' ? 'workspaces.ticket.editorNotActivated' : 'workspaces.ticket.editorLaunchFailed' })}
            sub={translate({ key: 'workspaces.ticket.editorLaunchHint' })}
            action={<WsButton icon="rotate" disabled={launching} onClick={() => { void launch(); }}>{translate({ key: 'workspaces.ticket.editorRetry' })}</WsButton>}
          />
        )}
      </div>
    </div>
  );
}
