//? Designer theme-generation service. Turns a plain-language brief ("a warm premium fintech look")
//? into a full design THEME — a light AND dark set of the 30 `--color-*` tokens the app themes on —
//? via the pluggable AI-provider layer (`runAiCompletion` — ADR 0007), so the backend is a per-feature
//? config choice, never hardcoded. Pure prompt-builder + parser (unit-testable); the one impure step
//? is the AI call. Stateless: it returns a token-set the client adds to its theme library (no DB yet).

import { tryCatch, tryCatchSync } from '@luckystack/core';
import { runAiCompletion } from '../ai/registry';

//? The 30 token roles (kept in sync with `src/index.css` + `src/workspaces/designer/themes.ts`).
//? Duplicated here so the server module stays standalone (server tsconfig doesn't pull in `src/`).
export const THEME_TOKENS = [
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
export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeTokens = Record<ThemeToken, string>;
//? `light`/`dark` are index-signature maps (NOT the hyphenated-literal-key `ThemeTokens`) so the
//? API type-map generator emits a clean `{ [k: string]: string }` — literal keys like
//? `container1-hover` would be emitted UNQUOTED and break the generated .d.ts.
export interface GeneratedTheme { name: string; description: string; light: Record<string, string>; dark: Record<string, string> }

//? The LuckyStack default, used to fill any token the model omits (so the result is always a
//? complete, valid 30-token set even if the AI returns a partial object).
const BASE_LIGHT: ThemeTokens = {
  background: '#F5F5F5',
  container1: '#FFFFFF', 'container1-hover': '#F9F9F9', 'container1-border': '#E5E5E5',
  container2: '#EFEFEF', 'container2-hover': '#E5E5E5', 'container2-border': '#DCDCDC',
  title: '#1E1F21', common: '#454648', muted: '#6B7280', disabled: '#9CA3AF',
  overlay: 'rgba(15, 23, 42, 0.45)', 'focus-ring': '#3B82F6', divider: '#E5E7EB',
  'title-primary': '#FFFFFF', 'common-primary': '#DBEAFE', 'title-secondary': '#FFFFFF', 'common-secondary': '#DBEAFE',
  primary: '#3B82F6', 'primary-hover': '#2563EB', 'primary-border': '#1D4ED8',
  secondary: '#3B82F6', 'secondary-hover': '#2563EB', 'secondary-border': '#1D4ED8',
  correct: 'oklch(72.3% 0.219 149.579)', 'correct-hover': 'oklch(62.7% 0.194 149.214)',
  warning: 'oklch(79.5% 0.184 86.047)', 'warning-hover': 'oklch(68.1% 0.162 75.834)',
  wrong: 'oklch(63.7% 0.237 25.331)', 'wrong-hover': 'oklch(57.7% 0.245 27.325)',
};
const BASE_DARK: ThemeTokens = {
  background: '#0B0F19',
  container1: '#111827', 'container1-hover': '#1E293B', 'container1-border': '#1E293B',
  container2: '#1E293B', 'container2-hover': '#334155', 'container2-border': '#334155',
  title: '#F1F5F9', common: '#CBD5E1', muted: '#94A3B8', disabled: '#475569',
  overlay: 'rgba(0, 0, 0, 0.6)', 'focus-ring': '#60A5FA', divider: '#1E293B',
  'title-primary': '#FFFFFF', 'common-primary': '#DBEAFE', 'title-secondary': '#FFFFFF', 'common-secondary': '#DBEAFE',
  primary: '#3B82F6', 'primary-hover': '#60A5FA', 'primary-border': '#1E40AF',
  secondary: '#3B82F6', 'secondary-hover': '#60A5FA', 'secondary-border': '#1E40AF',
  correct: 'oklch(72.3% 0.219 149.579)', 'correct-hover': 'oklch(62.7% 0.194 149.214)',
  warning: 'oklch(79.5% 0.184 86.047)', 'warning-hover': 'oklch(68.1% 0.162 75.834)',
  wrong: 'oklch(63.7% 0.237 25.331)', 'wrong-hover': 'oklch(57.7% 0.245 27.325)',
};

//? Compact role hints so the model produces sensible, accessible values.
const TOKEN_GUIDE = [
  'background = page background',
  'container1/2 = card & panel surfaces (1 sits on the page, 2 sits on container1); each has -hover and -border',
  'title = strong headings, common = body text, muted = captions, disabled = disabled text (decreasing contrast)',
  'overlay = modal backdrop (use rgba), focus-ring = focus outline, divider = hairline separator',
  'primary/-hover/-border = the main accent (buttons, links); secondary/-hover/-border = a secondary accent',
  'title-primary/common-primary = text ON the primary button (title-primary is almost always #FFFFFF); same for -secondary',
  'correct/-hover = success green, warning/-hover = amber, wrong/-hover = error red — keep these standard + recognisable',
].join('\n');

//? Build the {system, prompt}. Pure — the prompt is the product; keep it explicit.
export function buildThemePrompt(brief: string): { system: string; prompt: string } {
  return {
    system: `You are a senior product designer building a cohesive UI colour theme. You output ONE JSON object and nothing else, in a single \`\`\`json code block, with this exact shape:
{"name":"<2-3 word theme name>","description":"<one short sentence>","light":{<all 30 tokens>},"dark":{<all 30 tokens>}}
Every one of these 30 tokens MUST be present in BOTH "light" and "dark": ${THEME_TOKENS.join(', ')}.
Values must be valid CSS colours (hex like #1A2B3C, or rgba(...), or oklch(...)). Ensure AA text contrast: dark text on light surfaces in "light", light text on dark surfaces in "dark". The accent should carry the theme's personality; the semantic colours (correct/warning/wrong) stay recognisably green/amber/red.
Token roles:\n${TOKEN_GUIDE}`,
    prompt: `Design a UI theme for this direction:\n\n"${brief}"\n\nReturn one \`\`\`json block with "name", "description", and complete "light" + "dark" token maps (all 30 tokens each).`,
  };
}

//? Coerce one parsed map into a complete token set, filling omissions from the base.
function completeTokens(raw: unknown, base: ThemeTokens): Record<string, string> {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = { ...base };
  for (const token of THEME_TOKENS) {
    const v = obj[token];
    if (typeof v === 'string' && v.trim().length > 0) out[token] = v.trim();
  }
  return out;
}

//? Parse the model text into a complete theme (never throws — falls back to the base on bad JSON).
export function parseTheme(text: string, fallbackName: string): GeneratedTheme {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const jsonSlice = fenced?.[1] ?? text;
  const start = jsonSlice.indexOf('{');
  const end = jsonSlice.lastIndexOf('}');
  const candidate = start !== -1 && end > start ? jsonSlice.slice(start, end + 1) : jsonSlice;
  const [, parsed] = tryCatchSync(() => JSON.parse(candidate) as unknown);
  const obj = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const name = typeof obj.name === 'string' && obj.name.trim().length > 0 ? obj.name.trim() : fallbackName;
  const description = typeof obj.description === 'string' ? obj.description.trim() : '';
  return {
    name,
    description,
    light: completeTokens(obj.light, BASE_LIGHT),
    dark: completeTokens(obj.dark, BASE_DARK),
  };
}

//? Generate a theme from a brief. Returns null on ANY provider error — including a thrown
//? exception (a PTY spawn failure must surface as a clean handled error, never a 500).
export async function generateTheme(brief: string, workspaceId?: string): Promise<GeneratedTheme | null> {
  const { system, prompt } = buildThemePrompt(brief);
  const [error, res] = await tryCatch(() => runAiCompletion('designer-theme', { prompt, system, timeoutMs: 180_000, ...(workspaceId ? { workspaceId, label: `Theme · ${brief.slice(0, 40)}` } : {}) }));
  if (error || !res?.ok) return null;
  return parseTheme(res.text, 'AI theme');
}
