//? Designer — the theme model. A THEME is a complete set of the app's `--color-*`
//? design tokens (the same 30 roles defined in `src/index.css`), in a light AND a dark
//? variant. Rendering the component gallery inside `<div style={themeVars(tokens)}>`
//? overrides those CSS variables for everything inside — and because every Tailwind
//? token utility (`bg-primary`, `text-muted`, …) reads `var(--color-*)`, the whole
//? subtree re-themes with zero `.dark`-class juggling. This is the substrate the
//? gallery previews on and the AI theme-generator writes into.

import type { CSSProperties } from 'react';

//? The 30 token roles, in `src/index.css` display order. The single source of truth for
//? "which tokens make up a theme" — the editor, the preview and the AI generator all key off it.
export const COLOR_TOKENS = [
  'background',
  'container1', 'container1-hover', 'container1-border',
  'container2', 'container2-hover', 'container2-border',
  'title', 'common', 'muted', 'disabled',
  'overlay', 'focus-ring', 'divider',
  'title-primary', 'common-primary', 'title-secondary', 'common-secondary',
  'primary', 'primary-hover', 'primary-border',
  'secondary', 'secondary-hover', 'secondary-border',
  'correct', 'correct-hover', 'warning', 'warning-hover', 'wrong', 'wrong-hover',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemeTokens = Record<ColorToken, string>;

//? Human-readable groups for the token editor (so 30 fields aren't one flat wall).
export const TOKEN_GROUPS: { key: string; label: string; tokens: ColorToken[] }[] = [
  { key: 'accent', label: 'Accent', tokens: ['primary', 'primary-hover', 'primary-border', 'secondary', 'secondary-hover', 'secondary-border', 'focus-ring'] },
  { key: 'onAccent', label: 'Text on accent', tokens: ['title-primary', 'common-primary', 'title-secondary', 'common-secondary'] },
  { key: 'surface', label: 'Surfaces', tokens: ['background', 'container1', 'container1-hover', 'container1-border', 'container2', 'container2-hover', 'container2-border', 'divider', 'overlay'] },
  { key: 'text', label: 'Text', tokens: ['title', 'common', 'muted', 'disabled'] },
  { key: 'semantic', label: 'Semantic', tokens: ['correct', 'correct-hover', 'warning', 'warning-hover', 'wrong', 'wrong-hover'] },
];

export type ThemeSource = 'seed' | 'ai' | 'manual';
export interface DesignTheme {
  id: string;
  name: string;
  description: string;
  source: ThemeSource;
  light: ThemeTokens;
  dark: ThemeTokens;
}

export type ThemeMode = 'light' | 'dark';

//? Inline CSS-variable style for a token set. Typed as `CSSProperties` intersected with
//? the `--*` custom-property record so the `--color-…` keys are valid WITHOUT a cast
//? (Rule 21: no `as any` / `as unknown as`). Spread onto any wrapper to re-theme its subtree.
export function themeVars(tokens: ThemeTokens): CSSProperties {
  const vars: Record<`--${string}`, string> = {};
  for (const token of COLOR_TOKENS) vars[`--color-${token}`] = tokens[token];
  return vars;
}

//? ---- composer: neutrals + shared semantic + a per-theme accent block ----
//? Only the accent/on-accent/focus roles (and optional neutral tints) change between
//? themes; the semantic feedback colours stay constant (a theme must never make an error
//? state read as "on brand"). Keeps each seed theme a few readable lines, not 30 hexes.
type NeutralKey = 'background' | 'container1' | 'container1-hover' | 'container1-border' | 'container2' | 'container2-hover' | 'container2-border' | 'title' | 'common' | 'muted' | 'disabled' | 'overlay' | 'divider';
type AccentKey = 'primary' | 'primary-hover' | 'primary-border' | 'secondary' | 'secondary-hover' | 'secondary-border' | 'focus-ring' | 'title-primary' | 'common-primary' | 'title-secondary' | 'common-secondary';
type SemanticKey = 'correct' | 'correct-hover' | 'warning' | 'warning-hover' | 'wrong' | 'wrong-hover';

type Neutral = Pick<ThemeTokens, NeutralKey>;
type Accent = Pick<ThemeTokens, AccentKey>;

const SEMANTIC: Pick<ThemeTokens, SemanticKey> = {
  correct: 'oklch(72.3% 0.219 149.579)', 'correct-hover': 'oklch(62.7% 0.194 149.214)',
  warning: 'oklch(79.5% 0.184 86.047)', 'warning-hover': 'oklch(68.1% 0.162 75.834)',
  wrong: 'oklch(63.7% 0.237 25.331)', 'wrong-hover': 'oklch(57.7% 0.245 27.325)',
};

const NEUTRAL_LIGHT: Neutral = {
  background: '#F5F5F5',
  container1: '#FFFFFF', 'container1-hover': '#F9F9F9', 'container1-border': '#E5E5E5',
  container2: '#EFEFEF', 'container2-hover': '#E5E5E5', 'container2-border': '#DCDCDC',
  title: '#1E1F21', common: '#454648', muted: '#6B7280', disabled: '#9CA3AF',
  overlay: 'rgba(15, 23, 42, 0.45)', divider: '#E5E7EB',
};
const NEUTRAL_DARK: Neutral = {
  background: '#0B0F19',
  container1: '#111827', 'container1-hover': '#1E293B', 'container1-border': '#1E293B',
  container2: '#1E293B', 'container2-hover': '#334155', 'container2-border': '#334155',
  title: '#F1F5F9', common: '#CBD5E1', muted: '#94A3B8', disabled: '#475569',
  overlay: 'rgba(0, 0, 0, 0.6)', divider: '#1E293B',
};

//? Warm-tinted neutrals for the Sunset theme (a real theme shifts the whole feel, not just
//? the accent) — kept AA-contrast against the same text tokens.
const NEUTRAL_WARM_LIGHT: Neutral = {
  ...NEUTRAL_LIGHT,
  background: '#FBF7F2', container1: '#FFFFFF', 'container1-hover': '#FBF6F0', 'container1-border': '#EFE4D8',
  container2: '#F4EBE0', 'container2-hover': '#EADDCD', 'container2-border': '#E4D6C4', divider: '#EFE1D2',
};
const NEUTRAL_WARM_DARK: Neutral = {
  ...NEUTRAL_DARK,
  background: '#17120E', container1: '#221A13', 'container1-hover': '#2E241A', 'container1-border': '#2E241A',
  container2: '#2E241A', 'container2-hover': '#3D2F21', 'container2-border': '#3D2F21', divider: '#2E241A',
};

//? Cool-slate neutrals for Violet.
const NEUTRAL_COOL_LIGHT: Neutral = {
  ...NEUTRAL_LIGHT,
  background: '#F6F5FA', container2: '#EDEBF4', 'container2-hover': '#E3E0EF', 'container2-border': '#DDD9EC', divider: '#E7E4F1',
};
const NEUTRAL_COOL_DARK: Neutral = {
  ...NEUTRAL_DARK,
  background: '#0C0A16', container1: '#151327', 'container1-hover': '#211D3B', 'container1-border': '#211D3B',
  container2: '#211D3B', 'container2-hover': '#332C55', 'container2-border': '#332C55', divider: '#211D3B',
};

function accent(primary: string, hover: string, border: string, onCommon: string, focus: string): Accent {
  return {
    primary, 'primary-hover': hover, 'primary-border': border,
    secondary: primary, 'secondary-hover': hover, 'secondary-border': border,
    'focus-ring': focus,
    'title-primary': '#FFFFFF', 'common-primary': onCommon,
    'title-secondary': '#FFFFFF', 'common-secondary': onCommon,
  };
}

function makeTheme(id: string, name: string, description: string, source: ThemeSource, nLight: Neutral, nDark: Neutral, aLight: Accent, aDark: Accent): DesignTheme {
  return {
    id, name, description, source,
    light: { ...nLight, ...SEMANTIC, ...aLight },
    dark: { ...nDark, ...SEMANTIC, ...aDark },
  };
}

//? ---- the seed themes (the "we hebben meerdere themes" starting library) ----
//? LuckyStack is a named const so `[0]`-style access (blocked by noUncheckedIndexedAccess)
//? is never needed for the guaranteed-present default.
export const LUCKYSTACK_THEME: DesignTheme = makeTheme(
  'luckystack', 'LuckyStack', 'The default blue. What the whole app ships with today.', 'seed',
  NEUTRAL_LIGHT, NEUTRAL_DARK,
  accent('#3B82F6', '#2563EB', '#1D4ED8', '#DBEAFE', '#3B82F6'),
  accent('#3B82F6', '#60A5FA', '#1E40AF', '#DBEAFE', '#60A5FA'),
);

export const SEED_THEMES: DesignTheme[] = [
  LUCKYSTACK_THEME,
  makeTheme(
    'emerald', 'Emerald', 'A calm, confident green — good for tools and dashboards.', 'seed',
    NEUTRAL_LIGHT, NEUTRAL_DARK,
    accent('#059669', '#047857', '#065F46', '#D1FAE5', '#10B981'),
    accent('#10B981', '#34D399', '#065F46', '#D1FAE5', '#34D399'),
  ),
  makeTheme(
    'violet', 'Violet', 'A modern purple on cool-slate surfaces — premium, creative.', 'seed',
    NEUTRAL_COOL_LIGHT, NEUTRAL_COOL_DARK,
    accent('#7C3AED', '#6D28D9', '#5B21B6', '#EDE9FE', '#8B5CF6'),
    accent('#8B5CF6', '#A78BFA', '#5B21B6', '#EDE9FE', '#A78BFA'),
  ),
  makeTheme(
    'sunset', 'Sunset', 'Warm amber on cream — friendly, consumer, energetic.', 'seed',
    NEUTRAL_WARM_LIGHT, NEUTRAL_WARM_DARK,
    accent('#EA580C', '#C2410C', '#9A3412', '#FFEDD5', '#F97316'),
    accent('#F97316', '#FB923C', '#9A3412', '#FFEDD5', '#FB923C'),
  ),
];

//? A blank-but-valid theme to seed the "new theme" / AI-fill flow (clones LuckyStack).
export function blankTheme(id: string, name: string): DesignTheme {
  return { id, name, description: '', source: 'manual', light: { ...LUCKYSTACK_THEME.light }, dark: { ...LUCKYSTACK_THEME.dark } };
}

//? ---- colour maths (hex only; oklch/rgba values are left untouched by the derive/contrast utils) ----
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const hex6 = m?.[1];
  if (hex6 === undefined) return null;
  const n = Number.parseInt(hex6, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function channelHex(v: number): string { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }
function toHex(r: number, g: number, b: number): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`.toUpperCase();
}
//? Mix a colour toward black (amount<0) or white (amount>0), amount in [-1,1].
function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex(rgb[0] + (target - rgb[0]) * t, rgb[1] + (target - rgb[1]) * t, rgb[2] + (target - rgb[2]) * t);
}

//? Derive the hover + border variants of an accent from its base (G-DSGN-4: related colours move
//? together). Hover is a touch darker, border darker still; on dark mode hover goes lighter.
export function deriveAccent(baseHex: string, forDark: boolean): { hover: string; border: string } {
  return forDark
    ? { hover: shade(baseHex, 0.18), border: shade(baseHex, -0.35) }
    : { hover: shade(baseHex, -0.15), border: shade(baseHex, -0.32) };
}

//? sRGB channel (0–255) → linear light. Threshold 0.039_28 per the WCAG relative-luminance formula.
function srgbToLinear(v: number): number { const s = v / 255; return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
function relLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
//? WCAG contrast ratio between two colours. Null when either isn't a plain hex (can't measure oklch here).
export function contrastRatio(fg: string, bg: string): number | null {
  const a = hexToRgb(fg); const b = hexToRgb(bg);
  if (!a || !b) return null;
  const l1 = relLuminance(a); const l2 = relLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
export type ContrastGrade = 'AAA' | 'AA' | 'AA-large' | 'fail';
export function contrastGrade(ratio: number): ContrastGrade {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

//? Export a theme as the CSS the app actually uses (`@theme` + `.dark`) — the "apply to app" copy.
function cssBlock(tokens: ThemeTokens): string { return COLOR_TOKENS.map((t) => `  --color-${t}: ${tokens[t]};`).join('\n'); }
export function themeToCss(theme: DesignTheme): string {
  return `/* ${theme.name} — generated by the Workspaces Designer */\n@theme {\n${cssBlock(theme.light)}\n}\n\n.dark {\n${cssBlock(theme.dark)}\n}\n`;
}
