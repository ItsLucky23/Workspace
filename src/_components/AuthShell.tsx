//? The auth surfaces (/login, /register, /reset-password) each rendered a bare card in an empty
//? viewport: no logo, no product name, nothing telling a first-time visitor WHAT they are signing
//? in to. AuthShell is the single place that answers that — brand mark + wordmark + one line of
//? what Workspaces is, on a calm token-built ground — so the three pages only supply their form
//? and their footer link.
//?
//? It also owns the auth form-control vocabulary (input/button classes, the password field with its
//? show/hide toggle, the step-swap motion) because all three pages need exactly the same controls
//? and the shared workspaces layer has no form-control primitive.

/* eslint-disable react-refresh/only-export-components -- auth shell module: the control classes + step-motion preset are intentionally co-located with the components that consume them (dev-only fast-refresh rule; these aren't route components) */
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, type ReactNode, type RefObject } from "react";

import { useTranslator } from "@luckystack/core/client";
import { Reveal } from "src/workspaces/_components/motion";

//? 44px (h-11) is the comfortable tap minimum (WCAG 2.5.5). The auth screen is the first thing a
//? phone user touches, so every control here — inputs and buttons alike — is sized for a thumb.
export const AUTH_INPUT_CLASS =
  "rounded-lg w-full h-11 border border-container1-border bg-container1 px-3 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";

export const AUTH_BUTTON_CLASS =
  "h-11 rounded-lg bg-primary text-title-primary text-sm font-semibold hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-container1";

//? Every step in these forms (spinner → form, password ⇄ email-code, credentials → 2FA, form →
//? success) used to swap in a single frame, which reads as a glitch on a screen the user is staring
//? at. A short fade+lift makes the same swap read as a deliberate step. Fade rather than height so
//? no `overflow-hidden` wrapper clips the inputs' focus rings.
export const AUTH_STEP_MOTION = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

export default function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const translate = useTranslator();

  return (
    <div className="relative w-full h-full overflow-y-auto bg-background text-title">
      {/* Two soft accent washes give the otherwise empty ground depth without inventing a colour:
          the teal focus accent above, the scarce warm accent below. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 w-[30rem] h-[30rem] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-44 -right-32 w-[28rem] h-[28rem] rounded-full bg-secondary/10 blur-3xl" />
      </div>

      <div className="relative min-h-full w-full flex flex-col items-center justify-center gap-7 px-4 py-12">
        <Reveal className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-2xl bg-primary text-title-primary flex items-center justify-center text-lg font-bold shadow-sm">
              {translate({ key: 'workspaces.shell.brandInitial' })}
            </span>
            <span className="text-2xl font-semibold tracking-tightest">{translate({ key: 'workspaces.shell.brand' })}</span>
          </div>
          <p className="max-w-[22rem] text-sm text-muted">{translate({ key: 'login.tagline' })}</p>
        </Reveal>

        <Reveal index={1} className="w-full max-w-[400px]">
          <div className="rounded-2xl border border-container1-border bg-container1 shadow-lg p-6 sm:p-7">
            {children}
          </div>
        </Reveal>

        {footer !== undefined && <div className="text-xs text-meta text-center">{footer}</div>}
      </div>
    </div>
  );
}

//? A password input with a show/hide toggle + optional policy hint. Typing a brand-new password
//? twice with no way to see it is the classic "passwords don't match" dead end, and the policy was
//? only discoverable by failing a round-trip. The toggle carries a translated accessible name and
//? `aria-pressed` so it announces its state to a screen reader.
export function PasswordField({ id, name, label, autoComplete, inputRef, hint, trailing, required, onChange }: {
  id: string;
  name?: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  inputRef?: RefObject<HTMLInputElement | null>;
  hint?: string;
  trailing?: ReactNode;
  required?: boolean;
  onChange?: () => void;
}) {
  const translate = useTranslator();
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-medium text-xs">{label}</label>
        {trailing}
      </div>
      <div className="relative">
        <input
          id={id}
          name={name ?? id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          onChange={onChange}
          placeholder="********"
          className={`${AUTH_INPUT_CLASS} pr-11`}
        />
        <button
          type="button"
          onClick={() => { setVisible((v) => !v); }}
          aria-pressed={visible}
          aria-label={translate({ key: visible ? 'login.hidePassword' : 'login.showPassword' })}
          className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-muted hover:text-title transition-colors cursor-pointer rounded-r-lg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/60"
        >
          <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} />
        </button>
      </div>
      {hint !== undefined && <p className="text-xs text-meta">{hint}</p>}
    </div>
  );
}
