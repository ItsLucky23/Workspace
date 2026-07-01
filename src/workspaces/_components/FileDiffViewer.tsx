//? Workspaces — GitLab-MR-style changed-files viewer. Left: a sidebar listing
//? every file with its +adds / −dels; click to jump to it. Right: each file as
//? a collapsible section (open/close like GitLab) rendering the inline diff.
//? Read-only; dummy data.

import { useRef, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import DiffView from './DiffView';
import Icon from './Icon';
import type { TicketFile } from '../_data/types';

const baseName = (path: string) => path.split('/').pop() ?? path;

export default function FileDiffViewer({ files }: { files: TicketFile[] }) {
  const translate = useTranslator();
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(files.map((f) => [f.path, true])));
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const jumpTo = (path: string) => {
    setOpen((prev) => ({ ...prev, [path]: true }));
    sectionRefs.current[path]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex gap-4 items-start">
      {/* file list */}
      <div className="w-56 shrink-0 sticky top-0 rounded-xl border border-container1-border bg-container1 p-2 hidden md:block">
        <div className="px-2 py-1.5 text-xs font-medium text-muted">{translate({ key: 'workspaces.fileDiff.fileCount', params: [{ key: 'count', value: files.length }] })}</div>
        {files.map((f) => (
          <button
            key={f.path} type="button" onClick={() => { jumpTo(f.path); }}
            className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-container2 transition-colors cursor-pointer"
          >
            <span className="font-mono text-xs text-common truncate" title={f.path}>{baseName(f.path)}</span>
            <span className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
              <span className="text-correct">+{f.add}</span>
              <span className="text-wrong">−{f.del}</span>
            </span>
          </button>
        ))}
      </div>

      {/* diffs */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {files.map((f) => {
          const isOpen = open[f.path] ?? true;
          return (
            <div key={f.path} ref={(el) => { sectionRefs.current[f.path] = el; }} className="rounded-xl border border-container1-border overflow-hidden">
              <button
                type="button"
                onClick={() => { setOpen((prev) => ({ ...prev, [f.path]: !isOpen })); }}
                className="w-full flex items-center justify-between gap-3 bg-container1 hover:bg-container1-hover px-3 h-10 cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Icon name={isOpen ? 'angle-down' : 'angle-right'} className="text-muted" />
                  <span className="font-mono text-xs text-title truncate" title={f.path}>{f.path}</span>
                </span>
                <span className="flex items-center gap-2 text-xs font-mono shrink-0">
                  <span className="text-correct">+{f.add}</span>
                  <span className="text-wrong">−{f.del}</span>
                </span>
              </button>
              {isOpen && (
                f.diff
                  ? <DiffView lines={f.diff} className="rounded-none border-0 border-t border-divider" />
                  : <div className="px-3 py-4 text-xs text-muted border-t border-divider">{translate({ key: 'workspaces.fileDiff.noInlineDiff' })}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
