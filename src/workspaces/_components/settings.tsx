//? Workspaces — the settings/form language.
//?
//? WHY THIS EXISTS: the UI audit (docs: `_docs/UI_AUDIT_2026-08-17.md`) found that most pages in
//? this app degenerate into the same shape — a heading, a paragraph of explanation, an input,
//? repeated ten times down the page. Every author invented their own row grammar, so /workspace
//? has eleven tabs of naked label-over-input pairs and one Admin tab alone carries three
//? different row styles for the same concept. That monotony, not the colour palette, is what
//? makes the product read as a config file with a stylesheet.
//?
//? The shape this replaces it with is the one every mature settings surface uses: the label and
//? its help text on the left, the control right-aligned on the right, rows separated by hairlines
//? inside a titled group. The explanation lives with the label (small, quiet) instead of as a
//? paragraph competing with it, so a scan down the page reads as a list of decisions rather than
//? a wall of prose.
//?
//? PERSISTENCE (owner decision, 2026-08-17): autosave everywhere, with a per-row status pill.
//? The app is realtime-convergent and phone-first — an explicit Save button loses work whenever a
//? user navigates away, which on a phone is constantly. `status` drives the pill; a row that
//? never sets it simply shows nothing.

/* eslint-disable react-refresh/only-export-components -- shared settings module: SaveStatus is the type its components consume (dev-only fast-refresh rule; these aren't route components) */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { tryCatch, useTranslator } from '@luckystack/core/client';

import Icon from './Icon';
import { InfoDot } from './primitives';

/** Per-row autosave state. `idle` renders nothing — a settled row should be quiet. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** The autosave affordance. Deliberately small and non-blocking: it confirms without demanding
 *  attention, which is the whole point of choosing autosave over a Save button. */
export function SavePill({ status, errorText }: { status: SaveStatus; errorText?: string }) {
  const translate = useTranslator();
  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-meta`}>
        <Icon name="spinner" className={`motion-safe:animate-spin`} />
        {translate({ key: 'workspaces.settings.saving' })}
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-correct`}>
        <Icon name="check" />
        {translate({ key: 'workspaces.settings.saved' })}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-wrong`} title={errorText}>
      <Icon name="triangle-exclamation" />
      {translate({ key: 'workspaces.settings.saveFailed' })}
    </span>
  );
}

/** Debounced autosave for a group of fields that persist together.
 *
 *  Watches `values`; on any change it waits `delay` (so typing does not fire a write per keystroke),
 *  calls `save`, then shows `saved` briefly before settling back to `idle`. The first run is skipped
 *  — mounting a form is not an edit — and a change to `resetKey` (e.g. switching workspace) re-seeds
 *  without writing, which is what stops a workspace switch from saving one workspace's values onto
 *  another.
 *
 *  Returns the status to hand to `SettingRow`. Rows that persist independently can each call this. */
export function useAutosave(values: readonly unknown[], save: () => void | Promise<void>, { delay = 700, resetKey = '' }: { delay?: number; resetKey?: string } = {}): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const saveRef = useRef(save);
  saveRef.current = save;
  const serialised = JSON.stringify(values);
  const lastSeen = useRef<string | null>(null);
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    // A new resetKey means new source data, not a user edit: adopt it silently.
    if (seededFor.current !== resetKey) {
      seededFor.current = resetKey;
      lastSeen.current = serialised;
      setStatus('idle');
      return;
    }
    if (lastSeen.current === serialised) return;
    lastSeen.current = serialised;

    setStatus('saving');
    const timer = setTimeout(() => {
      void (async () => {
        const [error] = await tryCatch(async () => saveRef.current());
        setStatus(error ? 'error' : 'saved');
      })();
    }, delay);
    return () => { clearTimeout(timer); };
  }, [serialised, delay, resetKey]);

  // Let a successful save fade back to quiet; an error stays until the next attempt.
  useEffect(() => {
    if (status !== 'saved') return;
    const timer = setTimeout(() => { setStatus('idle'); }, 2000);
    return () => { clearTimeout(timer); };
  }, [status]);

  return status;
}

/** A titled group of setting rows. Use one per coherent topic; a tab with more than ~3 groups is
 *  a tab that should be split. */
export function FormSection({ title, desc, right, children, className = '' }: {
  title?: ReactNode; desc?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-container1-border bg-container1 shadow-xs ${className}`}>
      {(title ?? right) && (
        <div className={`flex items-start justify-between gap-3 px-5 pt-5 pb-3`}>
          <div className={`min-w-0`}>
            {title && <h3 className={`text-base font-semibold tracking-[-0.015em] text-title`}>{title}</h3>}
            {desc && <div className={`text-sm text-muted mt-0.5`}>{desc}</div>}
          </div>
          {right}
        </div>
      )}
      {/* Hairlines between rows, never around them — a border per row reads as a stack of cards. */}
      <div className={`divide-y divide-divider`}>{children}</div>
    </section>
  );
}

/** One decision: label + optional help on the left, the control on the right.
 *
 *  `stacked` moves the control onto its own full-width line — the right choice for textareas and
 *  anything that needs the horizontal room (and what the layout falls back to on phones anyway).
 *  `inherits` is the inheritance note: a layered setting states what it builds on RIGHT THERE, so
 *  a user never has to infer the relationship from a hint elsewhere in the app. */
export function SettingRow({ label, help, info, control, status, errorText, inherits, stacked = false, className = '' }: {
  label: ReactNode;
  help?: ReactNode;
  /** Longer explanation that would crowd the row — goes behind a hover "?" instead. */
  info?: ReactNode;
  control: ReactNode;
  status?: SaveStatus;
  errorText?: string;
  inherits?: ReactNode;
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div className={`px-5 py-4 ${className}`}>
      <div className={`flex ${stacked ? 'flex-col gap-2.5' : 'flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6'}`}>
        <div className={`min-w-0 ${stacked ? '' : 'sm:max-w-md'}`}>
          <div className={`flex items-center gap-1.5`}>
            <span className={`text-sm font-semibold text-title`}>{label}</span>
            {info && <InfoDot body={info} align="left" />}
            {status && <SavePill status={status} errorText={errorText} />}
          </div>
          {help && <div className={`text-xs text-muted mt-1 leading-relaxed`}>{help}</div>}
          {inherits && (
            <div className={`inline-flex items-center gap-1.5 mt-1.5 rounded-md bg-container2 px-1.5 py-0.5 text-[11px] text-meta`}>
              <Icon name="layer-group" className={`text-[10px]`} />
              {inherits}
            </div>
          )}
        </div>
        <div className={stacked ? `w-full` : `w-full sm:w-auto sm:min-w-[220px] sm:max-w-sm sm:shrink-0`}>{control}</div>
      </div>
    </div>
  );
}
