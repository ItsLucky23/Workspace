import { ReactNode, useId } from "react";

import { FieldSize } from "./fieldShell";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Label shown beside the switch. */
  label?: ReactNode;
  /** Helper text under the label. */
  description?: ReactNode;
  size?: FieldSize;
  disabled?: boolean;
  /** Put the label before the switch instead of after. */
  labelPosition?: "left" | "right";
  className?: string;
  /** Accessible name when no visible label is provided. */
  ariaLabel?: string;
}

const TRACK: Record<FieldSize, string> = {
  sm: "w-8 h-4.5",
  md: "w-10 h-5.5",
  lg: "w-12 h-6.5",
};
const KNOB: Record<FieldSize, string> = {
  sm: "w-3.5 h-3.5",
  md: "w-4.5 h-4.5",
  lg: "w-5.5 h-5.5",
};
const TRANSLATE: Record<FieldSize, string> = {
  sm: "translate-x-3.5",
  md: "translate-x-4.5",
  lg: "translate-x-5.5",
};
const LABEL_TEXT: Record<FieldSize, string> = {
  sm: "text-sm",
  md: "text-sm",
  lg: "text-base",
};

/** A primary-coloured on/off switch with a smoothly sliding knob. */
export default function Toggle({
  checked,
  onChange,
  label,
  description,
  size = "md",
  disabled = false,
  labelPosition = "right",
  className = "",
  ariaLabel,
}: ToggleProps) {
  const labelId = useId();

  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      disabled={disabled}
      onClick={() => { onChange(!checked); }}
      className={`relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200 outline-none
        focus-visible:ring-2 focus-visible:ring-primary/40
        ${TRACK[size]}
        ${checked ? "bg-primary border-primary-border" : "bg-container2 border-container2-border"}
        ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block rounded-full bg-container1 shadow-sm transition-transform duration-200 ml-0.5
          ${KNOB[size]} ${checked ? TRANSLATE[size] : "translate-x-0"}`}
      />
    </button>
  );

  if (!label && !description) {
    return <div className={`inline-flex ${className}`}>{control}</div>;
  }

  return (
    <div className={`flex items-center gap-3 ${labelPosition === "left" ? "flex-row-reverse justify-end" : ""} ${className}`}>
      {control}
      <div className="flex flex-col">
        {label && <span id={labelId} className={`font-medium text-title ${LABEL_TEXT[size]}`}>{label}</span>}
        {description && <span className="text-xs text-muted">{description}</span>}
      </div>
    </div>
  );
}
