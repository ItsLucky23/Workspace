//? L2 (AI_LIBRARIES_ACCOUNTS_PROGRAM.md) — parse the persisted `DesignArtifact` rows (surfaced on the
//? snapshot as `designArtifacts`) back into the typed designer library shapes, so a saved theme/style/anim
//? ROUND-TRIPS: it reappears in the gallery/rails on reload + after a save (the libraries were seed-only
//? before, so persistence was one-directional). Pure + defensive: a malformed row coerces to null, never
//? crashes the designer.

import { COLOR_TOKENS, type DesignTheme, type ThemeTokens } from './themes';
import type { DesignStyle, BorderTreatment, Density, MotionFeel } from './styles';
import type { AnimSpec, AnimEasing } from './animations';

//? The persisted artifact shape as it arrives on the snapshot (server/read/workspaceSnapshot.ts).
export interface PersistedArtifact { id: string; kind: string; name: string; description: string; content: unknown; source: string; active: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
const num = (v: unknown, d: number): number => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const boolOf = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

//? A token-set is valid only when every colour token is a present string (so the theme can't render half-set).
function asTokens(v: unknown): ThemeTokens | null {
  if (!isObj(v)) return null;
  for (const t of COLOR_TOKENS) { if (typeof v[t] !== 'string') return null; }
  return v as ThemeTokens;
}

//? A persisted `theme` artifact → DesignTheme (content = { light, dark } token-sets).
export function artifactToTheme(a: PersistedArtifact): DesignTheme | null {
  if (a.kind !== 'theme' || !isObj(a.content)) return null;
  const light = asTokens(a.content.light);
  const dark = asTokens(a.content.dark);
  if (!light || !dark) return null;
  return { id: a.id, name: a.name, description: a.description, source: 'manual', light, dark };
}

const BORDERS: BorderTreatment[] = ['none', 'hairline', 'solid', 'bold'];
const DENSITIES: Density[] = ['compact', 'cozy', 'comfortable'];
const MOTIONS: MotionFeel[] = ['none', 'snappy', 'smooth', 'bouncy'];
const asOneOf = <T extends string>(v: unknown, opts: T[], d: T): T => (typeof v === 'string' && (opts as string[]).includes(v) ? v as T : d);

//? A persisted `style` artifact → DesignStyle (content = the full style spec).
export function artifactToStyle(a: PersistedArtifact): DesignStyle | null {
  if (a.kind !== 'style' || !isObj(a.content)) return null;
  const c = a.content;
  return {
    id: a.id, name: a.name, description: a.description, source: 'manual',
    radius: num(c.radius, 12), radiusLg: num(c.radiusLg, 16), pill: boolOf(c.pill, false),
    shadow: str(c.shadow, 'none'), shadowSm: str(c.shadowSm, 'none'),
    border: asOneOf(c.border, BORDERS, 'hairline'), density: asOneOf(c.density, DENSITIES, 'cozy'),
    fontHeading: str(c.fontHeading, 'system-ui, sans-serif'), fontBody: str(c.fontBody, 'system-ui, sans-serif'),
    weightHeading: num(c.weightHeading, 600), tracking: str(c.tracking, '0'),
    motion: asOneOf(c.motion, MOTIONS, 'smooth'), blur: num(c.blur, 0),
  };
}

const EASINGS: AnimEasing[] = ['spring', 'linear', 'easeIn', 'easeOut', 'easeInOut'];

//? A persisted `animation` artifact → AnimSpec (content = the full anim spec).
export function artifactToAnim(a: PersistedArtifact): AnimSpec | null {
  if (a.kind !== 'animation' || !isObj(a.content)) return null;
  const c = a.content;
  return {
    id: a.id, name: a.name, description: a.description, source: 'manual',
    fade: boolOf(c.fade, true), x: num(c.x, 0), y: num(c.y, 0), scale: num(c.scale, 1), rotate: num(c.rotate, 0),
    easing: asOneOf(c.easing, EASINGS, 'spring'), duration: num(c.duration, 0.4), bounce: num(c.bounce, 0.2),
  };
}

//? The recognizable fields of a style / anim — an IMPORT must carry at least a few, else the lenient
//? coercion (all-defaults) would accept ANY object (even `{}` or unrelated JSON) as a "valid" style/anim.
const STYLE_KEYS = ['radius', 'radiusLg', 'pill', 'shadow', 'border', 'density', 'fontHeading', 'fontBody', 'weightHeading', 'tracking', 'motion', 'blur'];
const ANIM_KEYS = ['fade', 'x', 'y', 'scale', 'rotate', 'easing', 'duration', 'bounce'];
const hasEnoughKeys = (content: unknown, keys: string[], min: number): boolean =>
  isObj(content) && keys.filter((k) => k in content).length >= min;

//? L3 — validate that an IMPORTED/COPIED artifact's content is a real theme/style/anim before it is saved
//? (so a garbage JSON upload can't poison the library). Themes are strict (all tokens); style/anim additionally
//? require enough recognizable fields, because the round-trip parsers coerce ANY object to all-defaults.
export function validArtifactContent(kind: string, content: unknown, name = 'x'): boolean {
  const row: PersistedArtifact = { id: 'x', kind, name, description: '', content, source: 'manual', active: false };
  if (kind === 'theme') return artifactToTheme(row) !== null;
  if (kind === 'style') return artifactToStyle(row) !== null && hasEnoughKeys(content, STYLE_KEYS, 3);
  if (kind === 'animation') return artifactToAnim(row) !== null && hasEnoughKeys(content, ANIM_KEYS, 2);
  return false;
}

//? Split the persisted artifacts into the three typed libraries (nulls dropped).
export function parsePersistedLibraries(artifacts: PersistedArtifact[]): { themes: DesignTheme[]; styles: DesignStyle[]; anims: AnimSpec[] } {
  const themes: DesignTheme[] = [];
  const styles: DesignStyle[] = [];
  const anims: AnimSpec[] = [];
  for (const a of artifacts) {
    const t = artifactToTheme(a); if (t) { themes.push(t); continue; }
    const s = artifactToStyle(a); if (s) { styles.push(s); continue; }
    const an = artifactToAnim(a); if (an) anims.push(an);
  }
  return { themes, styles, anims };
}
