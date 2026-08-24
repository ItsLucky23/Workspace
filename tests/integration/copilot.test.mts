//? Test for the #109 AI-drives-UI copilot directive PRODUCER: validateCopilot accepts a known nav
//? target + note (+ string-only prefill) and rejects everything else. The directive travels inside the
//? chat response itself (the client's applyCopilot navigates + pre-fills); the legacy `copilot-propose`
//? control-op / 'copilot' suggestion type were removed 2026-08-24 — nothing ever dispatched them.

import { assert, eq, report } from '../_helpers.mts';

const { validateCopilot } = await import('../../server/ai/workspaceChat');

{
  const ok = validateCopilot({ navigate: 'content', note: 'Create your video here', prefill: { title: 'Launch', brief: 'about X', bad: 5 } });
  assert(ok !== null && ok.navigate === 'content' && ok.note.length > 0, 'a valid copilot directive validates');
  eq(ok?.prefill?.title, 'Launch', 'string prefill hints are carried');
  assert(ok?.prefill !== undefined && !('bad' in ok.prefill), 'non-string prefill values are dropped');
  eq(validateCopilot({ navigate: 'nope', note: 'x' }), null, 'an unknown nav target is rejected (no invented routes)');
  eq(validateCopilot({ navigate: 'content', note: '' }), null, 'an empty note is rejected');
  eq(validateCopilot(null), null, 'a null directive is rejected');
}

report('tests/integration/copilot.test.mts');
