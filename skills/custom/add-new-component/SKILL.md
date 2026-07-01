# Skill: add-new-component

Scaffold a new reusable UI component under `src/_components/` (inputs live in `src/_components/inputs/`) that matches the framework's conventions, then mirror it into the `create-luckystack-app` template so it ships to consumers.

LuckyStack components are plain default-exported React 19 components. There is no routing or codegen for components — the value of this skill is consistency: reusing the shared primitives (`fieldShell`, `floatingLayer`), the `@theme` colour tokens, controlled+uncontrolled support, and the i18n rules, instead of rolling a parallel implementation.

## Workflow

### 1. Check what already exists FIRST — do NOT duplicate

Before authoring anything, confirm nothing already covers the use case:

- **`docs/AI_CAPABILITIES.md`** — the auto-generated capability snapshot. Grep it for the primitive you're about to build.
- **The "Component Reference" table in the root `CLAUDE.md`** — `Dropdown`, `MultiSelectDropdown`, `MenuHandler` / `menuHandler.confirm`, `Avatar`, `Navbar`, `ErrorPage`, `Middleware`, `TemplateProvider`.
- **`src/_components/inputs/`** — the input primitives: `TextField`, `Toggle`, `Checkbox`, `DatePicker`, `Popover`, plus the shared internals `fieldShell.tsx`, `floatingLayer.tsx`, `dateUtils.ts`.

If a component already does the job, **extend it (add a prop) or compose it** — never fork a parallel version. Only create a new file when no existing component and no combination of existing components can cover the use case. If the surface belongs in a not-yet-installed `@luckystack/*` package (see `docs/PACKAGE_OVERVIEW.md`), propose the install instead.

### 2. Pick the right primitive to build on

| Building… | Reuse |
|---|---|
| A form input (label + control + error) | `FieldShell` + `inputBoxClass` + `useShake` / `useErrorPulse` from `./fieldShell` |
| Anything anchored / overlaid (popover, menu, calendar, tooltip) | `useFloatingLayer` + `FloatingPanel` from `./floatingLayer` — gives the smooth mount → measure → fade-in → fade-out portal choreography for free |
| A listbox-style picker with search/keyboard nav | extend the existing `Dropdown` (`dropdownInternals.tsx`), don't re-implement |

Do NOT hand-roll positioning, outside-click, Escape handling, or fade animations — `floatingLayer` already solves them.

### 3. Hard rules for every component

- **Default-export** the component: `export default function MyThing(...)`. Co-located helpers/hooks may be named exports.
- **Colours come ONLY from the `@theme` tokens in `src/index.css`** — `bg-container1`, `text-title`, `text-muted`, `border-container1-border`, `text-wrong`, `bg-primary`, `text-correct`, etc. (full list: the "Tailwind Color Tokens" table in `CLAUDE.md`). NEVER an arbitrary hex/`rgb()` value — the `luckystack/no-arbitrary-tailwind-color` lint rule fails the build on `bg-[#...]`, `text-[rgb(...)]`, and friends.
- **No raw user-facing JSX text literals** — `react/jsx-no-literals` is on. Every visible string is either:
  - a prop (`label`, `description`, `error`, `placeholder`, `aria-label`) supplied by the caller — preferred for primitives, OR
  - resolved via `useTranslator` from `src/_functions/translator` when the component itself owns copy, OR
  - produced by `Intl` (e.g. number/date formatting).
  - `aria-label`/`placeholder`/`title` attribute strings are fine inline; visible text nodes are not.
- **Controlled + uncontrolled support**: accept `value` + `onChange` for controlled use, and a `defaultValue` for uncontrolled (track internal state, fall back to it when `value` is `undefined`). Mirror the prop shapes already used by `TextField` / `Toggle` / `Checkbox`.
- **Sizes**: support `size?: 'sm' | 'md' | 'lg'` and route sizing through the shared `FIELD_SIZES` map (from `./fieldShell`) for inputs, so spacing/typography stay consistent. Default to `'md'`.
- **`className` passthrough** for the wrapper, merged last.
- Use backticks in every `className`. Self-close childless tags. Reuse the `tryCatch` from `@luckystack/core` if the component does async work.

### 4. Starter template — simple input-style component

Save to `src/_components/inputs/{Name}.tsx`. This is a minimal field that reuses `FieldShell` for the label/error/shake scaffold and `FIELD_SIZES` for sizing:

```tsx
import { ReactNode, useId, useState } from "react";

import {
  FieldShell,
  FieldSize,
  FIELD_SIZES,
  inputBoxClass,
  useErrorPulse,
  useShake,
} from "./fieldShell";

export interface MyFieldProps {
  /** Controlled value. Omit to run uncontrolled (see `defaultValue`). */
  value?: string;
  /** Uncontrolled initial value. Ignored when `value` is provided. */
  defaultValue?: string;
  /** Fired with the new value on every change. */
  onChange?: (value: string) => void;
  /** Label above the control — supplied by the caller (no literal copy here). */
  label?: ReactNode;
  description?: ReactNode;
  /** Error message; flips the control to the error style and shakes it. */
  error?: ReactNode;
  required?: boolean;
  size?: FieldSize;
  disabled?: boolean;
  /** Accessible placeholder — attribute string, allowed inline. */
  placeholder?: string;
  className?: string;
}

/** One-line description of what this primitive is for. All visible copy arrives via props. */
export default function MyField({
  value,
  defaultValue = "",
  onChange,
  label,
  description,
  error,
  required = false,
  size = "md",
  disabled,
  placeholder,
  className = "",
}: MyFieldProps) {
  const inputId = useId();
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internal;

  const { ref: shakeRef, shake } = useShake<HTMLDivElement>();
  useErrorPulse(error, shake);

  const hasError = Boolean(error);

  const commit = (next: string) => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <FieldShell
      label={label}
      htmlFor={inputId}
      description={description}
      error={error}
      required={required}
      size={size}
      className={className}
    >
      <div ref={shakeRef} className={inputBoxClass({ size, hasError, disabled })}>
        <input
          id={inputId}
          value={current}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => { commit(event.target.value); }}
          className={`min-w-0 flex-1 bg-transparent text-title outline-none placeholder:text-muted disabled:cursor-not-allowed ${FIELD_SIZES[size].text}`}
        />
      </div>
    </FieldShell>
  );
}
```

For an anchored/overlay component instead, drop `FieldShell` and build on `useFloatingLayer` + `FloatingPanel` from `./floatingLayer` (see `Popover.tsx` / `DatePicker.tsx` for the full pattern).

### 5. Mirror the file into the consumer template

The component must ship to scaffolded apps. Copy the exact file you just wrote into the matching path under the template:

- `src/_components/inputs/{Name}.tsx` → `packages/create-luckystack-app/template/src/_components/inputs/{Name}.tsx`
- `src/_components/{Name}.tsx` → `packages/create-luckystack-app/template/src/_components/{Name}.tsx`

If you also added or touched a shared internal (`fieldShell.tsx`, `floatingLayer.tsx`, `dateUtils.ts`, `dropdownInternals.tsx`), mirror that change too. Keep the two copies byte-identical — the template is the source consumers get.

### 6. Refresh the capability snapshot, then lint + build

Run autonomously, in order:

- `npm run ai:capabilities` — re-scans `src/_components/` so the new component shows up in `docs/AI_CAPABILITIES.md` (and future sessions won't re-build it).
- `npm run lint` — must pass with zero warnings. This is where `luckystack/no-arbitrary-tailwind-color` and `react/jsx-no-literals` violations surface.
- `npm run build` — must pass with zero errors.

If lint flags an arbitrary colour, swap it for the nearest `@theme` token. If it flags a JSX literal, lift the string to a prop or route it through `useTranslator`.

### 7. Decisions to make consciously

- **Controlled vs uncontrolled defaults** — does the caller own state, or should the component? Support both; default behaviour should match the sibling inputs.
- **Which token** — pick the semantically correct surface/text token (`container1` vs `container2`, `muted` vs `disabled`, `wrong` for errors), not just whatever looks right.
- **Accessibility** — wire `htmlFor`/`id`, `aria-*`, keyboard handling. `FieldShell` and `floatingLayer` cover most of it; fill the gaps.
- **Does this belong as a prop on an existing component instead of a new file?** Re-ask this before committing to a new component.

### 8. Deep dive

- Shared input scaffold: `src/_components/inputs/fieldShell.tsx`.
- Anchored-layer choreography: `src/_components/inputs/floatingLayer.tsx` (and the Dropdown's own copy, `src/_components/dropdownInternals.tsx`).
- Colour tokens: the `@theme` block in `src/index.css` and the "Tailwind Color Tokens" table in the root `CLAUDE.md`.
- Existing-component matrix: the "Component Reference" table in `CLAUDE.md` and `docs/AI_CAPABILITIES.md`.
