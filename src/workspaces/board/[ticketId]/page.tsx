//? Workspaces — ticket detail. Header (id/issue/status/branch/MR/cost/preview +
//? status dropdown + viewers), needs-input / done banners, and the tabbed body
//? (Overview · Terminal · Files & refs · Activity · Links · Stage history).
//? Desktop-first; dummy data. Overlays (promote preview, teardown, reference
//? picker) run through the shared `menuHandler.confirm`.

import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import { loadThemeId } from 'src/_components/editor/editorThemes';
import type { EditorChange } from 'src/_components/editor/CodeEditorPanel';
import type { EditorFile } from 'src/_components/editor/fileTree';

import FileDiffViewer from './FileDiffViewer';
import MrReviewPanel from '../../_components/MrReviewPanel';

//? Lazy so Monaco (multi-MB) only loads when the Code tab is opened.
const LazyCodeEditorPanel = lazy(() => import('src/_components/editor/CodeEditorPanel').then((m) => ({ default: m.CodeEditorPanel })));
//? Lazy so the iframe host only loads when the user opens the live (container) editor.
const LazyVsCodeEmbed = lazy(() => import('src/_components/editor/VsCodeEmbed').then((m) => ({ default: m.VsCodeEmbed })));
import Icon from '../../_components/Icon';
import XtermTerminal from '../../_components/XtermTerminal';
import { AvatarBubble, AvatarStack, EmptyState, LabelChip, PopMenu, StatusPill, Tabs, WsButton, type PopMenuItem, type TabDef } from '../../_components/primitives';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { isModuleEnabled } from '../../_data/modules';
import type { ActivityEvent, Member, StageHistoryEntry, Ticket, TicketFile, TicketLink } from '../../_data/types';
import { PRIORITY_DOT, PRIORITY_LABEL_KEY, PRIORITY_ORDER } from '../../_functions/priority';
import { parseStructuredQuestion } from '../../_functions/structuredQuestion';

export const template = 'workspaces';

export default function TicketPage({ params }: { params: Record<string, string | undefined> }) {
  const id = params.ticketid ?? '';
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const ticket = ctx.tickets.find((t) => t.id === id);
  const [tab, setTab] = useState('overview');

  const TABS: TabDef[] = [
    { id: 'overview', label: translate({ key: 'workspaces.ticket.tabOverview' }), icon: 'file-lines' },
    { id: 'terminal', label: translate({ key: 'workspaces.ticket.tabTerminal' }), icon: 'terminal' },
    { id: 'files', label: translate({ key: 'workspaces.ticket.tabFiles' }), icon: 'diagram-project' },
    { id: 'code', label: translate({ key: 'workspaces.ticket.tabCode' }), icon: 'code-branch' },
    { id: 'review', label: translate({ key: 'workspaces.ticket.tabReview' }), icon: 'code-merge' },
    { id: 'activity', label: translate({ key: 'workspaces.ticket.tabActivity' }), icon: 'wave-square' },
    { id: 'links', label: translate({ key: 'workspaces.ticket.tabLinks' }), icon: 'link' },
    { id: 'history', label: translate({ key: 'workspaces.ticket.tabHistory' }), icon: 'list-check' },
  ];

  if (!ticket) return <EmptyState icon="circle-question" title={translate({ key: 'workspaces.ticket.notFound', params: [{ key: 'id', value: id }] })} />;

  //? Status is AI-owned — the user can't change it (it'd be wrong to flip
  //? "needs input" to "busy"). Shown read-only; the user's lever is replying.
  const status = ticket.status;
  const stage = ctx.stages.find((s) => s.id === ticket.stageId);
  const nextStage = ctx.stages.find((s) => s.order === (stage?.order ?? -1) + 1);

  return (
    <div className="flex flex-col h-full min-h-0">
      <TicketHeader ticket={ticket} />
      <TicketControls ticket={ticket} />

      {status === 'needs-input' && ticket.needsInput && <NeedsInputBanner question={ticket.needsInput} ticketKey={ticket.id} />}
      {/* #16 (W2) — non-blocking advisory questions: confirm the agent's assumption or correct it. */}
      {ticket.advisoryQuestions && ticket.advisoryQuestions.length > 0 && <AdvisoryList ticketKey={ticket.id} advisories={ticket.advisoryQuestions} />}
      {status === 'done' && (
        <Banner
          tone="correct" icon="circle-check"
          title={translate({ key: 'workspaces.ticket.doneIn', params: [{ key: 'stage', value: stage?.name ?? translate({ key: 'workspaces.ticket.thisStage' }) }] })}
          action={nextStage && (
            <WsButton
              onClick={() => {
                void menuHandler.confirm({
                  title: translate({ key: 'workspaces.ticket.promoteConfirmTitle', params: [{ key: 'id', value: ticket.id }, { key: 'stage', value: nextStage.name }] }),
                  content: ticket.carryOver ?? translate({ key: 'workspaces.ticket.promoteConfirmContent' }),
                }).then((ok) => { if (ok) ctx.bulkMove([ticket.id], nextStage.id); });
              }}
            >
              {translate({ key: 'workspaces.ticket.promoteTo', params: [{ key: 'stage', value: nextStage.name }] })}
            </WsButton>
          )}
        />
      )}

      <div className="px-4 md:px-6">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        <div className={`mx-auto w-full ${tab === 'files' || tab === 'terminal' || tab === 'code' || tab === 'review' ? 'max-w-5xl' : 'max-w-3xl'}`}>
          {tab === 'overview' && <OverviewTab ticket={ticket} stage={stage?.name} />}
          {tab === 'terminal' && <TerminalTab ticketId={ticket.id} stageId={ticket.stageId} />}
          {tab === 'files' && <FilesTab files={ticket.files ?? []} />}
          {tab === 'code' && <CodeTab files={ticket.files ?? []} workspaceId={ctx.activeWorkspace.id} ticketKey={ticket.id} />}
          {tab === 'review' && <MrReviewPanel ticket={ticket} />}
          {tab === 'activity' && <ActivityTab events={ctx.activityEvents.filter((e) => e.ticketId === ticket.id)} />}
          {tab === 'links' && <LinksTab links={ticket.links ?? []} onOpen={ctx.openTicket} />}
          {tab === 'history' && <HistoryTab history={ticket.history ?? []} />}
        </div>
      </div>
    </div>
  );
}

//? Reconstruct editable file content + original/modified pairs from the ticket's changed
//? files (the diff lines carry the new/old text). Feeds the in-ticket Monaco Code tab —
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

//? The per-ticket "Code" tab. Two modes:
//?  - "changes" (Monaco): the changed-file set + source-control diff, themed with the shared
//?    editor theme. Always available, no container needed.
//?  - "live" (real VS Code): launches openvscode INSIDE the ticket container via `openEditor`
//?    (ADR 0010) with the user's projected profile, and embeds it. Needs an activated ticket.
function CodeTab({ files, workspaceId, ticketKey }: { files: TicketFile[]; workspaceId: string; ticketKey: string }) {
  const translate = useTranslator();
  const theme = loadThemeId(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const { editorFiles, changes } = ticketFilesToEditor(files);
  const [mode, setMode] = useState<'changes' | 'live'>('changes');
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
    <div className="flex flex-col gap-2 h-[70vh] min-h-[420px]">
      <div className="flex items-center gap-2 shrink-0">
        <WsButton variant={mode === 'changes' ? 'primary' : 'ghost'} onClick={() => { setMode('changes'); }}>{translate({ key: 'workspaces.ticket.codeChanges' })}</WsButton>
        <WsButton variant={mode === 'live' ? 'primary' : 'ghost'} icon="code-branch" disabled={launching} onClick={() => { if (liveUrl) setMode('live'); else void launch(); }}>
          {translate({ key: launching ? 'workspaces.ticket.editorLaunching' : 'workspaces.ticket.openLiveEditor' })}
        </WsButton>
        {err !== null && <span className="text-xs text-wrong">{translate({ key: err === 'editor.notActivated' ? 'workspaces.ticket.editorNotActivated' : 'workspaces.ticket.editorLaunchFailed' })}</span>}
      </div>
      <div className="flex-1 min-h-0">
        {mode === 'changes' ? (
          editorFiles.length === 0 ? <EmptyState icon="code-branch" title={translate({ key: 'workspaces.ticket.noCode' })} /> : (
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
    </div>
  );
}

//? C2 agent controls + preview launcher on the ticket. Pause/resume/kill drive the engine's
//? context-methods (the engine skips the auto-turn while a live editor is open — editGuard).
//? Open preview starts the ticket's dev server (Project.devCommand) and surfaces the URL.
//? T1/T3 — the time-travel form: pick a raw commit, "main minus commit X", or "as of a date" → a past-version
//? preview. Submits a RefSpec to timeTravelPreview (git-only resolve → ephemeral ref-preview container).
//? #25 — the 'ref' kind previews an ARBITRARY git ref (SHA/tag/branch) via open-ref-preview (was an
//? endpoint with no UI entry); commit/revert/asof go through timeTravelPreview.
type TravelSpec = { kind: 'commit'; value: string } | { kind: 'revert'; value: string } | { kind: 'asof'; whenMs: number } | { kind: 'ref'; value: string };
const asTravelMode = (v: string): 'commit' | 'revert' | 'asof' | 'ref' => (v === 'revert' || v === 'asof' || v === 'ref' ? v : 'commit');
function TimeTravelForm({ onSubmit, translate }: { onSubmit: (spec: TravelSpec) => void; translate: ReturnType<typeof useTranslator> }) {
  const [mode, setMode] = useState<'commit' | 'revert' | 'asof' | 'ref'>('commit');
  const [value, setValue] = useState('');
  const [when, setWhen] = useState('');
  const modeItems: DropdownItem[] = (['commit', 'revert', 'asof', 'ref'] as const).map((m) => ({ id: m, value: m, item: translate({ key: `workspaces.timetravel.mode_${m}` }) }));
  const inputCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary w-full';
  const valuePh = mode === 'revert' ? 'workspaces.timetravel.revertPh' : (mode === 'ref' ? 'workspaces.timetravel.refPh' : 'workspaces.timetravel.commitPh');
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.timetravel.title' })}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-common">{translate({ key: 'workspaces.timetravel.mode' })}</span>
        <Dropdown size="sm" items={modeItems} value={modeItems.find((it) => it.id === mode)} onChange={(it) => { setMode(asTravelMode(String(it.value))); }} />
      </div>
      {mode === 'asof'
        ? <input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); }} className={inputCls} />
        : <input value={value} onChange={(e) => { setValue(e.target.value); }} placeholder={translate({ key: valuePh })} className={inputCls} />}
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="clock-rotate-left" onClick={() => {
          if (mode === 'asof') { if (when) onSubmit({ kind: 'asof', whenMs: new Date(when).getTime() }); return; }
          const v = value.trim(); if (v) onSubmit({ kind: mode, value: v });
        }}>{translate({ key: 'workspaces.timetravel.preview' })}</WsButton>
      </div>
    </div>
  );
}

function TicketControls({ ticket }: { ticket: Ticket }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [preview, setPreview] = useState<{ loading: boolean; url?: string; err?: boolean }>({ loading: false });
  //? #20 — the live agent PTY tail for this ticket (empty when no live turn is streaming).
  const [showLive, setShowLive] = useState(false);
  const liveOutput = ctx.agentTerm[ticket.id] ?? '';

  const kill = (): void => {
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.ticket.killConfirmTitle', params: [{ key: 'id', value: ticket.id }] }),
      content: translate({ key: 'workspaces.ticket.killConfirmContent' }),
    }).then((ok) => { if (ok) ctx.killTicket(ticket.id); });
  };

  const openPreview = async (): Promise<void> => {
    setPreview({ loading: true });
    const res = await ctx.openPreview(ticket.id);
    if (res.ok && res.url) { setPreview({ loading: false, url: res.url }); }
    else setPreview({ loading: false, err: true });
  };

  //? T1/T3 — time-travel preview: open the ticket's app at a PAST version (a raw commit, "main minus commit X",
  //? or "as of a date"). Resolves the spec (git-only) → an ephemeral ref-preview container. The timeTravelPreview
  //? routes existed but had NO caller; this wires them.
  const timeTravel = (spec: TravelSpec): void => {
    setPreview({ loading: true });
    const settle = (r: { status: string; result?: { ok?: boolean; url?: string } }): void => {
      if (r.status === 'success' && r.result?.ok && r.result.url) { setPreview({ loading: false, url: r.result.url }); }
      else setPreview({ loading: false, err: true });
    };
    //? #25 — a raw ref goes through open-ref-preview; commit/revert/asof through timeTravelPreview.
    if (spec.kind === 'ref') {
      void apiRequest({ name: 'workspaces/openRefPreview', version: 'v1', data: { workspaceId: ctx.activeWorkspace.id, ticketKey: ticket.id, ref: spec.value } }).then(settle);
      return;
    }
    void apiRequest({ name: 'workspaces/timeTravelPreview', version: 'v1', data: { workspaceId: ctx.activeWorkspace.id, ticketKey: ticket.id, branch: ticket.branch ?? 'main', spec } }).then(settle);
  };
  const openTimeTravel = (): void => {
    void menuHandler.open(<TimeTravelForm translate={translate} onSubmit={(spec) => { void menuHandler.close(); timeTravel(spec); }} />, { dimBackground: true, background: 'bg-container1', size: 'sm' });
  };

  //? Simplify: a ticket's primary action is "open preview" (what a non-technical approver actually needs). The
  //? agent-lifecycle (pause/resume) + the destructive/dev tools (kill, time-travel) move into a "…" menu so the
  //? ticket header isn't a wall of dev-verbs. Kill + time-travel are gated on the development module + admin/owner
  //? (fail-open: an unresolved role is not 'member'); pause/resume stay for whoever manages the ticket.
  const showDevOps = isModuleEnabled(ctx.activeWorkspace.enabledSections, 'development') && ctx.activeWorkspace.role !== 'member';
  const agentMenu: PopMenuItem[] = [
    { label: translate({ key: 'workspaces.ticket.pauseAgent' }), icon: 'pause', onClick: () => { ctx.pauseTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.ticket.resumeAgent' }), icon: 'play', onClick: () => { ctx.resumeTicket(ticket.id); } },
    { label: translate({ key: 'workspaces.ticket.critiquePlan' }), icon: 'wand-magic-sparkles', onClick: () => { ctx.planCritique(ticket.id); } },
  ];
  if (showDevOps) {
    agentMenu.push(
      { label: translate({ key: 'workspaces.timetravel.button' }), icon: 'clock-rotate-left', onClick: openTimeTravel },
      { divider: true },
      { label: translate({ key: 'workspaces.ticket.killAgent' }), icon: 'ban', danger: true, onClick: kill },
    );
  }

  return (
    <>
    <div className="px-4 md:px-6 pb-2 flex flex-wrap items-center gap-2">
      <WsButton variant="secondary" icon="display" disabled={preview.loading} onClick={() => { void openPreview(); }}>
        {translate({ key: preview.loading ? 'workspaces.ticket.previewOpening' : 'workspaces.ticket.openPreview' })}
      </WsButton>
      <PopMenu items={agentMenu} />
      {preview.url !== undefined && <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate max-w-xs">{preview.url}</a>}
      {/* #37 — stop a running preview (closePreview existed but had no UI trigger). */}
      {preview.url !== undefined && (
        <WsButton variant="ghost" icon="circle-stop" onClick={() => { ctx.closePreview(ticket.id); setPreview({ loading: false }); }}>{translate({ key: 'workspaces.ticket.stopPreview' })}</WsButton>
      )}
      {preview.err === true && (
        <div className="flex items-center gap-1.5 text-xs text-wrong">
          <span>{translate({ key: 'workspaces.ticket.previewFailed' })}</span>
          {/* #39 — actionable pointer: a failed preview usually means the dev command isn't set. */}
          <button type="button" onClick={() => { ctx.navigate('workspace'); }} className="text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.ticket.previewSetDevCommand' })}</button>
        </div>
      )}
    </div>
    {/* #38 — inline preview (decision A: inline is primary; the URL link above opens it in a new tab). */}
    {preview.url !== undefined && (
      <div className="px-4 md:px-6 pb-3">
        <iframe title={translate({ key: 'workspaces.ticket.openPreview' })} src={preview.url} className="w-full h-[60vh] rounded-xl border border-container1-border bg-container1" />
      </div>
    )}
    {/* #20 — Live agent: tail the code agent's PTY output as the turn runs. Only offered once output arrives. */}
    {liveOutput.length > 0 && (
      <div className="px-4 md:px-6 pb-3 flex flex-col gap-2">
        <button type="button" onClick={() => { setShowLive((v) => !v); }} className="self-start text-xs text-muted hover:text-common cursor-pointer inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-correct animate-pulse" />{translate({ key: showLive ? 'workspaces.ticket.liveAgentHide' : 'workspaces.ticket.liveAgentShow' })}
        </button>
        {showLive && (
          <pre className="w-full max-h-80 overflow-auto rounded-xl border border-container1-border bg-container2/60 p-3 text-[11px] leading-snug font-mono text-common whitespace-pre-wrap break-words">{liveOutput}</pre>
        )}
      </div>
    )}
    </>
  );
}

function TicketHeader({ ticket }: { ticket: Ticket }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const linked = ctx.ticketMembers(ticket);
  const { setTicketPresence } = ctx;
  //? Realtime presence (#17): announce viewing on open + a heartbeat (< the 25s prune), retract on
  //? close. `setTicketPresence` is a stable useCallback, so this doesn't re-fire on every render.
  useEffect(() => {
    setTicketPresence(ticket.id, true);
    const hb = setInterval(() => { setTicketPresence(ticket.id, true); }, 12_000);
    return () => { clearInterval(hb); setTicketPresence(ticket.id, false); };
  }, [ticket.id, setTicketPresence]);
  const viewers = ctx.viewersOf(ticket.id).map((uid) => ctx.membersById[uid]).filter((m): m is Member => m !== undefined);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(ticket.title);
  //? Focus the title input when edit mode opens (user-initiated, so a11y-safe —
  //? avoids the `autoFocus` prop the jsx-a11y rule bans for on-load focus).
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (renaming) nameRef.current?.focus(); }, [renaming]);

  const startRename = () => { setNameInput(ticket.title); setRenaming(true); };
  const commitRename = () => {
    if (!renaming) return;
    setRenaming(false);
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== ticket.title) ctx.editTicket(ticket.id, { title: trimmed });
  };

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-5 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm text-muted">
            <span className="font-mono">{ticket.id}</span>
            {ticket.issue && <span>· {ticket.issue}</span>}
            {ticket.status !== 'idle' && <StatusPill status={ticket.status} />}
          </div>
          {renaming ? (
            <input
              ref={nameRef}
              value={nameInput} onChange={(e) => { setNameInput(e.target.value); }}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
              className="w-full text-xl md:text-2xl font-semibold text-title bg-transparent border-b border-primary mt-1.5 leading-snug focus:outline-none"
            />
          ) : (
            <div className="flex items-center gap-2 mt-1.5">
              <h1 className="text-xl md:text-2xl font-semibold text-title leading-snug">{ticket.title}</h1>
              <button type="button" onClick={startRename} title={translate({ key: 'workspaces.ticket.editTitle' })} className="text-xs text-muted hover:text-title cursor-pointer shrink-0">{translate({ key: 'workspaces.workspaceSettings.edit' })}</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 pt-1">
          {viewers.length > 0 && (
            <div className="flex items-center gap-1.5" title={translate({ key: 'workspaces.ticket.viewingNow' })}>
              <span className="w-1.5 h-1.5 rounded-full bg-correct motion-safe:animate-pulse" />
              <AvatarStack users={viewers} size={24} max={4} />
            </div>
          )}
          {linked.length > 0 && <div title={translate({ key: 'workspaces.ticket.creatorAssignee' })}><AvatarStack users={linked} size={26} /></div>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-3">
        {ticket.branch && <MetaChip icon="diagram-project" text={ticket.branch} />}
        {ticket.mr && ticket.mr !== '—' && <MetaChip icon="code-merge" text={ticket.mr} />}
        {ticket.costLabel && <MetaChip icon="chart-column" text={ticket.costLabel} />}
        <MetaChip icon="up-right-from-square" text={translate({ key: 'workspaces.ticket.previewLive' })} tone="correct" />
        <div className="flex-1" />
        <WsButton variant="secondary" icon="terminal" onClick={() => { ctx.navigate('terminals'); }}>{translate({ key: 'workspaces.ticket.openTerminal' })}</WsButton>
        <WsButton variant="secondary" icon="up-right-from-square" onClick={() => { /* Fase 2: no GitLab deep-link op yet */ }}>{translate({ key: 'workspaces.ticket.gitlab' })}</WsButton>
      </div>

      {ticket.labels.length > 0 && <div className="flex flex-wrap gap-1 mt-3">{ticket.labels.map((l) => <LabelChip key={l} name={l} />)}</div>}
    </div>
  );
}

function MetaChip({ icon, text, tone }: { icon: Parameters<typeof Icon>[0]['name']; text: string; tone?: 'correct' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg bg-container2 px-2 h-7 text-xs font-medium ${tone === 'correct' ? 'text-correct' : 'text-common'}`}>
      <Icon name={icon} /> {text}
    </span>
  );
}

function Banner({ tone, icon, title, action, children }: { tone: 'warning' | 'correct'; icon: Parameters<typeof Icon>[0]['name']; title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  const ring = tone === 'warning' ? 'border-warning/40 bg-warning/10' : 'border-correct/40 bg-correct/10';
  const fg = tone === 'warning' ? 'text-warning' : 'text-correct';
  return (
    <div className={`mx-4 md:mx-6 mb-2 rounded-xl border ${ring} p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon name={icon} className={`${fg} mt-0.5`} />
          <div>
            <div className="text-sm font-semibold text-title">{title}</div>
            {children}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}

//? #16 (W2) — the advisory list: NON-blocking questions the agent already proceeded past with an
//? assumption. Confirm the assumption (marks it resolved) or Correct it (a divergent answer schedules a
//? revision turn). Routes through the SAME `answerInput` op with the advisory's index.
function AdvisoryList({ ticketKey, advisories }: { ticketKey: string; advisories: { index: number; q: string; assumption: string }[] }) {
  const translate = useTranslator();
  const { answerInput } = useWorkspaces();
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [text, setText] = useState('');
  return (
    <div className="rounded-xl border border-container1-border bg-container1 p-4 flex flex-col gap-2">
      <div className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1.5"><Icon name="lightbulb" className="text-warning" /> {translate({ key: 'workspaces.ticket.advisoryTitle' })}</div>
      {advisories.map((a) => (
        <div key={a.index} className="rounded-lg border border-container2-border bg-container2/40 p-2.5 flex flex-col gap-1.5">
          <div className="text-sm text-title">{a.q}</div>
          {a.assumption.length > 0 && <div className="text-xs text-muted">{translate({ key: 'workspaces.ticket.advisoryAssumption', params: [{ key: 'assumption', value: a.assumption }] })}</div>}
          {correcting === a.index ? (
            <div className="flex items-center gap-2">
              <input value={text} onChange={(e) => { setText(e.target.value); }} placeholder={translate({ key: 'workspaces.ticket.advisoryCorrectPh' })} className="flex-1 h-8 px-2 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
              <WsButton icon="check" disabled={text.trim().length === 0} onClick={() => { answerInput(ticketKey, text.trim(), a.index); setCorrecting(null); setText(''); }}>{translate({ key: 'workspaces.ticket.advisorySubmit' })}</WsButton>
              <WsButton variant="ghost" onClick={() => { setCorrecting(null); setText(''); }}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <WsButton variant="secondary" icon="check" onClick={() => { answerInput(ticketKey, a.assumption || 'ok', a.index); }}>{translate({ key: 'workspaces.ticket.advisoryConfirm' })}</WsButton>
              <WsButton variant="ghost" icon="pen" onClick={() => { setCorrecting(a.index); setText(''); }}>{translate({ key: 'workspaces.ticket.advisoryCorrect' })}</WsButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

//? P-B — a structured, phone-usable answer card. The agent's question is stored in `needsInput` and
//? decoded here: an `approve` question renders Approve/Reject (+ an optional note); a `choice` question
//? renders one tap-target per option; a `free` question keeps the text input. Every path routes through the
//? SAME `answerInput` op (the Conductor records it + re-fires the parked turn) — no new verb, no schema
//? change. Optimistic: the card disappears when the ticket delta (needsInput cleared) broadcasts back.
function NeedsInputBanner({ question, ticketKey }: { question: string; ticketKey: string }) {
  const translate = useTranslator();
  const { answerInput } = useWorkspaces();
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const sq = parseStructuredQuestion(question);
  const answer = (a: string) => { const v = a.trim(); if (v.length === 0) return; answerInput(ticketKey, v); setReply(''); setNote(''); };
  const withNote = (decision: string) => { answer(note.trim().length > 0 ? `${decision}: ${note.trim()}` : decision); };
  return (
    <Banner tone="warning" icon="circle-question" title={translate({ key: 'workspaces.ticket.agentNeedsInput' })}>
      <p className="text-sm text-common mt-0.5">{sq.prompt}</p>
      {sq.kind === 'approve' && (
        <div className="flex flex-col gap-2 mt-2">
          <input
            value={note} onChange={(e) => { setNote(e.target.value); }}
            placeholder={translate({ key: 'workspaces.ticket.notePlaceholder' })}
            className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          />
          <div className="flex items-center gap-2">
            <WsButton icon="check" onClick={() => { withNote(translate({ key: 'workspaces.ticket.approved' })); }}>{translate({ key: 'workspaces.ticket.approve' })}</WsButton>
            <WsButton variant="ghost" icon="xmark" onClick={() => { withNote(translate({ key: 'workspaces.ticket.rejected' })); }}>{translate({ key: 'workspaces.ticket.reject' })}</WsButton>
          </div>
        </div>
      )}
      {sq.kind === 'choice' && (
        <div className="flex flex-wrap gap-2 mt-2">
          {sq.options.map((opt) => (
            <WsButton key={opt} variant="ghost" onClick={() => { answer(opt); }}>{opt}</WsButton>
          ))}
        </div>
      )}
      {sq.kind === 'free' && (
        <div className="flex items-center gap-2 mt-2">
          <input
            value={reply} onChange={(e) => { setReply(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') answer(reply); }}
            placeholder={translate({ key: 'workspaces.ticket.answerPlaceholder' })}
            className="flex-1 h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          />
          <WsButton onClick={() => { answer(reply); }}>{translate({ key: 'workspaces.ticket.send' })}</WsButton>
        </div>
      )}
    </Banner>
  );
}

function OverviewTab({ ticket, stage }: { ticket: Ticket; stage?: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [desc, setDesc] = useState(ticket.description ?? '');
  useEffect(() => { setDesc(ticket.description ?? ''); }, [ticket.description]);
  const commitDesc = () => { if (desc !== (ticket.description ?? '')) ctx.editTicket(ticket.id, { description: desc }); };
  const priorityItems: DropdownItem[] = PRIORITY_ORDER.map((p) => ({ id: p, value: p, item: translate({ key: PRIORITY_LABEL_KEY[p] }) }));
  //? The REAL stage config for this ticket's stage (was a static "AI-driven · RAG…"
  //? string that contradicted a No-AI stage). Drives the aiEnabled label + skills.
  const stageCfg = ctx.stageConfigs.find((s) => s.id === ticket.stageId);
  const stageSkills = stageCfg ? [...stageCfg.skillKeys, ...(stageCfg.sourceIds.length > 0 ? [String(stageCfg.sourceIds.length) + ' sources'] : [])] : [];
  return (
    <div className="flex flex-col gap-4">
      <Card title={translate({ key: 'workspaces.ticket.description' })}>
        <textarea
          value={desc} onChange={(e) => { setDesc(e.target.value); }}
          onBlur={commitDesc}
          placeholder={translate({ key: 'workspaces.ticket.addDescriptionPlaceholder' })}
          rows={4}
          className="w-full resize-y rounded-lg border border-container1-border bg-container2/50 px-3 py-2 text-sm text-common leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
        />
      </Card>
      <Card title={translate({ key: 'workspaces.priority.label' })}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PRIORITY_DOT[ticket.priority ?? 'normal']}`} />
          <Dropdown
            size="sm"
            items={priorityItems}
            value={priorityItems.find((i) => i.id === (ticket.priority ?? 'normal'))}
            onChange={(it) => {
              const next = PRIORITY_ORDER.find((p) => p === it.id) ?? 'normal';
              if (next !== (ticket.priority ?? 'normal')) ctx.editTicket(ticket.id, { priority: next });
            }}
          />
          {(ticket.priority ?? 'normal') === 'urgent' && (
            <span className="text-xs text-wrong">{translate({ key: 'workspaces.priority.urgentHint' })}</span>
          )}
        </div>
      </Card>
      {ticket.carryOver && (
        <Card title={translate({ key: 'workspaces.ticket.carryOverTitle' })}>
          <p className="text-sm text-common leading-relaxed">{ticket.carryOver}</p>
        </Card>
      )}
      <Card title={translate({ key: 'workspaces.ticket.stageConfig' })}>
        <div className="flex items-center gap-2 text-sm text-common">
          <Icon name="diagram-project" className="text-muted" />
          <span className="text-title font-medium">{stage ?? '—'}</span>
          <span className="text-muted">· {stageCfg?.aiEnabled === true ? translate({ key: 'workspaces.board.aiDrivenStage' }) : translate({ key: 'workspaces.board.noAi' })}{stageSkills.length > 0 ? ` · ${stageSkills.join(', ')}` : ''}</span>
        </div>
      </Card>
      <LinkedArtifactsCard ticketKey={ticket.id} />
      <CommentsThread ticketId={ticket.id} />
      {/* Teardown is a destructive dev-op → only for the development module + admin/owner (fail-open on unknown role). */}
      {isModuleEnabled(ctx.activeWorkspace.enabledSections, 'development') && ctx.activeWorkspace.role !== 'member' && (
        <div className="flex items-center gap-2">
          <WsButton
            variant="danger" icon="box-archive"
            onClick={() => {
              /* Fase 2: no teardown-container control-op yet — confirm only, no follow-up write */
              void menuHandler.confirm({ title: translate({ key: 'workspaces.ticket.teardownConfirmTitle', params: [{ key: 'id', value: ticket.id }] }), content: translate({ key: 'workspaces.ticket.teardownConfirmContent' }), input: ticket.id });
            }}
          >
            {translate({ key: 'workspaces.ticket.teardownContainer' })}
          </WsButton>
        </div>
      )}
    </div>
  );
}

//? Linked artifacts (ADR 0034) — design/Studio artifacts this ticket implements. The Conductor injects
//? each linked artifact into the coding agent's context at stage-spawn, so linking a Designer theme or
//? a Studio spec to a ticket makes the agent build to it.
function LinkedArtifactsCard({ ticketKey }: { ticketKey: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const links = ctx.ticketArtifactLinks.filter((l) => l.ticketId === ticketKey);
  const options: DropdownItem[] = [
    ...ctx.designArtifacts.map((d) => ({ id: `design:${d.id}`, value: `design:${d.id}`, item: `${d.kind}: ${d.name}`, searchText: d.name })),
    ...ctx.studioArtifacts.map((s) => ({ id: `studio:${s.id}`, value: `studio:${s.id}`, item: `${s.kind}: ${s.title}`, searchText: s.title })),
  ];
  const onPick = (it: DropdownItem) => {
    const kind = String(it.id).startsWith('design:') ? 'design' : 'studio';
    const aid = String(it.id).slice(kind.length + 1);
    if (aid.length === 0) return;
    const name = kind === 'design' ? ctx.designArtifacts.find((d) => d.id === aid)?.name : ctx.studioArtifacts.find((s) => s.id === aid)?.title;
    ctx.linkArtifact(ticketKey, aid, kind, name);
  };
  return (
    <Card title={translate({ key: 'workspaces.ticket.linkedArtifacts' })}>
      <div className="flex flex-col gap-2">
        {links.length === 0 && <div className="text-xs text-muted">{translate({ key: 'workspaces.ticket.noLinkedArtifacts' })}</div>}
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 rounded-lg border border-container1-border bg-container2/40 px-2.5 py-1.5">
            <Icon name={l.artifactKind === 'design' ? 'palette' : 'bullhorn'} className="text-primary text-sm shrink-0" />
            <span className="text-sm text-common truncate flex-1">{l.name}</span>
            <button type="button" onClick={() => { ctx.unlinkArtifact(l.id); }} className="text-muted hover:text-wrong cursor-pointer shrink-0"><Icon name="xmark" className="text-xs" /></button>
          </div>
        ))}
        {options.length > 0 && <Dropdown size="sm" items={options} placeholder={translate({ key: 'workspaces.ticket.linkArtifactPlaceholder' })} onChange={onPick} />}
      </div>
    </Card>
  );
}

//? Comments thread + composer, scoped to one ticket. Notes arrive newest-first
//? from the snapshot; rendered oldest→newest so the thread reads top-to-bottom.
//? Non-user / unknown authors fall back to a generic label + initials avatar.
function CommentsThread({ ticketId }: { ticketId: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const [draft, setDraft] = useState('');
  const notes = ctx.ticketNotes.filter((n) => n.ticketId === ticketId).toReversed();

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    ctx.addComment(ticketId, trimmed);
    setDraft('');
  };

  return (
    <Card title={translate({ key: 'workspaces.ticket.comments' })}>
      <div className="flex flex-col gap-3">
        {notes.length === 0
          ? <div className="text-sm text-muted">{translate({ key: 'workspaces.ticket.noComments' })}</div>
          : notes.map((n) => {
            const author = ctx.membersById[n.author];
            const name = author?.name ?? translate({ key: 'workspaces.ticket.commentSystemAuthor' });
            return (
              <div key={n.id} className="flex items-start gap-2.5">
                <AvatarBubble user={author ?? { name }} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-title">{name}</span>
                    <span className="text-xs text-muted font-mono">{n.time}</span>
                  </div>
                  <p className="text-sm text-common leading-relaxed mt-0.5 whitespace-pre-wrap break-words">{n.body}</p>
                </div>
              </div>
            );
          })}
        <div className="flex items-end gap-2 pt-1">
          <textarea
            value={draft} onChange={(e) => { setDraft(e.target.value); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={translate({ key: 'workspaces.ticket.addCommentPlaceholder' })}
            rows={2}
            className="flex-1 resize-y rounded-lg border border-container1-border bg-container2/50 px-3 py-2 text-sm text-common leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          />
          <WsButton onClick={submit}>{translate({ key: 'workspaces.ticket.send' })}</WsButton>
        </div>
      </div>
    </Card>
  );
}

//? Remembered terminal height (module-level so a drag persists across remounts /
//? tab switches without threading it through page state — mirrors the Terminals
//? page's rememberedGridHeight).
let rememberedTerminalHeight = 320;
const MIN_TERMINAL_HEIGHT = 220;
const MAX_TERMINAL_HEIGHT = 900;

//? Which terminals exist comes from the ticket's CURRENT stage pipeline config
//? (`ctx.stageConfigs[stageId].processes`), not a per-ticket terminal catalog. A
//? stage with no configured processes (e.g. `unrefined` human-triage) has NO
//? terminal — render the empty state.
function TerminalTab({ ticketId, stageId }: { ticketId: string; stageId: string }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  const stageCfg = ctx.stageConfigs.find((s) => s.id === stageId);
  const processes = stageCfg?.processes ?? [];
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(rememberedTerminalHeight);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  //? Drag the bottom strip to resize the panel height. Clamp to a sane range and
  //? remember the last height at module level. Pointer-capture keeps the drag
  //? tracking even when the cursor leaves the thin handle (mirrors TerminalPanel).
  const onHandleDown = (e: ReactPointerEvent) => {
    dragRef.current = { startY: e.clientY, startH: height };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const next = Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, dragRef.current.startH + (e.clientY - dragRef.current.startY)));
    rememberedTerminalHeight = next;
    setHeight(next);
  };
  const onHandleUp = () => { dragRef.current = null; setDragging(false); };

  const proc = processes[active] ?? processes[0];
  if (!proc) {
    return <EmptyState icon="terminal" title={translate({ key: 'workspaces.ticket.noTerminal' })} sub={translate({ key: 'workspaces.ticket.noTerminalSub' })} />;
  }
  return (
    <div className="rounded-xl overflow-hidden border border-container1-border">
      <div className="flex items-center justify-between gap-2 bg-terminal-surface px-3 h-10 text-terminal-text">
        <div className="flex items-center gap-1">
          {processes.map((p, i) => (
            <button key={p.name} type="button" onClick={() => { setActive(i); }}
              className={`rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors ${i === active ? 'bg-white/10 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}>
              {p.name}
            </button>
          ))}
          <span className="text-terminal-muted text-xs ml-1">· {proc.cwd}</span>
        </div>
        <button type="button" onClick={() => { ctx.navigate('terminals'); }} className="text-xs text-terminal-muted hover:text-terminal-text cursor-pointer inline-flex items-center gap-1">
          <Icon name="up-right-from-square" /> {translate({ key: 'workspaces.ticket.openInTerminals' })}
        </button>
      </div>
      <div style={{ height }}>
        <XtermTerminal key={`${ticketId}:${proc.name}`} sessionId={`${ticketId}:${proc.name}`} className="h-full" />
      </div>
      <div onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
        title={translate({ key: 'workspaces.terminals.resizeTitle' })}
        className="group h-2.5 flex items-center justify-center cursor-ns-resize bg-terminal-surface border-t border-white/5">
        <span className={`w-8 h-0.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-terminal-muted/50 group-hover:bg-terminal-muted'}`} />
      </div>
    </div>
  );
}

function FilesTab({ files }: { files: TicketFile[] }) {
  const translate = useTranslator();
  if (files.length === 0) return <EmptyState icon="diagram-project" title={translate({ key: 'workspaces.ticket.noFileChanges' })} sub={translate({ key: 'workspaces.ticket.noFileChangesSub' })} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.ticket.changedFilesCount', params: [{ key: 'count', value: files.length }] })}</span>
        <WsButton variant="secondary" icon="link" onClick={() => { /* Fase 2: reference picker not wired yet */ }}>{translate({ key: 'workspaces.ticket.addReference' })}</WsButton>
      </div>
      <FileDiffViewer files={files} />
    </div>
  );
}

const ACTOR_GLYPH = (actor: string, membersById: Record<string, Member>) => (actor === 'ai' ? '🤖' : (actor === 'mr' ? '🔀' : (membersById[actor]?.name[0] ?? '·')));
const EVENT_TINT: Record<ActivityEvent['type'], string> = {
  command: 'bg-container2 text-common',
  'file-change': 'bg-primary/12 text-primary',
  'ai-message': 'bg-primary/12 text-primary',
  'status-change': 'bg-warning/15 text-warning',
  mr: 'bg-correct/15 text-correct',
  comment: 'bg-container2 text-muted',
  ci: 'bg-secondary/15 text-secondary',
};

function ActivityTab({ events }: { events: ActivityEvent[] }) {
  const translate = useTranslator();
  const ctx = useWorkspaces();
  if (events.length === 0) return <EmptyState icon="wave-square" title={translate({ key: 'workspaces.ticket.noActivity' })} />;
  return (
    <div className="flex flex-col gap-2">
      {events.map((e) => (
        <div key={`${e.time}-${e.actor}-${e.type}-${e.text}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-container2/50 transition-colors">
          <span className="w-6 h-6 rounded-full bg-container2 text-xs flex items-center justify-center shrink-0">{ACTOR_GLYPH(e.actor, ctx.membersById)}</span>
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${EVENT_TINT[e.type]}`}>{e.type}</span>
          <span className="text-sm text-common flex-1 min-w-0 truncate">{e.text}</span>
          <span className="text-xs text-muted font-mono shrink-0">{e.time}</span>
        </div>
      ))}
    </div>
  );
}

function WhyPopover({ reason }: { reason: string }) {
  const translate = useTranslator();
  return (
    <span className="relative group/why inline-flex">
      <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center cursor-help">?</span>
      <span className="pointer-events-none absolute right-0 top-6 z-30 w-64 rounded-xl border border-container1-border bg-container1 p-3 text-xs text-common shadow-lg opacity-0 translate-y-1 group-hover/why:opacity-100 group-hover/why:translate-y-0 transition-all duration-150">
        <span className="font-semibold text-title block mb-1">{translate({ key: 'workspaces.ticket.whyThisLink' })}</span>
        {reason}
      </span>
    </span>
  );
}

function LinksTab({ links, onOpen }: { links: TicketLink[]; onOpen: (id: string) => void }) {
  const translate = useTranslator();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.ticket.relatedTickets' })}</span>
        <WsButton variant="secondary" icon="link" onClick={() => { /* Fase 2: ticket link picker not wired yet */ }}>{translate({ key: 'workspaces.ticket.linkTicket' })}</WsButton>
      </div>
      {links.length === 0
        ? <EmptyState icon="link" title={translate({ key: 'workspaces.ticket.noLinks' })} sub={translate({ key: 'workspaces.ticket.noLinksSub' })} />
        : (
          <Card>
            <div className="flex flex-col divide-y divide-divider">
              {links.map((l) => (
                <div key={l.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <button type="button" onClick={() => { onOpen(l.id); }} className="font-mono text-sm text-primary hover:underline cursor-pointer">{l.id}</button>
                  <span className="text-sm text-muted">{l.rel}</span>
                  {l.ai && (
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px] font-medium"><Icon name="robot" /> {translate({ key: 'workspaces.ticket.aiSuggested' })}</span>
                      {l.reason && <WhyPopover reason={l.reason} />}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
    </div>
  );
}

function HistoryTab({ history }: { history: StageHistoryEntry[] }) {
  const translate = useTranslator();
  if (history.length === 0) return <EmptyState icon="list-check" title={translate({ key: 'workspaces.ticket.noStageHistory' })} />;
  return (
    <div className="flex flex-col">
      {history.map((h, i) => (
        // eslint-disable-next-line react-x/no-array-index-key -- append-only ordered history; a stage can recur, so the positional index is the entry identity
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${h.done ? 'bg-correct/15 text-correct' : 'bg-primary/12 text-primary'}`}>
              <Icon name={h.done ? 'circle-check' : 'clock'} />
            </span>
            {i < history.length - 1 && <span className="w-px flex-1 bg-divider my-1" />}
          </div>
          <div className="pb-5">
            <div className="text-sm font-semibold text-title">{h.stage}</div>
            <div className="text-sm text-common mt-0.5">{h.summary}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      {title && <div className="text-sm font-semibold text-title mb-2">{title}</div>}
      {children}
    </section>
  );
}
