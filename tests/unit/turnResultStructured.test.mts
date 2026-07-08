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

report('tests/unit/turnResultStructured.test.mts');
