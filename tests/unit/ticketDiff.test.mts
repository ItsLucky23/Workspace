//? F-006/F-014 — the ticket Code tab now renders the built-in MR diff (the Review tab's data) instead of the
//? never-populated `Ticket.files`. Pins the MrDiffFile → TicketFile mapping and the SCM-pair derivation.

import { assert, eq, report } from '../_helpers.mts';
import { changesFromFiles, mrFilesToTicketFiles } from '../../src/workspaces/develop/board/[ticketId]/ticketDiff.ts';

const files = mrFilesToTicketFiles([
  { path: 'src/a.ts', oldPath: null, status: 'modified', additions: 1, deletions: 1, truncated: false, lines: [
    { kind: 'hunk', content: '@@ -1,2 +1,2 @@', oldNo: null, newNo: null },
    { kind: 'ctx', content: 'const a = 1;', oldNo: 1, newNo: 1 },
    { kind: 'del', content: 'const b = 2;', oldNo: 2, newNo: null },
    { kind: 'add', content: 'const b = 3;', oldNo: null, newNo: 2 },
  ] },
  { path: 'gone.ts', oldPath: null, status: 'deleted', additions: 0, deletions: 2, truncated: false, lines: [
    { kind: 'del', content: 'x', oldNo: 1, newNo: null }, { kind: 'del', content: 'y', oldNo: 2, newNo: null },
  ] },
]);

eq(files.length, 2, 'one TicketFile per MR file');
eq(files[0]?.add, 1, 'additions map to add');
eq(files[0]?.del, 1, 'deletions map to del');
eq(files[0]?.diff?.length, 4, 'every diff line is kept (hunk headers included)');
eq(files[0]?.diff?.[1]?.text, 'const a = 1;', 'content maps to text');
eq(files[0]?.diff?.[1]?.oldNo, 1, 'line numbers carry over');
assert(!('newNo' in (files[0]?.diff?.[2] ?? {})), 'a null line number is omitted, not set to null');

const changes = changesFromFiles(files);
eq(changes[0]?.status, 'modified', 'add+del → modified');
eq(changes[0]?.original, 'const a = 1;\nconst b = 2;', 'original = del+ctx lines');
eq(changes[0]?.modified, 'const a = 1;\nconst b = 3;', 'modified = add+ctx lines');
eq(changes[1]?.status, 'deleted', 'del-only → deleted');

report('tests/unit/ticketDiff.test.mts');
