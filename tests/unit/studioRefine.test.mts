//? Unit test for FREEDOM_PROGRAM I4 — the studio refine/tweak on regenerate. Verifies applyRefine appends a
//? free-text direction to the built prompt (was a blind re-roll), and leaves it unchanged when empty. Pure.

import { assert, eq, report } from '../_helpers.mts';

const { applyRefine } = await import('../../server/studio/generate.ts');

{
  const base = 'Generate a landing page for Acme.';
  const refined = applyRefine(base, 'make it bolder and shorter');
  assert(refined.startsWith(base), 'the original prompt is preserved');
  assert(refined.includes('make it bolder and shorter'), 'the refine direction is appended');
  assert(refined.includes('Refine'), 'the refine block is labelled');
  eq(applyRefine(base), base, 'no tweak → the prompt is unchanged');
  eq(applyRefine(base, '   '), base, 'a blank tweak → unchanged');
}

report('tests/unit/studioRefine.test.mts');
