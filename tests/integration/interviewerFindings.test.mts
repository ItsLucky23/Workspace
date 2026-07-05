//? Test the interviewer findings parser (ADR 0034) — the pure markdown→categorised-findings step.

import { assert, eq, report } from '../_helpers.mts';

const m = await import('../../server/interviewer/findings');

try {
  const md = [
    'Here are some ideas:',
    '- [security] **Rotate the JWT secret** — it is hardcoded and never rotates.',
    '- [ux] **Add empty states** — blank screens confuse first-time users.',
    '- **Cache the snapshot** — the query runs on every keystroke.',
    '',
  ].join('\n');
  const f = m.parseFindings(md);
  eq(f.length, 3, 'preamble skipped; 3 list items parsed');
  eq(f[0]?.area, 'security', 'area tag parsed');
  eq(f[0]?.severity, 'high', 'security → high severity');
  assert((f[0]?.title ?? '').includes('Rotate') && (f[0]?.summary ?? '').includes('hardcoded'), 'title/summary split on the dash');
  eq(f[1]?.area, 'ux', 'second area parsed');
  eq(f[2]?.area, 'other', 'no [area] tag → other');
  assert(!(f[0]?.title ?? '').includes('*'), 'bold markers stripped from title');

  eq(m.parseFindings('just prose, no list at all').length, 0, 'no list items → no findings');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/interviewerFindings.test.mts');
