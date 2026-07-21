/** @docs owner ItsLucky23 */
//? EXP (DOCUMENTS_AND_SKILLS) — the document EXPORT layer. Markdown is the single source (ADR 0271);
//? every format is a RENDER TARGET: md (verbatim) + html (own safe md→html subset, standalone page
//? with optional brand logo + TOC + inlined images) + xlsx (markdown tables → a dependency-free minimal
//? OOXML workbook) run natively; docx (pandoc) + pdf (headless-chromium print of the html) run in throwaway
//? Docker containers (images overridable via WS_EXPORT_PANDOC_IMAGE / WS_EXPORT_CHROME_IMAGE). Outputs land
//? in the media store (`/media/<file>`) and are appended to Document.assets by the Conductor op.
//? @adr 0271

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { deflateRawSync } from 'node:zlib';

import { tryCatchSync } from '@luckystack/core';

import { runToolContainer } from '../container/toolHarness';
import { persistMediaBytes, MEDIA_DIR } from '../media/store';

export type DocumentExportFormat = 'md' | 'html' | 'pdf' | 'docx' | 'xlsx';
export const DOCUMENT_EXPORT_FORMATS: DocumentExportFormat[] = ['md', 'html', 'pdf', 'docx', 'xlsx'];

const PANDOC_IMAGE = (process.env.WS_EXPORT_PANDOC_IMAGE ?? '').trim() || 'pandoc/core:3.2';
const CHROME_IMAGE = (process.env.WS_EXPORT_CHROME_IMAGE ?? '').trim() || 'zenika/alpine-chrome:124';

//? DESIGN_DOCS_PROGRAM 2.2 (export side) — mermaid diagrams render in the HTML/PDF export by inlining the
//? mermaid runtime (an IIFE global, no bundler needed) + init; the chromium print pass runs it via
//? --virtual-time-budget before printing. Read once, cached; '' if mermaid isn't installed (→ code-block fallback).
let mermaidRuntimeCache: string | null = null;
function mermaidRuntime(): string {
  if (mermaidRuntimeCache === null) {
    const [err, js] = tryCatchSync(() => readFileSync(path.join(process.cwd(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'), 'utf8'));
    mermaidRuntimeCache = err || js === null ? '' : js;
  }
  return mermaidRuntimeCache;
}
function hasMermaid(markdown: string): boolean { return /```+\s*mermaid\b/.test(markdown); }

/* ----------------------------------------------------------------- md → html */

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
//? A safe href/src: only http(s), mailto, anchors, and (post-inlining) data: image URIs. Anything else
//? (javascript:, file:, a relative /media that never inlined) is dropped to '#'.
function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:|#|data:image\/)/i.test(u)) return u.replaceAll('"', '%22');
  return '#';
}
//? EXP (2.4) — inline markdown: images, links, bold, inline code. Escape FIRST, then apply the inline
//? regexes on the escaped text: markdown syntax chars (`![]()*`) survive esc(), and a url's `&`→`&amp;` is
//? exactly right inside an HTML attribute. Images before links (an image is a link with a leading `!`).
//? `alt`/text are already escaped by esc(); urls are gated by safeUrl. No placeholders → no collisions.
function inline(s: string): string {
  return esc(s)
    .replaceAll(/!\[([^\]]*)]\(([^)]+)\)/g, (_m, alt: string, url: string) => `<img src="${safeUrl(url)}" alt="${alt}" />`)
    .replaceAll(/\[([^\]]+)]\(([^)]+)\)/g, (_m, text: string, url: string) => `<a href="${safeUrl(url)}">${text}</a>`)
    .replaceAll(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replaceAll(/`(.+?)`/g, '<code>$1</code>');
}
//? A URL-safe heading anchor id (for the TOC links + deep links).
function slug(s: string): string {
  return s.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

const isRow = (l: string): boolean => { const t = l.trim(); return t.startsWith('|') && t.endsWith('|') && t.length > 2; };
const isDivider = (l: string): boolean => isRow(l) && /^\|[\s:|-]+\|$/.test(l.trim());
const cells = (l: string): string[] => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

//? The same markdown subset MarkdownView renders + fenced code, horizontal rules, links, images, anchors.
export function mdToHtmlBody(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = (): void => { if (list) { out.push(`</${list}>`); list = null; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    //? EXP (2.4) — fenced code block: consume verbatim until the closing fence (never inline-processed).
    const fence = /^```+\s*([\w-]*)\s*$/.exec(line.trim());
    if (fence) {
      closeList();
      const lang = fence[1] ?? '';
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^```+\s*$/.test((lines[j] ?? '').trim())) { body.push(lines[j] ?? ''); j += 1; }
      out.push(lang === 'mermaid'
        ? `<pre class="mermaid">${esc(body.join('\n'))}</pre>`
        : `<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      i = j + 1;
      continue;
    }
    //? Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { closeList(); out.push('<hr />'); i += 1; continue; }
    if (isRow(line) && isDivider(lines[i + 1] ?? '')) {
      closeList();
      const header = cells(line);
      out.push('<table><thead><tr>' + header.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
      let j = i + 2;
      while (j < lines.length && isRow(lines[j] ?? '')) {
        const r = cells(lines[j] ?? '');
        out.push('<tr>' + header.map((_, ci) => `<td>${inline(r[ci] ?? '')}</td>`).join('') + '</tr>');
        j += 1;
      }
      out.push('</tbody></table>');
      i = j;
      continue;
    }
    const t = line.trim();
    if (t.startsWith('- ') || t.startsWith('* ')) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(t.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(t)) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(t.replace(/^\d+\.\s/, ''))}</li>`);
    } else {
      closeList();
      if (t.length === 0) { /* paragraph gap */ }
      else if (t.startsWith('#### ')) { const x = t.slice(5); out.push(`<h4 id="${slug(x)}">${inline(x)}</h4>`); }
      else if (t.startsWith('### ')) { const x = t.slice(4); out.push(`<h3 id="${slug(x)}">${inline(x)}</h3>`); }
      else if (t.startsWith('## ')) { const x = t.slice(3); out.push(`<h2 id="${slug(x)}">${inline(x)}</h2>`); }
      else if (t.startsWith('# ')) { const x = t.slice(2); out.push(`<h1 id="${slug(x)}">${inline(x)}</h1>`); }
      else if (t.startsWith('> ')) out.push(`<blockquote>${inline(t.slice(2))}</blockquote>`);
      else out.push(`<p>${inline(t)}</p>`);
    }
    i += 1;
  }
  closeList();
  return out.join('\n');
}

//? EXP (2.4) — a table of contents from the document's ## / ### headings (only when there are ≥3, so a short
//? doc isn't cluttered). Links to the heading anchors emitted by mdToHtmlBody. Ignores headings inside code.
export function buildToc(markdown: string): string {
  const lines = markdown.split('\n');
  const entries: { level: number; text: string }[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```+/.test(line.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.*)$/.exec(line.trim());
    const hashes = m?.[1];
    const heading = m?.[2];
    if (hashes !== undefined && heading !== undefined) entries.push({ level: hashes.length, text: heading.trim() });
  }
  if (entries.length < 3) return '';
  const items = entries.map((e) => `<li class="toc-l${String(e.level)}"><a href="#${slug(e.text)}">${inline(e.text)}</a></li>`).join('');
  return `<nav class="toc"><div class="toc-title">Contents</div><ul>${items}</ul></nav>`;
}

//? EXP (2.4) — self-contained export: inline any local /media/ image referenced in the markdown as a data URI
//? (the chromium PDF render runs --network none, and a downloaded HTML must not depend on the app being up).
//? Remote (http) images are left as-is. Best-effort per image.
export function inlineMediaImages(markdown: string): string {
  return markdown.replaceAll(/(!\[[^\]]*]\()(\/media\/[^)\s]+)(\))/g, (whole, pre: string, url: string, post: string) => {
    const uri = brandLogoDataUri(url);
    return uri ? `${pre}${uri}${post}` : whole;
  });
}

//? EXP3 — standalone shareable page: inline CSS, print-friendly, optional brand-logo header + a TOC.
export function standaloneHtml(title: string, markdown: string, brandLogoDataUri?: string): string {
  const css = [
    'body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1.25rem;color:#1f2430;line-height:1.6}',
    'h1{font-size:1.7rem;margin:1.2rem 0 .6rem}h2{font-size:1.3rem;margin:1.1rem 0 .5rem}h3{font-size:1.1rem;margin:1rem 0 .4rem}h4{font-size:1rem;margin:.9rem 0 .3rem}',
    'table{border-collapse:collapse;margin:.8rem 0;width:100%}th,td{border:1px solid #d5d9e2;padding:.45rem .6rem;text-align:left;vertical-align:top}th{background:#f2f4f8}',
    'code{background:#f2f4f8;border-radius:4px;padding:.1rem .3rem;font-size:.9em}blockquote{border-left:3px solid #d5d9e2;margin:.6rem 0;padding:.1rem .9rem;color:#5a6172;font-style:italic}',
    'pre.code{background:#1f2430;color:#e6e9f0;border-radius:6px;padding:.8rem 1rem;overflow-x:auto;font-size:.85em;line-height:1.5}pre.code code{background:none;padding:0;color:inherit}',
    'img{max-width:100%;height:auto;border-radius:6px}hr{border:none;border-top:1px solid #d5d9e2;margin:1.2rem 0}a{color:#2b62d9}',
    '.toc{border:1px solid #d5d9e2;border-radius:8px;padding:.6rem 1rem;margin:1rem 0;background:#f8fafc}.toc-title{font-weight:600;margin-bottom:.3rem}.toc ul{list-style:none;padding-left:0;margin:0}.toc li{margin:.15rem 0}.toc-l3{padding-left:1rem;font-size:.95em}',
    'header.brand{display:flex;justify-content:flex-end;margin-bottom:.5rem}header.brand img{max-height:44px;border-radius:0}',
    'pre.mermaid{background:none;border:none;padding:0;text-align:center;overflow-x:auto}',
    '@media print{body{margin:0 auto}.toc{break-inside:avoid}pre.code,pre.mermaid,table,img{break-inside:avoid}}',
  ].join('');
  const logo = brandLogoDataUri ? `<header class="brand"><img src="${brandLogoDataUri}" alt=""/></header>` : '';
  const md = inlineMediaImages(markdown);
  //? 2.2 export — when the doc has mermaid, inline the runtime + init so chromium renders the diagrams
  //? (the print pass waits via --virtual-time-budget). No mermaid → nothing injected (no 3.5MB overhead).
  const mermaid = hasMermaid(md) && mermaidRuntime().length > 0
    ? `<script>${mermaidRuntime()}</script><script>(function(){var a=(window.__esbuild_esm_mermaid_nm||{}).mermaid;var m=a&&(a.default||a);if(m&&m.initialize){m.initialize({startOnLoad:true,securityLevel:'strict',theme:'neutral'});}})();</script>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title><style>${css}</style></head><body>${logo}${buildToc(md)}${mdToHtmlBody(md)}${mermaid}</body></html>`;
}

/* ----------------------------------------------------------------- markdown tables → xlsx */

export interface MdTable { name: string; header: string[]; rows: string[][] }

//? Every markdown table in the document, named after the nearest preceding heading.
export function extractTables(markdown: string): MdTable[] {
  const lines = markdown.split('\n');
  const tables: MdTable[] = [];
  let heading = 'Sheet';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const t = line.trim();
    if (/^#{1,4}\s/.test(t)) heading = t.replace(/^#{1,4}\s/, '').trim() || heading;
    if (isRow(line) && isDivider(lines[i + 1] ?? '')) {
      const header = cells(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isRow(lines[j] ?? '')) { rows.push(cells(lines[j] ?? '')); j += 1; }
      tables.push({ name: heading, header, rows });
      i = j;
      continue;
    }
    i += 1;
  }
  return tables;
}

//? Minimal STORE/DEFLATE-free… actually: DEFLATE-compressed ZIP writer (local headers + central dir).
//? Enough for OOXML consumers; no external dependency.
function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xED_B8_83_20 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0 ^ -1;
  for (const byte of buf) crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xFF] ?? 0);
  return (crc ^ -1) >>> 0;
}

export function zipBuffer(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const comp = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4B_50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02_01_4B_50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(0, 30); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4B_50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

const colName = (n: number): string => {
  let s = '';
  let x = n;
  for (;;) { s = String.fromCodePoint(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; if (x < 0) break; }
  return s;
};

const sheetXml = (t: MdTable): string => {
  const rows = [t.header, ...t.rows];
  const rowsXml = rows.map((r, ri) =>
    `<row r="${String(ri + 1)}">` + r.map((c, ci) => `<c r="${colName(ci)}${String(ri + 1)}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`).join('') + '</row>',
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
};
const safeName = (s: string, i: number): string => (s.replaceAll(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet') + ` ${String(i + 1)}`;

//? Markdown tables → a minimal OOXML workbook (inline strings; one worksheet per table). A document
//? without tables exports its lines as a single one-column sheet so the export is never empty.
export function xlsxFromMarkdown(title: string, markdown: string): Buffer {
  let tables = extractTables(markdown);
  if (tables.length === 0) {
    const linesRows = markdown.split('\n').filter((l) => l.trim().length > 0).map((l) => [l.trim()]);
    tables = [{ name: title || 'Document', header: ['Text'], rows: linesRows }];
  }
  const sheetsMeta = tables.map((t, i) => ({ id: i + 1, name: safeName(t.name, i) }));
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsMeta.map((s) => `<sheet name="${esc(s.name)}" sheetId="${String(s.id)}" r:id="rId${String(s.id)}"/>`).join('')}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetsMeta.map((s) => `<Relationship Id="rId${String(s.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(s.id)}.xml"/>`).join('')}</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetsMeta.map((s) => `<Override PartName="/xl/worksheets/sheet${String(s.id)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  return zipBuffer([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    ...tables.map((t, i) => ({ name: `xl/worksheets/sheet${String(i + 1)}.xml`, data: Buffer.from(sheetXml(t), 'utf8') })),
  ]);
}

/* ----------------------------------------------------------------- container renders */

//? Both renders run in a throwaway `--network none` container over a temp dir (the shared Phase 0.1
//? harness `runToolContainer`): the render never needs egress (inputs are mounted, images are data URIs).
export async function renderDocx(markdown: string): Promise<Buffer | null> {
  return runToolContainer({
    buildInput: (dir) => { writeFileSync(path.join(dir, 'in.md'), markdown, 'utf8'); },
    imageAndArgs: [PANDOC_IMAGE, '/data/in.md', '-f', 'markdown', '-t', 'docx', '-o', '/data/out.docx'],
    outFile: 'out.docx',
    tmpPrefix: 'ws-export-',
  });
}

export async function renderPdf(title: string, markdown: string, logoDataUri?: string): Promise<Buffer | null> {
  return runToolContainer({
    buildInput: (dir) => { writeFileSync(path.join(dir, 'in.html'), standaloneHtml(title, markdown, logoDataUri), 'utf8'); },
    //? --virtual-time-budget lets inlined mermaid render before the print pass; harmless when there's none.
    imageAndArgs: [CHROME_IMAGE, '--headless', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=8000', '--print-to-pdf=/data/out.pdf', '--no-pdf-header-footer', 'file:///data/in.html'],
    outFile: 'out.pdf',
    tmpPrefix: 'ws-export-',
  });
}

/* ----------------------------------------------------------------- the export entry */

export interface ExportResult { ok: boolean; url?: string; error?: string }

//? EXP3 — inline the workspace brand logo as a data URI (the export must be self-contained; the
//? chromium container runs with --network none). Only local /media/ logos inline; failures = no logo.
export function brandLogoDataUri(brandLogoUrl: string | null): string | undefined {
  if (!brandLogoUrl?.startsWith('/media/')) return undefined;
  const name = brandLogoUrl.slice('/media/'.length);
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return undefined;
  const [err, uri] = tryCatchSync(() => {
    const bytes = readFileSync(path.join(MEDIA_DIR, name));
    const ext = path.extname(name).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${bytes.toString('base64')}`;
  });
  return err || uri === null ? undefined : uri;
}

export async function exportDocument(
  doc: { id: string; title: string; content: string }, format: DocumentExportFormat, brandLogoUrl: string | null,
): Promise<ExportResult> {
  const id = `doc-${doc.id.slice(-6)}-${randomUUID().slice(0, 8)}`;
  if (format === 'md') {
    const { url } = persistMediaBytes(Buffer.from(doc.content, 'utf8'), 'md', id);
    return { ok: true, url };
  }
  if (format === 'html') {
    const { url } = persistMediaBytes(Buffer.from(standaloneHtml(doc.title, doc.content, brandLogoDataUri(brandLogoUrl)), 'utf8'), 'html', id);
    return { ok: true, url };
  }
  if (format === 'xlsx') {
    const { url } = persistMediaBytes(xlsxFromMarkdown(doc.title, doc.content), 'xlsx', id);
    return { ok: true, url };
  }
  if (format === 'docx') {
    const bytes = await renderDocx(doc.content);
    if (!bytes) return { ok: false, error: 'export.containerFailed' };
    const { url } = persistMediaBytes(bytes, 'docx', id);
    return { ok: true, url };
  }
  const bytes = await renderPdf(doc.title, doc.content, brandLogoDataUri(brandLogoUrl));
  if (!bytes) return { ok: false, error: 'export.containerFailed' };
  const { url } = persistMediaBytes(bytes, 'pdf', id);
  return { ok: true, url };
}
