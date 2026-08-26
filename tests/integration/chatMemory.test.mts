//? Integration test for the Assistant's MEMORY (ADR 0328, server/ai/chatCompaction.ts) against the REAL
//? Mongo, because every failure mode here is a database-shaped one: what the watermark reads back, which
//? rows a surface sees, and whether an over-budget conversation actually shrinks.
//?
//? The compaction path calls a live AI provider to write the summary, which is exactly the part a test
//? must NOT depend on. So the assertions are split along that seam: everything that must hold REGARDLESS
//? of whether the summariser answered (the tail, progress, the surface split, the watermark resume) is
//? asserted unconditionally, and the summary-was-written half is asserted only when a Handoff actually
//? landed. That is the honest shape — the degradation path is a real supported outcome, not a test excuse.
//?
//? Run: `npx tsx tests/integration/chatMemory.test.mts`.

//? MUST precede the import of promptBudget (CHAT_CONTEXT_TOKENS is resolved at module load). 8000 is the
//? floor the constant clamps to, so ~32k chars of conversation is enough to cross the ceiling — the same
//? code path the 272k default takes, at a size a test can actually write.
process.env.WS_CHAT_CONTEXT_TOKENS = '8000';

import { db, cleanupWorkspace, createRealUser, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { loadChatContext } = await import('../../server/ai/chatCompaction');
const { interpretChat, mergePendingTurns } = await import('../../server/ai/workspaceChat');
const { bootstrapWorkspace } = await import('../../server/orchestrator/conductor');

const stamp = Date.now();
const owner = await createRealUser(prisma, `chatmem-${String(stamp)}`);
let workspaceId: string | null = null;

//? Chat rows are ordered by `createdAt`, so the fixtures need distinct, ASCENDING timestamps. Real turns are
//? seconds apart; one second per turn keeps the ordering unambiguous without depending on write speed.
const at = (index: number): Date => new Date(stamp - 3_600_000 + index * 1000);

async function seedTurns(wsId: string, userId: string, count: number, chars: number, roles: [string, string], prefix: string): Promise<void> {
  await prisma.workspaceChatMessage.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      workspaceId: wsId, userId,
      role: i % 2 === 0 ? roles[0] : roles[1],
      text: `${prefix}-${String(i)} ${'x'.repeat(Math.max(0, chars))}`,
      createdAt: at(i),
    })),
  });
}

try {
  const boot = await bootstrapWorkspace({ name: `Chat Memory Test ${String(stamp)}`, ownerId: owner.id });
  workspaceId = boot.workspaceId;

  // ---- 1. under the ceiling: everything verbatim, nothing compacted --------------
  await seedTurns(workspaceId, owner.id, 6, 10, ['user', 'ai'], 'small');
  const small = await loadChatContext(prisma, workspaceId, owner.id, 'assistant');
  eq(small.turns.length, 6, 'a conversation under the ceiling is returned in full');
  eq(small.summary, '', 'nothing is summarised while the conversation fits');
  eq(small.turns[0]?.text.startsWith('small-0'), true, 'turns come back oldest-first (a summary of them would otherwise be backwards)');
  eq(small.turns.map((t) => t.role), ['user', 'ai', 'user', 'ai', 'user', 'ai'], 'the stored role alternation survives the mapping to user/ai');
  eq(await prisma.handoff.count({ where: { workspaceId, sessionKey: `assistant:${owner.id}` } }), 0, 'an under-budget load writes NO Handoff (compaction is not a per-turn cost)');

  // ---- 2. the surface split: the interviewer is a separate conversation ----------
  await seedTurns(workspaceId, owner.id, 4, 10, ['interviewer-user', 'interviewer-ai'], 'iv');
  const assistantAfter = await loadChatContext(prisma, workspaceId, owner.id, 'assistant');
  const interviewer = await loadChatContext(prisma, workspaceId, owner.id, 'interviewer');
  eq(assistantAfter.turns.length, 6, 'interviewer turns never leak into the Assistant surface');
  eq(interviewer.turns.length, 4, 'the interviewer surface reads only its own rows');
  assert(interviewer.turns.every((t) => t.text.startsWith('iv-')), 'every interviewer turn is an interviewer row');
  eq(interviewer.turns.map((t) => t.role), ['user', 'ai', 'user', 'ai'], "interviewer-user/-ai map onto the same user/ai roles the prompt speaks");

  // ---- 3. another user in the same workspace is another conversation -------------
  const other = await createRealUser(prisma, `chatmem-other-${String(stamp)}`);
  const otherCtx = await loadChatContext(prisma, workspaceId, other.id, 'assistant');
  eq(otherCtx.turns.length, 0, "one member's chat history is invisible to another member");

  // ---- 4. resume from a watermark (fully deterministic — no AI involved) ---------
  //? The single highest-risk invariant in the feature: the Handoff's createdAt is a WATERMARK, and the next
  //? load must read STRICTLY AFTER it. An off-by-one here either re-sends a turn the summary already covers
  //? or silently swallows the turn that sits exactly on the boundary.
  const boundary = await prisma.workspaceChatMessage.findFirst({
    where: { workspaceId, userId: owner.id, role: { in: ['user', 'ai'] } },
    orderBy: { createdAt: 'asc' }, skip: 3, select: { createdAt: true, text: true },
  });
  assert(boundary !== null, 'fixture sanity: a 4th assistant-surface turn exists to sit on the boundary');
  await prisma.handoff.create({
    data: {
      workspaceId, sessionKey: `assistant:${owner.id}`, reason: 'budget',
      body: { summary: 'PRIOR SUMMARY: the user asked about DEV-42.', decisions: [], state: '', next: [], gotchas: [] },
      createdAt: boundary?.createdAt ?? new Date(),
    },
  });
  const resumed = await loadChatContext(prisma, workspaceId, owner.id, 'assistant');
  eq(resumed.summary, 'PRIOR SUMMARY: the user asked about DEV-42.', 'a stored Handoff summary is carried into the next turn');
  eq(resumed.turns.length, 2, 'only the turns AFTER the watermark are re-sent verbatim');
  assert(!resumed.turns.some((t) => t.text === boundary?.text), 'the turn ON the watermark is covered by the summary, not sent twice');
  eq(resumed.turns[0]?.text.startsWith('small-4'), true, 'the tail resumes at the very next turn — nothing is swallowed at the boundary');

  //? A second, NEWER Handoff must win: compaction appends rather than updating, so reading the oldest would
  //? replay a conversation the newer summary already absorbed.
  const newest = await prisma.workspaceChatMessage.findFirst({ where: { workspaceId, userId: owner.id, role: { in: ['user', 'ai'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  await prisma.handoff.create({
    data: {
      workspaceId, sessionKey: `assistant:${owner.id}`, reason: 'budget',
      body: { summary: 'NEWER SUMMARY: everything so far.', decisions: [], state: '', next: [], gotchas: [] },
      createdAt: newest?.createdAt ?? new Date(),
    },
  });
  const resumedNewest = await loadChatContext(prisma, workspaceId, owner.id, 'assistant');
  eq(resumedNewest.summary, 'NEWER SUMMARY: everything so far.', 'the NEWEST Handoff is the live summary, not the first one written');
  eq(resumedNewest.turns.length, 0, 'a watermark on the last turn leaves an empty verbatim tail (the summary carries it all)');

  //? A Handoff whose body has no usable summary must not blank the conversation: it degrades to "no summary",
  //? and the turns after it are still the tail. (A corrupted body is the realistic version of this.)
  const junkUser = await createRealUser(prisma, `chatmem-junk-${String(stamp)}`);
  await seedTurns(workspaceId, junkUser.id, 4, 10, ['user', 'ai'], 'junk');
  const junkBoundary = await prisma.workspaceChatMessage.findFirst({ where: { workspaceId, userId: junkUser.id }, orderBy: { createdAt: 'asc' }, skip: 1, select: { createdAt: true } });
  await prisma.handoff.create({
    data: { workspaceId, sessionKey: `assistant:${junkUser.id}`, reason: 'budget', body: { state: 'no summary key here' }, createdAt: junkBoundary?.createdAt ?? new Date() },
  });
  const junk = await loadChatContext(prisma, workspaceId, junkUser.id, 'assistant');
  eq(junk.summary, '', 'a Handoff body without a summary string degrades to no summary instead of throwing');
  eq(junk.turns.length, 2, 'the watermark still applies even when the body carried no usable summary');

  // ---- 5. over the ceiling: the conversation actually shrinks --------------------
  //? 24 turns x ~1800 chars ≈ 43k chars ≈ 10.8k tokens, over the 8000-token ceiling set at the top.
  const bigUser = await createRealUser(prisma, `chatmem-big-${String(stamp)}`);
  await seedTurns(workspaceId, bigUser.id, 24, 1800, ['user', 'ai'], 'big');
  const before = await prisma.workspaceChatMessage.count({ where: { workspaceId, userId: bigUser.id } });
  eq(before, 24, 'fixture sanity: 24 over-budget turns are stored');

  const big = await loadChatContext(prisma, workspaceId, bigUser.id, 'assistant');
  //? COMPACT_FRACTION 0.7 → floor(24 * 0.7) = 16 folded away, 8 left verbatim.
  eq(big.turns.length, 8, 'an over-budget conversation is cut down to its recent tail');
  assert(big.turns.length < before, 'compaction always makes progress — the tail is strictly smaller than the input');
  eq(big.turns[0]?.text.startsWith('big-16'), true, 'the tail is the NEWEST turns (a follow-up refers to those, not to the opening)');
  eq(big.turns.at(-1)?.text.startsWith('big-23'), true, 'the very last turn is always in the verbatim tail');

  const written = await prisma.handoff.findFirst({ where: { workspaceId, sessionKey: `assistant:${bigUser.id}` }, orderBy: { createdAt: 'desc' }, select: { body: true, createdAt: true } });
  const cutRow = await prisma.workspaceChatMessage.findFirst({ where: { workspaceId, userId: bigUser.id }, orderBy: { createdAt: 'asc' }, skip: 15, select: { createdAt: true } });
  if (written === null) {
    //? The supported degradation: no summariser → no Handoff, and the turn continues on the tail alone.
    eq(big.summary, '', 'when the summariser is unavailable the turn continues WITHOUT a summary rather than failing');
    console.log('  · note: the summariser did not answer — the degradation path was exercised instead of the write path.');
  } else {
    eq(written.createdAt.getTime(), cutRow?.createdAt.getTime(), 'the Handoff createdAt is stamped to the LAST SUMMARISED turn (the watermark), not to now');
    assert(big.summary.length > 0, 'a written summary is handed to the current turn immediately, not only to the next one');
    const body = written.body as Record<string, unknown> | null;
    eq(typeof body?.summary, 'string', 'the compaction Handoff stores its summary under the `summary` key the reader looks for');

    //? The point of the whole mechanism: the SECOND load must be cheap. It reads the summary plus only the
    //? turns after the watermark, instead of the 24 rows that blew the budget.
    const second = await loadChatContext(prisma, workspaceId, bigUser.id, 'assistant');
    eq(second.turns.length, 8, 'the next load reads the tail only — compaction is not repeated per turn');
    assert(second.summary.length > 0, 'the next load picks the summary back up from the Handoff');
    eq(await prisma.handoff.count({ where: { workspaceId, sessionKey: `assistant:${bigUser.id}` } }), 1, 'a settled conversation does not write a second Handoff on every load');
  }

  // ---- 6. mergePendingTurns: the drain race ------------------------------------
  //? The Conductor writes the turn record AFTER the reply, so a fast follow-up arrives while the previous
  //? pair is still in flight. What the client saw fills that gap — without duplicating what IS stored.
  const stored = [{ role: 'user', text: 'first' }, { role: 'ai', text: 'answer' }];
  eq(mergePendingTurns(stored, []).length, 2, 'no client turns leaves the stored history untouched');
  eq(mergePendingTurns(stored, [{ role: 'user', text: 'first' }, { role: 'ai', text: 'answer' }]).length, 2, 'client turns already in the store are not duplicated');
  eq(mergePendingTurns(stored, [{ role: 'user', text: 'not drained yet' }]).length, 3, 'a turn the store has not drained yet is appended');
  eq(mergePendingTurns(stored, [{ role: 'user', text: 'not drained yet' }]).at(-1)?.text, 'not drained yet', 'the pending turn is appended at the END (it is the most recent)');
  eq(mergePendingTurns(stored, [{ role: 'user', text: '' }]).length, 2, 'an empty client turn is never appended');
  eq(mergePendingTurns([], [{ role: 'user', text: 'only the client has this' }]).length, 1, 'with no stored history the client turns carry the conversation');

  // ---- 7. the point of the whole feature, against a REAL model -------------------
  //? Everything above proves the plumbing. This proves the BEHAVIOUR the owner actually asked for: the
  //? assistant answers from what it was told in an earlier turn, WITHOUT the client resending it. The
  //? history argument is deliberately empty — if the reply still knows the passphrase, it can only have come
  //? from the stored rows, which is precisely what "not fire and forget" means.
  const recallUser = await createRealUser(prisma, `chatmem-recall-${String(stamp)}`);
  const project = await prisma.project.create({ data: { workspaceId, name: `Chat Memory Project ${String(stamp)}`, gitlabPath: `chatmem/${String(stamp)}` } });
  const passphrase = `ORANGE-${String(stamp).slice(-6)}`;
  await prisma.workspaceChatMessage.createMany({
    data: [
      { workspaceId, userId: recallUser.id, role: 'user', text: `Remember this for later: my deploy passphrase is ${passphrase}.`, createdAt: at(0) },
      { workspaceId, userId: recallUser.id, role: 'ai', text: `Noted — your deploy passphrase is ${passphrase}.`, createdAt: at(1) },
    ],
  });
  const recall = await interpretChat(
    prisma, workspaceId,
    'What is my deploy passphrase? Answer with just the passphrase and nothing else.',
    project.id,
    [], //? EMPTY on purpose — the old code path had nothing else to go on and would have failed here.
    recallUser.id, 'assistant',
  );
  if (recall.error !== undefined && recall.error !== null) {
    console.log(`  · note: no AI backend answered (${recall.error}) — the live recall assertion was skipped.`);
  } else {
    assert(
      recall.reply.includes(passphrase),
      `the assistant recalls a fact from a STORED earlier turn with no client history (reply: ${recall.reply.slice(0, 120)})`,
    );
  }
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  //? createRealUser prefixes every fixture email with `lstest_<tag>_…`, so this removes the throwaway users
  //? this run created (owner included, if cleanupWorkspace did not get to it) and nothing else.
  await prisma.user.deleteMany({ where: { email: { startsWith: `lstest_chatmem-` } } }).catch(() => undefined);
}

report('tests/integration/chatMemory.test.mts');
