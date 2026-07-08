//? Designer — shared state for the whole tool (themes + styles + animations). The Designer grew
//? from a single component list into a broad visual editor with several sections (Components /
//? Styles / Animations / Themes / Typography), all previewing under the SAME active theme + style,
//? so their selection lives here in one context instead of being prop-drilled through every section.
//? Every library (themes/styles/anims) is client-held: seeds now + AI-generated + user edits; each
//? item can be renamed, duplicated and (for non-seeds) removed. Persistence lands in a later phase.

/* eslint-disable react-refresh/only-export-components -- context module: the useDesigner hook is co-exported with the DesignerProvider by design (dev-only fast-refresh rule) */
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

import { apiRequest, tryCatch } from '@luckystack/core/client';

import { useWorkspaces } from '../_shell/WorkspacesContext';
import {
  COLOR_TOKENS, LUCKYSTACK_THEME, SEED_THEMES, blankTheme,
  type ColorToken, type DesignTheme, type ThemeMode, type ThemeSource, type ThemeTokens,
} from './themes';
import { APPLE_STYLE, SEED_STYLES, blankStyle, coerceStyle, type DesignStyle } from './styles';
import { FADE_ANIM, SEED_ANIMS, blankAnim, coerceAnim, type AnimSpec } from './animations';
import { parsePersistedLibraries } from './persisted';

//? A stable, collision-free client id (no Date.now/Math.random needed — a monotonic counter is
//? enough for client-only library items).
let idSeq = 0;
function nextId(prefix: string): string { idSeq += 1; return `${prefix}-${String(idSeq)}`; }

function coerceTokens(raw: unknown, base: ThemeTokens): ThemeTokens {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...base };
  for (const t of COLOR_TOKENS) { const v = obj[t]; if (typeof v === 'string' && v.trim().length > 0) out[t] = v.trim(); }
  return out;
}

export interface DesignerCtx {
  // ---- themes ----
  themes: DesignTheme[];
  activeThemeId: string;
  setActiveThemeId: (id: string) => void;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  activeTheme: DesignTheme;
  tokens: ThemeTokens;                    // active theme + mode
  addTheme: () => void;
  duplicateTheme: (id: string) => void;
  renameTheme: (id: string, name: string) => void;
  removeTheme: (id: string) => void;
  setToken: (token: ColorToken, value: string) => void;
  applyTokens: (light: ThemeTokens, dark: ThemeTokens) => void;   // bulk (derive/import)
  importTheme: (name: string, light: ThemeTokens, dark: ThemeTokens) => void;
  generateTheme: (prompt: string) => Promise<boolean>;            // AI

  // ---- styles ----
  styles: DesignStyle[];
  activeStyleId: string;
  setActiveStyleId: (id: string) => void;
  activeStyle: DesignStyle;
  addStyle: () => void;
  duplicateStyle: (id: string) => void;
  renameStyle: (id: string, name: string) => void;
  removeStyle: (id: string) => void;
  setStyle: (patch: Partial<DesignStyle>) => void;
  generateStyle: (prompt: string) => Promise<boolean>;    // AI

  // ---- animations ----
  anims: AnimSpec[];
  activeAnimId: string;
  setActiveAnimId: (id: string) => void;
  activeAnim: AnimSpec;
  addAnim: () => void;
  duplicateAnim: (id: string) => void;
  renameAnim: (id: string, name: string) => void;
  removeAnim: (id: string) => void;
  setAnim: (patch: Partial<AnimSpec>) => void;
  generateAnimation: (prompt: string) => Promise<boolean>;    // AI

  // ---- pipeline coupling (ADR 0034): the workspace's ACTIVE theme/style + a "use in project" action ----
  activeThemeName: string | null;
  activeStyleName: string | null;
  useInProject: (kind: 'theme' | 'style') => Promise<boolean>;
}

const Ctx = createContext<DesignerCtx | null>(null);
export function useDesigner(): DesignerCtx {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('useDesigner must be used within <DesignerProvider>');
  return ctx;
}

export function DesignerProvider({ children }: { children: ReactNode }) {
  const { activeWorkspace, refetch, designArtifacts } = useWorkspaces();
  const activeThemeName = designArtifacts.find((d) => d.kind === 'theme' && d.active)?.name ?? null;
  const activeStyleName = designArtifacts.find((d) => d.kind === 'style' && d.active)?.name ?? null;

  const [themes, setThemes] = useState<DesignTheme[]>(SEED_THEMES);
  const [activeThemeId, setActiveThemeId] = useState(LUCKYSTACK_THEME.id);
  const [mode, setMode] = useState<ThemeMode>('light');

  const [styles, setStyles] = useState<DesignStyle[]>(SEED_STYLES);
  const [activeStyleId, setActiveStyleId] = useState(APPLE_STYLE.id);

  const [anims, setAnims] = useState<AnimSpec[]>(SEED_ANIMS);
  const [activeAnimId, setActiveAnimId] = useState(FADE_ANIM.id);

  //? L2 — round-trip: merge the PERSISTED design artifacts (from the snapshot) into the libraries, so a
  //? saved theme/style/anim reappears on reload + right after saving (was seed-only, one-directional). Append
  //? by id (idempotent), never clobbering unsaved local edits.
  useEffect(() => {
    const parsed = parsePersistedLibraries(designArtifacts);
    const mergeById = <T extends { id: string }>(prev: T[], add: T[]): T[] => {
      const fresh = add.filter((p) => !prev.some((x) => x.id === p.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    };
    setThemes((prev) => mergeById(prev, parsed.themes));
    setStyles((prev) => mergeById(prev, parsed.styles));
    setAnims((prev) => mergeById(prev, parsed.anims));
  }, [designArtifacts]);

  const ctx = useMemo<DesignerCtx>(() => {
    const activeTheme = themes.find((t) => t.id === activeThemeId) ?? LUCKYSTACK_THEME;
    const activeStyle = styles.find((s) => s.id === activeStyleId) ?? APPLE_STYLE;
    const activeAnim = anims.find((a) => a.id === activeAnimId) ?? FADE_ANIM;

    const editTheme = (id: string, fn: (t: DesignTheme) => DesignTheme) => { setThemes((prev) => prev.map((t) => (t.id === id ? fn(t) : t))); };

    return {
      themes, activeThemeId, setActiveThemeId, mode, setMode, activeTheme, tokens: activeTheme[mode],
      addTheme: () => { const t = blankTheme(nextId('theme'), `Custom ${String(themes.filter((x) => x.source === 'manual').length + 1)}`); setThemes((p) => [...p, t]); setActiveThemeId(t.id); },
      duplicateTheme: (id) => { const src = themes.find((t) => t.id === id) ?? activeTheme; const t: DesignTheme = { ...src, id: nextId('theme'), name: `${src.name} copy`, source: 'manual', light: { ...src.light }, dark: { ...src.dark } }; setThemes((p) => [...p, t]); setActiveThemeId(t.id); },
      renameTheme: (id, name) => { editTheme(id, (t) => ({ ...t, name })); },
      removeTheme: (id) => { setThemes((p) => p.filter((t) => t.id !== id)); if (activeThemeId === id) setActiveThemeId(LUCKYSTACK_THEME.id); },
      setToken: (token, value) => { editTheme(activeThemeId, (t) => { const src: ThemeSource = t.source === 'seed' ? 'seed' : 'manual'; const next: ThemeTokens = { ...t[mode], [token]: value }; return mode === 'light' ? { ...t, source: src, light: next } : { ...t, source: src, dark: next }; }); },
      applyTokens: (light, dark) => { editTheme(activeThemeId, (t) => ({ ...t, source: t.source === 'seed' ? 'seed' : 'manual', light, dark })); },
      importTheme: (name, light, dark) => { const t: DesignTheme = { id: nextId('theme'), name, description: 'Imported', source: 'manual', light, dark }; setThemes((p) => [...p, t]); setActiveThemeId(t.id); },
      generateTheme: async (prompt) => {
        const workspaceId = activeWorkspace.id;
        if (!workspaceId || prompt.trim().length === 0) return false;
        const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/designerGenerateTheme', version: 'v1', data: { workspaceId, prompt: prompt.trim() } }));
        if (error || res?.status !== 'success') return false;
        const r = res.result;
        const t: DesignTheme = { id: nextId('ai-theme'), name: r.name || 'AI theme', description: r.description, source: 'ai', light: coerceTokens(r.light, LUCKYSTACK_THEME.light), dark: coerceTokens(r.dark, LUCKYSTACK_THEME.dark) };
        setThemes((p) => [...p, t]); setActiveThemeId(t.id);
        refetch(); //? so the new run shows in the AI-activity feed (snapshot-backed)
        return true;
      },

      styles, activeStyleId, setActiveStyleId, activeStyle,
      addStyle: () => { const s = blankStyle(nextId('style'), `Custom ${String(styles.filter((x) => x.source === 'manual').length + 1)}`); setStyles((p) => [...p, s]); setActiveStyleId(s.id); },
      duplicateStyle: (id) => { const src = styles.find((s) => s.id === id) ?? activeStyle; const s: DesignStyle = { ...src, id: nextId('style'), name: `${src.name} copy`, source: 'manual' }; setStyles((p) => [...p, s]); setActiveStyleId(s.id); },
      renameStyle: (id, name) => { setStyles((p) => p.map((s) => (s.id === id ? { ...s, name } : s))); },
      removeStyle: (id) => { setStyles((p) => p.filter((s) => s.id !== id)); if (activeStyleId === id) setActiveStyleId(APPLE_STYLE.id); },
      setStyle: (patch) => { setStyles((p) => p.map((s) => (s.id === activeStyleId ? { ...s, ...patch, source: s.source === 'seed' ? 'seed' : 'manual' } : s))); },
      generateStyle: async (prompt) => {
        const workspaceId = activeWorkspace.id;
        if (!workspaceId || prompt.trim().length === 0) return false;
        const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/designerGenerateAsset', version: 'v1', data: { workspaceId, kind: 'style', prompt: prompt.trim() } }));
        if (error || res?.status !== 'success') return false;
        const s = coerceStyle(res.result.asset, nextId('ai-style'));
        setStyles((p) => [...p, s]); setActiveStyleId(s.id);
        refetch();
        return true;
      },

      anims, activeAnimId, setActiveAnimId, activeAnim,
      addAnim: () => { const a = blankAnim(nextId('anim'), `Custom ${String(anims.filter((x) => x.source === 'manual').length + 1)}`); setAnims((p) => [...p, a]); setActiveAnimId(a.id); },
      duplicateAnim: (id) => { const src = anims.find((a) => a.id === id) ?? activeAnim; const a: AnimSpec = { ...src, id: nextId('anim'), name: `${src.name} copy`, source: 'manual' }; setAnims((p) => [...p, a]); setActiveAnimId(a.id); },
      renameAnim: (id, name) => { setAnims((p) => p.map((a) => (a.id === id ? { ...a, name } : a))); },
      removeAnim: (id) => { setAnims((p) => p.filter((a) => a.id !== id)); if (activeAnimId === id) setActiveAnimId(FADE_ANIM.id); },
      setAnim: (patch) => { setAnims((p) => p.map((a) => (a.id === activeAnimId ? { ...a, ...patch, source: a.source === 'seed' ? 'seed' : 'manual' } : a))); },
      activeThemeName, activeStyleName,
      useInProject: async (kind) => {
        const workspaceId = activeWorkspace.id;
        if (!workspaceId) return false;
        let artifact: { kind: string; name: string; description: string; content: unknown; source: string } | null = null;
        if (kind === 'theme') {
          const t = themes.find((x) => x.id === activeThemeId);
          if (t) artifact = { kind: 'theme', name: t.name, description: t.description, content: { light: t.light, dark: t.dark }, source: t.source };
        } else {
          const s = styles.find((x) => x.id === activeStyleId);
          if (s) artifact = { kind: 'style', name: s.name, description: s.description, content: s, source: s.source };
        }
        if (!artifact) return false;
        const [e1, saved] = await tryCatch(() => apiRequest({ name: 'workspaces/designerLibrary', version: 'v1', data: { workspaceId, op: 'save', artifact } }));
        if (e1 || saved?.status !== 'success') return false;
        const id = saved.result.id;
        if (!id) return false;
        const [e2, act] = await tryCatch(() => apiRequest({ name: 'workspaces/designerLibrary', version: 'v1', data: { workspaceId, op: 'setActive', artifactId: id } }));
        if (e2 || act?.status !== 'success') return false;
        refetch();
        return true;
      },
      generateAnimation: async (prompt) => {
        const workspaceId = activeWorkspace.id;
        if (!workspaceId || prompt.trim().length === 0) return false;
        const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/designerGenerateAsset', version: 'v1', data: { workspaceId, kind: 'animation', prompt: prompt.trim() } }));
        if (error || res?.status !== 'success') return false;
        const a = coerceAnim(res.result.asset, nextId('ai-anim'));
        setAnims((p) => [...p, a]); setActiveAnimId(a.id);
        refetch();
        return true;
      },
    };
  }, [themes, activeThemeId, mode, styles, activeStyleId, anims, activeAnimId, activeWorkspace.id, refetch, activeThemeName, activeStyleName]);

  return <Ctx value={ctx}>{children}</Ctx>;
}
