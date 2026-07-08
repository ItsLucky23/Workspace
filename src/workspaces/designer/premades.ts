//? L1 (AI_LIBRARIES_ACCOUNTS_PROGRAM.md) — the PREMADE UI-look catalog. A "look" is a curated pairing of an
//? existing palette (DesignTheme) + component style (DesignStyle) + entrance animation + heading/body fonts,
//? so a user can pick a full identity ("Apple", "Brutalist", "Glass") and preview it live (landing / menu /
//? animation / font surfaces) before applying it. Pure DATA + a resolver over the existing seed catalogs — no
//? new palette authoring; the set is a strong STARTER that upload/copy/customize (L3) extends.

import { SEED_THEMES, type DesignTheme } from './themes';
import { SEED_STYLES, type DesignStyle } from './styles';
import { FONT_LIBRARY } from './fonts';

export interface PremadeLook {
  id: string;
  name: string;
  description: string;
  themeId: string;      // → SEED_THEMES id
  styleId: string;      // → SEED_STYLES id
  animId: string;       // → SEED_ANIMS id (entrance feel for the preview)
  fontHeadingId: string; // → FONT_LIBRARY id
  fontBodyId: string;   // → FONT_LIBRARY id
}

//? The curated starter catalog. Each look leans on a distinct style + font so the identity reads clearly even
//? where two looks share a palette family. Extend by appending here (or a user uploads their own — L3).
export const PREMADE_LOOKS: PremadeLook[] = [
  { id: 'apple', name: 'Apple', description: 'Clean, airy, restrained — soft radii and subtle depth.', themeId: 'luckystack', styleId: 'apple', animId: 'fade-up', fontHeadingId: 'apple', fontBodyId: 'apple' },
  { id: 'material', name: 'Material', description: 'Bold surfaces, crisp elevation, confident colour.', themeId: 'emerald', styleId: 'material', animId: 'pop', fontHeadingId: 'system', fontBodyId: 'system' },
  { id: 'glass', name: 'Glassmorphic', description: 'Frosted, translucent panels with a premium sheen.', themeId: 'violet', styleId: 'glass', animId: 'sheet', fontHeadingId: 'geometric', fontBodyId: 'system' },
  { id: 'brutalist', name: 'Brutalist', description: 'Hard edges, heavy borders, unapologetic type.', themeId: 'sunset', styleId: 'brutalist', animId: 'pop', fontHeadingId: 'impact', fontBodyId: 'arial' },
  { id: 'minimal', name: 'Minimal', description: 'The quietest look — hairlines, generous whitespace.', themeId: 'luckystack', styleId: 'minimal', animId: 'fade', fontHeadingId: 'helvetica', fontBodyId: 'helvetica' },
  { id: 'editorial', name: 'Editorial', description: 'Serif headings, magazine rhythm, considered spacing.', themeId: 'sunset', styleId: 'editorial', animId: 'slide-up', fontHeadingId: 'georgia', fontBodyId: 'georgia' },
  { id: 'playful', name: 'Playful', description: 'Rounded, bouncy, friendly — high energy.', themeId: 'violet', styleId: 'playful', animId: 'bounce-in', fontHeadingId: 'trebuchet', fontBodyId: 'system' },
  { id: 'neumorphic', name: 'Neumorphic', description: 'Soft, extruded surfaces with gentle shadows.', themeId: 'emerald', styleId: 'neumorphic', animId: 'scale-in', fontHeadingId: 'geometric', fontBodyId: 'system' },
];

export interface ResolvedLook { look: PremadeLook; theme: DesignTheme; style: DesignStyle; fontHeading: string; fontBody: string }

//? Resolve a look's id into its concrete theme + style + font stacks (null when any ref is unknown).
export function resolveLook(id: string): ResolvedLook | null {
  const look = PREMADE_LOOKS.find((l) => l.id === id);
  if (!look) return null;
  const theme = SEED_THEMES.find((t) => t.id === look.themeId);
  const style = SEED_STYLES.find((s) => s.id === look.styleId);
  if (!theme || !style) return null;
  const fontHeading = FONT_LIBRARY.find((f) => f.id === look.fontHeadingId)?.stack ?? style.fontHeading;
  const fontBody = FONT_LIBRARY.find((f) => f.id === look.fontBodyId)?.stack ?? style.fontBody;
  return { look, theme, style, fontHeading, fontBody };
}
