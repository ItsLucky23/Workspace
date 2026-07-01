/* eslint-disable react-refresh/only-export-components -- shared field primitives colocated with helpers */
import { ReactNode, useCallback, useEffect, useRef } from "react";

//? Shared building blocks for the form inputs (TextField, Toggle, Checkbox,
//? DatePicker). Keeps label/description/error markup, sizing tokens and the
//? error-shake animation in one place so every input looks and behaves the
//? same. All user-facing strings arrive as props — no hardcoded copy.

export type FieldSize = "sm" | "md" | "lg";

export const FIELD_SIZES: Record<FieldSize, { control: string; text: string; icon: string }> = {
  sm: { control: "h-8 px-2.5", text: "text-sm", icon: "text-xs" },
  md: { control: "h-9 px-3", text: "text-sm", icon: "text-sm" },
  lg: { control: "h-11 px-3.5", text: "text-base", icon: "text-base" },
};

/** Base classes for a bordered input box, reacting to size/error/disabled state. */
export const inputBoxClass = (args: { size: FieldSize; hasError: boolean; disabled?: boolean }): string => {
  const sizing = FIELD_SIZES[args.size];
  const border = args.hasError
    ? "border-wrong focus-within:border-wrong focus-within:ring-2 focus-within:ring-wrong/30"
    : "border-container1-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30";
  const state = args.disabled ? "opacity-60 cursor-not-allowed" : "";
  return `flex items-center gap-2 w-full rounded-md border bg-container1 text-title transition-colors
    ${sizing.control} ${sizing.text} ${border} ${state}`;
};

/** A horizontal shake on demand — used to flag invalid input. No CSS keyframes needed. */
export function useShake<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const shake = useCallback(() => {
    ref.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(5px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 360, easing: "ease-in-out" },
    );
  }, []);
  return { ref, shake };
}

export interface FieldShellProps {
  /** Optional label rendered above the control. */
  label?: ReactNode;
  /** `id` of the control the label points at. */
  htmlFor?: string;
  /** Helper text under the control (hidden while an error is shown). */
  description?: ReactNode;
  /** Error message; when set, the control flips to the error style. */
  error?: ReactNode;
  /** Show a "*" after the label. */
  required?: boolean;
  size?: FieldSize;
  /** Wrapper classes. */
  className?: string;
  /** Trailing node on the label row (e.g. a char counter). */
  labelAside?: ReactNode;
  children: ReactNode;
}

/** Standard label + control + description/error scaffold shared by every input. */
export function FieldShell({
  label,
  htmlFor,
  description,
  error,
  required = false,
  size = "md",
  className = "",
  labelAside,
  children,
}: FieldShellProps) {
  const hasError = Boolean(error);
  const showLabelRow = Boolean(label) || Boolean(labelAside);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {showLabelRow && (
        <div className="flex items-center justify-between gap-2">
          {label
            ? (
              <label htmlFor={htmlFor} className={`font-medium text-title ${FIELD_SIZES[size].text}`}>
                {label}
                {required && <span className="text-wrong"> *</span>}
              </label>
            )
            : <span />}
          {labelAside && <span className="text-xs text-muted">{labelAside}</span>}
        </div>
      )}

      {children}

      <div
        className={`overflow-hidden transition-all duration-200 ${hasError || description ? "max-h-20 opacity-100" : "max-h-0 opacity-0"}`}
      >
        {hasError
          ? <p className="text-xs text-wrong">{error}</p>
          : (description ? <p className="text-xs text-muted">{description}</p> : null)}
      </div>
    </div>
  );
}

/** Auto-trigger a callback when `error` goes from empty to set (used to fire the shake). */
export function useErrorPulse(error: ReactNode, onAppear: () => void): void {
  const prev = useRef<boolean>(Boolean(error));
  useEffect(() => {
    const now = Boolean(error);
    if (now && !prev.current) onAppear();
    prev.current = now;
  }, [error, onAppear]);
}
