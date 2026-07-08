//? P-B — parseTurnResult now carries structured questions. A `ws-needs-input` block whose entries are
//? objects ({prompt,kind,options}) is encoded into the needsInput wire form (plain for free, `@@wsq:` for
//? approve/choice) that the P-B card decodes; bare-string entries stay plain (back-compat). Pure, no DB.

import { parseTurnResult } from '../../server/orchestrator/turnResult.ts';
import { parseStructuredQuestion } from '../../src/workspaces/_functions/structuredQuestion.ts';
import { assert, eq, report } from '../_helpers.mts';

//? Legacy: a plain-string question is unchanged (the pre-P-B contract the stage-engine test asserts).
const free = await parseTurnResult('```ws-needs-input\n{"questions":["Which DB?"]}\n```');
assert(free.kind === 'needs-input', 'free block → needs-input');
if (free.kind === 'needs-input') eq(free.questions[0], 'Which DB?', 'plain question stays plain');

//? Approve: an object entry becomes the envelope, decoding back to an approve question.
const appr = await parseTurnResult('```ws-needs-input\n{"questions":[{"kind":"approve","prompt":"Deploy to prod?"}]}\n```');
if (appr.kind === 'needs-input') {
  assert(appr.questions[0].startsWith('@@wsq:'), 'approve question encoded as envelope');
  eq(parseStructuredQuestion(appr.questions[0]), { kind: 'approve', prompt: 'Deploy to prod?', options: [] }, 'approve decodes back');
}

//? Choice: options survive the round-trip.
const choice = await parseTurnResult('```ws-needs-input\n{"questions":[{"kind":"choice","prompt":"Which auth?","options":["OAuth","Magic link","Password"]}]}\n```');
if (choice.kind === 'needs-input') {
  const q = parseStructuredQuestion(choice.questions[0]);
  eq(q.kind, 'choice', 'choice decodes to choice');
  eq(q.options, ['OAuth', 'Magic link', 'Password'], 'choice options preserved');
}

//? A bare-array block (no `questions` wrapper) still works.
const bare = await parseTurnResult('```ws-needs-input\n["Just tell me"]\n```');
if (bare.kind === 'needs-input') eq(bare.questions[0], 'Just tell me', 'bare-array free question parsed');

//? carryover + continue are unaffected.
eq((await parseTurnResult('Still going.')).kind, 'continue', 'no marker → continue');

//? W2 — a done-envelope's openQuestions can mix plain strings (passed forward) with `{question, assumption}`
//? advisory objects (NON-blocking questions the agent proceeded past). They split correctly.
const done = await parseTurnResult('```ws-carryover\n{"summary":"done","changedFiles":["a.ts"],"openQuestions":["a plain note",{"question":"Which port?","assumption":"8080"}]}\n```');
assert(done.kind === 'done', 'carryover → done');
if (done.kind === 'done') {
  eq(done.envelope.advisories?.length, 1, 'one advisory extracted');
  eq(done.envelope.advisories?.[0].q, 'Which port?', 'advisory question captured');
  eq(done.envelope.advisories?.[0].assumption, '8080', 'advisory assumption captured');
  assert(done.envelope.openQuestions.includes('a plain note'), 'the plain note stays in openQuestions');
  assert(done.envelope.openQuestions.some((s) => s.includes('Which port?') && s.includes('8080')), 'the advisory renders into openQuestions as "Q (assumed: A)" for the next stage');
}

//? A done envelope with no advisories omits the field (back-compat).
const plainDone = await parseTurnResult('```ws-carryover\n{"summary":"x","openQuestions":["just a note"]}\n```');
if (plainDone.kind === 'done') eq(plainDone.envelope.advisories, undefined, 'no advisory objects → advisories omitted');

report('tests/unit/turnResultStructured.test.mts');
