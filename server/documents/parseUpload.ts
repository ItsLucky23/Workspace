/** @docs owner ItsLucky23 */
//? PARSE (DESIGN_DOCS_PROGRAM Phase 0.2 / 1.2) — text extraction for an uploaded file so its CONTENT can
//? reach a document-generation prompt (the J-Doc1 spine: "upload school PDFs → technical design doc").
//? pdf → poppler `pdftotext`; docx → pandoc `docx→markdown`; txt/md → read verbatim. The heavy formats run
//? in the shared throwaway `--network none` container harness (Phase 0.1). Best-effort: any failure returns
//? a typed status, never throws, so an upload is still attached even if extraction fails.

import { copyFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { runToolContainerText } from '../container/toolHarness';
import { safeMediaPath } from '../media/download';

const POPPLER_IMAGE = (process.env.WS_POPPLER_IMAGE ?? '').trim() || 'minidocks/poppler:latest';
const PANDOC_IMAGE = (process.env.WS_EXPORT_PANDOC_IMAGE ?? '').trim() || 'pandoc/core:3.2';

//? Bound stored/embedded source text so a huge PDF can't blow up the RAG store or a prompt.
const MAX_TEXT = 200_000;
//? Four UTF-8 bytes per retained JS character is a bounded read/output ceiling consistent with MAX_TEXT.
const MAX_TEXT_BYTES = MAX_TEXT * 4;

export type ExtractStatus = 'ok' | 'empty' | 'unsupported' | 'failed';
export interface ExtractedUpload { status: ExtractStatus; text: string }

//? The upload extensions we can turn into text (drives the 'pending' extract status on attach).
export const PARSEABLE_EXT = new Set(['pdf', 'docx', 'txt', 'md', 'markdown']);
function mediaPath(mediaUrl: string): string { return mediaUrl.split(/[?#]/, 1)[0] ?? ''; }
export function mediaExtension(mediaUrlOrExt: string): string {
  const clean = mediaPath(mediaUrlOrExt);
  return (path.extname(clean).slice(1) || clean).toLowerCase();
}
export function isParseableUpload(mediaUrlOrExt: string): boolean { return PARSEABLE_EXT.has(mediaExtension(mediaUrlOrExt)); }

async function readTextPrefix(filePath: string): Promise<string | null> {
  const [openError, handle] = await tryCatch(() => open(filePath, 'r'));
  if (openError || handle === null) return null;
  const bytes = Buffer.alloc(MAX_TEXT_BYTES);
  const [readError, result] = await tryCatch(() => handle.read(bytes, 0, bytes.length, 0));
  await tryCatch(() => handle.close());
  if (readError || result === null) return null;
  const [decodeError, text] = tryCatchSync(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, result.bytesRead)));
  return decodeError ? null : text;
}

//? Extract text from a `/media/<file>` upload. Resolves the file safely under MEDIA_DIR (reuses the
//? download route's traversal guard), then dispatches by extension. Returns { status, text } — the caller
//? persists it onto the Document.assets entry + indexes it into RAG.
export async function extractUploadText(mediaUrl: string): Promise<ExtractedUpload> {
  const abs = safeMediaPath(mediaPath(mediaUrl));
  if (abs === null) return { status: 'failed', text: '' };
  const ext = mediaExtension(mediaUrl);

  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    const raw = await readTextPrefix(abs);
    if (raw === null) return { status: 'failed', text: '' };
    const text = raw.slice(0, MAX_TEXT).trim();
    return { status: text.length > 0 ? 'ok' : 'empty', text };
  }

  if (ext === 'pdf') {
    const out = await runToolContainerText({
      buildInput: (dir) => { copyFileSync(abs, path.join(dir, 'in.pdf')); },
      //? -layout keeps columns/tables readable; -enc UTF-8 for accented source material. (This is
      //? poppler's encoding-name CLI arg, which must be the canonical "UTF-8", not the JS "utf8".)
      // eslint-disable-next-line unicorn/text-encoding-identifier-case
      imageAndArgs: [POPPLER_IMAGE, 'pdftotext', '-layout', '-enc', 'UTF-8', '/data/in.pdf', '/data/out.txt'],
      outFile: 'out.txt',
      maxOutputBytes: MAX_TEXT_BYTES,
      tmpPrefix: 'ws-parse-',
    });
    if (out === null) return { status: 'failed', text: '' };
    const text = out.slice(0, MAX_TEXT).trim();
    return { status: text.length > 0 ? 'ok' : 'empty', text };
  }

  if (ext === 'docx') {
    const out = await runToolContainerText({
      buildInput: (dir) => { copyFileSync(abs, path.join(dir, 'in.docx')); },
      imageAndArgs: [PANDOC_IMAGE, '/data/in.docx', '-f', 'docx', '-t', 'markdown', '-o', '/data/out.md'],
      outFile: 'out.md',
      maxOutputBytes: MAX_TEXT_BYTES,
      tmpPrefix: 'ws-parse-',
    });
    if (out === null) return { status: 'failed', text: '' };
    const text = out.slice(0, MAX_TEXT).trim();
    return { status: text.length > 0 ? 'ok' : 'empty', text };
  }

  return { status: 'unsupported', text: '' };
}
