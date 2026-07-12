//? The full Monaco editor experience (editor #1): a VS-Code-shaped shell — activity bar
//? (Explorer / Source Control), a themed file tree, open-file tabs, the Monaco editor, a
//? read-only source-control DIFF view, and a status bar. Theme is controlled by the parent
//? (shared with the real VS Code editor). Fully responsive: on small screens the sidebar
//? collapses to an overlay drawer.
//?
//? eslint disables: jsx-no-literals (editor chrome uses standard VS Code labels/glyphs, not
//? translatable product copy — flagged for i18n review) and prefer-luckystack-dropdown (the
//? theme picker is intentionally a lightweight native <select> on this self-contained
//? editor surface, which the framework Dropdown's provider coupling would over-complicate).

/* eslint-disable react/jsx-no-literals -- editor-chrome labels/glyphs */
/* eslint-disable luckystack/prefer-luckystack-dropdown -- intentional native select on the standalone editor surface */
import { useMemo, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { MonacoEditor, MonacoDiff } from './MonacoEditor';
import { FileExplorer, type GitStatus } from './FileExplorer';
import { buildTree, allDirPaths, type EditorFile } from './fileTree';
import { languageForPath, langDefForPath } from './languages';
import { EDITOR_THEMES, getPalette, type EditorThemeId, type ThemePalette } from './editorThemes';

export interface EditorChange {
  path: string;
  status: GitStatus;
  original: string;
  modified: string;
}

export interface CodeEditorPanelProps {
  files: EditorFile[];
  changes?: EditorChange[];
  theme: EditorThemeId;
  onThemeChange?: (id: EditorThemeId) => void;
  readOnly?: boolean;
  showThemeSwitcher?: boolean;
  title?: string;
}

type View = 'files' | 'scm';

const NO_CHANGES: EditorChange[] = [];

function scmColor(status: GitStatus, palette: ThemePalette): string {
  if (status === 'deleted') return palette.removedFg;
  if (status === 'added') return palette.addedFg;
  return palette.attribute;
}

export function CodeEditorPanel({ files, changes = NO_CHANGES, theme, onThemeChange, readOnly, showThemeSwitcher = true, title }: CodeEditorPanelProps) {
  const translate = useTranslator();
  const palette = getPalette(theme);
  const [contents, setContents] = useState<Record<string, string>>(() => Object.fromEntries(files.map((f) => [f.path, f.content])));
  const paths = useMemo(() => Object.keys(contents), [contents]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allDirPaths(buildTree(paths))));
  const [openTabs, setOpenTabs] = useState<string[]>(() => (files[0] ? [files[0].path] : []));
  const [activePath, setActivePath] = useState<string | null>(files[0]?.path ?? null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>('files');
  const [scmPath, setScmPath] = useState<string | null>(changes[0]?.path ?? null);
  const [pos, setPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const statusMap = useMemo<Record<string, GitStatus>>(() => Object.fromEntries(changes.map((c) => [c.path, c.status])), [changes]);

  const toggleDir = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const open = (path: string): void => {
    setActivePath(path);
    setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
    setView('files');
    setDrawerOpen(false);
  };
  const closeTab = (path: string): void => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((t) => t !== path);
      if (activePath === path) setActivePath(next.at(-1) ?? null);
      return next;
    });
  };
  const edit = (path: string, value: string): void => {
    setContents((c) => ({ ...c, [path]: value }));
    setDirty((d) => new Set(d).add(path));
  };
  const selectScm = (path: string): void => { setScmPath(path); setDrawerOpen(false); };

  const activeChange = changes.find((c) => c.path === scmPath) ?? null;
  const activeLang = activePath ? languageForPath(activePath) : 'plaintext';

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden rounded-lg border" style={{ borderColor: palette.border, background: palette.bg, color: palette.fg }}>
      {/* Top bar */}
      <div className="flex items-center gap-2 px-2 h-9 shrink-0 border-b" style={{ borderColor: palette.border, background: palette.bgAlt }}>
        <button type="button" className="md:hidden px-2 py-1 rounded text-sm cursor-pointer" style={{ color: palette.fg }} onClick={() => { setDrawerOpen((o) => !o); }} aria-label="Toggle explorer">☰</button>
        <span className="text-[13px] font-medium truncate" style={{ color: palette.fg }}>{title ?? translate({ key: 'workspaces.editor.title' })}</span>
        <div className="flex-1" />
        {showThemeSwitcher && (
          <select
            value={theme}
            onChange={(e) => { onThemeChange?.(e.target.value); }}
            aria-label="Editor theme"
            className="text-[12px] rounded px-1.5 py-1 cursor-pointer outline-none border"
            style={{ background: palette.bg, color: palette.fg, borderColor: palette.border }}
          >
            {EDITOR_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Activity bar */}
        <div className="flex flex-col items-center gap-1 py-2 w-11 shrink-0 border-r" style={{ borderColor: palette.border, background: palette.bgAlt }}>
          <ActivityIcon glyph="📄" label={translate({ key: 'workspaces.editor.explorer' })} active={view === 'files'} palette={palette} onClick={() => { setView('files'); setDrawerOpen(true); }} />
          <ActivityIcon glyph="⑂" label={translate({ key: 'workspaces.editor.scm' })} active={view === 'scm'} palette={palette} badge={changes.length} onClick={() => { setView('scm'); setDrawerOpen(true); }} />
        </div>

        {/* Sidebar — inline on md+, overlay drawer on mobile */}
        <div
          className={`${drawerOpen ? 'absolute z-20 left-11 top-9 bottom-0 w-64 shadow-xl' : 'hidden'} md:relative md:left-0 md:top-0 md:block md:w-60 md:shadow-none shrink-0 border-r`}
          style={{ borderColor: palette.border }}
        >
          {view === 'files' ? (
            <FileExplorer tree={tree} activePath={activePath} onOpen={open} palette={palette} expanded={expanded} onToggleDir={toggleDir} status={statusMap} />
          ) : (
            <ScmPanel changes={changes} activePath={scmPath} onSelect={selectScm} palette={palette} />
          )}
        </div>

        {/* Main */}
        <div className="flex flex-col flex-1 min-w-0">
          {view === 'files' ? (
            <>
              <div className="flex items-stretch h-9 shrink-0 overflow-x-auto border-b" style={{ borderColor: palette.border, background: palette.bgAlt }}>
                {openTabs.map((path) => {
                  const isActive = path === activePath;
                  const { icon, color } = langDefForPath(path);
                  return (
                    <div
                      key={path}
                      className="flex items-center gap-1.5 px-3 text-[12px] cursor-pointer border-r shrink-0"
                      style={{ borderColor: palette.border, background: isActive ? palette.bg : 'transparent', color: isActive ? palette.fg : palette.comment }}
                      onClick={() => { setActivePath(path); }}
                    >
                      <span className="text-[10px] font-bold" style={{ color }}>{icon.length > 2 ? '•' : icon}</span>
                      <span className="truncate max-w-[8rem]">{path.split('/').at(-1)}</span>
                      {dirty.has(path) && <span style={{ color: palette.accent }}>●</span>}
                      <button type="button" className="ml-1 opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); closeTab(path); }}>×</button>
                    </div>
                  );
                })}
              </div>
              <div className="flex-1 min-h-0">
                {activePath ? (
                  <MonacoEditor
                    key={activePath}
                    path={activePath}
                    value={contents[activePath] ?? ''}
                    language={activeLang}
                    theme={theme}
                    readOnly={readOnly}
                    onChange={(v) => { edit(activePath, v); }}
                    onMount={(editor) => { editor.onDidChangeCursorPosition((e) => { setPos({ line: e.position.lineNumber, col: e.position.column }); }); }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm" style={{ color: palette.comment }}>{translate({ key: 'workspaces.editor.openFileHint' })}</div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-3 py-2 text-[12px] border-b shrink-0" style={{ borderColor: palette.border, color: palette.comment }}>
                {activeChange ? `${activeChange.path} — ${activeChange.status}` : translate({ key: 'workspaces.editor.noChangeSelected' })}
              </div>
              <div className="flex-1 min-h-0">
                {activeChange ? (
                  <MonacoDiff original={activeChange.original} modified={activeChange.modified} language={languageForPath(activeChange.path)} theme={theme} />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm" style={{ color: palette.comment }}>{translate({ key: 'workspaces.editor.noChanges' })}</div>
                )}
              </div>
            </div>
          )}

          {/* Status bar */}
          <div className="flex items-center gap-3 px-3 h-6 shrink-0 text-[11px] border-t" style={{ borderColor: palette.border, background: palette.accent, color: palette.type === 'dark' ? '#0b0d12' : '#ffffff' }}>
            <span>{view === 'files' ? langDefForPath(activePath ?? '').label : translate({ key: 'workspaces.editor.scm' })}</span>
            {view === 'files' && <span>Ln {pos.line}, Col {pos.col}</span>}
            <div className="flex-1" />
            <span>{getPalette(theme).label}</span>
            {dirty.size > 0 && <span>● {translate({ key: 'workspaces.editor.unsavedCount', params: [{ key: 'n', value: String(dirty.size) }] })}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityIcon({ glyph, label, active, palette, onClick, badge }: { glyph: string; label: string; active: boolean; palette: ThemePalette; onClick: () => void; badge?: number }) {
  return (
    <button type="button" title={label} onClick={onClick} className="relative w-9 h-9 flex items-center justify-center rounded cursor-pointer text-base" style={{ background: active ? palette.selection : 'transparent', opacity: active ? 1 : 0.65 }}>
      {glyph}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: palette.accent, color: '#fff' }}>{badge}</span>
      )}
    </button>
  );
}

function ScmPanel({ changes, activePath, onSelect, palette }: { changes: EditorChange[]; activePath: string | null; onSelect: (p: string) => void; palette: ThemePalette }) {
  const translate = useTranslator();
  const glyph: Record<GitStatus, string> = { modified: 'M', added: 'A', deleted: 'D' };
  return (
    <div className="h-full overflow-y-auto py-1 text-[13px]" style={{ background: palette.bgAlt, color: palette.fg }}>
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide" style={{ color: palette.comment }}>{translate({ key: 'workspaces.editor.scm' })} · {changes.length}</div>
      {changes.length === 0 && <div className="px-3 py-2 text-[12px]" style={{ color: palette.comment }}>{translate({ key: 'workspaces.editor.noChanges' })}</div>}
      {changes.map((c) => {
        const color = scmColor(c.status, palette);
        return (
          <button key={c.path} type="button" onClick={() => { onSelect(c.path); }} className="w-full flex items-center gap-2 px-3 py-[3px] text-left cursor-pointer" style={{ background: activePath === c.path ? palette.selection : 'transparent' }}>
            <span className="truncate flex-1" style={{ color }}>{c.path.split('/').at(-1)}</span>
            <span className="text-[10px]" style={{ color: palette.comment }}>{c.path.split('/').slice(0, -1).join('/')}</span>
            <span className="text-[11px] font-bold" style={{ color }}>{glyph[c.status]}</span>
          </button>
        );
      })}
    </div>
  );
}
