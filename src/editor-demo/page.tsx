//? intent: Standalone demo + test harness for the two code editors (Monaco + real VS Code),
//? with a SHARED theme switcher so you can see the theme carry across both. Public/plain
//? (no auth, no workspaces provider) so it loads with only the Vite frontend — the fast path
//? for agent-browser testing while the container/backend infra is built.
//?
//? eslint disables: jsx-no-literals (demo/dev harness labels) + prefer-luckystack-dropdown
//? (intentional native select — the shared theme picker on a provider-free plain page).

/* eslint-disable react/jsx-no-literals -- demo/dev harness chrome */
/* eslint-disable luckystack/prefer-luckystack-dropdown -- native select on a provider-free plain page */
import { Suspense, lazy, useState } from 'react';

import { EDITOR_THEMES, loadThemeId, saveThemeId, getPalette, type EditorThemeId } from 'src/_components/editor/editorThemes';
import { SAMPLE_FILES, SAMPLE_CHANGES } from 'src/_components/editor/sampleWorkspace';

const CodeEditorPanel = lazy(() => import('src/_components/editor/CodeEditorPanel').then((m) => ({ default: m.CodeEditorPanel })));
const VsCodeEmbed = lazy(() => import('src/_components/editor/VsCodeEmbed').then((m) => ({ default: m.VsCodeEmbed })));

export const template = 'plain';

type Tab = 'monaco' | 'vscode';

export default function EditorDemo() {
  const [theme, setTheme] = useState<EditorThemeId>(() => loadThemeId(typeof globalThis !== 'undefined' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches));
  const [tab, setTab] = useState<Tab>('monaco');
  const palette = getPalette(theme);

  const changeTheme = (id: EditorThemeId): void => { setTheme(id); saveThemeId(id); };

  const tabBtn = (id: Tab, label: string): React.ReactElement => (
    <button
      type="button"
      data-testid={`tab-${id}`}
      onClick={() => { setTab(id); }}
      className="px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors"
      style={tab === id ? { background: palette.accent, color: '#fff' } : { color: palette.fg, background: 'transparent' }}
    >{label}</button>
  );

  return (
    <div className="flex flex-col h-screen w-full" style={{ background: palette.bg }} data-testid="editor-demo">
      <div className="flex items-center gap-3 px-3 md:px-4 h-12 shrink-0 border-b" style={{ borderColor: palette.border, background: palette.bgAlt, color: palette.fg }}>
        <span className="text-sm font-semibold hidden sm:inline" style={{ color: palette.fg }}>LuckyStack · Code Editors</span>
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: palette.bg }}>
          {tabBtn('monaco', 'Monaco')}
          {tabBtn('vscode', 'VS Code')}
        </div>
        <div className="flex-1" />
        <label htmlFor="theme-select" className="text-[12px] hidden md:inline" style={{ color: palette.comment }}>Shared theme</label>
        <select
          id="theme-select"
          value={theme}
          onChange={(e) => { changeTheme(e.target.value); }}
          data-testid="theme-select"
          className="text-[13px] rounded-md px-2 py-1.5 cursor-pointer outline-none border"
          style={{ background: palette.bg, color: palette.fg, borderColor: palette.border }}
        >
          {EDITOR_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      <div className="flex-1 min-h-0 p-2 md:p-3">
        <Suspense fallback={<div className="h-full flex items-center justify-center text-sm" style={{ color: palette.comment }}>Loading editor…</div>}>
          {tab === 'monaco' ? (
            <CodeEditorPanel files={SAMPLE_FILES} changes={SAMPLE_CHANGES} theme={theme} onThemeChange={changeTheme} showThemeSwitcher={false} title="Monaco Editor" />
          ) : (
            <VsCodeEmbed theme={theme} />
          )}
        </Suspense>
      </div>
    </div>
  );
}
