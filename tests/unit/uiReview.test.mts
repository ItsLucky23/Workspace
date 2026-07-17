//? U1 — the UI-review taxonomy + input sanitizers (pure). Verifies: the checkbox taxonomy is fixed; only valid
//? problem keys survive (deduped, off-list dropped so a client can't inject tags); and only `/media/…` uploaded
//? screenshot urls are kept (no arbitrary external url), capped at 20.

import { readFileSync } from 'node:fs';

import { assert, eq, report } from '../_helpers.mts';
import { UI_PROBLEMS, isUiProblem, sanitizeProblems, sanitizeScreenshots } from '../../server/ui/uiReview.ts';
import { UI_PROBLEMS as FORM_PROBLEMS, uiProblemI18nKey } from '../../src/workspaces/_data/uiReviewTaxonomy';

assert(UI_PROBLEMS.includes('cluttered') && UI_PROBLEMS.includes('not-responsive') && UI_PROBLEMS.includes('visual-hierarchy'), 'the taxonomy covers the user\'s named problems');
assert(isUiProblem('visual-hierarchy') && !isUiProblem('made-up'), 'isUiProblem gates the taxonomy');

//? THE round-trip regression (gap-scan critical): the form's checkbox list and the server validator must be the
//? SAME list — a diverging pair previously reduced every ticked problem to []. Guard both the identity and the
//? behaviour (every renderable key survives sanitize), plus a localized label for every key in all 4 locales.
{
  eq([...FORM_PROBLEMS], [...UI_PROBLEMS], 'form taxonomy === server taxonomy (single source)');
  eq(sanitizeProblems([...FORM_PROBLEMS]).length, FORM_PROBLEMS.length, 'EVERY form checkbox key survives the server sanitizer');
  for (const locale of ['en', 'nl', 'de', 'fr']) {
    const dict = JSON.parse(readFileSync(`src/_locales/${locale}.json`, 'utf8')) as { workspaces?: { uiReview?: Record<string, string> } };
    for (const p of FORM_PROBLEMS) {
      assert(typeof dict.workspaces?.uiReview?.[uiProblemI18nKey(p)] === 'string', `${locale}: label exists for ${p}`);
    }
  }
}

// problems: valid kept + deduped, invalid dropped
{
  const clean = sanitizeProblems(['cluttered', 'cluttered', 'made-up', 'not-responsive', 42, null]);
  eq(clean.length, 2, 'dupes + off-list + non-strings dropped');
  assert(clean.includes('cluttered') && clean.includes('not-responsive'), 'the valid problems survive');
  eq(sanitizeProblems('nope').length, 0, 'a non-array → empty');
}

// screenshots: only /media/ urls kept, capped
{
  const ok = sanitizeScreenshots(['/media/a.png', 'https://evil.com/x.png', '/media/b.png', 12]);
  eq(ok.length, 2, 'only /media/ uploaded urls are kept (no external / non-string)');
  assert(ok.every((u) => u.startsWith('/media/')), 'every kept url is a media upload');
  eq(sanitizeScreenshots(Array.from({ length: 40 }, (_, i) => `/media/${String(i)}.png`)).length, 20, 'capped at 20 screenshots');
}

report('tests/unit/uiReview.test.mts');
