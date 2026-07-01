import { createContext, useContext, useState, ReactNode, ReactElement, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';

// Types
interface MenuEntry {
  id: string;
  element: ReactElement;
  options: MenuOptions;
  isClosing?: boolean;
  soonIsTop?: boolean;
  resolver?: (value: any) => void;
}

interface MenuOptions {
  dimBackground?: boolean;
  background?: string;
  size?: 'sm' | 'md' | 'lg';
}

interface MenuHandlerContextType {
  open: (element: ReactElement, options?: MenuOptions) => Promise<any>;
  replace: (element: ReactElement, options?: MenuOptions) => Promise<any>;
  close: () => void;
  closeAll: () => void;
  logStack: () => void;
}

interface SlideInWrapperProps {
  children: ReactNode;
  isTop: boolean;
  options: MenuOptions;
  isClosing?: boolean;
  soonIsTop?: boolean;
}

const SlideInWrapper = ({ children, options, isTop, isClosing, soonIsTop }: SlideInWrapperProps) => {
  const [location, setLocation] = useState<'left' | 'center' | 'right'>('center');

  useEffect(() => {
    // Only slide when stacking multiple menus
    if (!isTop && location === 'center') {
      setLocation('left');
    } else if (isClosing && location === 'center') {
      setLocation('right');
    } else if (location === 'left' && soonIsTop) {
      setLocation('center');
    }
  }, [isTop, isClosing, soonIsTop]);

  const translate =
    location === 'center'
      ? '0 0'
      : location === 'left'
        ? '-100% 0'
        : '100% 0';

  return (
    <div
      className={`w-full overflow-hidden absolute flex flex-col text-black transform transition-transform duration-300 
        ${options.background ?? ''}
      `}
      style={{ translate }}
    >
      {children}
    </div>
  );
};


const MenuHandlerContext = createContext<MenuHandlerContextType | null>(null);

export const useMenuHandler = () => {
  const ctx = useContext(MenuHandlerContext);
  if (!ctx) throw new Error('useMenuHandler must be used within MenuHandlerProvider');
  return ctx;
};

export const MenuHandlerProvider = ({ children }: { children: ReactNode }) => {
  const [stack, setStack] = useState<MenuEntry[]>([]);
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const open = (element: ReactElement, options: MenuOptions = {}) => {
    return new Promise((resolve) => {
      const id = uuidv4();
      setStack((prev) => [...prev, { id, element, options, resolver: resolve }]);
      setIsAnimatingIn(true);
      // Reset animation state after initial render
      requestAnimationFrame(() => {
        setIsAnimatingIn(false);
      });
    });
  };

  const replace = (element: ReactElement, options: MenuOptions = {}) => {
    return new Promise((resolve) => {
      const id = uuidv4();
      setStack((prev) => {
        const newStack = [...prev];
        newStack.pop();
        newStack.push({ id, element, options, resolver: resolve });
        return newStack;
      });
    });
  };

  const close = () => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const lastitem = prev.length == 1
      const newStack = [...prev];
      const top = newStack[newStack.length - 1];
      const second = newStack[newStack.length - 2];

      // Prevent double-close
      if ((top as any).isClosing) return prev;

      // Mark top as closing
      if (!lastitem) {
        newStack[newStack.length - 1] = { ...top, isClosing: true };
        if (second) {
          newStack[newStack.length - 2] = { ...second, soonIsTop: true };
        }
      } else {
        top.resolver?.(null);
        return [];
      }

      // Delay removal for animation
      if (!lastitem) {
        setTimeout(() => {
          setStack((current) => {
            const last = current[current.length - 1];
            const tempSecond = current[current.length - 2];
            if (last?.id === top.id && (last as any).isClosing) {
              if (last.resolver) last.resolver(null);
              if (tempSecond?.id && tempSecond.id == second?.id && (tempSecond as any).soonIsTop) {
                current[current.length - 2] = { ...tempSecond, soonIsTop: false };
              }
              return current.slice(0, -1);
            }
            return current;
          });
        }, 200); // Match animation duration
      }
      return newStack;
    });
  };


  const closeAll = () => {
    setStack((prev) => {
      prev.forEach((entry) => entry.resolver?.(null));
      return [];
    });
  };

  const logStack = () => {
    console.log('Menu stack:', stack.map(s => s.id));
  };

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Measure container size based on content
  useEffect(() => {
    if (!containerRef.current || stack.length === 0) {
      setContainerSize({ width: 0, height: 0 });
      return;
    }

    const updateSize = () => {
      if (!containerRef.current) return;

      const lastChild = containerRef.current.lastElementChild as HTMLElement;
      if (lastChild) {
        const rect = lastChild.getBoundingClientRect();
        setContainerSize({
          width: rect.width,
          height: rect.height
        });
      }
    };

    // Initial measurement
    updateSize();

    // Use ResizeObserver for dynamic content changes
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [stack]);

  const stackTop = stack[stack.length - 1] || {};

  const sizeClass = {
    sm: '384px',
    md: '512px',
    lg: '768px',
  }[stackTop?.options?.size || 'sm'];

  let attempToCloseAll = false;

  return (
    <MenuHandlerContext.Provider value={{ open, replace, close, closeAll, logStack }}>
      {children}
      {createPortal(
        <div
          className={`absolute top-0 left-0 w-full h-full flex items-center justify-center z-[1000] overflow-hidden ${stack.length == 0 ? 'pointer-events-none' : ''}`}
          style={{ backgroundColor: stackTop.options && stackTop.options?.dimBackground != false ? 'rgba(0, 0, 0, 0.7)' : 'transparent' }}
          onMouseDown={() => attempToCloseAll = true}
          onMouseUp={() => {
            if (!attempToCloseAll) { return }
            closeAll();
          }}
        >
          <div
            ref={containerRef}
            className={`rounded-md overflow-hidden relative
              transition-[opacity,transform,height,width] duration-200 origin-center
              ${isAnimatingIn || stack.length === 0 ? 'opacity-0 scale-90' : 'opacity-100 scale-100'}
            `}
            style={{
              width: containerSize.width > 0 ? `${containerSize.width}px` : sizeClass,
              height: containerSize.height > 0 ? `${containerSize.height}px` : 'auto'
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            {stack.map((entry, index) => (
              <SlideInWrapper
                key={entry.id}
                isTop={index === stack.length - 1}
                isClosing={entry.isClosing}
                soonIsTop={entry.soonIsTop}
                options={entry.options}
              >
                {entry.element}
              </SlideInWrapper>
            ))}
          </div>
        </div>,
        document.body
      )}
    </MenuHandlerContext.Provider>
  );
};