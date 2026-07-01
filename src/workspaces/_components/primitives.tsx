//? Workspaces — shared UI primitives.
//?
//? Reuses `src/_components/Avatar` and `Dropdown` where they fit; everything
//? here is a workspace-specific primitive the base kit doesn't have yet
//? (StatusPill, LabelChip, Tabs, Toggle, Segmented, PopMenu, …). Tailwind +
//? theme tokens only — no arbitrary hex. Overlays close on outside-click +
//? Escape; transforms respect `prefers-reduced-motion` via `motion-reduce:`.

import { useEffect, useRef, useState, type ReactNode } from 'react';

import BaseAvatar from 'src/_components/Avatar';

import { motion } from 'motion/react';

import Icon, { type IconName } from './Icon';
import { Popover, SPRING_SOFT } from './motion';
import type { Member, TicketStatus } from '../_data/types';

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
          +{extra}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- status pill */
const STATUS_META: Record<TicketStatus, { label: string; tint: string; dot: string; pulse?: boolean }> = {
  'needs-input': { label: 'Needs input', tint: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  busy: { label: 'Busy', tint: 'bg-primary/12 text-primary', dot: 'bg-primary', pulse: true },
  done: { label: 'Done', tint: 'bg-correct/15 text-correct', dot: 'bg-correct' },
  idle: { label: 'No AI', tint: 'bg-container2 text-muted', dot: 'bg-muted' },
  paused: { label: 'Paused', tint: 'bg-container2 text-muted', dot: 'bg-muted' },
  stuck: { label: 'Stuck', tint: 'bg-warning/15 text-warning', dot: 'bg-warning', pulse: true },
};

export function statusColorVar(status: TicketStatus): string {
  return ({
    'needs-input': 'var(--color-warning)', busy: 'var(--color-primary)', done: 'var(--color-correct)',
    idle: 'var(--color-muted)', paused: 'var(--color-muted)', stuck: 'var(--color-warning)',
  })[status];
}

export function StatusPill({ status, dot = true }: { status: TicketStatus; dot?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${m.tint}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${m.pulse ? 'motion-safe:animate-pulse' : ''}`} />}
      {m.label}
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
const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-primary text-title-primary hover:bg-primary-hover',
  secondary: 'bg-container2 text-title hover:bg-container2-hover',
  ghost: 'text-common hover:bg-container2',
  danger: 'bg-wrong text-white hover:bg-wrong-hover',
};
export function WsButton({ variant = 'primary', icon, children, onClick, title, type = 'button', className = '' }: {
  variant?: BtnVariant; icon?: IconName; children?: ReactNode; onClick?: () => void; title?: string; type?: 'button' | 'submit'; className?: string;
}) {
  return (
    <button
      type={type} onClick={onClick} title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 h-9 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${BTN_VARIANT[variant]} ${className}`}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, onClick, title, active, className = '' }: { icon: IconName; onClick?: () => void; title?: string; active?: boolean; className?: string }) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-xl text-common transition-colors cursor-pointer hover:bg-container2 ${active ? 'bg-container2 text-title' : ''} ${className}`}
    >
      <Icon name={icon} />
    </button>
  );
}

/* ----------------------------------------------------------------- tabs */
export interface TabDef { id: string; label: string; icon?: IconName; count?: number }
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-divider overflow-x-auto">
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id} type="button" onClick={() => { onChange(t.id); }}
            className={`relative inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${on ? 'text-title' : 'text-muted hover:text-common'}`}
          >
            {t.icon && <Icon name={t.icon} />}
            {t.label}
            {t.count != null && <span className="rounded-full bg-container2 px-1.5 text-xs text-muted">{t.count}</span>}
            {on && <motion.span layoutId="wsTabsUnderline" className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-primary" transition={SPRING_SOFT} />}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- toggle */
export function Toggle({ on, onChange, label }: { on: boolean; onChange?: (next: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange?.(!on)} className="inline-flex items-center gap-2.5 cursor-pointer group">
      <span className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-container2-border'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
      {label && <span className="text-sm text-common">{label}</span>}
    </button>
  );
}

/* ----------------------------------------------------------------- segmented */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-container2 p-0.5">
      {options.map((o) => (
        <button
          key={o.id} type="button" onClick={() => { onChange(o.id); }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-sm font-medium transition-colors cursor-pointer ${value === o.id ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}
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
    <section className={`rounded-2xl border border-container1-border bg-container1 p-5 ${className}`}>
      {(title ?? right) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {title && <div className="text-base font-semibold text-title">{title}</div>}
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

/* ----------------------------------------------------------------- info dot */
//? A small "?" that reveals an info popover on hover. Pure CSS group-hover so
//? it works inside scroll containers without portals.
export function InfoDot({ title, body, align = 'right' }: { title?: string; body: ReactNode; align?: 'left' | 'right' }) {
  return (
    <span className="relative group/info inline-flex shrink-0">
      <span className="w-4 h-4 rounded-full bg-container2 text-muted text-[10px] font-bold flex items-center justify-center cursor-help transition-colors hover:bg-primary/15 hover:text-primary">?</span>
      <span className={`pointer-events-none absolute ${align === 'right' ? 'right-0' : 'left-0'} top-5 z-40 w-60 rounded-xl border border-container1-border bg-container1 p-3 text-xs text-common shadow-lg opacity-0 translate-y-1 group-hover/info:opacity-100 group-hover/info:translate-y-0 transition-all duration-150`}>
        {title && <span className="font-semibold text-title block mb-1 break-words">{title}</span>}
        <span className="break-words">{body}</span>
      </span>
    </span>
  );
}

/* ----------------------------------------------------------------- pop menu */
export interface PopMenuItem { label?: string; icon?: IconName; danger?: boolean; divider?: boolean; onClick?: () => void }
export function PopMenu({ items, align = 'right', icon = 'ellipsis', triggerClass, onOpenChange }: { items: PopMenuItem[]; align?: 'left' | 'right'; icon?: IconName; triggerClass?: string; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  const ref = useClickAway<HTMLDivElement>(open, () => { change(false); });
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); change(!open); }}
        className={triggerClass ?? 'inline-flex items-center justify-center w-7 h-7 rounded-lg text-muted hover:bg-container2 hover:text-common transition-colors cursor-pointer'}
      >
        <Icon name={icon} />
      </button>
      <Popover open={open} className={`absolute z-30 mt-1 min-w-[190px] rounded-xl border border-container1-border bg-container1 p-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
        {items.map((it, i) =>
          it.divider ? (
            <div key={i} className="my-1 h-px bg-divider" />
          ) : (
            <button
              key={i} type="button"
              onClick={(e) => { e.stopPropagation(); change(false); it.onClick?.(); }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors cursor-pointer ${it.danger ? 'text-wrong hover:bg-wrong/10' : 'text-common hover:bg-container2'}`}
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
