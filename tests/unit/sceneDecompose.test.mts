//? Unit test for V3 (IDEA_TO_OUTCOME) — the continuity-prompt builder. Pure. Verifies consecutive scenes are
//? told to flow from the previous beat, the first scene has no continuity hint, and empty beats degrade.

import { assert, eq, report } from '../_helpers.mts';
import { buildContinuityPrompts } from '../../server/content/sceneDecompose';

try {
  const beats = [
    { order: 0, text: 'intro', visualPrompt: 'a sunrise over a city' },
    { order: 1, text: 'middle', visualPrompt: 'a busy street' },
    { order: 2, text: 'outro', visualPrompt: null },   // falls back to text
  ];
  const specs = buildContinuityPrompts(beats);
  eq(specs.length, 3, 'one spec per beat');
  eq(specs[0]?.prompt, 'a sunrise over a city', 'the first scene has NO continuity hint');
  assert((specs[1]?.prompt ?? '').startsWith('a busy street'), 'scene 2 keeps its own visual');
  assert((specs[1]?.prompt ?? '').includes('Continues seamlessly from the previous scene: a sunrise over a city'), 'scene 2 flows from scene 1');
  assert((specs[2]?.prompt ?? '').startsWith('outro'), 'scene 3 falls back to the beat text when no visualPrompt');
  assert((specs[2]?.prompt ?? '').includes('a busy street'), 'scene 3 flows from scene 2');
  eq(specs[1]?.order, 1, 'the order is carried');

  eq(buildContinuityPrompts([]).length, 0, 'no beats → no specs');
  //? A single beat is just itself (no continuity).
  const one = buildContinuityPrompts([{ order: 0, text: 't', visualPrompt: 'solo' }]);
  eq(one[0]?.prompt, 'solo', 'a single scene has no continuity hint');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/sceneDecompose.test.mts');
