//? Workspaces — shared UI primitives.
//?
//? Reuses `src/_components/Avatar` and `Dropdown` where they fit; everything
//? here is a workspace-specific primitive the base kit doesn't have yet
//? (StatusPill, LabelChip, Tabs, Toggle, Segmented, PopMenu, …). Tailwind +
//? theme tokens only — no arbitrary hex. Overlays close on outside-click +
//? Escape; transforms respect `prefers-reduced-motion` via `motion-reduce:`.

/* eslint-disable react-refresh/only-export-components -- shared primitives module: the useClickAway hook is intentionally co-located with the primitives that use it (dev-only fast-refresh rule; these aren't route components) */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useTranslator } from '@luckystack/core/client';

import BaseAvatar from 'src/_components/Avatar';
import BaseToggle from 'src/_components/inputs/Toggle';
//? The POSITIONED popover (floating layer, auto-flip, Escape, outside-click). Aliased because this
//? module already imports a same-named PRESENCE wrapper from ./motion — they do different jobs.
import FloatingPopover from 'src/_components/inputs/Popover';

import Icon, { type IconName } from './Icon';
import { Collapse, Popover } from './motion';
import type { Member, TicketStatus } from '../_data/types';

/* ----------------------------------------------------------------- focus ring */
//? ONE keyboard-focus affordance for every custom control. The audit found the branded ring on
//? two of six primitives and the bare UA outline on the rest, so tabbing through the app kept
//? changing appearance. Raw page-local buttons use the `.focus-ring` utility in src/index.css.
export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/60';

/* ----------------------------------------------------------------- click-away */
export function useClickAway<T extends HTMLElement>(active: boolean, onAway: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onAway(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, onAway]);
  return ref;
}

/* ----------------------------------------------------------------- avatars */
export function AvatarBubble({ user, size = 28 }: { user: Member | { name: string; avatar?: string; avatarFallback?: string }; size?: number }) {
  return (
    <div className="rounded-full overflow-hidden shrink-0" style={{ width: size, height: size }}>
      <BaseAvatar user={user} textSize={size <= 22 ? 'text-xs' : (size <= 30 ? 'text-sm' : 'text-base')} />
    </div>
  );
}

export function AvatarStack({ users, max = 3, size = 22 }: { users: Member[]; max?: number; size?: number }) {
  const translate = useTranslator();
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((u, i) => (
        <div key={u.id} className="rounded-full ring-2 ring-container1" style={{ marginLeft: i === 0 ? 0 : -size * 0.32 }}>
          <AvatarBubble user={u} size={size} />
        </div>
      ))}
      {extra > 0 && (
        <div
          className="rounded-full ring-2 ring-container1 bg-container2 text-muted flex items-center justify-center font-medium"
          style={{ width: size, height: size, marginLeft: -size * 0.32, fontSize: size * 0.4 }}
        >
          {translate({ key: 'workspaces.common.plusCount', params: [{ key: 'count', value: String(extra) }] })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- status pill */
const STATUS_META: Record<TicketStatus, { label: string; tint: string; dot: string; pulse?: boolean }> = {
  'needs-input': { label: 'workspaces.common.statusNeedsInput', tint: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  busy: { label: 'workspaces.common.statusBusy', tint: 'bg-primary/12 text-primary', dot: 'bg-primary', pulse: true },
  done: { label: 'workspaces.common.statusDone', tint: 'bg-correct/15 text-correct', dot: 'bg-correct' },
  idle: { label: 'workspaces.common.statusIdle', tint: 'bg-container2 text-muted', dot: 'bg-muted' },
  paused: { label: 'workspaces.common.statusPaused', tint: 'bg-container2 text-muted', dot: 'bg-muted' },
  stuck: { label: 'workspaces.common.statusStuck', tint: 'bg-warning/15 text-warning', dot: 'bg-warning', pulse: true },
};

export function statusColorVar(status: TicketStatus): string {
  return ({
    'needs-input': 'var(--color-warning)', busy: 'var(--color-primary)', done: 'var(--color-correct)',
    idle: 'var(--color-muted)', paused: 'var(--color-muted)', stuck: 'var(--color-warning)',
  })[status];
}

export function StatusPill({ status, dot = true }: { status: TicketStatus; dot?: boolean }) {
  const translate = useTranslator();
  const m = STATUS_META[status];
  return (
    //? inset ring: a flat tint on a tinted surface disappears — the hairline keeps the pill readable on any layer.
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ring-current/15 ${m.tint}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${m.pulse ? 'motion-safe:animate-pulse' : ''}`} />}
      {translate({ key: m.label })}
    </span>
  );
}

/* ----------------------------------------------------------------- label chip */
const LABEL_TINT: Record<string, string> = {
  bug: 'bg-wrong/12 text-wrong', security: 'bg-wrong/12 text-wrong',
  frontend: 'bg-primary/12 text-primary', feature: 'bg-primary/12 text-primary', mobile: 'bg-primary/12 text-primary',
  auth: 'bg-warning/15 text-warning', perf: 'bg-warning/15 text-warning', flaky: 'bg-warning/15 text-warning',
};
export function LabelChip({ name }: { name: string }) {
  const tint = LABEL_TINT[name] ?? 'bg-container2 text-common';
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tint}`}>{name}</span>;
}

/* ----------------------------------------------------------------- buttons */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
//? Filled variants carry a hairline inset highlight + contact shadow so they read as a
//? raised, pressable object instead of a flat colour rectangle; the ghost/secondary pair
//? stays quiet on purpose so one primary action per view keeps its weight.
const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-primary text-title-primary hover:bg-primary-hover shadow-xs hover:shadow-sm',
  secondary: 'bg-container1 text-title border border-container1-border hover:bg-container1-hover hover:border-container2-border shadow-2xs',
  ghost: 'text-common hover:bg-container2 hover:text-title',
  danger: 'bg-wrong text-white hover:bg-wrong-hover shadow-xs hover:shadow-sm',
};
//? The button SHELL, shared with `PopMenu`'s labelled trigger: a menu that opens the page's primary
//? action must look like that action, and copying this string to a call site is how the two drift.
const BTN_SHELL = 'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 h-9 text-sm font-semibold tracking-[-0.01em] transition-[color,background-color,box-shadow,border-color,transform] duration-150 ease-[var(--ease-soft)] cursor-pointer';

//? `ariaLabel` exists because half the call sites hide the text label on phones
//? (`hidden md:inline`), which removes it from the accessibility tree too — the button then
//? announces as nothing at all. It falls back to `title` so the many buttons that already pass
//? a tooltip get a name for free.
export function WsButton({ variant = 'primary', icon, children, onClick, title, ariaLabel, type = 'button', className = '', disabled = false }: {
  variant?: BtnVariant; icon?: IconName; children?: ReactNode; onClick?: () => void; title?: string; ariaLabel?: string; type?: 'button' | 'submit'; className?: string; disabled?: boolean;
}) {
  return (
    <button
      type={type} onClick={onClick} title={title} aria-label={ariaLabel ?? title} disabled={disabled}
      className={`${BTN_SHELL} ${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none motion-safe:active:scale-[0.97] ${BTN_VARIANT[variant]} ${className}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

//? `touch` is the 44px minimum a finger can reliably hit. This product is phone-first, yet every
//? icon-only control shipped at 28-32px — small enough that the audit found users mis-tapping the
//? neighbouring control. Use `touch` for anything a thumb reaches in a bar, sheet or card header.
const ICON_BTN_SIZE = { sm: 'w-8 h-8', md: 'w-9 h-9', touch: 'w-11 h-11' } as const;
export function IconButton({ icon, onClick, title, active, size = 'md', className = '' }: { icon: IconName; onClick?: () => void; title?: string; active?: boolean; size?: keyof typeof ICON_BTN_SIZE; className?: string }) {
  return (
    <button
      //? a11y (gap-fix): icon-only → the title doubles as the accessible name (falls back to the icon name).
      type="button" onClick={onClick} title={title} aria-label={title ?? icon}
      className={`inline-flex items-center justify-center ${ICON_BTN_SIZE[size]} rounded-xl text-muted transition-[color,background-color,transform] duration-150 ease-[var(--ease-soft)] cursor-pointer hover:bg-container2 hover:text-title ${FOCUS_RING} motion-safe:active:scale-90 ${active ? 'bg-container2 text-title' : ''} ${className}`}
    >
      <Icon name={icon} />
    </button>
  );
}

/* ----------------------------------------------------------------- tabs */
export interface TabDef { id: string; label: string; icon?: IconName; count?: number }
//? Real tablist semantics + roving tabIndex: a screen reader announces "tab 3 of 7" and the
//? arrow keys move between tabs, which is what a keyboard user expects from something that LOOKS
//? like tabs. Without this the strip was a row of anonymous buttons.
function moveFocus(ids: string[], current: string, delta: number, onChange: (id: string) => void) {
  const i = ids.indexOf(current);
  if (i === -1) return;
  const next = ids[(i + delta + ids.length) % ids.length];
  if (next !== undefined) onChange(next);
}

export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  const ids = tabs.map((t) => t.id);
  return (
    //? ws-no-scrollbar: the strip scrolls on narrow screens, but a visible scrollbar under the tabs reads as a rendering glitch
    <div role="tablist" className="flex items-center gap-1 border-b border-divider overflow-x-auto ws-no-scrollbar">
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id} type="button" onClick={() => { onChange(t.id); }}
            role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            //? Arrow keys live on the focusable tab itself, not on the tablist container — a
            //? non-focusable container with a key handler never receives the event anyway.
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              moveFocus(ids, active, e.key === 'ArrowRight' ? 1 : -1, onChange);
            }}
            className={`relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer rounded-t-lg ${FOCUS_RING} ${on ? 'text-title' : 'text-muted hover:text-common'}`}
          >
            {t.icon && <Icon name={t.icon} />}
            {t.label}
            {t.count != null && <span className="rounded-full bg-container2 px-1.5 text-xs text-muted">{t.count}</span>}
            {on && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- toggle */
//? Thin adapter over the base kit's switch (`src/_components/inputs/Toggle`), which already has
//? role="switch", aria-checked, a focus ring and a proper label association. This module used to
//? ship a SECOND, rival toggle with none of that — the one wired to skill-enable, doc aiEditable
//? and budget caps. Keeping the `{on, label}` signature so existing call sites are untouched;
//? pass `ariaLabel` whenever there is no visible label.
export function Toggle({ on, onChange, label, ariaLabel, disabled }: { on: boolean; onChange?: (next: boolean) => void; label?: ReactNode; ariaLabel?: string; disabled?: boolean }) {
  return (
    <BaseToggle
      checked={on}
      onChange={(next) => onChange?.(next)}
      label={label}
      ariaLabel={ariaLabel}
      disabled={disabled ?? false}
      size="sm"
    />
  );
}

/* ----------------------------------------------------------------- segmented */
//? `ariaLabel` is REQUIRED in practice whenever `label` is a bare icon (e.g. the sun/moon theme
//? segment) — an icon-only radio with no name announces as nothing at all.
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode; ariaLabel?: string }[]; value: T; onChange: (id: T) => void }) {
  const ids = options.map((o) => o.id);
  return (
    <div role="radiogroup" className="inline-flex items-center gap-0.5 rounded-xl bg-container2 p-0.5">
      {options.map((o) => (
        <button
          key={o.id} type="button" onClick={() => { onChange(o.id); }}
          role="radio" aria-checked={value === o.id} aria-label={o.ariaLabel} tabIndex={value === o.id ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            moveFocus(ids, value, e.key === 'ArrowRight' ? 1 : -1, (id) => { onChange(id as T); });
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-sm font-semibold whitespace-nowrap transition-colors duration-150 cursor-pointer ${FOCUS_RING} ${value === o.id ? 'bg-container1 text-title shadow-xs ring-1 ring-container1-border' : 'text-muted hover:text-common'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- section card */
export function SectionCard({ title, desc, right, children, className = '' }: { title?: ReactNode; desc?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-container1-border bg-container1 p-5 shadow-xs ${className}`}>
      {(title ?? right) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {title && <div className="text-base font-semibold tracking-[-0.015em] text-title">{title}</div>}
            {desc && <div className="text-sm text-muted mt-0.5">{desc}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- empty state */
export function EmptyState({ icon, title, sub, action }: { icon?: IconName; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {icon && <Icon name={icon} className="text-3xl text-disabled mb-3" />}
      <div className="text-sm font-medium text-common">{title}</div>
      {sub && <div className="text-sm text-muted mt-1 max-w-xs">{sub}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- info tip */
//? THE progressive-disclosure affordance (ADR 0312): the extra explanation a screen needs but should
//? not spend layout on. One implementation, so it behaves identically everywhere.
//?
//? It replaces a CSS-only `group-hover` tooltip that had two disqualifying faults. It opened on hover
//? ONLY — so on the phone this product is designed around, the explanation simply did not exist — and
//? it was a fixed `w-60` box positioned with `absolute`, so near a viewport edge or inside a scroll
//? container it clipped. This delegates to the framework Popover (floating layer: auto-flip,
//? outside-click, Escape, `aria-haspopup`), opens on click/Enter/Space everywhere, and ADDITIONALLY on
//? hover where the pointer supports it. Touch users get 44px via the coarse-pointer rule in index.css.
//?
//? `points` is what makes it worth having over a `title=` attribute: it answers "what are the other
//? parts of this, and where do I edit them?" — each row may deep-link to its owning surface. That is
//? the whole progressive-disclosure idea: say more without occupying the screen, and let the answer be
//? navigable rather than something the user has to go hunting for.
//?
//? House rule — an InfoTip may only answer one of: where does this value come from · what else
//? affects it · what happens if I change it. If it restates the label it is noise, and 200 of those
//? recreate the crowding it exists to relieve.
export interface InfoTipPoint {
  /** Stable identity for the row — usually the id of the thing it describes (a layer, a setting). */
  id: string;
  label: ReactNode;
  desc?: ReactNode;
  /** Deep-link to where this part is actually edited. Closes the tip first. */
  onGo?: () => void;
  goLabel?: ReactNode;
}

export function InfoTip({ title, body, points, align = 'center', label, icon, className }: {
  title?: ReactNode;
  body?: ReactNode;
  points?: InfoTipPoint[];
  align?: 'start' | 'center' | 'end';
  /** Accessible name for the trigger — say what it explains, not "info". */
  label?: string;
  icon?: IconName;
  className?: string;
}) {
  const translate = useTranslator();
  const [open, setOpen] = useState(false);
  //? Hover is an ENHANCEMENT, never the only way in: a coarse pointer has no hover state, and a
  //? keyboard user never fires one. Click/Enter/Space is the baseline.
  const [hoverCapable, setHoverCapable] = useState(false);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const mq = globalThis.matchMedia('(hover: hover) and (pointer: fine)');
    setHoverCapable(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => { setHoverCapable(e.matches); };
    mq.addEventListener('change', onChange);
    return () => { mq.removeEventListener('change', onChange); };
  }, []);

  const content = (
    <div className={`w-64 max-w-[min(16rem,calc(100vw-2rem))] flex flex-col gap-2`}>
      {title !== undefined && <div className={`text-xs font-semibold text-title break-words`}>{title}</div>}
      {body !== undefined && <div className={`text-xs text-common leading-relaxed break-words`}>{body}</div>}
      {points !== undefined && points.length > 0 && (
        <ol className={`flex flex-col gap-1.5`}>
          {points.map((point, index) => (
            <li key={point.id} className={`flex items-start gap-2 text-xs`}>
              <span className={`mt-0.5 w-4 h-4 shrink-0 rounded flex items-center justify-center bg-container2 text-meta text-[10px] font-bold tabular-nums`}>{index + 1}</span>
              <span className={`min-w-0 flex-1`}>
                <span className={`font-medium text-title break-words`}>{point.label}</span>
                {point.desc !== undefined && <span className={`block text-meta break-words`}>{point.desc}</span>}
                {point.onGo !== undefined && (
                  <button
                    type="button"
                    className={`min-h-0 mt-0.5 inline-flex items-center gap-1 text-primary hover:text-primary-hover font-medium cursor-pointer ${FOCUS_RING} rounded`}
                    onClick={() => { setOpen(false); point.onGo?.(); }}
                  >
                    {point.goLabel ?? translate({ key: 'workspaces.common.infoGo' })}
                    <Icon name="arrow-right" className={`text-[10px]`} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  //? Hover is delegated to the Popover rather than hand-rolled here, and that IS the fix.
  //?
  //? This used to open on the wrapper's `mouseenter` and close on its `mouseleave`. The panel renders
  //? in a floating layer OUTSIDE that wrapper, so moving the pointer toward the panel left the wrapper
  //? and shut it — you could only reach the contents by racing the cursor there. And because the panel
  //? was ALSO `trigger="click"`, a click on an already-hover-opened tip toggled it CLOSED, so the way
  //? in was: click to close, click again to open, and only then interact.
  //?
  //? `trigger="hover"` gives the whole thing to the component that owns both halves: it opens on the
  //? trigger, cancels the pending close when the pointer enters the PANEL, and closes `hoverDelay` ms
  //? after you leave either. It also makes `handleClick` a no-op, which is what the owner asked for.
  const keyToggle = (event: React.KeyboardEvent): void => {
    //? In click mode the Popover handles Enter/Space itself; doubling it would toggle twice.
    if (!hoverCapable) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setOpen((wasOpen) => !wasOpen);
  };

  return (
    <span className={`inline-flex shrink-0 ${className ?? ''}`} onKeyDown={keyToggle}>
      <FloatingPopover
        trigger={hoverCapable ? 'hover' : 'click'}
        //? Half a second to travel from the icon to the panel — long enough not to feel like the menu
        //? is running away from the pointer, short enough that it does not linger over the page.
        hoverDelay={500}
        placement="bottom"
        align={align}
        open={open}
        onOpenChange={setOpen}
        content={content}
        ariaLabel={label ?? translate({ key: 'workspaces.common.moreInfo' })}
      >
        <span className={`w-4 h-4 rounded-full bg-container2 text-muted text-[10px] font-bold flex items-center justify-center transition-colors hover:bg-primary/15 hover:text-primary ${open ? 'bg-primary/15 text-primary' : ''}`}>
          {icon === undefined ? '?' : <Icon name={icon} />}
          {/* The `ariaLabel` above names the popover PANEL, which is correct and deliberate — but it
              leaves the TRIGGER named "?" (or nothing at all when an icon is used). 95 of these ship,
              and "button, question mark" is what a screen reader announced for every one. This gives
              the trigger a real name without changing what anyone sees. */}
          <span className={`sr-only`}>{label ?? translate({ key: 'workspaces.common.moreInfo' })}</span>
        </span>
      </FloatingPopover>
    </span>
  );
}

//? The original call shape, kept so the 14 existing sites keep working — and so nobody has a reason to
//? reach for the old hover-only behaviour. Same component underneath.
export function InfoDot({ title, body, align = 'right' }: { title?: string; body: ReactNode; align?: 'left' | 'right' }) {
  return <InfoTip title={title} body={body} align={align === 'right' ? 'end' : 'start'} />;
}

/* ----------------------------------------------------------------- pop menu */
//? `disabled` + `disabledReason`: menu actions that cannot run today (Designer's "Apply tokens")
//? were rendered as normal rows and silently did nothing when clicked — the user reads that as a
//? broken product. A greyed, unclickable row that carries WHY in its tooltip is honest instead.
export interface PopMenuItem { label?: string; icon?: IconName; danger?: boolean; divider?: boolean; disabled?: boolean; disabledReason?: string; onClick?: () => void }
//? `label` renders a text + chevron trigger (e.g. "Advanced ▾") instead of the icon-only button, for a
//? progressive-disclosure menu that reads as a labelled control. Omit it → the original icon-only trigger.
export function PopMenu({ items, align = 'right', icon = 'ellipsis', label, ariaLabel, triggerClass, variant, onOpenChange }: { items: PopMenuItem[]; align?: 'left' | 'right'; icon?: IconName; label?: string; ariaLabel?: string; triggerClass?: string; /** Render the labelled trigger as a real button of this variant — for a menu that IS the page's primary action. */ variant?: BtnVariant; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  const ref = useClickAway<HTMLDivElement>(open, () => { change(false); });
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        //? a11y (gap-fix): the icon-only trigger had NO accessible name — screen readers announced "button".
        {...(label ? {} : { 'aria-label': ariaLabel ?? 'menu', 'aria-haspopup': true, 'aria-expanded': open })}
        onClick={(e) => { e.stopPropagation(); change(!open); }}
        className={`${triggerClass ?? (variant === undefined
          ? (label
            ? 'inline-flex items-center gap-1.5 h-8 rounded-lg border border-container1-border bg-container1 px-3 text-sm text-common hover:bg-container2 transition-colors cursor-pointer'
            : 'inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:bg-container2 hover:text-common transition-colors cursor-pointer')
          : `${BTN_SHELL} ${BTN_VARIANT[variant]}`)} ${FOCUS_RING}`}
      >
        {label ? (<>{label} <Icon name="caret-down" className={`text-xs transition-transform ${open ? 'rotate-180' : ''}`} /></>) : <Icon name={icon} />}
      </button>
      <Popover open={open} className={`absolute z-30 mt-1 min-w-[190px] rounded-xl border border-container1-border bg-container1 p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
        {items.map((it, i) =>
          it.divider ? (
            // eslint-disable-next-line react-x/no-array-index-key -- static menu; dividers carry no stable id, so the positional index is the item identity
            <div key={i} className="my-1 h-px bg-divider" />
          ) : (
            <button
              // eslint-disable-next-line react-x/no-array-index-key -- static menu; positional index is the item identity
              key={i} type="button"
              disabled={it.disabled ?? false} title={it.disabled === true ? it.disabledReason : undefined}
              onClick={(e) => { e.stopPropagation(); change(false); it.onClick?.(); }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${it.disabled === true
                ? 'text-disabled cursor-not-allowed'
                : `cursor-pointer ${it.danger === true ? 'text-wrong hover:bg-wrong/10' : 'text-common hover:bg-container2'}`}`}
            >
              {it.icon && <Icon name={it.icon} className="w-4 text-center opacity-80" />}
              {it.label}
            </button>
          ),
        )}
      </Popover>
    </div>
  );
}

/* ----------------------------------------------------------------- disclosure */
//? Progressive disclosure: a labelled summary row that expands/collapses its body. The go-to for keeping
//? advanced/dev controls off the first paint without hiding them (they're one tap away, mobile + desktop).
//? `defaultOpen` seeds the initial state; the chevron rotates and the body is only mounted while open.
export function Disclosure({ summary, defaultOpen = false, children, className = '' }: { summary: ReactNode; defaultOpen?: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border border-container1-border bg-container1 ${className}`}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); }}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-title cursor-pointer rounded-xl ${FOCUS_RING}`}
      >
        <span className="min-w-0 flex-1 text-left">{summary}</span>
        <Icon name="caret-down" className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      <Collapse open={open}><div className="px-4 pb-4 pt-0">{children}</div></Collapse>
    </div>
  );
}

/* ----------------------------------------------------------------- clickable card / row */
//? WHY: five pages ship things that ARE buttons but were built as plain divs — content PieceCard
//? and the library thumbnails, the studio brief rail, documents rows, the answers entity list.
//? They had no cursor-pointer (so nothing said "click me"), no hover feedback, and no tabIndex at
//? all, which meant a keyboard user literally could not reach the page's primary interaction.
//? This bakes in the KanbanCard treatment — the one card in the app that already feels right.
//?
//? It renders a div with explicit button semantics rather than a real <button>: these cards carry
//? their own ⋯ menus and inline actions, and a button inside a button is invalid DOM that browsers
//? silently reparent. The keyboard contract is therefore implemented by hand.
export interface ClickableCardProps {
  onClick: () => void;
  /** `card` = padded tile in a grid; `row` = tighter line in a list. Padding + radius only. */
  as?: 'card' | 'row';
  /** Marks the active item in a rail/list; emits `aria-current` so it is not colour-only. */
  selected?: boolean;
  /** Required when the content is not self-describing text (a bare thumbnail, an avatar, a glyph). */
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

export function ClickableCard({ onClick, as = 'card', selected = false, ariaLabel, className = '', children }: ClickableCardProps) {
  const downAt = useRef(0);
  return (
    <div
      role="button" tabIndex={0} aria-label={ariaLabel} aria-current={selected ? true : undefined}
      onPointerDown={() => { downAt.current = Date.now(); }}
      //? Activate only on a deliberate, quick click. Cards hold selectable text, and without this a
      //? user who drags to select a title gets navigated away instead (KanbanCard's proven guard).
      onClick={() => {
        if (Date.now() - downAt.current > 350) return;
        if ((globalThis.getSelection()?.toString() ?? '') !== '') return;
        onClick();
      }}
      //? Space must be prevented before it acts, otherwise the page scrolls under the user.
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick();
      }}
      //? The lift on hover animates transform + box-shadow ONLY — never width/height/padding, which
      //? would reflow the whole grid on every mouse-over.
      className={`group relative w-full text-left cursor-pointer border bg-container1 shadow-2xs transition-[border-color,box-shadow,transform] duration-150 ease-[var(--ease-soft)] hover:border-container2-border hover:shadow-md motion-safe:hover:-translate-y-px ${FOCUS_RING} focus-visible:ring-offset-2 focus-visible:ring-offset-background ${as === 'card' ? 'rounded-xl p-3' : 'rounded-lg px-3 py-2'} ${selected ? 'border-primary/60 ring-1 ring-primary/30' : 'border-container1-border'} ${className}`}
    >
      {children}
    </div>
  );
}

//? Same contract, list padding — a named export so a rail of rows reads as rows at the call site
//? instead of `<ClickableCard as="row">` repeated twenty times.
export function InteractiveRow(props: Omit<ClickableCardProps, 'as'>) {
  return <ClickableCard {...props} as="row" />;
}
