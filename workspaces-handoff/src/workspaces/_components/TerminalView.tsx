//? Workspaces — terminal surface. Fixed-dark (both themes) mono render of a
//? process's lines, using the `terminal-*` theme tokens. Shared by the ticket
//? detail Terminal tab and the Terminals page.

import type { TerminalLine, TerminalTone } from '../_data/types';

const TONE: Record<TerminalTone, string> = {
  text: 'text-terminal-text',
  muted: 'text-terminal-muted',
  green: 'text-terminal-green',
  blue: 'text-terminal-blue',
  amber: 'text-terminal-amber',
  red: 'text-terminal-red',
  cyan: 'text-terminal-cyan',
};

export default function TerminalView({ lines, className }: { lines: TerminalLine[]; className?: string }) {
  return (
    <div className={`bg-terminal-bg text-terminal-text font-mono text-[13px] leading-relaxed p-3 overflow-auto ${className ?? ''}`}>
      {lines.map((l, i) => (
        <div key={i} className={`whitespace-pre-wrap ${TONE[l.tone]}`}>
          {l.prefix && <span className="font-semibold">{l.prefix}</span>}
          {l.text}
          {l.cursor && <span className="inline-block w-[7px] h-3.5 align-middle bg-terminal-text motion-safe:animate-pulse ml-0.5" />}
        </div>
      ))}
    </div>
  );
}
