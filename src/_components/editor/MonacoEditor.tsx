//? Thin wrappers around @monaco-editor/react that (a) force the locally-bundled monaco
//? (monacoSetup) and (b) register the shared theme set on mount so Monaco and the real
//? VS Code share themes. `MonacoEditor` = single file; `MonacoDiff` = read-only diff
//? (the "source control" diff view for editor #1). Both size to their container
//? (automaticLayout) so they stay mobile-responsive.
//?
//? eslint jsx-no-literals is disabled here: the only literals are two neutral
//? "Loading…" fallbacks — real editor content is user data, not hard-coded copy.

/* eslint-disable react/jsx-no-literals -- neutral loading fallbacks only */
import { Editor, DiffEditor, type OnMount, type OnChange, type BeforeMount } from '@monaco-editor/react';

import { ensureMonacoConfigured } from './monacoSetup';
import { defineMonacoThemes, type EditorThemeId } from './editorThemes';

//? Run once, at module import (this module is lazy-loaded by the editor surfaces).
ensureMonacoConfigured();

// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- `monaco` is the monaco-editor namespace (structurally matches defineMonacoThemes)
const registerThemes: BeforeMount = (monaco) => { defineMonacoThemes(monaco); };

const BASE_OPTIONS = {
  automaticLayout: true,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  fontSize: 13,
  lineHeight: 20,
  tabSize: 2,
  minimap: { enabled: true },
  fontLigatures: true,
  renderWhitespace: 'selection' as const,
  padding: { top: 8, bottom: 8 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

export interface MonacoEditorProps {
  value: string;
  language: string;
  theme: EditorThemeId;
  path?: string;
  readOnly?: boolean;
  minimap?: boolean;
  height?: string | number;
  onChange?: (value: string) => void;
  onMount?: OnMount;
}

export function MonacoEditor({ value, language, theme, path, readOnly, minimap = true, height = '100%', onChange, onMount }: MonacoEditorProps) {
  const handleChange: OnChange = (v) => { onChange?.(v ?? ''); };
  return (
    <Editor
      height={height}
      path={path}
      language={language}
      value={value}
      theme={theme}
      beforeMount={registerThemes}
      onMount={onMount}
      onChange={handleChange}
      options={{ ...BASE_OPTIONS, readOnly: readOnly ?? false, minimap: { enabled: minimap } }}
      loading={<div className="w-full h-full flex items-center justify-center text-sm text-muted">Loading editor…</div>}
    />
  );
}

export interface MonacoDiffProps {
  original: string;
  modified: string;
  language: string;
  theme: EditorThemeId;
  height?: string | number;
  renderSideBySide?: boolean;
}

export function MonacoDiff({ original, modified, language, theme, height = '100%', renderSideBySide = false }: MonacoDiffProps) {
  return (
    <DiffEditor
      height={height}
      language={language}
      original={original}
      modified={modified}
      theme={theme}
      beforeMount={registerThemes}
      options={{ ...BASE_OPTIONS, readOnly: true, renderSideBySide, minimap: { enabled: false }, renderOverviewRuler: false }}
      loading={<div className="w-full h-full flex items-center justify-center text-sm text-muted">Loading diff…</div>}
    />
  );
}
