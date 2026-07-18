//? DESIGN_DOCS_PROGRAM Phase 2.5 — a dependency-free line diff for reviewing an AI document draft against
//? the current content BEFORE applying it (apply = consent, B-23). Pure LCS over lines → DiffLine[] that the
//? existing DiffView renders. Kept small: whole-line granularity is enough for a markdown document review,
//? and bounded so a huge redraft can't lock the UI.

import type { DiffLine } from '../_data/types';

const MAX_LINES = 4000;

//? Longest-common-subsequence line diff. Returns context/added/removed lines with 1-based line numbers,
//? mirroring the MR-review diff shape so <DiffView> renders it unchanged.
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n').slice(0, MAX_LINES);
  const b = newText.split('\n').slice(0, MAX_LINES);
  const n = a.length;
  const m = b.length;
  //? LCS length table (n+1 × m+1). Bounded by MAX_LINES so this stays a few MB worst-case.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => Array.from<number>({ length: m + 1 }).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? (lcs[i + 1]![j + 1]! + 1) : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'ctx', oldNo: i + 1, newNo: j + 1, text: a[i] ?? '' }); i++; j++; }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { out.push({ kind: 'del', oldNo: i + 1, text: a[i] ?? '' }); i++; }
    else { out.push({ kind: 'add', newNo: j + 1, text: b[j] ?? '' }); j++; }
  }
  while (i < n) { out.push({ kind: 'del', oldNo: i + 1, text: a[i] ?? '' }); i++; }
  while (j < m) { out.push({ kind: 'add', newNo: j + 1, text: b[j] ?? '' }); j++; }
  return out;
}

//? Counts for a one-line summary ("+12 −4") above the diff.
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) { if (l.kind === 'add') added++; else if (l.kind === 'del') removed++; }
  return { added, removed };
}
