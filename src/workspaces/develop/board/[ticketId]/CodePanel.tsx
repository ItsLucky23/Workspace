//? Workspaces — the ticket "Code" tab: ONE surface for everything code. The old
//? standalone "Files & refs" tab is merged in — it showed the same changed-file set
//? the editor's source-control diff shows, so it is now the default, phone-friendly
//? "Diff view" mode here. Three modes:
//?  - "diff" (default): the GitLab-MR-style changed-files viewer (lightweight, no Monaco).
//?  - "changes" (Monaco): the changed-file set as an editable source-control diff.
//?  - "live" (real VS Code): launches openvscode INSIDE the ticket container via
//?    `openEditor` (ADR 0010) and embeds it. Needs an activated ticket; the engine's
//?    editGuard skips auto-turns while it is open.

import { Suspense, lazy, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { loadThemeId } from 'src/_components/editor/editorThemes';
import type { EditorChange } from 'src/_components/editor/CodeEditorPanel';
import type { EditorFile } from 'src/_components/editor/fileTree';

import FileDiffViewer from './FileDiffViewer';
import { EmptyState, WsButton } from '../../../_components/primitives';
import type { TicketFile } from '../../../_data/types';

//? Lazy so Monaco (multi-MB) only loads when the editor mode is opened.
const LazyCodeEditorPanel = lazy(() => import('src/_components/editor/CodeEditorPanel').then((m) => ({ default: m.CodeEditorPanel })));
//? Lazy so the iframe host only loads when the user opens the live (container) editor.
const LazyVsCodeEmbed = lazy(() => import('src/_components/editor/VsCodeEmbed').then((m) => ({ default: m.VsCodeEmbed })));

//? Reconstruct editable file content + original/modified pairs from the ticket's changed
//? files (the diff lines carry the new/old text). Feeds the in-ticket Monaco mode —
//? the real mount point for the per-ticket editor; it upgrades to real git-backed content
//? once the backend serves the worktree (Track D).
function ticketFilesToEditor(files: TicketFile[]): { editorFiles: EditorFile[]; changes: EditorChange[] } {
  const editorFiles: EditorFile[] = [];
  const changes: EditorChange[] = [];
  for (const f of files) {
    const lines = f.diff ?? [];
    const modified = lines.filter((l) => l.kind === 'add' || l.kind === 'ctx').map((l) => l.text).join('\n');
    const original = lines.filter((l) => l.kind === 'del' || l.kind === 'ctx').map((l) => l.text).join('\n');
    editorFiles.push({ path: f.path, content: modified });
    const status: EditorChange['status'] = (f.del > 0 && f.add === 0) ? 'deleted' : (original.length === 0 ? 'added' : 'modified');
    changes.push({ path: f.path, status, original, modified });
  }
  return { editorFiles, changes };
}

export default function CodePanel({ files, workspaceId, ticketKey }: { files: TicketFile[]; workspaceId: string; ticketKey: string }) {
  const translate = useTranslator();
  const theme = loadThemeId(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const { editorFiles, changes } = ticketFilesToEditor(files);
  const [mode, setMode] = useState<'diff' | 'changes' | 'live'>('diff');
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  //? #35 — save an edited file back to the ticket worktree (stage-locked server-side). Returns {ok,error?}.
  const saveWorktreeFile = async (path: string, content: string): Promise<{ ok: boolean; error?: string }> => {
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/saveWorktreeFile', version: 'v1', data: { workspaceId, ticketKey, path, content } }));
    if (error || res?.status !== 'success') return { ok: false, error: res?.status === 'error' ? res.errorCode : 'editor.saveFailed' };
    return res.result;
  };

  const launch = async (): Promise<void> => {
    setLaunching(true); setErr(null); setMode('live');
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/openEditor', version: 'v1', data: { workspaceId, ticketKey } }));
    setLaunching(false);
    if (error || res?.status !== 'success' || !res.result.ok || !res.result.url) {
      const code = res?.status === 'error' ? res.errorCode : (res?.status === 'success' ? res.result.error : undefined);
      setErr(code ?? 'editor.launchFailed');
      return;
    }
    setLiveUrl(res.result.url);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <WsButton variant={mode === 'diff' ? 'primary' : 'ghost'} icon="code-branch" onClick={() => { setMode('diff'); }}>{translate({ key: 'workspaces.ticket.codeDiffMode' })}</WsButton>
        <WsButton variant={mode === 'changes' ? 'primary' : 'ghost'} onClick={() => { setMode('changes'); }}>{translate({ key: 'workspaces.ticket.codeChanges' })}</WsButton>
        <WsButton variant={mode === 'live' ? 'primary' : 'ghost'} icon="display" disabled={launching} onClick={() => { if (liveUrl) setMode('live'); else void launch(); }}>
          {translate({ key: launching ? 'workspaces.ticket.editorLaunching' : 'workspaces.ticket.openLiveEditor' })}
        </WsButton>
        {err !== null && <span className="text-xs text-wrong">{translate({ key: err === 'editor.notActivated' ? 'workspaces.ticket.editorNotActivated' : 'workspaces.ticket.editorLaunchFailed' })}</span>}
      </div>

      {mode === 'diff' && (
        files.length === 0
          ? <EmptyState icon="code-branch" title={translate({ key: 'workspaces.ticket.noFileChanges' })} sub={translate({ key: 'workspaces.ticket.noFileChangesSub' })} />
          : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.ticket.changedFilesCount', params: [{ key: 'count', value: files.length }] })}</span>
                {/* Fase 2: reference picker not wired yet — kept reachable, but ghost so it never reads as a working primary. */}
                <WsButton variant="ghost" icon="link" onClick={() => { /* Fase 2: reference picker not wired yet */ }}>{translate({ key: 'workspaces.ticket.addReference' })}</WsButton>
              </div>
              <FileDiffViewer files={files} />
            </div>
          )
      )}

      {mode !== 'diff' && (
        <div className="h-[70vh] min-h-[420px]">
          {mode === 'changes' ? (
            editorFiles.length === 0 ? <EmptyState icon="code-branch" title={translate({ key: 'workspaces.ticket.noFileChanges' })} sub={translate({ key: 'workspaces.ticket.noFileChangesSub' })} /> : (
              <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-muted">{translate({ key: 'workspaces.ticket.loadingEditor' })}</div>}>
                <LazyCodeEditorPanel files={editorFiles} changes={changes} theme={theme} title={translate({ key: 'workspaces.ticket.tabCode' })} onSave={saveWorktreeFile} />
              </Suspense>
            )
          ) : (liveUrl ? (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-muted">{translate({ key: 'workspaces.ticket.loadingEditor' })}</div>}>
              <LazyVsCodeEmbed theme={theme} initialUrl={liveUrl} />
            </Suspense>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted">{translate({ key: launching ? 'workspaces.ticket.editorLaunching' : 'workspaces.ticket.editorLaunchHint' })}</div>
          ))}
        </div>
      )}
    </div>
  );
}
