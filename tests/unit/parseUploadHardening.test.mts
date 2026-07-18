//? A05 parser hardening — bounded direct-text reads and safe media URL/extension handling without Docker.

import { rmSync } from 'node:fs';

import {
  extractUploadText,
  isParseableUpload,
  mediaExtension,
} from '../../server/documents/parseUpload.ts';
import { persistMediaBytes } from '../../server/media/store.ts';
import { assert, eq, report } from '../_helpers.mts';

const stamp = `${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
const paths: string[] = [];

const longText = persistMediaBytes(Buffer.from(`  ${'x'.repeat(250_000)}  `), 'TXT', `parse-long-${stamp}`);
paths.push(longText.path);
const longResult = await extractUploadText(`${longText.url}?download=1#section`);
eq(longResult.status, 'ok', 'bounded UTF-8 text extraction succeeds');
assert(longResult.text.length <= 200_000 && longResult.text.length > 199_000, 'direct text is capped at MAX_TEXT without reading an unbounded result');

const invalidUtf8 = persistMediaBytes(Buffer.from([0xc3, 0x28]), 'txt', `parse-invalid-${stamp}`);
paths.push(invalidUtf8.path);
const invalidResult = await extractUploadText(invalidUtf8.url);
eq(invalidResult.status, 'failed', 'invalid UTF-8 fails closed instead of replacement-decoding binary bytes');

const empty = persistMediaBytes(Buffer.from('  \n\t  '), 'md', `parse-empty-${stamp}`);
paths.push(empty.path);
const emptyResult = await extractUploadText(empty.url);
eq(emptyResult.status, 'empty', 'whitespace-only markdown remains an empty extraction');

const unsupported = persistMediaBytes(Buffer.from('not parsed here'), 'png', `parse-unsupported-${stamp}`);
paths.push(unsupported.path);
const unsupportedResult = await extractUploadText(unsupported.url);
eq(unsupportedResult.status, 'unsupported', 'non-document media remains unsupported');

eq((await extractUploadText('/media/../secret.txt')).status, 'failed', 'media traversal still fails before file access');
eq(mediaExtension('/media/Brief.PDF?download=1#page=2'), 'pdf', 'query/hash-safe extension logic from the concurrent edit is preserved');
assert(isParseableUpload('/media/Brief.DOCX?x=1') && !isParseableUpload('/media/image.png'), 'parseable extension classification stays coherent');

for (const filePath of paths) rmSync(filePath, { force: true });
report('parseUploadHardening');
