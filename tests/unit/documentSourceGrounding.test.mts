//? DESIGN_DOCS_PROGRAM Phase 1.2/1.3 — the uploaded-source grounding logic for document generation.
//? Pure: parseAssetEntries validates the Prisma Json assets shape, and sourceMaterialBlock inlines the FULL
//? extracted text of attached source files (not a RAG gist), only for kind='file' + extractStatus='ok',
//? bounded by the per-asset/total caps. No DB, no providers.

import { parseAssetEntries, sourceMaterialBlock } from '../../server/documents/docs.ts';
import { isParseableUpload } from '../../server/documents/parseUpload.ts';
import { assert, report } from '../_helpers.mts';

/* -------------------------------------------------------------- parseAssetEntries */

const parsed = parseAssetEntries([
  { kind: 'file', url: '/media/a.pdf', label: 'Brief', extractStatus: 'ok', extractedText: 'hello' },
  { kind: 'image', url: '/media/b.png', label: 'shot', stub: true },
  null,
  'garbage',
  { kind: 'file' },                 // missing url → dropped
  { url: '/media/c.txt' },          // missing kind → dropped
  ['not', 'an', 'object'],          // array → dropped
]);
assert(parsed.length === 2, 'only the 2 well-formed entries survive');
assert(parsed[0]?.extractedText === 'hello' && parsed[0]?.extractStatus === 'ok', 'extract fields preserved');
assert(parsed[1]?.stub === true, 'stub flag preserved');
assert(parseAssetEntries('nope').length === 0, 'a non-array is dropped to []');
assert(parseAssetEntries(null).length === 0, 'null is dropped to []');

/* -------------------------------------------------------------- sourceMaterialBlock */

const block = sourceMaterialBlock([
  { kind: 'file', url: '/media/brief.pdf', label: 'Assignment brief', extractStatus: 'ok', extractedText: 'Build an offline-first note app.' },
  { kind: 'file', url: '/media/rubric.docx', label: 'Rubric', extractStatus: 'ok', extractedText: 'Grading: architecture 40%, UX 30%.' },
  { kind: 'file', url: '/media/pending.pdf', label: 'Pending', extractStatus: 'pending' },
  { kind: 'file', url: '/media/failed.pdf', label: 'Failed', extractStatus: 'failed', extractedText: '' },
  { kind: 'image', url: '/media/pic.png', label: 'pic', extractStatus: 'ok', extractedText: 'should-not-appear' },
]);
assert(block.includes('Build an offline-first note app.'), 'ok file text is inlined');
assert(block.includes('Grading: architecture 40%'), 'second ok file text is inlined');
assert(block.includes('Assignment brief') && block.includes('Rubric'), 'source labels are shown');
assert(!block.includes('should-not-appear'), 'non-file (image) assets are excluded');
assert(!block.includes('Pending'), 'pending (not-yet-extracted) assets are excluded');
assert(sourceMaterialBlock([]) === '', 'no assets → empty block');

//? Cap: a single huge source is truncated (per-asset cap 12k), never dumped whole into the prompt.
const huge = 'x'.repeat(50_000);
const capped = sourceMaterialBlock([{ kind: 'file', url: '/media/big.pdf', label: 'Big', extractStatus: 'ok', extractedText: huge }]);
assert(capped.length < 20_000, 'a 50k-char source is capped well under its raw size');

/* -------------------------------------------------------------- isParseableUpload */

assert(isParseableUpload('pdf') && isParseableUpload('docx') && isParseableUpload('txt') && isParseableUpload('md'), 'pdf/docx/txt/md are parseable');
assert(!isParseableUpload('png') && !isParseableUpload('mp4'), 'images/video are not parseable sources');
assert(isParseableUpload('PDF'), 'extension check is case-insensitive');

report('documentSourceGrounding');
