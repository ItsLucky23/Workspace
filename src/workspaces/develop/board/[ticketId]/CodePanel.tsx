//? Workspaces — the ticket "Code" tab: ONE surface for everything code. The old
//? standalone "Files & refs" tab is merged in — it showed the same changed-file set
//? the editor's source-control diff shows, so it is now the default, phone-friendly
//? "Diff view" mode here. Three modes:
//?  - "diff" (default): the GitLab-MR-style changed-files viewer (lightweight, no Monaco).
//?  - "changes" (Monaco): the changed-file set as an editable source-control diff.
//?  - "live" (real VS Code): launches openvscode INSIDE the ticket container via
//?    `openEditor` (ADR 0010) and embeds it. Needs an activated ticket; the engine's
//?    editGuard skips auto-turns while it is open.
//?
//? WHERE THE FILES COME FROM (F-006/F-014): `Ticket.files` was a seed-era field nothing on the
//? server ever populated, so both diff-backed modes were permanently empty on live data while the
//? sibling Review tab showed the real diff. The changed-file set is now the SAME data the Review tab
//? renders — the built-in MR view for the ticket's branch (`ctx.mrByBranch`, loaded via
//? `mrAction('create')`), mapped to the viewer's line shape. The Monaco "changes" mode additionally
//? reads each file's FULL content from the container worktree (`readWorktreeFile`): saving
//? hunk-reconstructed text (add+ctx lines only) would have overwritten real files with partial-
//? context fragments, so the editor never edits anything but worktree-backed content.

import { Suspense, lazy, useEffect, useState, type ReactElement } from 'react';

import { useNavigate } from 'react-router-dom';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { loadThemeId } from 'src/_components/editor/editorThemes';
import { menuHandler } from 'src/_functions/menuHandler';
import { useWorkspaces } from '../../../_shell/WorkspacesContext';
import type { EditorFile } from 'src/_components/editor/fileTree';

import FileDiffViewer from './FileDiffViewer';
import { ArtifactLinkPicker } from '../ArtifactLinkPicker';
import { LazyVsCodeEmbed, useLiveEditor } from './liveEditor';
import { changesFromFiles, mrFilesToTicketFiles } from './ticketDiff';
import { EmptyState, WsButton } from '../../../_components/primitives';
import type { Ticket } from '../../../_data/types';

//? Lazy so Monaco (multi-MB) only loads when the editor mode is opened.
const LazyCodeEditorPanel = lazy(() => import('src/_components/editor/CodeEditorPanel').then((m) => ({ default: m.CodeEditorPanel })));

interface WorktreeState { phase: 'idle' | 'loading' | 'ready' | 'unavailable'; contents: Record<string, string> }

export default function CodePanel({ ticket, workspaceId, initialMode, initialFile }: { ticket: Ticket; workspaceId: string; initialMode?: 'diff' | 'changes' | 'live'; initialFile?: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const { mrAction } = ctx;
  const ticketKey = ticket.id;
  const branch = ticket.branch ?? '';
  const mr = ctx.mrByBranch[branch];
  const [mrPhase, setMrPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const theme = loadThemeId(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  //? Same load the Review tab performs — `create` is idempotent and lands the view in mrByBranch.
  useEffect(() => {
    if (!branch) return;
    let cancelled = false;
    setMrPhase('loading');
    void mrAction('create', { ticketKey }).then((r) => { if (!cancelled) setMrPhase(r.ok ? 'ready' : 'error'); });
    return () => { cancelled = true; };
  }, [branch, ticketKey, mrAction]);

  const files = mr ? mrFilesToTicketFiles(mr.diff.files) : [];
  //? Preview-target (from the MR review tab's per-file affordance): in "changes" mode, float the requested
  //? file to the front so the Monaco panel opens it (it selects files[0]/changes[0] by default). Diff mode
  //? scrolls to it instead (FileDiffViewer handles that); live mode is the container VS Code — no file targeting.
  const orderedFiles = (initialMode === 'changes' && initialFile !== undefined)
    ? files.toSorted((a, b) => Number(b.path === initialFile) - Number(a.path === initialFile))
    : files;
  const [mode, setMode] = useState<'diff' | 'changes' | 'live'>(initialMode ?? 'diff');
  const navigate = useNavigate();
  //? Live-editor launch state is shared with the full-page editor route (../liveEditor).
  const { liveUrl, launching, err, launch } = useLiveEditor(workspaceId, ticketKey);

  //? Full worktree content per changed file, read on demand when the Monaco mode opens. Deleted files have
  //? nothing to read. The first unreadable file (no container / docker down) marks the whole set
  //? unavailable — a half-editable change set would be worse than an honest notice.
  const [worktree, setWorktree] = useState<WorktreeState>({ phase: 'idle', contents: {} });
  //? Keyed on the changed-PATH set, not the array identity (rebuilt every render): a new set (the agent
  //? kept editing) re-reads; a mere re-render does not.
  const fileKey = files.map((f) => `${f.path}|${String(f.del > 0 && f.add === 0)}`).join('\n');
  useEffect(() => {
    if (mode !== 'changes' || fileKey.length === 0) return;
    const run = { cancelled: false };
    setWorktree({ phase: 'loading', contents: {} });
    void (async () => {
      const contents: Record<string, string> = {};
      for (const entry of fileKey.split('\n')) {
        const sep = entry.lastIndexOf('|');
        const path = entry.slice(0, sep);
        const deleted = entry.slice(sep + 1);
        if (path.length === 0 || deleted === 'true') continue;
        const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/readWorktreeFile', version: 'v1', data: { workspaceId, ticketKey, path } }));
        const content = (!error && res?.status === 'success' && res.result.ok) ? res.result.content : undefined;
        if (content === undefined) {
          if (!run.cancelled) setWorktree({ phase: 'unavailable', contents: {} });
          return;
        }
        contents[path] = content;
      }
      if (!run.cancelled) setWorktree({ phase: 'ready', contents });
    })();
    return () => { run.cancelled = true; };
  }, [mode, fileKey, workspaceId, ticketKey]);

  const editorFiles: EditorFile[] = orderedFiles.filter((f) => worktree.contents[f.path] !== undefined).map((f) => ({ path: f.path, content: worktree.contents[f.path] ?? '' }));
  const changes = changesFromFiles(orderedFiles);

  //? #35 — save an edited file back to the ticket worktree (stage-locked server-side). Returns {ok,error?}.
  const saveWorktreeFile = async (path: string, content: string): Promise<{ ok: boolean; error?: string }> => {
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/saveWorktreeFile', version: 'v1', data: { workspaceId, ticketKey, path, content } }));
    if (error || res?.status !== 'success') return { ok: false, error: res?.status === 'error' ? res.errorCode : 'editor.saveFailed' };
    return res.result;
  };

  //? The Monaco mode, by worktree phase: notice (no container), loading, or the editor.
  const changesBody = (): ReactElement => {
    if (files.length === 0) return emptyDiff();
    if (worktree.phase === 'unavailable') return <EmptyState icon="display" title={translate({ key: 'workspaces.ticket.editorNotActivated' })} sub={translate({ key: 'workspaces.ticket.changesNeedContainer' })} />;
    if (worktree.phase === 'ready') {
      return (
        <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-muted">{translate({ key: 'workspaces.ticket.loadingEditor' })}</div>}>
          <LazyCodeEditorPanel files={editorFiles} changes={changes} theme={theme} title={translate({ key: 'workspaces.ticket.tabCode' })} onSave={saveWorktreeFile} />
        </Suspense>
      );
    }
    return <div className="h-full flex items-center justify-center text-sm text-muted">{translate({ key: 'workspaces.ticket.changesLoadingFiles' })}</div>;
  };

  //? The shared "nothing to show" state for both diff-backed modes: no branch yet, diff still loading, or a
  //? genuinely empty change set.
  const emptyDiff = (): ReactElement => {
    if (!branch) return <EmptyState icon="code-branch" title={translate({ key: 'workspaces.ticket.noFileChanges' })} sub={translate({ key: 'workspaces.ticket.diffNoBranch' })} />;
    if (!mr && mrPhase === 'loading') return <EmptyState icon="clock" title={translate({ key: 'workspaces.ticket.diffLoading' })} />;
    return <EmptyState icon="code-branch" title={translate({ key: 'workspaces.ticket.noFileChanges' })} sub={translate({ key: 'workspaces.ticket.noFileChangesSub' })} />;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <WsButton variant={mode === 'diff' ? 'primary' : 'ghost'} icon="code-branch" onClick={() => { setMode('diff'); }}>{translate({ key: 'workspaces.ticket.codeDiffMode' })}</WsButton>
        <WsButton variant={mode === 'changes' ? 'primary' : 'ghost'} onClick={() => { setMode('changes'); }}>{translate({ key: 'workspaces.ticket.codeChanges' })}</WsButton>
        <WsButton variant={mode === 'live' ? 'primary' : 'ghost'} icon="display" disabled={launching} onClick={() => { setMode('live'); if (!liveUrl) void launch(); }}>
          {translate({ key: launching ? 'workspaces.ticket.editorLaunching' : 'workspaces.ticket.openLiveEditor' })}
        </WsButton>
        {/* In live mode, offer the same editor with the whole screen (its own route). */}
        {mode === 'live' && (
          <WsButton variant="ghost" icon="up-right-from-square" onClick={() => { void navigate(`/workspaces/develop/board/${ticketKey}/editor`); }}>{translate({ key: 'workspaces.ticket.openFullPage' })}</WsButton>
        )}
        {err !== null && <span className="text-xs text-wrong">{translate({ key: err === 'editor.notActivated' ? 'workspaces.ticket.editorNotActivated' : 'workspaces.ticket.editorLaunchFailed' })}</span>}
      </div>

      {mode === 'diff' && (
        files.length === 0
          ? emptyDiff()
          : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.ticket.changedFilesCount', params: [{ key: 'count', value: files.length }] })}</span>
                <WsButton variant="ghost" icon="link" onClick={() => { void menuHandler.open(<ArtifactLinkPicker ticketKey={ticketKey} ctx={ctx} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); }}>{translate({ key: 'workspaces.ticket.addReference' })}</WsButton>
              </div>
              <FileDiffViewer files={files} initialFile={initialMode === 'diff' ? initialFile : undefined} />
            </div>
          )
      )}

      {mode !== 'diff' && (
        <div className="h-[70vh] min-h-[420px]">
          {mode === 'changes' ? changesBody() : (liveUrl ? (
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
