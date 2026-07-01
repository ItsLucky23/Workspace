//? Workspaces — shared motion layer (Framer Motion / `motion`).
//?
//? One place for the spring presets + the reusable entrance/exit primitives so
//? every menu, popover, sheet and drawer feels the same. Reduced-motion is
//? handled globally by <MotionConfig reducedMotion="user"> at the app root
//? (page.tsx), so individual call-sites don't need to branch.

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

/** A dimmed backdrop that fades in/out behind drawers, sheets and modals. */
export function Backdrop({ open, onClick, className }: { open: boolean; onClick?: () => void; className?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          onClick={onClick}
          className={className ?? 'fixed inset-0 z-40 bg-overlay'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        />
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
