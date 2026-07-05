//? Designer — the ANIMATION model. A motion preset the user can preview, tune with sliders, and
//? have the AI generate. Presets are seeded to match the app's real motion layer (the SPRING_POP /
//? SPRING_SHEET / SPRING_SOFT + accordion springs in `_components/motion.tsx`) so what you design
//? here reads like the rest of the product. Each spec is stored as editable primitives; the
//? playground builds the `from`/`to`/`transition` objects for `motion/react` at render time.

import type { Transition } from 'motion/react';

export type AnimSource = 'seed' | 'ai' | 'manual';
export type AnimEasing = 'spring' | 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface AnimSpec {
  id: string;
  name: string;
  description: string;
  source: AnimSource;
  fade: boolean;      //? animate opacity 0 → 1
  x: number;          //? start x offset (px), animates to 0
  y: number;          //? start y offset (px), animates to 0
  scale: number;      //? start scale, animates to 1 (1 = no scale)
  rotate: number;     //? start rotation (deg), animates to 0
  easing: AnimEasing;
  duration: number;   //? seconds — spring duration OR tween duration
  bounce: number;     //? spring bounce 0–1 (ignored for tweens)
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- must be a type alias, not an interface: motion/react's TargetAndTransition has an index signature and only a type alias (implicit index signature) is assignable to it
export type MotionTarget = { opacity?: number; x?: number; y?: number; scale?: number; rotate?: number };

//? Build the initial ("from") target for `motion.div initial={…}`.
export function animFrom(a: AnimSpec): MotionTarget {
  const from: MotionTarget = {};
  if (a.fade) from.opacity = 0;
  if (a.x !== 0) from.x = a.x;
  if (a.y !== 0) from.y = a.y;
  if (a.scale !== 1) from.scale = a.scale;
  if (a.rotate !== 0) from.rotate = a.rotate;
  return from;
}
//? The settled ("to") target — everything back to neutral.
export const ANIM_TO: MotionTarget = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };

//? Build the `motion/react` transition for a spec.
export function animTransition(a: AnimSpec): Transition {
  if (a.easing === 'spring') return { type: 'spring', duration: a.duration, bounce: a.bounce };
  return { duration: a.duration, ease: a.easing === 'linear' ? 'linear' : a.easing };
}

//? A cubic-bezier for the easing-curve visualiser (springs are drawn as a note, not a bezier).
export const EASING_BEZIER: Record<Exclude<AnimEasing, 'spring'>, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.4, 0, 1, 1],
  easeOut: [0, 0, 0.2, 1],
  easeInOut: [0.4, 0, 0.2, 1],
};

//? Short human summary chips for a preset card.
export function animChips(a: AnimSpec): string[] {
  const chips: string[] = [];
  if (a.fade) chips.push('fade');
  if (a.y !== 0) chips.push(a.y > 0 ? 'slide up' : 'slide down');
  if (a.x !== 0) chips.push(a.x > 0 ? 'slide left' : 'slide right');
  if (a.scale !== 1) chips.push(a.scale < 1 ? 'scale up' : 'scale down');
  if (a.rotate !== 0) chips.push('rotate');
  chips.push(a.easing === 'spring' ? `spring ${a.bounce >= 0.35 ? 'bouncy' : 'soft'}` : a.easing);
  return chips;
}

//? ---- seed presets (aligned to the app's real springs) ----
//? A named first preset so `[0]`-style access (blocked by noUncheckedIndexedAccess) is never needed.
export const FADE_ANIM: AnimSpec = { id: 'fade', name: 'Fade', description: 'A plain opacity fade — the safest reveal.', source: 'seed', fade: true, x: 0, y: 0, scale: 1, rotate: 0, easing: 'easeOut', duration: 0.2, bounce: 0 };
export const SEED_ANIMS: AnimSpec[] = [
  FADE_ANIM,
  { id: 'fade-up', name: 'Fade up', description: 'Fade while rising a few pixels — the app’s default content reveal.', source: 'seed', fade: true, x: 0, y: 10, scale: 1, rotate: 0, easing: 'spring', duration: 0.34, bounce: 0.05 },
  { id: 'pop', name: 'Pop', description: 'Menu/popover pop — scale + drop, slightly bouncy (SPRING_POP).', source: 'seed', fade: true, x: 0, y: -6, scale: 0.96, rotate: 0, easing: 'spring', duration: 0.22, bounce: 0.22 },
  { id: 'sheet', name: 'Sheet in', description: 'Slide in from the right like a drawer (SPRING_SHEET).', source: 'seed', fade: false, x: 120, y: 0, scale: 1, rotate: 0, easing: 'spring', duration: 0.42, bounce: 0.1 },
  { id: 'slide-up', name: 'Slide up', description: 'Rise up from below with a fade.', source: 'seed', fade: true, x: 0, y: 28, scale: 1, rotate: 0, easing: 'spring', duration: 0.34, bounce: 0 },
  { id: 'scale-in', name: 'Scale in', description: 'Grow from smaller — good for cards + modals.', source: 'seed', fade: true, x: 0, y: 0, scale: 0.8, rotate: 0, easing: 'spring', duration: 0.3, bounce: 0.12 },
  { id: 'bounce-in', name: 'Bounce in', description: 'Playful over-shooting entrance.', source: 'seed', fade: true, x: 0, y: 0, scale: 0.85, rotate: 0, easing: 'spring', duration: 0.5, bounce: 0.5 },
  { id: 'rotate-in', name: 'Rotate in', description: 'Tilt into place with a small rotation.', source: 'seed', fade: true, x: 0, y: 0, scale: 0.96, rotate: -8, easing: 'spring', duration: 0.42, bounce: 0.2 },
];

//? A blank-but-valid spec (clones Fade up) for "new animation" / AI fill.
export function blankAnim(id: string, name: string): AnimSpec {
  return { id, name, description: '', source: 'manual', fade: true, x: 0, y: 12, scale: 1, rotate: 0, easing: 'spring', duration: 0.34, bounce: 0.1 };
}
