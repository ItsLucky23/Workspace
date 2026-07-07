//? Unit test for FREEDOM_PROGRAM A3 — per-type push opt-out. Verifies pushCategoryAllowed's default-ON /
//? opt-out semantics: a push is allowed unless the user explicitly turned that category off. Pure.

import { assert, report } from '../_helpers.mts';

const { pushCategoryAllowed } = await import('../../server/hooks/webPush.ts');

{
  assert(pushCategoryAllowed({}, 'assignment') === true, 'no preference set → allowed (opt-out default)');
  assert(pushCategoryAllowed({ pushOnAssignment: true }, 'assignment') === true, 'explicit true → allowed');
  assert(pushCategoryAllowed({ pushOnAssignment: false }, 'assignment') === false, 'explicit false → suppressed');
  assert(pushCategoryAllowed({ pushOnAutomation: false }, 'assignment') === true, 'a different category off does not affect this one');
  assert(pushCategoryAllowed({ pushOnAutomation: false }, 'automation') === false, 'automation off → suppressed');
  assert(pushCategoryAllowed({ pushOnAiSuggestion: false }, 'aiSuggestion') === false, 'ai-suggestion off → suppressed');
  assert(pushCategoryAllowed({ pushOnAssignment: false }, undefined) === true, 'no category → always allowed');
  assert(pushCategoryAllowed(null, 'assignment') === true, 'null prefs → allowed');
  assert(pushCategoryAllowed('nonsense', 'assignment') === true, 'non-object prefs → allowed');
}

report('tests/unit/pushCategory.test.mts');
