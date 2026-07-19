//? The cross-ticket answer inbox + the two bugs the BROWSER caught in it that no unit test would have.
//?
//? Context: a server-built `answerQueue` sat in the snapshot since ADR 0048 and was rendered by nothing.
//? For a product whose premise is "the human only approves and answers questions", that is a gap on the
//? core loop — you could only answer if you happened to have the right ticket open.
//?
//? Both browser findings are pinned here because both produced a SUCCESSFUL-looking write:
//?   1. answering cleared the ticket server-side and the inbox kept showing the answered question, because
//?      no realtime delta ever updates a separate `answerQueue` array;
//?   2. the F45 idempotency id keyed on the TICKET, so the next question's answer on the same ticket was
//?      silently swallowed as a replay of the previous one — parked ticket, spinning button, no error.

import { readFileSync } from 'node:fs';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { encodeQuestion, parseStructuredQuestion } from '../../src/workspaces/_functions/structuredQuestion.ts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const prisma = await db();
const workspaceId = '000000000000000000a48001';

/* ------------------------------------------------------------ the queue is DERIVED, not stored */

const page = read('src/workspaces/develop/answers/page.tsx');
assert(page.includes('const { tickets } = useWorkspaces()'), 'the inbox reads the live tickets');
assert(page.includes('.filter((t) => t.archived !== true && ((t.needsInput ?? \'\').length > 0 || t.status === \'needs-input\'))'), 'and derives the queue from them');
assert(!page.includes('const { answerQueue } = useWorkspaces()'), 'it does NOT read a snapshot array that no delta keeps current');

//? The dead server-side field is gone rather than left in place — a snapshot field nobody reads is exactly
//? the pattern that produced this gap in the first place.
const snapshot = read('server/read/workspaceSnapshot.ts');
assert(!snapshot.includes('answerQueue'), 'the unreadable server-side answerQueue was removed, not left dangling');
const types = read('src/workspaces/_data/types.ts');
assert(!types.includes('AnswerQueueItem'), 'and so is its type');

/* ------------------------------------------------------------ the idempotency id keys on the QUESTION */

const provider = read('src/workspaces/_shell/WorkspacesProvider.tsx');
assert(provider.includes('const askedNow = snap.tickets.find((t) => t.id === ticketId)?.needsInput ?? \'\''), 'the write reads the question currently being asked');
assert(provider.includes('const reqId = `answer:${key}:${shortHash(askedNow)}`'), 'and folds it into the idempotency id');
assert(!provider.includes('const reqId = `answer:${key}`;'), 'the ticket-only id is gone — it swallowed the NEXT question as a replay');

//? The fingerprint only has to distinguish one open question from the next on the same ticket.
const shortHash = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.trunc(Math.imul(31, hash) + (value.codePointAt(index) ?? 0));
  return (hash >>> 0).toString(36);
};
const first = encodeQuestion({ kind: 'approve', prompt: 'Drop the legacy /v1 endpoint?' });
const second = encodeQuestion({ kind: 'choice', prompt: 'Which cache?', options: ['Redis', 'Postgres'] });
assert(shortHash(first) !== shortHash(second), 'two different questions produce different ids — otherwise the second answer is deduped away');
eq(shortHash(first), shortHash(first), 'and the same question is stable — that is what makes a double-tap dedupe');

/* ------------------------------------------------------------ structured questions survive the trip */

//? The inbox must offer the SAME tap-targets as the ticket banner. That only works if the raw envelope
//? reaches it: flattening the question to its prompt (which the old server-side queue did) silently
//? degrades every approve/choice question into a free-text box.
const approve = parseStructuredQuestion(encodeQuestion({ kind: 'approve', prompt: 'Ship it?' }));
eq(approve.kind, 'approve', 'an approve question stays an approve question');
const choice = parseStructuredQuestion(encodeQuestion({ kind: 'choice', prompt: 'Which cache?', options: ['Redis', 'Postgres'] }));
eq(choice.kind, 'choice', 'a choice question keeps its kind');
eq(choice.options.length, 2, 'and its options');
assert(page.includes('parseStructuredQuestion(item.question)'), 'the inbox parses the raw envelope');
assert(page.includes("sq.kind === 'approve'") && page.includes("sq.kind === 'choice'"), 'and renders both structured kinds');

/* ------------------------------------------------------------ ordering + the wait indicator */

const existing = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
if (existing) await cleanupWorkspace(prisma, workspaceId);
await prisma.workspace.create({ data: { id: workspaceId, name: 'Answer inbox', slug: `answers-${String(Date.now())}`, ownerId: '000000000000000000a48fff' } });
const projectId = '000000000000000000a48bbb';

const park = async (key: string, number: number, priority: string, minutesAgo: number) => prisma.ticket.create({
  data: {
    workspaceId, projectId, key, number, title: `Ticket ${key}`, stageId: 'implement', status: 'needs-input',
    needsInput: encodeQuestion({ kind: 'approve', prompt: `Approve ${key}?` }),
    labels: [], priority, lastActivityAt: new Date(Date.now() - minutesAgo * 60_000),
  },
});
await park('DEV-1', 1, 'normal', 5);
await park('DEV-2', 2, 'urgent', 1);
await park('DEV-3', 3, 'normal', 240);

//? The client's ordering rule, applied to the same rows: urgent first, then longest-waiting. This is the
//? order a reviewer needs — "what should I look at next?" is the only question a queue exists to answer.
const PRIORITY_RANK: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
const parked = await prisma.ticket.findMany({ where: { workspaceId, status: 'needs-input' } });
const ordered = parked
  .map((t) => ({ key: t.key, priority: t.priority, waitingSince: t.lastActivityAt?.toISOString() ?? '' }))
  .toSorted((a, b) => {
    const byPriority = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
    return byPriority === 0 ? a.waitingSince.localeCompare(b.waitingSince) : byPriority;
  });
eq(ordered[0]?.key, 'DEV-2', 'the urgent ticket comes first even though it is the newest');
eq(ordered[1]?.key, 'DEV-3', 'then the longest-waiting of the rest');
eq(ordered[2]?.key, 'DEV-1', 'then the newer one');

//? An answered ticket must leave the queue. Deriving from tickets is what makes this automatic — the ticket
//? delta that clears `needsInput` IS the queue update.
await prisma.ticket.updateMany({ where: { workspaceId, key: 'DEV-2' }, data: { needsInput: null, status: 'idle' } });
const remaining = await prisma.ticket.findMany({ where: { workspaceId, status: 'needs-input' } });
eq(remaining.length, 2, 'an answered ticket drops out of the queue');
assert(!remaining.some((t) => t.key === 'DEV-2'), 'specifically the one that was answered');

/* ------------------------------------------------------------ reachability */

const shell = read('src/workspaces/_shell/Shell.tsx');
//? ADR 0280 — the verb groups became module categories; the inbox sits first-class under Develop.
assert(shell.includes("{ id: 'answers', icon: 'circle-question', label: 'Answers', group: 'develop' }"), 'the inbox has a nav entry');
assert(shell.includes("group: 'develop'"), 'in Develop — on a phone-first product, "what is waiting on me?" IS the work');
const context = read('src/workspaces/_shell/WorkspacesContext.tsx');
assert(context.includes("| 'answers' |"), 'and the view is routable');

//? All four locales, or the page renders raw key strings for three of them.
for (const lang of ['en', 'nl', 'de', 'fr']) {
  const locale = JSON.parse(read(`src/_locales/${lang}.json`)) as { workspaces: { answers?: Record<string, string> } };
  const answers = locale.workspaces.answers ?? {};
  for (const key of ['heading', 'sub', 'emptyTitle', 'emptySub', 'waitedMinutes', 'waitedHours', 'waitedDays', 'moreOpen']) {
    assert((answers[key] ?? '').length > 0, `${lang}: workspaces.answers.${key} is translated`);
  }
  //? The translator interpolates {{double}} braces; a single brace renders literally, which a browser pass
  //? caught on a different string this session.
  for (const key of ['waitedMinutes', 'waitedHours', 'waitedDays', 'moreOpen']) {
    assert((answers[key] ?? '').includes('{{n}}'), `${lang}: ${key} uses a {{double-brace}} placeholder`);
  }
}

await cleanupWorkspace(prisma, workspaceId);
report('answerInbox');
