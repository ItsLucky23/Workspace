//? Shared editor theme registry — ONE source of truth consumed by BOTH editors:
//?  - Monaco (editor #1) via `defineMonacoThemes(monaco)` + `monaco.editor.setTheme(id)`.
//?  - openvscode-server / real VS Code (editor #2) via `vscodeColorCustomizations(id)`,
//?    which the orchestrator writes into the session's settings.json so the two editors
//?    render the same colors. The user's selected theme id is persisted (localStorage +,
//?    later, their account) so it follows them across workspaces and across both editors.
//?
//? A theme is a compact PALETTE; the two generators below expand it into (a) Monaco's
//? token-rules + UI colors and (b) VS Code's `workbench.colorCustomizations` +
//? `editor.tokenColorCustomizations`. Add a theme = add one palette entry.

import type { editor } from 'monaco-editor';

export type EditorThemeType = 'light' | 'dark';

//? One palette drives an entire theme. Hex values only (no `#` omitted).
export interface ThemePalette {
  id: string;
  label: string;
  type: EditorThemeType;
  //? Surfaces
  bg: string;          // editor background
  bgAlt: string;       // side panels / gutter
  fg: string;          // default foreground
  selection: string;   // selection background
  lineHighlight: string;
  cursor: string;
  //? Syntax
  comment: string;
  keyword: string;
  string: string;
  number: string;
  func: string;        // function names
  typeColor: string;   // types / classes
  variable: string;
  constant: string;
  operator: string;
  tag: string;         // html/jsx tags
  attribute: string;
  //? UI accents
  accent: string;      // active border / focus
  border: string;
  addedFg: string;     // git added
  removedFg: string;   // git removed
}

//? The default theme SET — a light + dark house pair plus three popular-style options,
//? so "multiple themes + a default set" is satisfied out of the box.
export const EDITOR_THEMES: [ThemePalette, ...ThemePalette[]] = [
  {
    id: 'luckystack-dark', label: 'LuckyStack Dark', type: 'dark',
    bg: '#0f1117', bgAlt: '#0b0d12', fg: '#c8ccd4', selection: '#2a3350', lineHighlight: '#161a23', cursor: '#7aa2f7',
    comment: '#5c6370', keyword: '#7aa2f7', string: '#9ece6a', number: '#e0af68', func: '#7dcfff', typeColor: '#2ac3de',
    variable: '#c8ccd4', constant: '#ff9e64', operator: '#89ddff', tag: '#f7768e', attribute: '#e0af68',
    accent: '#7aa2f7', border: '#1b2130', addedFg: '#9ece6a', removedFg: '#f7768e',
  },
  {
    id: 'luckystack-light', label: 'LuckyStack Light', type: 'light',
    bg: '#ffffff', bgAlt: '#f6f7f9', fg: '#24292f', selection: '#cfe3ff', lineHighlight: '#f2f4f8', cursor: '#0969da',
    comment: '#8b949e', keyword: '#cf222e', string: '#0a3069', number: '#0550ae', func: '#8250df', typeColor: '#953800',
    variable: '#24292f', constant: '#0550ae', operator: '#0969da', tag: '#116329', attribute: '#0550ae',
    accent: '#0969da', border: '#e4e7ec', addedFg: '#1a7f37', removedFg: '#cf222e',
  },
  {
    id: 'midnight', label: 'Midnight', type: 'dark',
    bg: '#0b0f1a', bgAlt: '#070a12', fg: '#d6deeb', selection: '#1d3b53', lineHighlight: '#0e1422', cursor: '#80a4c2',
    comment: '#637777', keyword: '#c792ea', string: '#addb67', number: '#f78c6c', func: '#82aaff', typeColor: '#ffcb8b',
    variable: '#d6deeb', constant: '#f78c6c', operator: '#7fdbca', tag: '#7fdbca', attribute: '#ffcb8b',
    accent: '#82aaff', border: '#122033', addedFg: '#addb67', removedFg: '#ef5350',
  },
  {
    id: 'solar-dark', label: 'Solar Dark', type: 'dark',
    bg: '#002b36', bgAlt: '#00212b', fg: '#93a1a1', selection: '#073642', lineHighlight: '#01323d', cursor: '#93a1a1',
    comment: '#586e75', keyword: '#859900', string: '#2aa198', number: '#d33682', func: '#268bd2', typeColor: '#b58900',
    variable: '#93a1a1', constant: '#cb4b16', operator: '#6c71c4', tag: '#268bd2', attribute: '#b58900',
    accent: '#268bd2', border: '#073642', addedFg: '#859900', removedFg: '#dc322f',
  },
  {
    id: 'github-light', label: 'GitHub Light', type: 'light',
    bg: '#ffffff', bgAlt: '#f6f8fa', fg: '#1f2328', selection: '#b6e3ff', lineHighlight: '#f6f8fa', cursor: '#0969da',
    comment: '#6e7781', keyword: '#cf222e', string: '#0a3069', number: '#0550ae', func: '#6639ba', typeColor: '#953800',
    variable: '#1f2328', constant: '#0550ae', operator: '#0550ae', tag: '#116329', attribute: '#0550ae',
    accent: '#0969da', border: '#d0d7de', addedFg: '#1a7f37', removedFg: '#cf222e',
  },
];

export type EditorThemeId = string;
export const DEFAULT_DARK_THEME = 'luckystack-dark';
export const DEFAULT_LIGHT_THEME = 'luckystack-light';

export function getPalette(id: EditorThemeId): ThemePalette {
  return EDITOR_THEMES.find((t) => t.id === id) ?? EDITOR_THEMES[0];
}

const strip = (hex: string): string => hex.replace('#', '');

//? Monaco token rules for a palette. `token` names follow Monaco's TextMate-ish scopes.
function monacoRules(p: ThemePalette): editor.ITokenThemeRule[] {
  return [
    { token: 'comment', foreground: strip(p.comment), fontStyle: 'italic' },
    { token: 'keyword', foreground: strip(p.keyword) },
    { token: 'keyword.control', foreground: strip(p.keyword) },
    { token: 'string', foreground: strip(p.string) },
    { token: 'string.escape', foreground: strip(p.operator) },
    { token: 'number', foreground: strip(p.number) },
    { token: 'regexp', foreground: strip(p.string) },
    { token: 'type', foreground: strip(p.typeColor) },
    { token: 'type.identifier', foreground: strip(p.typeColor) },
    { token: 'namespace', foreground: strip(p.typeColor) },
    { token: 'identifier', foreground: strip(p.variable) },
    { token: 'function', foreground: strip(p.func) },
    { token: 'entity.name.function', foreground: strip(p.func) },
    { token: 'variable', foreground: strip(p.variable) },
    { token: 'variable.predefined', foreground: strip(p.constant) },
    { token: 'constant', foreground: strip(p.constant) },
    { token: 'operator', foreground: strip(p.operator) },
    { token: 'delimiter', foreground: strip(p.fg) },
    { token: 'tag', foreground: strip(p.tag) },
    { token: 'metatag', foreground: strip(p.tag) },
    { token: 'attribute.name', foreground: strip(p.attribute) },
    { token: 'attribute.value', foreground: strip(p.string) },
    { token: 'key', foreground: strip(p.tag) },
    { token: 'string.key.json', foreground: strip(p.tag) },
    { token: 'string.value.json', foreground: strip(p.string) },
  ];
}

//? Monaco editor UI colors for a palette.
function monacoColors(p: ThemePalette): Record<string, string> {
  return {
    'editor.background': p.bg,
    'editor.foreground': p.fg,
    'editorLineNumber.foreground': p.comment,
    'editorLineNumber.activeForeground': p.fg,
    'editor.selectionBackground': p.selection,
    'editor.lineHighlightBackground': p.lineHighlight,
    'editorCursor.foreground': p.cursor,
    'editorWhitespace.foreground': p.border,
    'editorIndentGuide.background1': p.border,
    'editorGutter.addedBackground': p.addedFg,
    'editorGutter.deletedBackground': p.removedFg,
    'diffEditor.insertedTextBackground': `${p.addedFg}22`,
    'diffEditor.removedTextBackground': `${p.removedFg}22`,
    'editorWidget.background': p.bgAlt,
    'editorWidget.border': p.border,
    'input.background': p.bgAlt,
    'focusBorder': p.accent,
  };
}

export function toMonacoTheme(p: ThemePalette): editor.IStandaloneThemeData {
  return {
    base: p.type === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: monacoRules(p),
    colors: monacoColors(p),
  };
}

//? Register EVERY theme with a Monaco instance (idempotent; safe to call per mount).
//? `monaco` is typed loosely to avoid importing the full editor namespace at call sites.
export function defineMonacoThemes(monaco: { editor: { defineTheme: (id: string, data: editor.IStandaloneThemeData) => void } }): void {
  for (const p of EDITOR_THEMES) monaco.editor.defineTheme(p.id, toMonacoTheme(p));
}

//? The SAME palette expanded into VS Code / openvscode-server settings. The orchestrator
//? writes this into the editor session's settings.json (workbench.colorCustomizations +
//? editor.tokenColorCustomizations) so the real VS Code matches the Monaco theme.
export function vscodeColorCustomizations(id: EditorThemeId): {
  'workbench.colorCustomizations': Record<string, string>;
  'editor.tokenColorCustomizations': { textMateRules: { scope: string | string[]; settings: { foreground?: string; fontStyle?: string } }[] };
} {
  const p = getPalette(id);
  return {
    'workbench.colorCustomizations': {
      'editor.background': p.bg,
      'editor.foreground': p.fg,
      'editor.selectionBackground': p.selection,
      'editor.lineHighlightBackground': p.lineHighlight,
      'editorCursor.foreground': p.cursor,
      'sideBar.background': p.bgAlt,
      'activityBar.background': p.bgAlt,
      'editorLineNumber.foreground': p.comment,
      'focusBorder': p.accent,
      'gitDecoration.addedResourceForeground': p.addedFg,
      'gitDecoration.deletedResourceForeground': p.removedFg,
    },
    'editor.tokenColorCustomizations': {
      textMateRules: [
        { scope: ['comment'], settings: { foreground: p.comment, fontStyle: 'italic' } },
        { scope: ['keyword', 'storage.type', 'keyword.control'], settings: { foreground: p.keyword } },
        { scope: ['string'], settings: { foreground: p.string } },
        { scope: ['constant.numeric'], settings: { foreground: p.number } },
        { scope: ['entity.name.function', 'support.function'], settings: { foreground: p.func } },
        { scope: ['entity.name.type', 'support.type', 'support.class'], settings: { foreground: p.typeColor } },
        { scope: ['variable'], settings: { foreground: p.variable } },
        { scope: ['constant.language'], settings: { foreground: p.constant } },
        { scope: ['entity.name.tag'], settings: { foreground: p.tag } },
        { scope: ['entity.other.attribute-name'], settings: { foreground: p.attribute } },
      ],
    },
  };
}

//? Cross-editor theme persistence (client). The account-linked version (Track E) mirrors
//? this to the user profile so it also crosses workspaces + devices.
const THEME_KEY = 'ls.editor.theme';
export function loadThemeId(prefersDark: boolean): EditorThemeId {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && EDITOR_THEMES.some((t) => t.id === saved)) return saved;
  }
  return prefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
}
export function saveThemeId(id: EditorThemeId): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, id);
}
