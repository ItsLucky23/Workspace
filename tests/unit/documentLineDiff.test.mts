//? DESIGN_DOCS_PROGRAM Phase 2.5 — the pure line diff behind the document draft-review-before-approve panel.

import { lineDiff, diffStat } from '../../src/workspaces/content/documents/lineDiff.ts';
import { assert, report } from '../_helpers.mts';

//? Identical text → all context, no changes.
const same = lineDiff('a\nb\nc', 'a\nb\nc');
assert(same.every((l) => l.kind === 'ctx'), 'identical text yields only context lines');
assert(diffStat(same).added === 0 && diffStat(same).removed === 0, 'identical text has no add/del');

//? A changed middle line → one del + one add, first/last kept as context.
const changed = lineDiff('a\nb\nc', 'a\nB\nc');
const s = diffStat(changed);
assert(s.added === 1 && s.removed === 1, 'a single line change = +1 −1');
assert(changed[0]?.kind === 'ctx' && changed[0].text === 'a', 'unchanged first line is context');
assert(changed.some((l) => l.kind === 'del' && l.text === 'b'), 'old line marked removed');
assert(changed.some((l) => l.kind === 'add' && l.text === 'B'), 'new line marked added');

//? Pure insertion at the end.
const added = lineDiff('a\nb', 'a\nb\nc\nd');
assert(diffStat(added).added === 2 && diffStat(added).removed === 0, 'appended lines are all adds');

//? Line numbers: adds carry newNo, dels carry oldNo.
const del = lineDiff('a\nb\nc', 'a\nc');
assert(del.some((l) => l.kind === 'del' && l.oldNo === 2 && l.text === 'b'), 'removed line keeps its old line number');

//? From-empty (generate mode) → everything is an add.
const fromEmpty = lineDiff('', '# Title\n\nBody');
assert(diffStat(fromEmpty).removed === 0 && diffStat(fromEmpty).added >= 1, 'generating from empty is all additions');

report('documentLineDiff');
