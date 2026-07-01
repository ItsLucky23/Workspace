import { faCheck, faMinus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, useId } from "react";

import { FieldSize, useErrorPulse, useShake } from "./fieldShell";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  /** Render a dash instead of a check (mixed state). Visual only. */
  indeterminate?: boolean;
  /** Error message; flips the box to the error colour and shakes it. */
  error?: ReactNode;
  size?: FieldSize;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

const BOX: Record<FieldSize, string> = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};
const ICON: Record<FieldSize, string> = {
  sm: "text-[9px]",
  md: "text-[11px]",
  lg: "text-sm",
};
const LABEL_TEXT: Record<FieldSize, string> = {
  sm: "text-sm",
  md: "text-sm",
  lg: "text-base",
};

/** A checkbox whose checked state fills with the primary colour (not the default grey). */
export default function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate = false,
  error,
  size = "md",
  disabled = false,
  className = "",
  ariaLabel,
}: CheckboxProps) {
  const labelId = useId();
  const { ref: shakeRef, shake } = useShake<HTMLDivElement>();
  useErrorPulse(error, shake);

  const active = checked || indeterminate;
  const hasError = Boolean(error);

  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      disabled={disabled}
      onClick={() => { onChange(!checked); }}
      className={`flex shrink-0 items-center justify-center rounded-md border transition-colors duration-150 outline-none
        focus-visible:ring-2 focus-visible:ring-primary/40
        ${BOX[size]}
        ${active
          ? "bg-primary border-primary-border text-title-primary"
          : (hasError ? "bg-container1 border-wrong" : "bg-container1 border-container2-border hover:border-primary")}
        ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className={`transition-transform duration-150 ${active ? "scale-100" : "scale-0"}`}>
        <FontAwesomeIcon icon={indeterminate ? faMinus : faCheck} className={ICON[size]} />
      </span>
    </button>
  );

  if (!label && !description) {
    return <div ref={shakeRef} className={`inline-flex ${className}`}>{box}</div>;
  }

  return (
    <div ref={shakeRef} className={`flex items-start gap-2.5 ${className}`}>
      {box}
      <div className="flex flex-col">
        {label && (
          <span id={labelId} className={`font-medium text-title ${LABEL_TEXT[size]}`}>
            {label}
          </span>
        )}
        {description && <span className="text-xs text-muted">{description}</span>}
        {hasError && <span className="text-xs text-wrong">{error}</span>}
      </div>
    </div>
  );
}
