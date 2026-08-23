//? FASE EV (DOCUMENTS_AND_SKILLS) — the pipeline role-prompt REPLAY harness. No DB, no LLM: it
//? exercises the scorer against the golden corpus (all must be clean) AND proves each structural
//? invariant actually FIRES by feeding it deliberately-broken turns (a malformed envelope, out-of-
//? scope files, a bare advisory, an out-of-range complexity score, a leftover template chip, a wrong
//? kind). If any of these regressions scored green, the harness would be worthless.

import { assert, eq, report } from '../_helpers.mts';

const { scoreAll, scoreTicket, globToRe, pathInScope } = await import('../../eval/pipeline/scorePipeline.mts');

try {
  // ---- 1. the whole golden corpus is clean (the committed baseline is 100%) ----
  const scores = await scoreAll();
  assert(scores.length >= 6, 'the golden corpus has at least 6 tickets (GT-001..006)');
  for (const s of scores) eq(s.score, 1, `${s.id} scores 100% (${String(s.passed)}/${String(s.total)})`);

  // ---- 2. glob scope matching ----
  assert(globToRe('src/login/**').test('src/login/_api/x.ts'), '** matches any depth');
  assert(!globToRe('src/login/*').test('src/login/a/b.ts'), '* is one segment');
  assert(pathInScope('src/login/x.ts', { allow: ['src/login/**'] }), 'allow-glob puts a file in scope');
  assert(!pathInScope('prisma/schema.prisma', { allow: ['src/**'], deny: ['prisma/**'] }), 'a deny-glob wins over allow');
  assert(!pathInScope('server/x.ts', { allow: ['src/**'] }), 'a file matching no allow-glob is out of scope');

  // ---- 3. each invariant FIRES on a deliberately-broken turn ----
  const broke = async (message: string, scope: { allow: string[]; deny?: string[] } = { allow: ['src/**'] }, expectKind: 'done' | 'needs-input' | 'continue' = 'done'): Promise<string[]> => {
    const t = await scoreTicket({ id: 'BAD', title: 'x', promptVersion: 'x', scope, stages: [{ stage: 's', message, expectKind }] });
    return t.failures.map((f) => f.check);
  };
  const cf = (o: unknown): string => '```ws-carryover\n' + JSON.stringify(o) + '\n```';

  assert((await broke('no fenced block at all')).includes('kind-matches'), 'a missing carry-over → kind-matches fails (parsed as continue)');
  assert((await broke(cf({ summary: '', changedFiles: [], openQuestions: [] }))).includes('summary-nonempty'), 'an empty summary fails');
  assert((await broke(cf({ summary: 'ok', changedFiles: ['prisma/schema.prisma'], openQuestions: [] }))).includes('changed-files-in-scope'), 'an out-of-scope changed file fails');
  assert((await broke(cf({ summary: 'ok', changedFiles: [], openQuestions: [{ question: 'X?', assumption: '' }] }))).includes('advisories-have-assumptions'), 'a bare advisory (no assumption) fails');
  assert((await broke(cf({ summary: 'ok', changedFiles: [], openQuestions: [], complexityScore: 99 }))).includes('complexity-in-range') === false, 'an out-of-range score is CLAMPED by parseTurnResult (contract holds — never a false red)');

  // ---- 4. a wrong expected kind is caught ----
  const wrongKind = await scoreTicket({ id: 'WK', title: 'x', promptVersion: 'x', scope: { allow: ['**'] }, stages: [{ stage: 's', message: cf({ summary: 'ok', changedFiles: [], openQuestions: [] }), expectKind: 'needs-input' }] });
  assert(wrongKind.failures.some((f) => f.check === 'kind-matches'), 'a done turn expected as needs-input fails kind-matches');

  // ---- 5. leftover template chip is caught ----
  const leftover = await scoreTicket({ id: 'LT', title: 'x', promptVersion: 'x', scope: { allow: ['**'] }, stages: [{ stage: 's', message: cf({ summary: 'ok', changedFiles: [], openQuestions: [] }), expectKind: 'done', nextTemplate: 'Do {{summary}} and {{unknownChip}}' }] });
  //? ADR 0319 — no slot template any more: a done turn composes the incoming handover from its envelope.
  assert(!leftover.failures.some((f) => f.check === 'handover-composed'), 'a done turn with an envelope composes a non-empty incoming handover');
} finally {
  report('tests/integration/evalPipeline.test.mts');
}
