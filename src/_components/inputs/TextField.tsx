import { faChevronDown, faChevronUp, faEye, faEyeSlash, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { InputHTMLAttributes, ReactNode, useId, useState } from "react";

import {
  FieldShell,
  FieldSize,
  FIELD_SIZES,
  inputBoxClass,
  useErrorPulse,
  useShake,
} from "./fieldShell";

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "value" | "onChange" | "type" | "prefix"
>;

export type TextFieldType = "text" | "email" | "password" | "number" | "tel" | "url" | "search";

export interface TextFieldProps extends NativeInputProps {
  value: string;
  /** Fired with the raw string value on every keystroke. */
  onChange: (value: string) => void;
  type?: TextFieldType;
  label?: ReactNode;
  description?: ReactNode;
  /** Error message; flips the control to the error style and shakes it. */
  error?: ReactNode;
  required?: boolean;
  size?: FieldSize;
  /** Icon rendered inside the box, leading. */
  leftIcon?: IconDefinition;
  /** Icon rendered inside the box, trailing (ignored for password — the reveal toggle wins). */
  rightIcon?: IconDefinition;
  /** Static text adornment before the input (e.g. "https://"). */
  prefix?: ReactNode;
  /** Static text adornment after the input (e.g. "kg"). */
  suffix?: ReactNode;
  /** Show a clear (×) button while there's a value. */
  clearable?: boolean;
  /** Show a character counter; pairs with `maxLength`. */
  showCount?: boolean;
  className?: string;
  // number-only knobs (ignored unless type="number")
  min?: number;
  max?: number;
  step?: number;
  /** Show +/- stepper buttons for number inputs. Default true. */
  showStepper?: boolean;
}

const ADORNMENT_BTN = "flex items-center justify-center text-muted hover:text-title transition-colors cursor-pointer";

/**
 * The framework's standard single-line input. One component covers text,
 * email, password (with reveal), number (custom steppers, no native arrows),
 * tel, url and search — with icons, prefix/suffix, clear button, char counter
 * and an error-shake. All copy is supplied via props.
 */
export default function TextField({
  value,
  onChange,
  type = "text",
  label,
  description,
  error,
  required = false,
  size = "md",
  leftIcon,
  rightIcon,
  prefix,
  suffix,
  clearable = false,
  showCount = false,
  className = "",
  min,
  max,
  step = 1,
  showStepper = true,
  disabled,
  maxLength,
  id,
  ...rest
}: TextFieldProps) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const [revealed, setRevealed] = useState(false);
  const { ref: shakeRef, shake } = useShake<HTMLDivElement>();
  useErrorPulse(error, shake);

  const hasError = Boolean(error);
  const sizing = FIELD_SIZES[size];
  const isPassword = type === "password";
  const isNumber = type === "number";
  const resolvedType = isPassword ? (revealed ? "text" : "password") : type;

  const clampNumber = (next: number): number => {
    let n = next;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);
    return n;
  };

  const nudge = (direction: 1 | -1) => {
    if (disabled) return;
    const current = value.trim() === "" ? 0 : Number(value);
    if (Number.isNaN(current)) return;
    const next = clampNumber(current + direction * step);
    onChange(String(next));
  };

  // Hide native number spinners — we render our own stepper.
  const noNativeSpinner = isNumber
    ? "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0"
    : "";

  const showClear = clearable && !disabled && value.length > 0;

  return (
    <FieldShell
      label={label}
      htmlFor={inputId}
      description={description}
      error={error}
      required={required}
      size={size}
      className={className}
      labelAside={showCount && typeof maxLength === "number"
        ? `${String(value.length)}/${String(maxLength)}`
        : undefined}
    >
      <div ref={shakeRef} className={inputBoxClass({ size, hasError, disabled })}>
        {leftIcon && <FontAwesomeIcon icon={leftIcon} className={`${sizing.icon} text-muted shrink-0`} />}
        {prefix && <span className="text-muted shrink-0 select-none">{prefix}</span>}

        <input
          id={inputId}
          type={resolvedType}
          value={value}
          disabled={disabled}
          maxLength={maxLength}
          inputMode={isNumber ? "decimal" : rest.inputMode}
          min={isNumber ? min : undefined}
          max={isNumber ? max : undefined}
          step={isNumber ? step : undefined}
          onChange={(event) => { onChange(event.target.value); }}
          className={`min-w-0 flex-1 bg-transparent text-title outline-none placeholder:text-muted disabled:cursor-not-allowed ${noNativeSpinner}`}
          {...rest}
        />

        {suffix && <span className="text-muted shrink-0 select-none">{suffix}</span>}

        {showClear && (
          <button type="button" tabIndex={-1} aria-label="Clear" onClick={() => { onChange(""); }} className={`${ADORNMENT_BTN} ${sizing.icon} shrink-0`}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        )}

        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={revealed ? "Hide" : "Show"}
            onClick={() => { setRevealed((r) => !r); }}
            className={`${ADORNMENT_BTN} ${sizing.icon} shrink-0`}
          >
            <FontAwesomeIcon icon={revealed ? faEyeSlash : faEye} />
          </button>
        )}

        {!isPassword && rightIcon && !showClear && (
          <FontAwesomeIcon icon={rightIcon} className={`${sizing.icon} text-muted shrink-0`} />
        )}

        {isNumber && showStepper && (
          <div className="flex flex-col shrink-0 -mr-1">
            <button type="button" tabIndex={-1} aria-label="Increment" disabled={disabled} onClick={() => { nudge(1); }} className={`${ADORNMENT_BTN} h-3 px-1 text-[10px] leading-none disabled:cursor-not-allowed`}>
              <FontAwesomeIcon icon={faChevronUp} />
            </button>
            <button type="button" tabIndex={-1} aria-label="Decrement" disabled={disabled} onClick={() => { nudge(-1); }} className={`${ADORNMENT_BTN} h-3 px-1 text-[10px] leading-none disabled:cursor-not-allowed`}>
              <FontAwesomeIcon icon={faChevronDown} />
            </button>
          </div>
        )}
      </div>
    </FieldShell>
  );
}
