//? W1 — the multi-question pure core. Verifies: the stored set parses (with a legacy single-banner fallback);
//? a single answer fills the first unanswered question (stepper) and a batch fills in order; the banner advances
//? to the next unanswered; and the combined resume prompt is single-answer for one question (back-compat) but a
//? numbered, envelope-decoded Q→A list for many. Pure, no DB.

import { assert, eq, report } from '../_helpers.mts';
import { parseNeedsInputQuestions, applyAnswers, firstUnanswered, buildCombinedAnswerPrompt } from '../../server/orchestrator/questionSet';

try {
  // parse — JSON set, legacy banner fallback, empty
  const parsed = parseNeedsInputQuestions([{ q: 'Q1', a: null }, { q: 'Q2', a: 'done' }], null);
  eq(parsed.length, 2, 'parses a 2-question set');
  eq(parsed[1].a, 'done', 'keeps a stored answer');
  eq(parseNeedsInputQuestions(null, 'only banner').length, 1, 'legacy: a single banner → a one-question set');
  eq(parseNeedsInputQuestions(null, 'only banner')[0].q, 'only banner', 'the banner becomes the sole question');
  eq(parseNeedsInputQuestions(null, null).length, 0, 'no set + no banner → empty');
  eq(parseNeedsInputQuestions([{ q: '  ', a: null }], null).length, 0, 'blank questions are dropped');

  // single answer → fills the first unanswered (stepper)
  const set0 = [{ q: 'Q1', a: null }, { q: 'Q2', a: null }, { q: 'Q3', a: null }];
  const step1 = applyAnswers(set0, { single: 'A1' });
  eq(step1.appliedCount, 1, 'a single answer fills exactly one');
  eq(step1.set[0].a, 'A1', 'Q1 answered');
  eq(step1.set[1].a, null, 'Q2 still open');
  eq(firstUnanswered(step1.set), 'Q2', 'banner advances to Q2');
  assert(set0[0].a === null, 'applyAnswers does not mutate the input');

  const step2 = applyAnswers(step1.set, { single: 'A2' });
  eq(firstUnanswered(step2.set), 'Q3', 'banner advances to Q3');
  const step3 = applyAnswers(step2.set, { single: 'A3' });
  eq(firstUnanswered(step3.set), null, 'all answered → no next banner');

  // blank single answer → no-op
  eq(applyAnswers(set0, { single: '   ' }).appliedCount, 0, 'a blank answer applies nothing');

  // batch fills open questions in order
  const batch = applyAnswers(set0, { batch: ['B1', 'B2', 'B3'] });
  eq(batch.appliedCount, 3, 'a batch fills all three');
  eq(batch.set.map((x) => x.a).join(','), 'B1,B2,B3', 'batch maps in order');
  const partial = applyAnswers([{ q: 'Q1', a: 'kept' }, { q: 'Q2', a: null }, { q: 'Q3', a: null }], { batch: ['NEW'] });
  eq(partial.set[0].a, 'kept', 'an already-answered question is not overwritten by a batch');
  eq(partial.set[1].a, 'NEW', 'the batch fills the first OPEN question');

  // combined resume prompt: 1 answer = just the answer (back-compat); many = numbered Q→A list
  eq(buildCombinedAnswerPrompt([{ q: 'Q1', a: 'just this' }]), 'just this', 'single question → the bare answer (byte-identical to pre-W1)');
  const combined = buildCombinedAnswerPrompt([{ q: 'Deploy now?', a: 'yes' }, { q: '@@wsq:{"kind":"choice","prompt":"Which env?","options":["dev","prod"]}', a: 'prod' }]);
  assert(combined.includes('1. Deploy now?') && combined.includes('→ yes'), 'combined prompt numbers Q1 + its answer');
  assert(combined.includes('2. Which env?') && combined.includes('→ prod'), 'the @@wsq envelope is decoded to its human prompt (Which env?)');
  assert(!combined.includes('@@wsq'), 'the raw envelope is NOT leaked into the resume prompt');

  eq(0, 0, 'question-set core verified');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/questionSet.test.mts');
