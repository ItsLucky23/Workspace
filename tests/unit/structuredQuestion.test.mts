//? P-B — structured approvals wire format. Verifies normalize/encode/parse round-trip a free / approve /
//? choice question through the single `needsInput` string, with malformed input always degrading to free
//? (never throwing) so a bad agent envelope can't break the answer loop. No DB, no canvas — pure.

import { normalizeQuestion, encodeQuestion, parseStructuredQuestion, questionPrompt } from '../../src/workspaces/_functions/structuredQuestion.ts';
import { assert, eq, report } from '../_helpers.mts';

//? normalize — a bare string is a free question.
eq(normalizeQuestion('Which DB?'), { kind: 'free', prompt: 'Which DB?', options: [] }, 'string → free');
//? approve keeps no options.
eq(normalizeQuestion({ kind: 'approve', prompt: 'Ship it?' }), { kind: 'approve', prompt: 'Ship it?', options: [] }, 'approve normalised');
//? choice with ≥2 options is a choice.
eq(normalizeQuestion({ kind: 'choice', prompt: 'Pick', options: ['A', 'B', 'C'] }), { kind: 'choice', prompt: 'Pick', options: ['A', 'B', 'C'] }, 'choice normalised');
//? choice with <2 usable options degrades to free (unanswerable as a choice).
eq(normalizeQuestion({ kind: 'choice', prompt: 'Pick', options: ['A'] }).kind, 'free', 'choice <2 options → free');
//? unknown kind → free.
eq(normalizeQuestion({ kind: 'weird', prompt: 'Huh' }).kind, 'free', 'unknown kind → free');

//? encode — free stays plain (legacy readers unaffected), approve/choice become the envelope.
eq(encodeQuestion('Which DB?'), 'Which DB?', 'free encodes to plain prompt');
assert(encodeQuestion({ kind: 'approve', prompt: 'Ship it?' }).startsWith('@@wsq:'), 'approve encodes to envelope');
assert(encodeQuestion({ kind: 'choice', prompt: 'Pick', options: ['A', 'B'] }).startsWith('@@wsq:'), 'choice encodes to envelope');

//? parse — round-trips each kind back out.
eq(parseStructuredQuestion(encodeQuestion({ kind: 'approve', prompt: 'Ship it?' })), { kind: 'approve', prompt: 'Ship it?', options: [] }, 'approve round-trips');
eq(parseStructuredQuestion(encodeQuestion({ kind: 'choice', prompt: 'Pick', options: ['A', 'B'] })), { kind: 'choice', prompt: 'Pick', options: ['A', 'B'] }, 'choice round-trips');
eq(parseStructuredQuestion('Plain legacy question'), { kind: 'free', prompt: 'Plain legacy question', options: [] }, 'plain legacy → free');

//? malformed/partial input never throws — always a free question.
eq(parseStructuredQuestion('@@wsq:{not json').kind, 'free', 'malformed envelope → free (no throw)');
eq(parseStructuredQuestion(null).prompt, '', 'null → empty free');
eq(parseStructuredQuestion('@@wsq:{"kind":"approve","prompt":""}').kind, 'free', 'empty-prompt envelope → free');

//? questionPrompt returns the human text for display (never the raw envelope).
eq(questionPrompt(encodeQuestion({ kind: 'choice', prompt: 'Pick one', options: ['A', 'B'] })), 'Pick one', 'questionPrompt strips envelope');

report('tests/unit/structuredQuestion.test.mts');
