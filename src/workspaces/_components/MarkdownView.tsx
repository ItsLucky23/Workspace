//? DOC2 (DOCUMENTS_AND_SKILLS) — minimal, SAFE markdown renderer for document previews: headings,
//? bullets, numbered lists, tables, paragraphs. No HTML injection (no dangerouslySetInnerHTML) —
//? extends the studio StrategyPreview approach with table support (tables also drive the xlsx export).

import type { ReactNode } from 'react';

//? strip **bold**/`code`/_italic_ markers for a plain readable render.
function stripInline(s: string): string {
  return s.replaceAll(/\*\*(.+?)\*\*/g, '$1').replaceAll(/`(.+?)`/g, '$1').replaceAll(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2');
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 2;
}
function isTableDivider(line: string): boolean {
  return isTableRow(line) && /^\|[\s:|-]+\|$/.test(line.trim());
}
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => stripInline(c.trim()));
}

export default function MarkdownView({ markdown, className = '' }: { markdown: string; className?: string }) {
  const lines = markdown.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    //? Table block: header row + divider + body rows.
    if (isTableRow(line) && isTableDivider(lines[i + 1] ?? '')) {
      const header = splitRow(line);
      const body: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j] ?? '')) { body.push(splitRow(lines[j] ?? '')); j += 1; }
      out.push(
        <div key={i} className="overflow-x-auto my-2">
          <table className="text-sm border-collapse min-w-[50%]">
            <thead><tr>{header.map((h, hi) => <th key={`${h}-${String(hi)}`} className="text-left font-semibold text-title border border-container1-border bg-container2/50 px-2.5 py-1.5">{h}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => <tr key={`${r.join('|').slice(0, 40)}-${String(ri)}`}>{header.map((h, ci) => <td key={`${h}-${String(ci)}`} className="text-common border border-container1-border px-2.5 py-1.5 align-top">{r[ci] ?? ''}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      i = j;
      continue;
    }
    const t = line.trim();
    if (t.length === 0) out.push(<div key={i} className="h-2" />);
    else if (t.startsWith('#### ')) out.push(<div key={i} className="text-sm font-semibold text-title mt-2">{stripInline(t.slice(5))}</div>);
    else if (t.startsWith('### ')) out.push(<div key={i} className="text-sm font-semibold text-title mt-2">{stripInline(t.slice(4))}</div>);
    else if (t.startsWith('## ')) out.push(<div key={i} className="text-base font-semibold text-title mt-3">{stripInline(t.slice(3))}</div>);
    else if (t.startsWith('# ')) out.push(<div key={i} className="text-lg font-semibold text-title mt-3">{stripInline(t.slice(2))}</div>);
    else if (/^\d+\.\s/.test(t)) out.push(<div key={i} className="flex gap-2 pl-2"><span className="text-muted">{t.split('.')[0]}.</span><span>{stripInline(t.replace(/^\d+\.\s/, ''))}</span></div>);
    else if (t.startsWith('- ') || t.startsWith('* ')) out.push(<div key={i} className="flex gap-2 pl-2"><span className="text-muted">•</span><span>{stripInline(t.slice(2))}</span></div>);
    else if (t.startsWith('> ')) out.push(<div key={i} className="border-l-2 border-container1-border pl-3 text-muted italic">{stripInline(t.slice(2))}</div>);
    else out.push(<div key={i}>{stripInline(t)}</div>);
    i += 1;
  }
  return <div className={`text-sm text-common leading-relaxed ${className}`}>{out}</div>;
}
