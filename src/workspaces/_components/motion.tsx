//? Workspaces — shared motion layer (Framer Motion / `motion`).
//?
//? One place for the spring presets + the reusable entrance/exit primitives so
//? every menu, popover, sheet and drawer feels the same. Reduced-motion is
//? handled globally by <MotionConfig reducedMotion="user"> at the app root
//? (page.tsx), so individual call-sites don't need to branch.

/* eslint-disable react-refresh/only-export-components -- shared motion module: the spring presets are intentionally co-located with the primitives that consume them (dev-only fast-refresh rule; these aren't route components) */
import { AnimatePresence, motion, type Transition } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';

//? Consumers import `motion` / `AnimatePresence` straight from `motion/react`;
//? this module only owns the spring presets + the reusable surfaces below.

/** Quick, slightly-bouncy spring for menus/popovers. */
export const SPRING_POP: Transition = { type: 'spring', duration: 0.22, bounce: 0.22 };
/** iOS-like spring for side panels / sheets / drawers. */
export const SPRING_SHEET: Transition = { type: 'spring', duration: 0.42, bounce: 0.1 };
/** Soft spring for layout/hover micro-interactions. */
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 };

/** Soft easing curve for page/content entrances (a gentle ease-out-quint). */
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** A consistent, snappy page-enter transition keyed on the route. Wrapping the shell's routed content
 *  in this gives every page the same premium fade+lift on navigation, in ONE place. `mode="wait"` so the
 *  outgoing page never overlaps the incoming one (no layout flash); reduced-motion is honoured globally. */
export function PageTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        className="h-full min-h-0"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.17, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** A staggered reveal for a list/grid of cards — children fade+lift in sequence on mount. Wrap a mapped
 *  list's items in <Reveal index={i}> for a premium "content settles in" feel. Cheap; reduced-motion-safe. */
export function Reveal({ index = 0, className, children }: { index?: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT, delay: Math.min(index * 0.04, 0.24) }}
    >
      {children}
    </motion.div>
  );
}

/** A menu/popover surface that fades + scales in from its top edge. The caller
 *  supplies positioning via `className` (e.g. `absolute right-0`). */
export function Popover({ open, className, style, children }: { open: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={className}
          style={{ transformOrigin: 'top', ...style }}
          initial={{ opacity: 0, scale: 0.96, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -6 }}
          transition={SPRING_POP}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Height-animated reveal for progressive disclosure ("Options", "Advanced", expandable rows).
 *  The gap this fills: every disclosure in the app rendered its body with a bare `{open && …}`, so the
 *  extra controls SNAPPED into existence and shoved the surrounding layout — the single most jarring
 *  interaction in the product. Animating `height: auto` needs the child measured, so the body is always
 *  mounted inside an `overflow-hidden` wrapper and the content itself fades slightly behind the height.
 *  Reduced-motion is honoured globally by <MotionConfig reducedMotion="user">. */
export function Collapse({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={`overflow-hidden ${className ?? ''}`}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: 0.24, ease: EASE_OUT }, opacity: { duration: 0.16 } }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A slide-in panel: from the right on desktop, up from the bottom on mobile
 *  (pass `side`). Renders its own backdrop. Use for overlays/sheets. */
export function Sheet({ open, onClose, side = 'right', className, children }: {
  open: boolean; onClose: () => void; side?: 'right' | 'bottom'; className?: string; children: ReactNode;
}) {
  const offscreen = side === 'right' ? { x: '100%' } : { y: '100%' };
  const pos = side === 'right' ? 'inset-y-0 right-0 h-full w-full max-w-md' : 'inset-x-0 bottom-0 max-h-[85%] rounded-t-2xl';
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div onClick={onClose} className="fixed inset-0 z-40 bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div
            className={`fixed z-50 bg-container1 border-divider shadow-xl ${pos} ${side === 'right' ? 'border-l' : 'border-t'} ${className ?? ''}`}
            initial={offscreen}
            animate={{ x: 0, y: 0 }}
            exit={offscreen}
            transition={SPRING_SHEET}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
