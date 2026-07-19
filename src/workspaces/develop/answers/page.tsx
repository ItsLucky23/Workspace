//? intent: One place to answer every AI that is waiting on you, without hunting for the ticket it belongs to.
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

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import { EmptyState, StatusPill, WsButton } from '../../_components/primitives';
import { parseStructuredQuestion } from '../../_functions/structuredQuestion';
import { useWorkspaces } from '../../_shell/WorkspacesContext';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

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
function QueueCard({ item }: { item: { ticketKey: string; title: string; question: string; priority: string; stageId: string; waitingSince?: string; openCount: number } }) {
  const translate = useTranslator();
  const navigate = useNavigate();
  const { answerInput, isAnswerPending } = useWorkspaces();
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');

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
  };
  const withNote = (decision: string) => { answer(note.trim().length > 0 ? `${decision}: ${note.trim()}` : decision); };

  return (
    <div className={`rounded-xl border bg-container1 p-4 flex flex-col gap-2 ${stale ? 'border-warning' : 'border-container1-border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* The ticket key stays a link: answering is the common case, but "what IS this?" needs an exit. */}
            <button type="button" onClick={() => { void navigate(`/workspaces/board/${item.ticketKey}`); }} className="text-xs font-mono text-primary hover:underline cursor-pointer">{item.ticketKey}</button>
            <StatusPill status="needs-input" />
            <span className="text-xs text-muted">{item.stageId}</span>
            {item.openCount > 1 && (
              <span className="text-[11px] rounded-md bg-container2 px-1.5 py-0.5 text-muted">{translate({ key: 'workspaces.answers.moreOpen', params: [{ key: 'n', value: String(item.openCount - 1) }] })}</span>
            )}
          </div>
          <div className="text-sm font-medium text-title truncate">{item.title}</div>
        </div>
        {waited !== null && (
          <span className={`text-xs shrink-0 ${stale ? 'text-warning' : 'text-muted'}`}>
            {stale && <Icon name="triangle-exclamation" className="mr-1" />}{waited}
          </span>
        )}
      </div>

      <p className="text-sm text-common">{sq.prompt}</p>

      {sq.kind === 'approve' && (
        <div className="flex flex-col gap-2">
          <input
            value={note} onChange={(e) => { setNote(e.target.value); }} disabled={pending}
            placeholder={translate({ key: 'workspaces.ticket.notePlaceholder' })}
            className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary disabled:opacity-50"
          />
          <div className="flex items-center gap-2">
            <WsButton icon={pending ? 'spinner' : 'check'} disabled={pending} onClick={() => { withNote(translate({ key: 'workspaces.ticket.approved' })); }}>{translate({ key: pending ? 'workspaces.ticket.sending' : 'workspaces.ticket.approve' })}</WsButton>
            <WsButton variant="ghost" icon="xmark" disabled={pending} onClick={() => { withNote(translate({ key: 'workspaces.ticket.rejected' })); }}>{translate({ key: 'workspaces.ticket.reject' })}</WsButton>
          </div>
        </div>
      )}

      {sq.kind === 'choice' && (
        <div className="flex flex-wrap gap-2">
          {sq.options.map((opt) => (
            <WsButton key={opt} variant="ghost" disabled={pending} onClick={() => { answer(opt); }}>{opt}</WsButton>
          ))}
        </div>
      )}

      {sq.kind === 'free' && (
        <div className="flex items-center gap-2">
          <input
            value={reply} onChange={(e) => { setReply(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') answer(reply); }}
            placeholder={translate({ key: 'workspaces.ticket.answerPlaceholder' })} disabled={pending}
            className="flex-1 h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary disabled:opacity-50"
          />
          <WsButton icon={pending ? 'spinner' : undefined} disabled={pending} onClick={() => { answer(reply); }}>{translate({ key: pending ? 'workspaces.ticket.sending' : 'workspaces.ticket.send' })}</WsButton>
        </div>
      )}
    </div>
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
      //? The banner shows ONE question; a ticket may hold several. Without the server's set we cannot know
      //? how many follow, so the card simply does not claim a count rather than guessing at one.
      openCount: 1,
    }))
    .toSorted((a, b) => {
      const byPriority = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
      if (byPriority !== 0) return byPriority;
      return (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '');
    }), [tickets]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.answers.heading' })}</h1>
        <p className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.answers.sub' })}</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
          {answerQueue.length === 0
            ? (
              //? An empty inbox is the GOOD state here, so it reads as "nothing is blocked on you" rather
              //? than as an error or an unfinished screen.
              <EmptyState
                icon="circle-check"
                title={translate({ key: 'workspaces.answers.emptyTitle' })}
                sub={translate({ key: 'workspaces.answers.emptySub' })}
              />
            )
            : answerQueue.map((item) => <QueueCard key={item.ticketKey} item={item} />)}
        </div>
      </div>
    </div>
  );
}
