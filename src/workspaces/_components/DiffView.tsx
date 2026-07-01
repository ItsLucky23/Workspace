//? Workspaces — GitLab-MR-style inline diff. Clean, readable formatting (NOT a
//? terminal): old/new line gutters, +/− signs, green/red row tints from the
//? semantic theme tokens. Read-only preview; a real editor (VS Code) comes
//? later.

import type { DiffLine } from '../_data/types';

const ROW: Record<DiffLine['kind'], string> = {
  add: 'bg-correct/10',
  del: 'bg-wrong/10',
  ctx: '',
  hunk: 'bg-container2',
};
const TEXT: Record<DiffLine['kind'], string> = {
  add: 'text-correct',
  del: 'text-wrong',
  ctx: 'text-common',
  hunk: 'text-muted',
};
const SIGN: Record<DiffLine['kind'], string> = { add: '+ ', del: '- ', ctx: '  ', hunk: '' };

export default function DiffView({ lines, className }: { lines: DiffLine[]; className?: string }) {
  return (
    <div className={`rounded-xl border border-container1-border overflow-hidden font-mono text-xs leading-relaxed ${className ?? ''}`}>
      {lines.map((l, i) => (
        <div key={i} className={`flex ${ROW[l.kind]}`}>
          <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-disabled select-none">{l.kind === 'add' ? '' : (l.oldNo ?? '')}</span>
          <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-disabled select-none border-r border-divider">{l.kind === 'del' ? '' : (l.newNo ?? '')}</span>
          <span className={`flex-1 pl-2 pr-3 py-0.5 whitespace-pre-wrap ${TEXT[l.kind]}`}>
            <span className="select-none opacity-70">{SIGN[l.kind]}</span>{l.text}
          </span>
        </div>
      ))}
    </div>
  );
}
