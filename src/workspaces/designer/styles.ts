//? Designer — the design-STYLE model (the "design skills" from the corpus: Apple, Material,
//? Brutalist, …). Where a THEME is colour (the 30 `--color-*` tokens), a STYLE is the visual
//? LANGUAGE around those colours: corner radius, shadow/elevation, border treatment, spacing
//? density, typography and motion character. A style is expressed as a set of `--ds-*` CSS
//? variables applied to the preview canvas, so the style-aware showcase components re-shape
//? live when you switch styles — independently of the active theme's colours.

import type { CSSProperties } from 'react';

export type StyleSource = 'seed' | 'ai' | 'manual';
export type Density = 'compact' | 'cozy' | 'comfortable';
export type MotionFeel = 'none' | 'snappy' | 'smooth' | 'bouncy';
export type BorderTreatment = 'none' | 'hairline' | 'solid' | 'bold';

export interface DesignStyle {
  id: string;
  name: string;
  description: string;
  source: StyleSource;
  radius: number;          //? base corner radius (px)
  radiusLg: number;        //? large radius for cards/sheets (px)
  pill: boolean;           //? fully-rounded buttons/controls
  shadow: string;          //? card elevation
  shadowSm: string;        //? control elevation
  border: BorderTreatment; //? how borders read
  density: Density;        //? padding / gap scale
  fontHeading: string;     //? heading font stack
  fontBody: string;        //? body font stack
  weightHeading: number;   //? heading weight
  tracking: string;        //? heading letter-spacing (e.g. '-0.02em')
  motion: MotionFeel;      //? animation character (used by the Animations section + hovers)
  blur: number;            //? backdrop blur for glass looks (px; 0 = none)
}

//? Density → padding + gap (px).
const DENSITY: Record<Density, { padX: number; padY: number; gap: number }> = {
  compact: { padX: 12, padY: 6, gap: 8 },
  cozy: { padX: 16, padY: 10, gap: 12 },
  comfortable: { padX: 22, padY: 14, gap: 18 },
};

const BORDER_WIDTH: Record<BorderTreatment, number> = { none: 0, hairline: 1, solid: 1, bold: 2 };

//? Inline `--ds-*` style for a design style. Typed as CSSProperties intersected with the custom-
//? property record so the keys are valid WITHOUT a cast (Rule 21). Spread onto the showcase wrapper.
export function styleVars(s: DesignStyle): CSSProperties {
  const d = DENSITY[s.density];
  const vars: Record<`--${string}`, string> = {
    '--ds-radius': `${String(s.radius)}px`,
    '--ds-radius-lg': `${String(s.radiusLg)}px`,
    '--ds-radius-pill': s.pill ? '9999px' : `${String(s.radius)}px`,
    '--ds-shadow': s.shadow,
    '--ds-shadow-sm': s.shadowSm,
    '--ds-border-width': `${String(BORDER_WIDTH[s.border])}px`,
    //? references a theme token so the border colour tracks the active theme (bold reads stronger).
    '--ds-border-color': s.border === 'bold' ? 'var(--color-title)' : 'var(--color-container1-border)',
    '--ds-pad-x': `${String(d.padX)}px`,
    '--ds-pad-y': `${String(d.padY)}px`,
    '--ds-gap': `${String(d.gap)}px`,
    '--ds-font-heading': s.fontHeading,
    '--ds-font-body': s.fontBody,
    '--ds-weight-heading': String(s.weightHeading),
    '--ds-tracking': s.tracking,
    '--ds-blur': s.blur > 0 ? `blur(${String(s.blur)}px)` : 'none',
  };
  return vars;
}

//? Human-readable summary chips for a style card (so the list reads at a glance).
export function styleChips(s: DesignStyle): string[] {
  return [
    s.pill ? 'pill' : `radius ${String(s.radius)}px`,
    s.border === 'none' ? 'no border' : `${s.border} border`,
    s.shadow === 'none' ? 'flat' : 'elevated',
    s.density,
    `${s.motion} motion`,
  ];
}

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

//? ---- the seed styles (the "design skills" library) ----
export const APPLE_STYLE: DesignStyle = {
  id: 'apple', name: 'Apple', description: 'Clean, generous radius, soft diffuse shadows, no hard borders. Calm and premium.', source: 'seed',
  radius: 12, radiusLg: 20, pill: false,
  shadow: '0 8px 30px rgba(0,0,0,0.10)', shadowSm: '0 1px 3px rgba(0,0,0,0.08)',
  border: 'none', density: 'comfortable',
  fontHeading: `-apple-system, BlinkMacSystemFont, "SF Pro Display", ${SYSTEM_SANS}`, fontBody: `-apple-system, BlinkMacSystemFont, "SF Pro Text", ${SYSTEM_SANS}`,
  weightHeading: 600, tracking: '-0.02em', motion: 'smooth', blur: 0,
};

export const SEED_STYLES: DesignStyle[] = [
  APPLE_STYLE,
  {
    id: 'material', name: 'Material', description: 'Google Material: modest radius, elevation shadows, confident weight.', source: 'seed',
    radius: 8, radiusLg: 12, pill: false,
    shadow: '0 2px 6px rgba(0,0,0,0.16), 0 1px 2px rgba(0,0,0,0.12)', shadowSm: '0 1px 2px rgba(0,0,0,0.14)',
    border: 'none', density: 'cozy',
    fontHeading: `Roboto, ${SYSTEM_SANS}`, fontBody: `Roboto, ${SYSTEM_SANS}`, weightHeading: 700, tracking: '0em', motion: 'snappy', blur: 0,
  },
  {
    id: 'brutalist', name: 'Brutalist', description: 'Sharp corners, thick borders, hard offset shadow. Loud and honest.', source: 'seed',
    radius: 0, radiusLg: 0, pill: false,
    shadow: '4px 4px 0 rgba(0,0,0,0.9)', shadowSm: '2px 2px 0 rgba(0,0,0,0.9)',
    border: 'bold', density: 'compact',
    fontHeading: `"Courier New", ui-monospace, monospace`, fontBody: `ui-monospace, "Courier New", monospace`, weightHeading: 800, tracking: '0em', motion: 'snappy', blur: 0,
  },
  {
    id: 'neumorphic', name: 'Neumorphic', description: 'Soft UI: everything extruded from one surface with dual soft shadows.', source: 'seed',
    radius: 16, radiusLg: 24, pill: false,
    shadow: '8px 8px 18px rgba(0,0,0,0.12), -8px -8px 18px rgba(255,255,255,0.55)', shadowSm: '4px 4px 10px rgba(0,0,0,0.10), -4px -4px 10px rgba(255,255,255,0.5)',
    border: 'none', density: 'comfortable',
    fontHeading: SYSTEM_SANS, fontBody: SYSTEM_SANS, weightHeading: 600, tracking: '0em', motion: 'smooth', blur: 0,
  },
  {
    id: 'glass', name: 'Glassmorphic', description: 'Frosted translucent surfaces with backdrop blur and a light border.', source: 'seed',
    radius: 16, radiusLg: 24, pill: false,
    shadow: '0 8px 32px rgba(0,0,0,0.18)', shadowSm: '0 2px 10px rgba(0,0,0,0.12)',
    border: 'hairline', density: 'comfortable',
    fontHeading: SYSTEM_SANS, fontBody: SYSTEM_SANS, weightHeading: 600, tracking: '-0.01em', motion: 'smooth', blur: 12,
  },
  {
    id: 'minimal', name: 'Minimal', description: 'Restrained: small radius, no shadow, hairline borders, lots of air.', source: 'seed',
    radius: 6, radiusLg: 8, pill: false,
    shadow: 'none', shadowSm: 'none',
    border: 'hairline', density: 'comfortable',
    fontHeading: SYSTEM_SANS, fontBody: SYSTEM_SANS, weightHeading: 500, tracking: '0em', motion: 'snappy', blur: 0,
  },
  {
    id: 'playful', name: 'Playful', description: 'Pill buttons, big radius, colourful soft shadows, bouncy motion.', source: 'seed',
    radius: 18, radiusLg: 28, pill: true,
    shadow: '0 10px 24px rgba(0,0,0,0.14)', shadowSm: '0 3px 8px rgba(0,0,0,0.12)',
    border: 'none', density: 'cozy',
    fontHeading: `"Trebuchet MS", ${SYSTEM_SANS}`, fontBody: `"Trebuchet MS", ${SYSTEM_SANS}`, weightHeading: 700, tracking: '0em', motion: 'bouncy', blur: 0,
  },
  {
    id: 'editorial', name: 'Editorial', description: 'Print-inspired: serif headings, tight radius, hairline rules, quiet shadow.', source: 'seed',
    radius: 4, radiusLg: 6, pill: false,
    shadow: '0 1px 2px rgba(0,0,0,0.06)', shadowSm: 'none',
    border: 'hairline', density: 'comfortable',
    fontHeading: `Georgia, "Times New Roman", serif`, fontBody: `Georgia, "Times New Roman", serif`, weightHeading: 700, tracking: '-0.01em', motion: 'smooth', blur: 0,
  },
];

//? A blank-but-valid style seeded from Apple (for "new style" / AI fill).
export function blankStyle(id: string, name: string): DesignStyle {
  return { ...APPLE_STYLE, id, name, description: '', source: 'manual' };
}

//? Small coercion helpers (module-scope) shared by the AI-fill parsers.
export function coNum(v: unknown, fb: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : fb; }
export function coStr(v: unknown, fb: string): string { return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fb; }
export function coOneOf<T extends string>(v: unknown, opts: readonly T[], fb: T): T { return typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : fb; }

//? Coerce a raw AI-generated object into a valid DesignStyle (validates enums, fills from Apple).
export function coerceStyle(raw: unknown, id: string): DesignStyle {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const b = APPLE_STYLE;
  const num = coNum; const str = coStr; const oneOf = coOneOf;
  return {
    id, source: 'ai',
    name: str(o.name, 'AI style'), description: str(o.description, ''),
    radius: num(o.radius, b.radius), radiusLg: num(o.radiusLg, b.radiusLg),
    pill: typeof o.pill === 'boolean' ? o.pill : b.pill,
    shadow: str(o.shadow, b.shadow), shadowSm: str(o.shadowSm, b.shadowSm),
    border: oneOf(o.border, ['none', 'hairline', 'solid', 'bold'] as const, b.border),
    density: oneOf(o.density, ['compact', 'cozy', 'comfortable'] as const, b.density),
    fontHeading: str(o.fontHeading, b.fontHeading), fontBody: str(o.fontBody, b.fontBody),
    weightHeading: num(o.weightHeading, b.weightHeading), tracking: str(o.tracking, b.tracking),
    motion: oneOf(o.motion, ['none', 'snappy', 'smooth', 'bouncy'] as const, b.motion),
    blur: num(o.blur, b.blur),
  };
}
