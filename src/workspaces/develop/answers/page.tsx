//? intent: The cross-ticket answer inbox — every AI question waiting on you, highest-priority and longest-waiting first, answered directly on its card (approve / pick an option / type); stage metadata and the optional approve-note sit behind small per-card disclosures.
//?
//? The cross-ticket answer inbox. A server-built `answerQueue` has existed in the snapshot since ADR 0048
//? and was rendered by NOTHING — the data was plumbed all the way to the client and then dropped on the floor.
//?
//? For a product whose whole premise is "the human is a man-in-the-middle who only approves and answers
//? questions", that is a gap on the core loop: you could only answer a question if you happened to have the
//? right ticket open. This page is the drain. Highest priority first, oldest wait surfaced, and the same
//? structured tap-targets the ticket banner offers — an approve question stays two buttons here too.
//?
//? The queue is DERIVED from the live tickets rather than read from that snapshot array. A browser pass
//? showed why: answering cleared the ticket server-side, the ticket delta arrived — and the inbox kept
//? showing the answered question, because no delta ever updates a separate `answerQueue` array. Tickets are
//? what the realtime layer actually keeps current, so the queue is computed from them and cannot go stale.
//?
//? KISS pass: the answer control is the card's ONE primary thing. The optional approve-note and the
//? stage/open-count metadata moved behind tiny per-card toggles so a first glance is just
//? "which ticket · how long has it waited · the question · the buttons".

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { Collapse } from '../../_components/motion';
import { EmptyState, InfoTip, StatusPill, WsButton } from '../../_components/primitives';
import type { TicketPriority } from '../../_data/types';
import { PRIORITY_DOT, PRIORITY_LABEL_KEY, isBadgedPriority } from '../../_functions/priority';
import { parseStructuredQuestion } from '../../_functions/structuredQuestion';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { useEffect, useMemo, useRef, useState } from 'react';

export const template = 'workspaces';

//? "How long has this been waiting?" is the question a reviewer actually has. Coarse on purpose: the
//? difference between 3 and 4 minutes never changes what you do, the difference between minutes and days does.
function waitedFor(iso: string | undefined, translate: (input: { key: string; params?: { key: string; value: string }[] }) => string): string | null {
  if (iso === undefined) return null;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return translate({ key: 'workspaces.answers.waitedMinutes', params: [{ key: 'n', value: String(minutes) }] });
  if (minutes < 1440) return translate({ key: 'workspaces.answers.waitedHours', params: [{ key: 'n', value: String(Math.round(minutes / 60)) }] });
  return translate({ key: 'workspaces.answers.waitedDays', params: [{ key: 'n', value: String(Math.round(minutes / 1440)) }] });
}

//? A question that has been sitting for hours is the failure this product is built to avoid, so it is
//? flagged rather than merely displayed.
const STALE_AFTER_MINUTES = 120;

function isStale(iso: string | undefined): boolean {
  if (iso === undefined) return false;
  return (Date.now() - new Date(iso).getTime()) / 60_000 > STALE_AFTER_MINUTES;
}

//? One waiting question. Deliberately the same interaction as the ticket's own banner — a user who learned
//? it in one place should not have to relearn it in the other.
function QueueCard({ item }: { item: { ticketKey: string; title: string; question: string; priority: TicketPriority; stageId: string; waitingSince?: string; openQuestionCount?: number } }) {
  const translate = useTranslator();
  const { answerInput, isAnswerPending, openTicket, claimTicket, claimedBy, membersById, currentUser } = useWorkspaces();
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  //? Focus the note input when the toggle opens it (user-initiated, so a11y-safe — avoids the
  //? `autoFocus` prop the jsx-a11y rule bans for on-load focus).
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (noteOpen) noteRef.current?.focus(); }, [noteOpen]);
  useEffect(() => () => { claimTicket(item.ticketKey, false); }, [claimTicket, item.ticketKey]);

  const claimantId = claimedBy(item.ticketKey);
  const claimant = claimantId !== null && claimantId !== currentUser.id ? membersById[claimantId] : undefined;
  const sq = parseStructuredQuestion(item.question);
  const pending = isAnswerPending(item.ticketKey);
  const waited = waitedFor(item.waitingSince, translate);
  const stale = isStale(item.waitingSince);

  const answer = (raw: string) => {
    const value = raw.trim();
    if (value.length === 0 || pending) return;
    answerInput(item.ticketKey, value);
    setReply('');
    setNote('');
    setNoteOpen(false);
  };
  const withNote = (decision: string) => { answer(note.trim().length > 0 ? `${decision}: ${note.trim()}` : decision); };
  //? Collapsing the note discards it: what is visible is exactly what gets sent — no hidden text riding
  //? along on an Approve.
  const toggleNote = () => {
    if (noteOpen) setNote('');
    setNoteOpen(!noteOpen);
  };

  return (
    <div className={`rounded-xl border bg-container1 p-4 flex flex-col gap-2 ${stale ? 'border-warning' : 'border-container1-border'}`}>
      <div className={`flex items-start justify-between gap-3`}>
        <div className={`min-w-0 flex-1 flex flex-col gap-0.5`}>
          <div className={`flex items-center gap-2 flex-wrap`}>
            {/* The ticket key stays a link: answering is the common case, but "what IS this?" needs an exit. */}
            <button type="button" onClick={() => { openTicket(item.ticketKey); }} className={`text-xs font-mono text-primary hover:underline cursor-pointer`}>{item.ticketKey}</button>
            <StatusPill status="needs-input" />
            {/* The list sorts by priority first, so the sort key needs a visible anchor on the card itself —
                without this, urgent and normal cards looked identical except for position. */}
            {isBadgedPriority(item.priority) && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${item.priority === 'urgent' ? 'text-wrong' : 'text-warning'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[item.priority]}`} />
                {translate({ key: PRIORITY_LABEL_KEY[item.priority] })}
              </span>
            )}
            {/* The whole value of this inbox is seeing WHERE the blockage is — a ticket parked on more than
                one question needs that visible here, not behind the Details disclosure. */}
            {item.openQuestionCount !== undefined && item.openQuestionCount > 1 && (
              <span className={`inline-flex items-center gap-1`}>
                <span className={`text-[11px] font-medium text-meta`}>
                  {translate({ key: 'workspaces.answers.moreOpen', params: [{ key: 'n', value: String(item.openQuestionCount - 1) }] })}
                </span>
                {/* Answering one question does NOT resume the ticket — conductor.ts:2266 advances the
                    banner and returns; only the last answer reprovisions with all answers combined. */}
                <InfoTip
                  align="start"
                  label={translate({ key: 'workspaces.tips.board.moreOpenGateTitle' })}
                  title={translate({ key: 'workspaces.tips.board.moreOpenGateTitle' })}
                  body={translate({ key: 'workspaces.tips.board.moreOpenGateBody' })}
                />
              </span>
            )}
          </div>
          <div className={`text-sm font-medium text-title truncate`}>{item.title}</div>
        </div>
        <div className={`flex items-center gap-2 shrink-0`}>
          {claimant && <span className={`text-xs text-warning`}>{translate({ key: 'workspaces.answers.claimedBy', params: [{ key: 'name', value: claimant.name }] })}</span>}
          {waited !== null && (
            <span title={stale ? translate({ key: 'workspaces.answers.staleTooltip' }) : undefined} className={`text-xs ${stale ? 'text-warning' : 'text-muted'}`}>
              {stale && <Icon name="triangle-exclamation" className={`mr-1`} />}{waited}
            </span>
          )}
        </div>
      </div>

      <div
        className={`flex flex-col gap-2`}
        onFocus={() => { claimTicket(item.ticketKey, true); }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) claimTicket(item.ticketKey, false);
        }}
      >
        <p className={`text-sm text-common`}>{sq.prompt}</p>

        {sq.kind === 'approve' && (
        <div className={`flex flex-col gap-2`}>
          <div className={`flex flex-wrap items-center gap-2`}>
            <WsButton icon={pending ? 'spinner' : 'check'} disabled={pending} onClick={() => { withNote(translate({ key: 'workspaces.ticket.approved' })); }}>{translate({ key: pending ? 'workspaces.ticket.sending' : 'workspaces.ticket.approve' })}</WsButton>
            <WsButton variant="ghost" icon="xmark" disabled={pending} onClick={() => { withNote(translate({ key: 'workspaces.ticket.rejected' })); }}>{translate({ key: 'workspaces.ticket.reject' })}</WsButton>
            {/* The note is the rare case, so it expands on demand — Approve/Reject stay one tap. */}
            <button type="button" aria-expanded={noteOpen} disabled={pending} onClick={toggleNote} className={`inline-flex items-center gap-1.5 text-xs text-muted hover:text-common cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}>
              <Icon name={noteOpen ? 'xmark' : 'plus'} />{translate({ key: 'workspaces.answers.addNote' })}
            </button>
            {/* Approve/Reject are not a structured verdict: the translated word plus the note is sent as
                ordinary free text (nothing server-side branches on it). It becomes the resume prompt
                (questionSet.ts:68 — or a numbered Q→A list when several questions were open), which
                stageRunner.ts:736 embeds in a fixed "the human answered … continue" wrapper — so the
                agent reads the answer, but not as a bare verbatim line. A restart that has to queue
                (capacity, editor open, paused) is re-provisioned WITHOUT that prompt, so the tip says
                "usually" rather than promising delivery. */}
            <InfoTip
              align="start"
              label={translate({ key: 'workspaces.tips.board.approveNoteTitle' })}
              title={translate({ key: 'workspaces.tips.board.approveNoteTitle' })}
              body={translate({ key: 'workspaces.tips.board.approveNoteBody' })}
            />
          </div>
          <Collapse open={noteOpen}>
            <input
              ref={noteRef} value={note} onChange={(e) => { setNote(e.target.value); }} disabled={pending}
              placeholder={translate({ key: 'workspaces.ticket.notePlaceholder' })}
              className={`w-full h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary disabled:opacity-50`}
            />
          </Collapse>
        </div>
      )}

      {sq.kind === 'choice' && (
        <div className={`flex flex-wrap gap-2`}>
          {sq.options.map((opt) => (
            <WsButton key={opt} variant="ghost" disabled={pending} onClick={() => { answer(opt); }}>{opt}</WsButton>
          ))}
        </div>
      )}

        {sq.kind === 'free' && (
          <div className={`flex flex-wrap items-center gap-2`}>
            <input
              value={reply} onChange={(e) => { setReply(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') answer(reply); }}
              placeholder={translate({ key: 'workspaces.ticket.answerPlaceholder' })} disabled={pending}
              className={`flex-1 min-w-40 h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary disabled:opacity-50`}
            />
            <WsButton icon={pending ? 'spinner' : undefined} disabled={pending} onClick={() => { answer(reply); }}>{translate({ key: pending ? 'workspaces.ticket.sending' : 'workspaces.ticket.send' })}</WsButton>
          </div>
        )}
      </div>

      {/* Metadata nobody needs for the decision itself — which pipeline stage is asking, whether more
          questions follow — folds away so the card stays scannable at phone width. */}
      <div className={`flex flex-col gap-1.5`}>
        <button type="button" aria-expanded={detailsOpen} onClick={() => { setDetailsOpen(!detailsOpen); }} className={`self-start inline-flex items-center gap-1.5 text-xs text-muted hover:text-common cursor-pointer`}>
          <Icon name="caret-down" className={`transition-transform motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`} />
          {translate({ key: 'workspaces.answers.details' })}
        </button>
        <Collapse open={detailsOpen}>
          <div className={`flex items-center gap-2 flex-wrap text-xs text-muted`}>
            <span>{translate({ key: 'workspaces.answers.stageLabel', params: [{ key: 's', value: item.stageId }] })}</span>
          </div>
        </Collapse>
      </div>
    </div>
  );
}

//? An empty inbox is the GOOD state here, so it reads as "nothing is blocked on you" rather than as an
//? error or an unfinished screen — and it teaches what will show up here, with the board as the way to
//? watch the running work that will produce the next question.
function InboxEmpty() {
  const translate = useTranslator();
  const { navigate } = useWorkspaces();
  return (
    <EmptyState
      icon="circle-check"
      title={translate({ key: 'workspaces.answers.emptyTitle' })}
      sub={`${translate({ key: 'workspaces.answers.emptySub' })} ${translate({ key: 'workspaces.answers.emptyTeach' })}`}
      action={<WsButton variant="secondary" icon="table-columns" onClick={() => { navigate('board'); }}>{translate({ key: 'workspaces.answers.viewBoard' })}</WsButton>}
    />
  );
}

//? Highest priority first, then longest-waiting — the two things that decide what a reviewer opens next.
const PRIORITY_RANK: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

export default function Answers() {
  const translate = useTranslator();
  const { tickets } = useWorkspaces();

  const answerQueue = useMemo(() => tickets
    .filter((t) => t.archived !== true && ((t.needsInput ?? '').length > 0 || t.status === 'needs-input'))
    .map((t) => ({
      ticketKey: t.id, title: t.title, question: t.needsInput ?? '',
      priority: t.priority ?? 'normal', stageId: t.stageId,
      ...(t.lastActivityAt === undefined ? {} : { waitingSince: t.lastActivityAt }),
      ...(t.openQuestionCount === undefined ? {} : { openQuestionCount: t.openQuestionCount }),
    }))
    .toSorted((a, b) => {
      const byPriority = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
      if (byPriority !== 0) return byPriority;
      return (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '');
    }), [tickets]);

  return (
    <div className={`flex flex-col h-full min-h-0`}>
      <div className={`px-4 md:px-6 py-3 md:py-4`}>
        <h1 className={`text-xl md:text-2xl font-semibold text-title`}>{translate({ key: 'workspaces.answers.heading' })}</h1>
        <p className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.answers.sub' })}</p>
        {/* The ticket's own banner offers the identical control — a user who finds both independently
            should not read them as two places state can drift. */}
        <p className={`text-xs text-muted mt-1`}>{translate({ key: 'workspaces.answers.sameAsTicket' })}</p>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8`}>
        <div className={`max-w-2xl mx-auto w-full flex flex-col gap-3`}>
          {answerQueue.length === 0
            ? <InboxEmpty />
            : answerQueue.map((item) => <QueueCard key={item.ticketKey} item={item} />)}
        </div>
      </div>
    </div>
  );
}
