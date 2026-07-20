//? Workspaces — built-in merge-request review panel (BUILTIN_MR_REVIEW). Renders the MR
//? view the `workspaces/mrAction` sync produces: a unified diff with old/new gutters and
//? line-anchored review threads, an MR-level discussion, approvals (with staleness), and
//? approve / merge controls. Reads the live view from `ctx.mrByBranch` (keyed by the
//? ticket's source branch) and drives its own load via `mrAction('create', …)`.

import { useEffect, useState } from 'react';

import { i18nNotify as notify, useTranslator } from '@luckystack/core/client';

import Icon, { type IconName } from './Icon';
import { AvatarBubble, EmptyState, WsButton } from './primitives';
import type { MrDiffFile, MrDiffLine, MrThread, MrView, Ticket } from '../_data/types';
import { useWorkspaces } from '../_shell/WorkspacesContext';

//? The three editors a changed file can be previewed in — the same trio as the ticket's Code tab
//? (lightweight diff · Monaco source-control diff · live in-container VS Code).
type PreviewMode = 'diff' | 'changes' | 'live';

const ROW_TINT: Record<MrDiffLine['kind'], string> = { add: 'bg-correct/10', del: 'bg-wrong/10', ctx: '', hunk: 'bg-container2' };
const TEXT_TINT: Record<MrDiffLine['kind'], string> = { add: 'text-correct', del: 'text-wrong', ctx: 'text-common', hunk: 'text-muted' };
const SIGN: Record<MrDiffLine['kind'], string> = { add: '+', del: '-', ctx: ' ', hunk: '' };

const FILE_STATUS_TINT: Record<MrDiffFile['status'], string> = {
  added: 'bg-correct/15 text-correct', deleted: 'bg-wrong/12 text-wrong',
  modified: 'bg-primary/12 text-primary', renamed: 'bg-warning/15 text-warning',
};
const FILE_STATUS_KEY: Record<MrDiffFile['status'], string> = {
  added: 'workspaces.mr.fileAdded', deleted: 'workspaces.mr.fileDeleted',
  modified: 'workspaces.mr.fileModified', renamed: 'workspaces.mr.fileRenamed',
};

//? #51/#52 — CI status/severity tints for the Checks section.
const CI_TINT: Record<string, string> = { success: 'bg-correct/15 text-correct', failed: 'bg-wrong/12 text-wrong', running: 'bg-warning/15 text-warning' };
const CI_ICON: Record<string, string> = { success: 'circle-check', failed: 'circle-xmark', running: 'spinner' };
const SEV_TINT: Record<string, string> = { critical: 'bg-wrong/12 text-wrong', high: 'bg-wrong/12 text-wrong', moderate: 'bg-warning/15 text-warning' };
const ciTint = (s: string): string => CI_TINT[s] ?? 'bg-container2 text-muted';
const ciIcon = (s: string): string => CI_ICON[s] ?? 'circle-minus';
const sevTint = (s: string): string => SEV_TINT[s] ?? 'bg-container2 text-muted';
//? #55 — merge-gate reason → i18n key (conflict is handled separately as it carries params).
const MR_REASON_KEY: Record<string, string> = { 'no-approval': 'needsApproval', 'ci-red': 'ciRed', 'ci-running': 'ciRunning', 'ci-stale': 'ciStale' };

//? A line's review anchor: which number + side a comment on it targets. Deletions anchor to
//? the old file/line; additions + context anchor to the new one.
function anchorOf(line: MrDiffLine): { no: number; side: 'old' | 'new' } | null {
  if (line.kind === 'del') return line.oldNo === null ? null : { no: line.oldNo, side: 'old' };
  if (line.kind === 'add' || line.kind === 'ctx') return line.newNo === null ? null : { no: line.newNo, side: 'new' };
  return null;
}
const normSide = (side: string): 'old' | 'new' => (side === 'old' ? 'old' : 'new');

export default function MrReviewPanel({ ticket, onPreviewFile }: { ticket: Ticket; onPreviewFile?: (path: string, mode: PreviewMode) => void }) {
  const translate = useTranslator();
  const { mrAction, mrByBranch } = useWorkspaces();
  const branch = ticket.branch ?? '';
  const mr = mrByBranch[branch];
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!branch) return;
    let cancelled = false;
    setPhase('loading');
    void mrAction('create', { ticketKey: ticket.id }).then((r) => {
      if (!cancelled) setPhase(r.ok ? 'ready' : 'error');
    });
    return () => { cancelled = true; };
  }, [branch, ticket.id, mrAction]);

  if (!branch) {
    return <EmptyState icon="code-merge" title={translate({ key: 'workspaces.mr.noBranchTitle' })} sub={translate({ key: 'workspaces.mr.noBranchSub' })} />;
  }
  if (!mr) {
    if (phase === 'error') {
      return (
        <EmptyState
          icon="triangle-exclamation" title={translate({ key: 'workspaces.mr.loadFailed' })}
          action={<WsButton variant="secondary" icon="wave-square" onClick={() => { setPhase('loading'); void mrAction('create', { ticketKey: ticket.id }).then((r) => { setPhase(r.ok ? 'ready' : 'error'); }); }}>{translate({ key: 'workspaces.mr.retry' })}</WsButton>}
        />
      );
    }
    if (phase === 'ready') return <EmptyState icon="code-merge" title={translate({ key: 'workspaces.mr.noMr' })} />;
    return <EmptyState icon="clock" title={translate({ key: 'workspaces.mr.loading' })} />;
  }
  return <MrBody mr={mr} ticketKey={ticket.id} onPreviewFile={onPreviewFile} />;
}

function MrBody({ mr, ticketKey, onPreviewFile }: { mr: MrView; ticketKey: string; onPreviewFile?: (path: string, mode: PreviewMode) => void }) {
  const translate = useTranslator();
  const { mrAction, currentUser, runCi, activeWorkspace, allowCiRed } = useWorkspaces();
  const [busy, setBusy] = useState<null | 'approve' | 'merge' | 'rollback'>(null);

  const isOpen = mr.status === 'open';
  const isMerged = mr.status === 'merged';
  const isConflict = mr.status === 'conflict';
  const alreadyApproved = mr.approvals.some((a) => a.userId === currentUser.id && !a.stale);
  //? Merge gate (#9): the server requires ≥1 approval bound to the current head; mirror it in the UI
  //? so Merge is disabled (with a hint) until someone has approved this exact head.
  const hasFreshApproval = mr.approvals.some((a) => !a.stale);

  const statusKey = ((): string => {
    if (isMerged) return 'workspaces.mr.statusMerged';
    if (isConflict) return 'workspaces.mr.statusConflict';
    if (isOpen) return 'workspaces.mr.statusOpen';
    return 'workspaces.mr.statusClosed';
  })();
  const statusLabel = translate({ key: statusKey });
  const statusTint = ((): string => {
    if (isMerged) return 'bg-correct/15 text-correct';
    if (isConflict) return 'bg-wrong/15 text-wrong';
    if (isOpen) return 'bg-primary/12 text-primary';
    return 'bg-container2 text-muted';
  })();

  //? Toast the transient merge/rollback outcome (no-approval / conflict + files) the server returns.
  const reportOutcome = (r: { ok: boolean; outcome?: { ok: boolean; reason?: string; files?: string[] } }, successKey: string) => {
    const outcome = r.ok ? r.outcome : undefined;
    if (!r.ok) { notify.error({ key: 'workspaces.mr.actionFailed' }); return; }
    if (outcome && !outcome.ok) {
      //? conflict carries the conflicting file list; the other reasons (#55) map to a plain key.
      if (outcome.reason === 'conflict') notify.error({ key: 'workspaces.mr.conflict', params: [{ key: 'files', value: (outcome.files ?? []).join(', ') || '—' }] });
      else notify.error({ key: `workspaces.mr.${MR_REASON_KEY[outcome.reason ?? ''] ?? 'mergeFailed'}` });
      return;
    }
    notify.success({ key: successKey });
  };

  const approve = () => { setBusy('approve'); void mrAction('approve', { ticketKey, mrId: mr.id }).then(() => { setBusy(null); }); };
  const merge = () => { setBusy('merge'); void mrAction('merge', { ticketKey, mrId: mr.id }).then((r) => { setBusy(null); reportOutcome(r, 'workspaces.mr.mergedToast'); }); };
  const rollback = () => { setBusy('rollback'); void mrAction('rollback', { ticketKey, mrId: mr.id }).then((r) => { setBusy(null); reportOutcome(r, 'workspaces.mr.revertedToast'); }); };
  //? mr-review (ADR 0041) — kick off an AI review of this MR's diff; the findings land as a WorkspaceSuggestion
  //? the human accepts to post as review comments. Fire-and-notify (runs async, never writes directly — B-23).
  const aiReview = () => { void mrAction('review', { ticketKey, mrId: mr.id }); notify.success({ key: 'workspaces.mr.aiReviewQueued' }); };

  const mrLevelThreads = mr.threads.filter((t) => t.filePath === null);

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="rounded-2xl border border-container1-border bg-container1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-muted">!{mr.number}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${statusTint}`}>
                <Icon name={isMerged ? 'code-merge' : (isOpen ? 'code-branch' : 'circle-check')} />{statusLabel}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-title mt-1.5 leading-snug break-words">{mr.title}</h2>
            <div className="flex items-center gap-2 flex-wrap mt-2 text-xs font-mono text-muted">
              <span className="inline-flex items-center gap-1 rounded-md bg-container2 px-1.5 py-0.5 text-common">{mr.sourceBranch}</span>
              <Icon name="angle-right" />
              <span className="inline-flex items-center gap-1 rounded-md bg-container2 px-1.5 py-0.5 text-common">{mr.targetBranch}</span>
              <span className="text-correct">+{mr.diff.additions}</span>
              <span className="text-wrong">−{mr.diff.deletions}</span>
              <span>· {translate({ key: 'workspaces.mr.filesChanged', params: [{ key: 'count', value: mr.diff.files.length }] })}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2">
              {/* I1 — run the built-in CI at this MR's head (ci-run op, previously no button). */}
              <WsButton variant="ghost" icon="wave-square" disabled={busy !== null} onClick={() => { runCi(ticketKey); }}>{translate({ key: 'workspaces.mr.runCi' })}</WsButton>
              {/* mr-review — AI review of the diff (was pipeline-only, no manual trigger). */}
              <WsButton variant="ghost" icon="robot" disabled={busy !== null} onClick={aiReview}>{translate({ key: 'workspaces.mr.aiReview' })}</WsButton>
              {/* ci-allow-red — let a human merge while CI is red (was UI-less). */}
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer" title={translate({ key: 'workspaces.mr.allowRedHint' })}>
                <input type="checkbox" checked={activeWorkspace.allowMergeOnRedCI ?? false} onChange={(e) => { allowCiRed(e.target.checked); }} className="accent-primary" />
                {translate({ key: 'workspaces.mr.allowRed' })}
              </label>
              <WsButton variant="secondary" icon="circle-check" disabled={busy !== null || alreadyApproved} onClick={approve}>
                {translate({ key: alreadyApproved ? 'workspaces.mr.approved' : 'workspaces.mr.approve' })}
              </WsButton>
              {isMerged
                ? (
                  <WsButton variant="secondary" icon="rotate-left" disabled={busy !== null} onClick={rollback}>
                    {translate({ key: 'workspaces.mr.revert' })}
                  </WsButton>
                )
                : (
                  <WsButton
                    variant="primary" icon="code-merge"
                    disabled={busy !== null || (!isOpen && !isConflict) || !hasFreshApproval}
                    title={hasFreshApproval ? undefined : translate({ key: 'workspaces.mr.needsApproval' })}
                    onClick={merge}
                  >
                    {translate({ key: isConflict ? 'workspaces.mr.retryMerge' : 'workspaces.mr.merge' })}
                  </WsButton>
                )}
            </div>
            {mr.externalUrl !== null && mr.externalUrl.length > 0 && (
              <a href={mr.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                <Icon name="up-right-from-square" /> {translate({ key: 'workspaces.mr.viewOnForge' })}
              </a>
            )}
          </div>
        </div>
        <Approvals mr={mr} />
      </div>

      {/* #51/#52 — CI Checks: rolled-up run status, per-job state, and parsed security findings. */}
      {mr.checks && (
        <div className="rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-title">{translate({ key: 'workspaces.mr.checksTitle' })}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ciTint(mr.checks.status)}`}>
              <Icon name={ciIcon(mr.checks.status)} />{translate({ key: `workspaces.mr.ciStatus.${mr.checks.status}` })}
            </span>
          </div>
          {/* Per-service CI: one row per unit, each with its own verdict and its own retry. A monorepo
              previously showed ONE status for the whole MR, so a red service was either invisible behind a
              green sibling or unattributable. A single-unit repo shows exactly one row — itself. */}
          {mr.checks.units.map((unit) => (
            <div key={unit.serviceId ?? 'root'} className="flex items-center justify-between gap-2 border-t border-divider pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ciTint(unit.status)}`}>
                  <Icon name={ciIcon(unit.status)} />{unit.serviceName}
                </span>
                {unit.jobs.map((j) => (
                  <span key={`${unit.serviceId ?? 'root'}:${j.name}`} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${ciTint(j.status)}`}>
                    <Icon name={ciIcon(j.status)} />{j.name}
                  </span>
                ))}
              </div>
              {/* Retry just this unit — re-running the whole MR to fix one flaky service is the thing that
                  makes people stop using CI. */}
              <button type="button" disabled={busy !== null} onClick={() => { runCi(ticketKey, unit.serviceId); }} className="text-xs text-primary hover:underline cursor-pointer shrink-0 disabled:opacity-50">{translate({ key: 'workspaces.mr.retryUnit' })}</button>
            </div>
          ))}
          {mr.checks.findings.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-divider pt-2">
              {mr.checks.findings.map((f, i) => (
                <div key={`${f.severity}:${f.title}:${String(i)}`} className="flex items-center gap-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${sevTint(f.severity)}`}>{f.severity}</span>
                  <span className="text-common truncate">{f.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* general discussion */}
      <Discussion mr={mr} threads={mrLevelThreads} ticketKey={ticketKey} />

      {/* per-file diffs */}
      {mr.diff.truncated && (
        <div className="flex items-center gap-1.5 text-xs text-warning">
          <Icon name="triangle-exclamation" /> {translate({ key: 'workspaces.mr.diffTruncated' })}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {mr.diff.files.map((f) => <FileDiff key={f.path} file={f} mr={mr} ticketKey={ticketKey} onPreviewFile={onPreviewFile} />)}
      </div>
    </div>
  );
}

function Approvals({ mr }: { mr: MrView }) {
  const translate = useTranslator();
  const { membersById } = useWorkspaces();
  const hasStale = mr.approvals.some((a) => a.stale);
  return (
    <div className="flex items-center gap-2 flex-wrap mt-4 pt-4 border-t border-divider">
      <span className="text-xs font-semibold text-title">{translate({ key: 'workspaces.mr.approvals' })}</span>
      {mr.approvals.length === 0
        ? <span className="text-xs text-muted">{translate({ key: 'workspaces.mr.noApprovals' })}</span>
        : (
          <div className="flex items-center gap-1.5">
            {mr.approvals.map((a) => {
              const member = membersById[a.userId];
              return (
                <span key={a.userId} className={`relative inline-flex ${a.stale ? 'opacity-50' : ''}`} title={member?.name ?? a.userId}>
                  <AvatarBubble user={member ?? { name: a.userId }} size={24} />
                </span>
              );
            })}
          </div>
        )}
      {hasStale && (
        <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 text-warning px-1.5 py-0.5 text-[11px] font-medium">
          <Icon name="triangle-exclamation" /> {translate({ key: 'workspaces.mr.needsReReview' })}
        </span>
      )}
    </div>
  );
}

function FileDiff({ file, mr, ticketKey, onPreviewFile }: { file: MrDiffFile; mr: MrView; ticketKey: string; onPreviewFile?: (path: string, mode: PreviewMode) => void }) {
  const translate = useTranslator();
  const { mrAction } = useWorkspaces();
  const [open, setOpen] = useState(true);
  const [composing, setComposing] = useState<string | null>(null);

  const fileThreads = mr.threads.filter((t) => t.filePath === file.path);
  const shown = new Set<string>();

  return (
    <div className="rounded-xl border border-container1-border overflow-hidden">
      <div className="w-full flex items-center bg-container1">
        <button
          type="button" onClick={() => { setOpen((v) => !v); }}
          className="flex-1 min-w-0 flex items-center justify-between gap-3 hover:bg-container1-hover px-3 h-10 cursor-pointer transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Icon name={open ? 'angle-down' : 'angle-right'} className="text-muted" />
            <span className="font-mono text-xs text-title truncate" title={file.path}>{file.path}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${FILE_STATUS_TINT[file.status]}`}>{translate({ key: FILE_STATUS_KEY[file.status] })}</span>
          </span>
          <span className="flex items-center gap-2 text-xs font-mono shrink-0">
            <span className="text-correct">+{file.additions}</span>
            <span className="text-wrong">−{file.deletions}</span>
          </span>
        </button>
        {onPreviewFile && (
          //? Preview this changed file in one of the ticket's editors — the same three modes as the Code tab.
          //? Icon-only to stay compact in the file header; each carries a translated tooltip + accessible name.
          //? (A dropdown menu would be clipped by this row's `overflow-hidden` container, so a button row it is.)
          <div className="flex items-center gap-0.5 pr-2 shrink-0">
            <PreviewButton icon="code-branch" label={translate({ key: 'workspaces.ticket.codeDiffMode' })} onClick={() => { onPreviewFile(file.path, 'diff'); }} />
            <PreviewButton icon="pen" label={translate({ key: 'workspaces.ticket.codeChanges' })} onClick={() => { onPreviewFile(file.path, 'changes'); }} />
            <PreviewButton icon="display" label={translate({ key: 'workspaces.ticket.openLiveEditor' })} onClick={() => { onPreviewFile(file.path, 'live'); }} />
          </div>
        )}
      </div>
      {open && (
        <div className="border-t border-divider overflow-x-auto font-mono text-xs leading-relaxed">
          {file.lines.map((line, i) => {
            const anchor = anchorOf(line);
            const key = `${file.path}:${String(i)}`;
            const lineThreads = anchor
              ? fileThreads.filter((t) => t.line === anchor.no && normSide(t.side) === anchor.side)
              : [];
            for (const t of lineThreads) shown.add(t.id);
            return (
              // eslint-disable-next-line react-x/no-array-index-key -- a diff is a static, non-reordering render with possibly-identical lines, so the positional index is the row identity
              <div key={i}>
                <div className={`group/line flex items-stretch ${ROW_TINT[line.kind]}`}>
                  <span className="w-7 shrink-0 flex items-center justify-center select-none">
                    {anchor && (
                      <button
                        type="button" title={translate({ key: 'workspaces.mr.commentOnLine' })}
                        onClick={() => { setComposing((c) => (c === key ? null : key)); }}
                        className="opacity-0 pointer-coarse:opacity-100 group-hover/line:opacity-100 text-muted hover:text-primary transition-opacity cursor-pointer"
                      >
                        <Icon name="comment" />
                      </button>
                    )}
                  </span>
                  <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-disabled select-none tabular-nums">{line.oldNo ?? ''}</span>
                  <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-disabled select-none border-r border-divider tabular-nums">{line.newNo ?? ''}</span>
                  <span className={`flex-1 pl-2 pr-3 py-0.5 whitespace-pre ${TEXT_TINT[line.kind]}`}>
                    <span className="select-none opacity-70">{SIGN[line.kind]} </span>{line.content}
                  </span>
                </div>
                {lineThreads.map((t) => <Thread key={t.id} thread={t} mr={mr} ticketKey={ticketKey} />)}
                {composing === key && anchor && (
                  <Composer
                    onCancel={() => { setComposing(null); }}
                    onSubmit={async (body) => {
                      const res = await mrAction('comment', { ticketKey, mrId: mr.id, body, filePath: file.path, line: anchor.no, side: anchor.side });
                      if (res.ok) setComposing(null);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* threads on this file not anchored to a visible line (line-less or out-of-window) */}
      {open && fileThreads.some((t) => !shown.has(t.id)) && (
        <div className="border-t border-divider p-3 flex flex-col gap-2 bg-container2/30">
          {fileThreads.filter((t) => !shown.has(t.id)).map((t) => <Thread key={t.id} thread={t} mr={mr} ticketKey={ticketKey} boxed />)}
        </div>
      )}
    </div>
  );
}

function Discussion({ mr, threads, ticketKey }: { mr: MrView; threads: MrThread[]; ticketKey: string }) {
  const translate = useTranslator();
  const { mrAction } = useWorkspaces();
  const [composing, setComposing] = useState(false);
  return (
    <div className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.mr.discussion' })}</span>
        <WsButton variant="secondary" icon="comment" onClick={() => { setComposing((v) => !v); }}>{translate({ key: 'workspaces.mr.comment' })}</WsButton>
      </div>
      <div className="flex flex-col gap-2">
        {threads.length === 0 && !composing && <div className="text-sm text-muted">{translate({ key: 'workspaces.mr.noDiscussion' })}</div>}
        {threads.map((t) => <Thread key={t.id} thread={t} mr={mr} ticketKey={ticketKey} boxed />)}
        {composing && (
          <Composer
            onCancel={() => { setComposing(false); }}
            onSubmit={async (body) => {
              const res = await mrAction('comment', { ticketKey, mrId: mr.id, body });
              if (res.ok) setComposing(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Thread({ thread, mr, ticketKey, boxed = false }: { thread: MrThread; mr: MrView; ticketKey: string; boxed?: boolean }) {
  const translate = useTranslator();
  const { mrAction, membersById } = useWorkspaces();
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleResolved = () => {
    setBusy(true);
    void mrAction('resolve', { ticketKey, threadId: thread.id, resolved: !thread.resolved }).then(() => { setBusy(false); });
  };

  return (
    <div className={`flex flex-col gap-2 ${boxed ? 'rounded-xl border border-container1-border bg-container1 p-3' : 'mx-2 my-1.5 rounded-xl border border-container1-border bg-container1 p-3'} ${thread.resolved ? 'opacity-70' : ''}`}>
      {thread.comments.map((c) => {
        const author = c.authorId === null ? undefined : membersById[c.authorId];
        const name = author?.name ?? (c.authorKind === 'ai' ? translate({ key: 'workspaces.mr.aiAuthor' }) : translate({ key: 'workspaces.ticket.commentSystemAuthor' }));
        return (
          <div key={c.id} className="flex items-start gap-2.5">
            <AvatarBubble user={author ?? { name }} size={26} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-title">{name}</span>
                <span className="text-xs text-muted font-mono">{c.createdAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
              <p className="text-sm text-common leading-relaxed mt-0.5 whitespace-pre-wrap break-words font-sans">{c.body}</p>
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-3 pl-9">
        <button type="button" onClick={() => { setReplying((v) => !v); }} className="text-xs text-common hover:text-title cursor-pointer inline-flex items-center gap-1">
          <Icon name="comment" /> {translate({ key: 'workspaces.mr.reply' })}
        </button>
        <button type="button" disabled={busy} onClick={toggleResolved} className={`text-xs cursor-pointer inline-flex items-center gap-1 disabled:opacity-50 ${thread.resolved ? 'text-correct' : 'text-common hover:text-title'}`}>
          <Icon name="circle-check" /> {translate({ key: thread.resolved ? 'workspaces.mr.resolved' : 'workspaces.mr.resolve' })}
        </button>
      </div>
      {replying && (
        <Composer
          onCancel={() => { setReplying(false); }}
          onSubmit={async (body) => {
            const res = await mrAction('comment', { ticketKey, mrId: mr.id, body, threadId: thread.id });
            if (res.ok) setReplying(false);
          }}
        />
      )}
    </div>
  );
}

function Composer({ onSubmit, onCancel }: { onSubmit: (body: string) => Promise<void>; onCancel: () => void }) {
  const translate = useTranslator();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    void onSubmit(trimmed).then(() => { setBusy(false); setDraft(''); });
  };

  return (
    <div className="flex items-end gap-2 p-2 font-sans">
      <textarea
        value={draft} onChange={(e) => { setDraft(e.target.value); }}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder={translate({ key: 'workspaces.mr.commentPlaceholder' })}
        rows={2}
        className="flex-1 resize-y rounded-lg border border-container1-border bg-container2/50 px-3 py-2 text-sm text-common leading-relaxed focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
      />
      <div className="flex flex-col gap-1.5">
        <WsButton disabled={busy} onClick={submit}>{translate({ key: 'workspaces.ticket.send' })}</WsButton>
        <WsButton variant="ghost" onClick={onCancel}>{translate({ key: 'workspaces.mr.cancel' })}</WsButton>
      </div>
    </div>
  );
}

//? Compact icon-only trigger to preview a changed file in one of the ticket editors, shown in the MR file
//? header when the panel is given an `onPreviewFile` handler. Icon-only → the tooltip doubles as the
//? accessible name (mirrors the IconButton primitive).
function PreviewButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button" title={label} aria-label={label} onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:bg-container2 hover:text-primary transition-colors cursor-pointer"
    >
      <Icon name={icon} />
    </button>
  );
}
