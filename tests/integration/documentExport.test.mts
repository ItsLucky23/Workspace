//? FASE EXP (DOCUMENTS_AND_SKILLS) — the export layer, WITH real Docker for the container formats.
//? Native: md (verbatim), html (safe md→html incl. tables + escaping), xlsx (dependency-free OOXML —
//? validated by UNZIPPING our own zip via node:zlib and checking the sheet XML). Container (real
//? `docker run`, network-none): docx via pandoc (PK zip + word/document.xml), pdf via headless
//? chromium (%PDF magic). The document-export op appends each result as an 'export' asset.
//? Docker MUST be available for this suite — a missing daemon FAILS loudly (never a silent skip).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { mdToHtmlBody, standaloneHtml, extractTables, xlsxFromMarkdown, zipBuffer, exportDocument } = await import('../../server/documents/export');
const { dockerAvailable } = await import('../../server/container/runtime');
const { MEDIA_DIR } = await import('../../server/media/store');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 120_000, stepMs = 250): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

//? Read one entry out of OUR zip format (local headers are deflate; enough to validate the xlsx).
function unzipEntry(zip: Buffer, name: string): string | null {
  let off = 0;
  while (off + 30 <= zip.length && zip.readUInt32LE(off) === 0x04034b50) {
    const compSize = zip.readUInt32LE(off + 18);
    const nameLen = zip.readUInt16LE(off + 26);
    const extraLen = zip.readUInt16LE(off + 28);
    const entryName = zip.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    if (entryName === name) return inflateRawSync(zip.subarray(dataStart, dataStart + compSize)).toString('utf8');
    off = dataStart + compSize;
  }
  return null;
}

const MD = [
  '# Q3 plan',
  '',
  'Intro with **bold** and `code` and a <script>alert(1)</script> injection attempt.',
  '',
  '## Budget',
  '',
  '| Item | Cost |',
  '| --- | --- |',
  '| Ads | 100 |',
  '| Tools | 50 |',
  '',
  '- point one',
  '1. numbered',
].join('\n');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `exp-${String(stamp)}@youcomm.nl`, name: 'EXP' } });
let wsId = '';

try {
  // ---- 0. Docker is REQUIRED here (the user's goal explicitly allows container setup) ----
  eq(await dockerAvailable(), true, 'docker daemon is available (container formats are part of this suite)');

  // ---- 1. md→html: structure + escaping ----
  const body = mdToHtmlBody(MD);
  assert(body.includes('<h1 id="q3-plan">Q3 plan</h1>') && body.includes('<h2 id="budget">Budget</h2>'), 'headings render with stable TOC anchors');
  assert(body.includes('<table>') && body.includes('<th>Item</th>') && body.includes('<td>Ads</td>'), 'tables render');
  assert(body.includes('<strong>bold</strong>') && body.includes('<code>code</code>'), 'inline marks render');
  assert(!body.includes('<script>') && body.includes('&lt;script&gt;'), 'HTML is ESCAPED (no injection)');
  const page = standaloneHtml('Q3 plan', MD, 'data:image/png;base64,AAAA');
  assert(page.startsWith('<!doctype html>') && page.includes('<title>Q3 plan</title>') && page.includes('header class="brand"'), 'standalone page with brand header');

  // ---- 2. tables → xlsx (validated by unzipping our own bytes) ----
  const tables = extractTables(MD);
  eq(tables.length, 1, 'one markdown table extracted');
  eq(tables[0]?.name, 'Budget', 'named after the nearest heading');
  const xlsx = xlsxFromMarkdown('Q3 plan', MD);
  eq(xlsx.readUInt32LE(0), 0x04034b50, 'xlsx starts with the PK zip magic');
  const wb = unzipEntry(xlsx, 'xl/workbook.xml');
  assert(wb !== null && wb.includes('<sheet name="Budget 1"'), 'workbook lists the sheet');
  const sheet = unzipEntry(xlsx, 'xl/worksheets/sheet1.xml');
  assert(sheet !== null && sheet.includes('>Ads</t>') && sheet.includes('>100</t>'), 'the sheet carries the table cells');
  const noTables = xlsxFromMarkdown('Notes', 'just a line\nanother line');
  assert(unzipEntry(noTables, 'xl/worksheets/sheet1.xml')?.includes('just a line') === true, 'a table-less document still exports its lines');
  const rt = zipBuffer([{ name: 'a.txt', data: Buffer.from('hello zip') }]);
  eq(unzipEntry(rt, 'a.txt'), 'hello zip', 'the zip writer round-trips through inflate');

  // ---- 3. native exports through the real op (md + html + xlsx land as export assets) ----
  const created = await createBlankWorkspace(prisma, owner.id, 'Export WS');
  wsId = created.workspaceId;
  await enqueueControlAction({ workspaceId: wsId, op: 'document-create', target: {}, payload: { title: 'Q3 plan', content: MD }, userId: owner.id, clientRequestId: `ec-${String(stamp)}` });
  const doc = await poll(() => prisma.document.findFirst({ where: { workspaceId: wsId, title: 'Q3 plan' } }), 10_000);
  assert(doc !== null, 'document created');
  for (const format of ['md', 'html', 'xlsx'] as const) {
    await enqueueControlAction({ workspaceId: wsId, op: 'document-export', target: {}, payload: { documentId: doc?.id, format }, userId: owner.id, clientRequestId: `ex-${format}-${String(stamp)}` });
  }
  const withNative = await poll(async () => {
    const d = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } });
    const assets = Array.isArray(d?.assets) ? (d.assets as { kind?: string }[]) : [];
    return assets.filter((a) => a.kind === 'export').length >= 3 ? d : null;
  }, 20_000);
  assert(withNative !== null, 'md+html+xlsx exports appended as export assets');
  const exportAssets = (withNative?.assets as { kind: string; url: string; label: string }[]).filter((a) => a.kind === 'export');
  for (const a of exportAssets) {
    const bytes = readFileSync(path.join(MEDIA_DIR, a.url.slice('/media/'.length)));
    assert(bytes.length > 0, `the ${a.label} export file exists on disk`);
  }

  // ---- 4. container formats (REAL docker run): docx via pandoc, pdf via chromium ----
  const docx = await exportDocument({ id: doc?.id ?? 'x', title: 'Q3 plan', content: MD }, 'docx', null);
  assert(docx.ok && typeof docx.url === 'string', 'pandoc container produced a docx');
  const docxBytes = readFileSync(path.join(MEDIA_DIR, (docx.url ?? '').slice('/media/'.length)));
  eq(docxBytes.readUInt32LE(0), 0x04034b50, 'docx is a PK zip');
  assert(docxBytes.includes(Buffer.from('word/')), 'docx contains the word/ part (a real OOXML document)');

  const pdf = await exportDocument({ id: doc?.id ?? 'x', title: 'Q3 plan', content: MD }, 'pdf', null);
  assert(pdf.ok && typeof pdf.url === 'string', 'chromium container produced a pdf');
  const pdfBytes = readFileSync(path.join(MEDIA_DIR, (pdf.url ?? '').slice('/media/'.length)));
  eq(pdfBytes.subarray(0, 5).toString('latin1'), '%PDF-', 'pdf starts with the %PDF magic');
  assert(pdfBytes.length > 1000, 'and is a non-trivial file');
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/documentExport.test.mts');
}
