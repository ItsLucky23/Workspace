//? Unified-diff parser for the built-in MR review (BUILTIN_MR_REVIEW). Turns `git diff target...source`
//? into a structured per-file / per-line shape the frontend renders (with old/new line numbers so
//? review threads can anchor to a line). Bounded so a huge diff can't blow up the payload.

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk';
export interface DiffLine { kind: DiffLineKind; content: string; oldNo: number | null; newNo: number | null }
export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';
export interface DiffFile { path: string; oldPath: string | null; status: FileStatus; additions: number; deletions: number; lines: DiffLine[]; truncated: boolean }
export interface MrDiff { files: DiffFile[]; additions: number; deletions: number; truncated: boolean }

const MAX_FILES = 200;
const MAX_LINES_PER_FILE = 2000;

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HEADER_RE = /^diff --git a\/(?:.+?) b\/(.+)$/;

//? Parse a raw unified diff into files + line-numbered lines. Ignores binary/metadata noise.
export function parseUnifiedDiff(raw: string): MrDiff {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  let truncated = false;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      if (files.length >= MAX_FILES) { truncated = true; cur = null; continue; }
      const m = HEADER_RE.exec(line);
      cur = { path: m?.[1] ?? line, oldPath: null, status: 'modified', additions: 0, deletions: 0, lines: [], truncated: false };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file')) { cur.status = 'added'; continue; }
    if (line.startsWith('deleted file')) { cur.status = 'deleted'; continue; }
    if (line.startsWith('rename from ')) { cur.oldPath = line.slice('rename from '.length); cur.status = 'renamed'; continue; }
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('similarity') || line.startsWith('rename to') || line.startsWith('old mode') || line.startsWith('new mode') || line.startsWith('Binary ') || line.startsWith(String.raw`\ `)) continue;

    if (cur.lines.length >= MAX_LINES_PER_FILE) { cur.truncated = true; truncated = true; continue; }

    if (line.startsWith('@@')) {
      const m = HUNK_RE.exec(line);
      oldNo = m ? Number(m[1]) : 0;
      newNo = m ? Number(m[2]) : 0;
      cur.lines.push({ kind: 'hunk', content: line, oldNo: null, newNo: null });
    } else if (line.startsWith('+')) {
      cur.lines.push({ kind: 'add', content: line.slice(1), oldNo: null, newNo });
      cur.additions++; newNo++;
    } else if (line.startsWith('-')) {
      cur.lines.push({ kind: 'del', content: line.slice(1), oldNo, newNo: null });
      cur.deletions++; oldNo++;
    } else if (line.startsWith(' ')) {
      cur.lines.push({ kind: 'ctx', content: line.slice(1), oldNo, newNo });
      oldNo++; newNo++;
    }
  }

  const additions = files.reduce((s, f) => s + f.additions, 0);
  const deletions = files.reduce((s, f) => s + f.deletions, 0);
  return { files, additions, deletions, truncated };
}
