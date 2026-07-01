import { ReactNode, useCallback, useEffect, useRef } from "react";

import {
  FloatingAlign,
  FloatingPanel,
  FloatingPlacement,
  useFloatingLayer,
} from "./floatingLayer";

export interface PopoverProps {
  /** The element that opens the popover. */
  children: ReactNode;
  /** The floating content. */
  content: ReactNode;
  /** How the popover opens. Default "click". */
  trigger?: "click" | "hover";
  /** Preferred side; auto-flips when there's no room. Default "bottom". */
  placement?: FloatingPlacement;
  /** Horizontal alignment against the trigger. Default "center". */
  align?: FloatingAlign;
  /** Padding/look of the content surface. Set "none" for a bare panel. Default "md". */
  padding?: "none" | "sm" | "md";
  /** Extra classes for the floating panel. */
  className?: string;
  /** Match the panel's min-width to the trigger width. */
  matchTriggerWidth?: boolean;
  /** Hover open/close grace period in ms. Default 120. */
  hoverDelay?: number;
  /** Controlled open state. Omit for uncontrolled. */
  open?: boolean;
  /** Notified on open/close in both modes. */
  onOpenChange?: (open: boolean) => void;
  /** Disable the trigger entirely. */
  disabled?: boolean;
  /** Accessible name for the popover dialog (recommended for screen readers). */
  ariaLabel?: string;
}

const PADDING_CLASS: Record<NonNullable<PopoverProps["padding"]>, string> = {
  none: "",
  sm: "p-2",
  md: "p-3",
};

/**
 * Smooth, accessible popover anchored to its trigger — same fade/scale
 * choreography as the framework dropdowns. Click or hover triggered,
 * controlled or uncontrolled.
 */
export default function Popover({
  children,
  content,
  trigger = "click",
  placement = "bottom",
  align = "center",
  padding = "md",
  className = "",
  matchTriggerWidth = false,
  hoverDelay = 120,
  open,
  onOpenChange,
  disabled = false,
  ariaLabel,
}: PopoverProps) {
  const isControlled = open !== undefined;
  const controller = useFloatingLayer({
    placement,
    align,
    closeOnOutsideClick: trigger === "click",
    closeOnEscape: true,
    onClose: () => { onOpenChange?.(false); },
  });

  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestOpen = useCallback(() => {
    if (disabled) return;
    onOpenChange?.(true);
    if (!isControlled) controller.open();
  }, [disabled, isControlled, controller, onOpenChange]);

  const requestClose = useCallback(() => {
    if (isControlled) { onOpenChange?.(false); return; }
    controller.close();
  }, [isControlled, controller, onOpenChange]);

  // Sync controlled open state into the layer.
  useEffect(() => {
    if (!isControlled) return;
    if (open && !controller.isOpen) controller.open();
    if (!open && controller.isOpen) controller.close();
  }, [isControlled, open, controller]);

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current !== null) {
      globalThis.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const handleHoverEnter = useCallback(() => {
    if (trigger !== "hover") return;
    clearHoverTimeout();
    requestOpen();
  }, [trigger, clearHoverTimeout, requestOpen]);

  const handleHoverLeave = useCallback(() => {
    if (trigger !== "hover") return;
    clearHoverTimeout();
    hoverTimeoutRef.current = globalThis.setTimeout(requestClose, hoverDelay);
  }, [trigger, clearHoverTimeout, requestClose, hoverDelay]);

  useEffect(() => clearHoverTimeout, [clearHoverTimeout]);

  const handleClick = () => {
    if (trigger !== "click" || disabled) return;
    if (controller.isOpen) requestClose();
    else requestOpen();
  };

  return (
    <div
      ref={controller.triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
    >
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="dialog"
        aria-expanded={controller.isOpen}
        aria-disabled={disabled}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (trigger !== "click" || disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
          }
        }}
        className={`inline-flex outline-none ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        {children}
      </div>

      <FloatingPanel
        controller={controller}
        className={className}
        matchTriggerWidth={matchTriggerWidth}
      >
        {/* Intentionally NON-modal (closes on outside-click, does not trap focus),
            so `aria-modal` is deliberately omitted — setting it true would lie to
            assistive tech. A non-modal `role="dialog"` should carry an accessible
            name, hence `aria-label`. */}
        <div
          role="dialog"
          aria-label={ariaLabel}
          className={`text-sm text-common ${PADDING_CLASS[padding]}`}
          onMouseEnter={handleHoverEnter}
          onMouseLeave={handleHoverLeave}
        >
          {content}
        </div>
      </FloatingPanel>
    </div>
  );
}
