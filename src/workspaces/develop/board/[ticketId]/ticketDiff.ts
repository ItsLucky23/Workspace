//? Pure mappers behind the ticket Code tab (F-006/F-014): the built-in MR diff (the SAME data the Review
//? tab renders) → the lightweight viewer's `TicketFile` shape, and the hunk lines → Monaco's SCM pairs.
//? Kept out of CodePanel.tsx so they are unit-testable without React/Monaco.

import type { EditorChange } from 'src/_components/editor/CodeEditorPanel';
import type { MrDiffFile, TicketFile } from '../../../_data/types';

export function mrFilesToTicketFiles(files: MrDiffFile[]): TicketFile[] {
  return files.map((f) => ({
    path: f.path,
    add: f.additions,
    del: f.deletions,
    diff: f.lines.map((l) => ({ kind: l.kind, text: l.content, ...(l.oldNo === null ? {} : { oldNo: l.oldNo }), ...(l.newNo === null ? {} : { newNo: l.newNo }) })),
  }));
}

//? original/modified are what the diff editor renders side by side. The EDITABLE buffer is NOT built
//? from these (hunks carry partial context) — CodePanel reads full worktree content for that.
export function changesFromFiles(files: TicketFile[]): EditorChange[] {
  return files.map((f) => {
    const lines = f.diff ?? [];
    const modified = lines.filter((l) => l.kind === 'add' || l.kind === 'ctx').map((l) => l.text).join('\n');
    const original = lines.filter((l) => l.kind === 'del' || l.kind === 'ctx').map((l) => l.text).join('\n');
    const status: EditorChange['status'] = (f.del > 0 && f.add === 0) ? 'deleted' : (original.length === 0 ? 'added' : 'modified');
    return { path: f.path, status, original, modified };
  });
}
