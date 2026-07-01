/* eslint-disable react-refresh/only-export-components -- hooks colocated with provider */
import { createContext, use, useState, ReactNode, ReactElement, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';

import { setMenuHandlerRef } from 'src/_functions/menuHandler';

interface MenuOptions {
  dimBackground?: boolean;
  background?: string;
  size?: 'sm' | 'md' | 'lg';
}

interface MenuEntry {
  id: string;
  element: ReactElement;
  options: MenuOptions;
  isClosing: boolean;
  resolver?: (value: unknown) => void;
}

interface MenuHandlerContextType {
  open: (element: ReactElement, options?: MenuOptions) => Promise<unknown>;
  replace: (element: ReactElement, options?: MenuOptions) => Promise<unknown>;
  close: () => void;
  closeAll: () => void;
  logStack: () => void;
}

const MENU_ANIMATION_MS = 200;
const SIZE_PX: Record<NonNullable<MenuOptions['size']>, string> = {
  sm: '384px',
  md: '512px',
  lg: '768px',
};

const MenuHandlerContext = createContext<MenuHandlerContextType | null>(null);

export function useMenuHandler() {
  const ctx = use(MenuHandlerContext);
  if (!ctx) throw new Error('useMenuHandler must be used within MenuHandlerProvider');
  return ctx;
}

interface MenuItemFrameProps {
  entry: MenuEntry;
  position: 'top' | 'beneath';
  background?: string;
}

//? Each menu in the stack is a layered absolute frame. The top one slides in
//? from the right and scales up; lower ones slide a tiny bit left and dim,
//? giving a clear depth cue. On close, the top one slides back to the right.
function MenuItemFrame({ entry, position, background }: MenuItemFrameProps) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => { setHasMounted(true); });
    return () => { cancelAnimationFrame(id); };
  }, []);

  const isVisible = hasMounted && !entry.isClosing;
  const isTop = position === 'top';

  const transformClass = isVisible
    ? (isTop
      ? 'opacity-100 scale-100 translate-x-0'
      : 'opacity-60 scale-95 -translate-x-4 pointer-events-none')
    : 'opacity-0 scale-95 translate-x-4';

  return (
    <div
      className={`${isTop ? 'relative' : 'absolute inset-0'} flex h-full min-h-0 w-full flex-col origin-center transition-all duration-200 ease-out
        ${transformClass}
        ${background ?? ''}`}
    >
      {entry.element}
    </div>
  );
}

export function MenuHandlerProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<MenuEntry[]>([]);
  const closeTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const backdropPressedRef = useRef(false);

  const submitTopFormFromEnter = useCallback(() => {
    const menuRoot = document.querySelector('#MENUHANDLER');
    if (!(menuRoot instanceof HTMLElement)) return;
    const form = menuRoot.querySelector('form[data-menuhandler-submit-on-enter="true"]');
    if (!(form instanceof HTMLFormElement)) return;
    form.requestSubmit();
  }, []);

  const open = useCallback((element: ReactElement, options: MenuOptions = {}) => {
    return new Promise<unknown>((resolve) => {
      setStack((prev) => [...prev, {
        id: uuidv4(),
        element,
        options,
        isClosing: false,
        resolver: resolve,
      }]);
    });
  }, []);

  const replace = useCallback((element: ReactElement, options: MenuOptions = {}) => {
    return new Promise<unknown>((resolve) => {
      setStack((prev) => {
        const next = prev.slice(0, -1);
        next.push({ id: uuidv4(), element, options, isClosing: false, resolver: resolve });
        return next;
      });
    });
  }, []);

  const close = useCallback(() => {
    setStack((prev) => {
      const top = prev.at(-1);
      if (!top || top.isClosing) return prev;

      const next = prev.slice(0, -1);
      next.push({ ...top, isClosing: true });

      const timeoutId = globalThis.setTimeout(() => {
        closeTimeoutsRef.current.delete(top.id);
        top.resolver?.(null);
        setStack((current) => current.filter((entry) => entry.id !== top.id));
      }, MENU_ANIMATION_MS);

      closeTimeoutsRef.current.set(top.id, timeoutId);
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    for (const timeoutId of closeTimeoutsRef.current.values()) {
      globalThis.clearTimeout(timeoutId);
    }
    closeTimeoutsRef.current.clear();

    setStack((prev) => {
      for (const entry of prev) entry.resolver?.(null);
      return [];
    });
  }, []);

  const logStack = useCallback(() => {
    console.log('Menu stack:', stack.map((s) => s.id));
  }, [stack]);

  const contextValue = useMemo(
    () => ({ open, replace, close, closeAll, logStack }),
    [open, replace, close, closeAll, logStack],
  );

  useEffect(() => {
    setMenuHandlerRef(contextValue);
    return () => { setMenuHandlerRef(null); };
  }, [contextValue]);

  // Reset on Vite HMR.
  useEffect(() => {
    if (!import.meta.hot) return;
    import.meta.hot.dispose(() => {
      for (const timeoutId of closeTimeoutsRef.current.values()) {
        globalThis.clearTimeout(timeoutId);
      }
      closeTimeoutsRef.current.clear();
      setStack([]);
      setMenuHandlerRef(null);
    });
  }, []);

  // Lock page scroll while any menu is open.
  useEffect(() => {
    if (stack.length === 0) return;
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [stack.length]);

  // Enter submits the top form. Escape closes the top menu.
  useEffect(() => {
    if (stack.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== 'Enter') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      submitTopFormFromEnter();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [stack.length, submitTopFormFromEnter, close]);

  // Cleanup any pending close timers on unmount.
  useEffect(() => {
    const timers = closeTimeoutsRef.current;
    return () => {
      for (const timeoutId of timers.values()) {
        globalThis.clearTimeout(timeoutId);
      }
      timers.clear();
    };
  }, []);

  const stackTop = stack.at(-1);
  const sizeClass = SIZE_PX[stackTop?.options.size ?? 'sm'];
  const dim = stackTop && !stackTop.isClosing && stackTop.options.dimBackground === true;

  return (
    <MenuHandlerContext value={contextValue}>
      {children}
      {createPortal(
        <div
          role="presentation"
          className={`fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto p-3 sm:p-4 transition-colors duration-200 ${stack.length === 0 ? 'pointer-events-none' : ''}`}
          style={{ backgroundColor: dim ? 'rgba(0, 0, 0, 0.7)' : 'transparent' }}
          onMouseDown={() => { backdropPressedRef.current = true; }}
          onMouseUp={() => {
            if (!backdropPressedRef.current) return;
            backdropPressedRef.current = false;
            closeAll();
          }}
        >
          <div
            id="MENUHANDLER"
            role="presentation"
            className={`relative flex min-h-0 flex-col overflow-hidden rounded-md transition-all duration-200 max-h-[calc(100dvh-2rem)] ${stackTop && !stackTop.isClosing ? 'scale-100 opacity-100' : 'scale-95 opacity-0 pointer-events-none'}`}
            style={{ width: sizeClass }}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onMouseUp={(e) => { e.stopPropagation(); }}
            onKeyDown={(e) => { e.stopPropagation(); }}
          >
            {stack.map((entry, index) => (
              <MenuItemFrame
                key={entry.id}
                entry={entry}
                position={index === stack.length - 1 ? 'top' : 'beneath'}
                background={entry.options.background}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </MenuHandlerContext>
  );
}
