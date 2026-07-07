//? S4 (premium-UX / a11y) — close a modal/overlay on the Escape key. Every full-screen overlay (the editors,
//? the setup wizard) should be dismissible without the mouse. Reduced-motion + focus are handled per component;
//? this covers the keyboard-dismiss part of the §0b checklist for the new surfaces.

import { useEffect } from 'react';

export function useEscapeKey(onEscape: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onEscape(); };
    globalThis.addEventListener('keydown', handler);
    return () => { globalThis.removeEventListener('keydown', handler); };
  }, [onEscape]);
}
