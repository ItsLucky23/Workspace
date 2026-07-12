//? Themed file tree for the Monaco editor. Expand/collapse dirs, language-colored file
//? glyphs, active-file highlight, and optional git-status badges (M/A/D). Colors come from
//? the active theme PALETTE (inline) so the chrome matches the editor theme and stays
//? consistent with the real VS Code. Keyboard + click; mobile-friendly (parent controls
//? show/hide as a drawer).
//?
//? #36 — the "Explorer" heading is translated (workspaces.editor.explorer); the disable below
//? remains only for the single technical git-status glyphs (M/A/D), not product copy.

/* eslint-disable react/jsx-no-literals -- git-status glyphs (M/A/D) only */
import { useTranslator } from '@luckystack/core/client';

import type { FileTreeNode } from './fileTree';
import { iconForPath } from './languages';
import type { ThemePalette } from './editorThemes';

export type GitStatus = 'modified' | 'added' | 'deleted';

const EMPTY_STATUS: Record<string, GitStatus> = {};
const STATUS_GLYPH: Record<GitStatus, string> = { modified: 'M', added: 'A', deleted: 'D' };

interface FileExplorerProps {
  tree: FileTreeNode[];
  activePath: string | null;
  onOpen: (path: string) => void;
  palette: ThemePalette;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  status?: Record<string, GitStatus>;
}

export function FileExplorer({ tree, activePath, onOpen, palette, expanded, onToggleDir, status = EMPTY_STATUS }: FileExplorerProps) {
  const translate = useTranslator();
  return (
    <div className="h-full overflow-y-auto py-1 text-[13px] select-none" style={{ background: palette.bgAlt, color: palette.fg }}>
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide" style={{ color: palette.comment }}>{translate({ key: 'workspaces.editor.explorer' })}</div>
      {tree.map((node) => (
        <TreeRow key={node.path} node={node} depth={0} activePath={activePath} onOpen={onOpen} palette={palette} expanded={expanded} onToggleDir={onToggleDir} status={status} />
      ))}
    </div>
  );
}

interface RowProps extends Omit<FileExplorerProps, 'tree'> {
  node: FileTreeNode;
  depth: number;
}

function statusColorFor(gitStatus: GitStatus | undefined, palette: ThemePalette): string {
  if (gitStatus === 'deleted') return palette.removedFg;
  if (gitStatus === 'added') return palette.addedFg;
  return palette.attribute;
}

function TreeRow({ node, depth, activePath, onOpen, palette, expanded, onToggleDir, status = EMPTY_STATUS }: RowProps) {
  const isDir = node.type === 'dir';
  const isOpen = expanded.has(node.path);
  const isActive = activePath === node.path;
  const pad = 8 + depth * 12;
  const gitStatus = status[node.path];
  const statusColor = statusColorFor(gitStatus, palette);
  const { icon, color } = iconForPath(node.path);

  const handleClick = (): void => { if (isDir) onToggleDir(node.path); else onOpen(node.path); };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-center gap-1.5 pr-2 py-[3px] text-left cursor-pointer"
        style={{ paddingLeft: pad, background: isActive ? palette.selection : 'transparent' }}
        title={node.path}
      >
        {isDir ? (
          <span className="w-3 inline-block text-center" style={{ color: palette.comment }}>{isOpen ? '▾' : '▸'}</span>
        ) : (
          <span className="w-3 inline-block text-center text-[10px] font-bold" style={{ color }}>{icon.length > 2 ? '•' : icon}</span>
        )}
        <span className="truncate flex-1" style={{ color: gitStatus ? statusColor : palette.fg, fontWeight: isDir ? 500 : 400 }}>{node.name}</span>
        {gitStatus && <span className="text-[10px] font-bold shrink-0" style={{ color: statusColor }}>{STATUS_GLYPH[gitStatus]}</span>}
      </button>
      {isDir && isOpen && node.children?.map((child) => (
        <TreeRow key={child.path} node={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} palette={palette} expanded={expanded} onToggleDir={onToggleDir} status={status} />
      ))}
    </div>
  );
}
