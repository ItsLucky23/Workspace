/* eslint-disable react-refresh/only-export-components -- shared internals colocated with helpers */
import { ReactNode, RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

//? Generic anchored floating layer. Captures the same smooth
//? mount -> measure/position -> fade-in -> (close) fade-out -> unmount
//? choreography used by the Dropdown, but free of any listbox/search
//? concerns so it can back the Popover, DatePicker, and any future
//? anchored surface. Dropdown keeps its own copy (dropdownInternals.tsx);
//? this layer intentionally does NOT depend on it.

export type FloatingPlacement = "top" | "bottom";
export type FloatingAlign = "start" | "center" | "end";

const ANIMATION_MS = 200;
const VIEWPORT_PADDING = 8;
const TRIGGER_GAP = 6;

interface FloatingPosition {
  top: number;
  left: number;
  triggerWidth: number;
}

export interface UseFloatingLayerArgs {
  /** Preferred vertical side. Auto-flips when there isn't room. Default "bottom". */
  placement?: FloatingPlacement;
  /** Horizontal alignment of the panel against the trigger. Default "start". */
  align?: FloatingAlign;
  /** Close when the user clicks outside the trigger + panel. Default true. */
  closeOnOutsideClick?: boolean;
  /** Close when the user presses Escape. Default true. */
  closeOnEscape?: boolean;
  /** Called after the layer has fully closed (post-animation unmount). */
  onClose?: () => void;
}

export interface FloatingLayerController {
  isOpen: boolean;
  isMounted: boolean;
  isVisible: boolean;
  isPositionReady: boolean;
  resolvedPlacement: FloatingPlacement;
  position: FloatingPosition;
  triggerRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Force a position recalculation (e.g. after the panel content resizes). */
  reposition: () => void;
}

export function useFloatingLayer(args: UseFloatingLayerArgs = {}): FloatingLayerController {
  const {
    placement = "bottom",
    align = "start",
    closeOnOutsideClick = true,
    closeOnEscape = true,
    onClose,
  } = args;

  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isPositionReady, setIsPositionReady] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [resolvedPlacement, setResolvedPlacement] = useState<FloatingPlacement>(placement);
  const [position, setPosition] = useState<FloatingPosition>({ top: 0, left: 0, triggerWidth: 0 });

  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFrameRef = useRef<number | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    const panelWidth = panelRef.current?.offsetWidth ?? rect.width;

    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_PADDING;
    const spaceAbove = rect.top - VIEWPORT_PADDING;
    const needed = panelHeight + TRIGGER_GAP;

    const side: FloatingPlacement = placement === "bottom"
      ? (spaceBelow >= needed || spaceBelow >= spaceAbove ? "bottom" : "top")
      : (spaceAbove >= needed || spaceAbove >= spaceBelow ? "top" : "bottom");

    let left = align === "start"
      ? rect.left
      : (align === "end" ? rect.right - panelWidth : rect.left + rect.width / 2 - panelWidth / 2);
    const maxLeft = viewportWidth - VIEWPORT_PADDING - panelWidth;
    left = Math.max(VIEWPORT_PADDING, Math.min(left, Math.max(VIEWPORT_PADDING, maxLeft)));

    const top = side === "bottom"
      ? Math.min(rect.bottom + TRIGGER_GAP, viewportHeight - VIEWPORT_PADDING - panelHeight)
      : Math.max(VIEWPORT_PADDING, rect.top - TRIGGER_GAP - panelHeight);

    setResolvedPlacement(side);
    setPosition({ top, left, triggerWidth: rect.width });
  }, [placement, align]);

  const cancelPending = useCallback(() => {
    if (showFrameRef.current !== null) {
      cancelAnimationFrame(showFrameRef.current);
      showFrameRef.current = null;
    }
    if (closeTimeoutRef.current !== null) {
      globalThis.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    cancelPending();
    setIsMounted(true);
    setIsPositionReady(false);
    setIsVisible(false);
    setIsOpen(true);
  }, [cancelPending]);

  const close = useCallback(() => {
    //? Return focus to the opener only when focus is currently INSIDE the panel
    //? (e.g. Escape with a calendar day focused). An outside-click close has
    //? already moved focus elsewhere — don't yank it back.
    const restoreFocus = panelRef.current?.contains(document.activeElement) ?? false;

    setIsOpen(false);
    setIsVisible(false);

    if (showFrameRef.current !== null) {
      cancelAnimationFrame(showFrameRef.current);
      showFrameRef.current = null;
    }
    if (closeTimeoutRef.current !== null) globalThis.clearTimeout(closeTimeoutRef.current);

    closeTimeoutRef.current = globalThis.setTimeout(() => {
      setIsMounted(false);
      setIsPositionReady(false);
      closeTimeoutRef.current = null;
      if (restoreFocus) {
        const opener = triggerRef.current?.querySelector<HTMLElement>('button, [tabindex]') ?? triggerRef.current;
        opener?.focus();
      }
      onClose?.();
    }, ANIMATION_MS);
  }, [onClose]);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  // Outside-click closes — only while open.
  useEffect(() => {
    if (!isOpen || !closeOnOutsideClick) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => { document.removeEventListener("mousedown", handleMouseDown); };
  }, [isOpen, closeOnOutsideClick, close]);

  // Escape closes — only while open.
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); };
  }, [isOpen, closeOnEscape, close]);

  // Reposition on scroll/resize while mounted.
  useEffect(() => {
    if (!isMounted) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isMounted, updatePosition]);

  // First-mount position calc, before paint.
  useLayoutEffect(() => {
    if (!isMounted || !isOpen || isPositionReady) return;
    updatePosition();
    setIsPositionReady(true);
  }, [isMounted, isOpen, isPositionReady, updatePosition]);

  // Trigger the visibility transition once positioned.
  useEffect(() => {
    if (!isMounted || !isOpen || !isPositionReady || isVisible) return;
    showFrameRef.current = requestAnimationFrame(() => {
      showFrameRef.current = requestAnimationFrame(() => {
        setIsVisible(true);
        showFrameRef.current = null;
      });
    });
    return () => {
      if (showFrameRef.current !== null) {
        cancelAnimationFrame(showFrameRef.current);
        showFrameRef.current = null;
      }
    };
  }, [isMounted, isOpen, isPositionReady, isVisible]);

  // Cleanup on unmount.
  useEffect(() => cancelPending, [cancelPending]);

  return {
    isOpen,
    isMounted,
    isVisible,
    isPositionReady,
    resolvedPlacement,
    position,
    triggerRef,
    panelRef,
    open,
    close,
    toggle,
    reposition: updatePosition,
  };
}

const hiddenStateClass = (side: FloatingPlacement) =>
  side === "top"
    ? "opacity-0 scale-95 translate-y-1 pointer-events-none"
    : "opacity-0 scale-95 -translate-y-1 pointer-events-none";

export interface FloatingPanelProps {
  controller: FloatingLayerController;
  /** Extra classes for the floating panel surface. */
  className?: string;
  /** Set min-width to the trigger's width (handy for menu-style panels). */
  matchTriggerWidth?: boolean;
  children: ReactNode;
}

/** Portals its children into a positioned, animated panel anchored to the controller's trigger. */
export function FloatingPanel({ controller, className = "", matchTriggerWidth = false, children }: FloatingPanelProps) {
  if (!controller.isMounted) return null;

  const stateClass = controller.isPositionReady && controller.isVisible
    ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
    : hiddenStateClass(controller.resolvedPlacement);

  return createPortal(
    <div
      ref={controller.panelRef}
      style={{
        top: controller.position.top,
        left: controller.position.left,
        minWidth: matchTriggerWidth ? controller.position.triggerWidth : undefined,
      }}
      className={`fixed z-[9999] rounded-lg border border-container1-border bg-container1 shadow-lg
        ${controller.isPositionReady ? "transition duration-200 ease-out" : ""}
        ${controller.resolvedPlacement === "top" ? "origin-bottom" : "origin-top"}
        ${className} ${stateClass}`}
      onMouseDown={(event) => { event.stopPropagation(); }}
    >
      {children}
    </div>,
    document.body,
  );
}
