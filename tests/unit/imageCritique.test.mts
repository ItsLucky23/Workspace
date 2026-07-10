//? F5 — image-critique prompt builder. Pure. Verifies the system prompt asks for concrete prioritized feedback
//? mapped to the real edit ops, and folds in the user's specific question when given.

import { assert, report } from '../_helpers.mts';
import { buildCritiquePrompt } from '../../server/content/imageCritique.ts';

const base = buildCritiquePrompt();
assert(/inpaint/.test(base) && /adjust/.test(base) && /crop/.test(base) && /regenerate/.test(base), 'the prompt names every edit op the feedback maps to');
assert(/prioriti/i.test(base), 'the prompt asks for prioritized feedback');
assert(!base.includes('The user specifically asks'), 'no user-note line when none is given');

const withNote = buildCritiquePrompt('make the sky more dramatic');
assert(withNote.includes('make the sky more dramatic'), 'a user note is folded into the prompt');
assert(withNote.includes('The user specifically asks'), 'the user-note line appears when given');

report('tests/unit/imageCritique.test.mts');
