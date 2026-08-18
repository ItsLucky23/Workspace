//? ADR 0312 — sub-navigation WITHIN a page, addressed by URL.
//?
//? The problem this solves is a tab that mixes several unrelated concerns and so reads as a wall of
//? controls: the Repository tab links a repo (once), describes how it runs (rarely) and manages its
//? services (continuously), stacked with nothing separating them. Adding a third rail level would
//? move the crowding one level down on 29 pages that mostly do not need it, so instead a page opts in
//? and gets a section index beside its content.
//?
//? ONE section is visible at a time. That is the point — the goal is fewer controls on screen, and a
//? stacked long page with an index would organise the crowding without reducing it. The index doubles
//? as the answer to "what else is in here?", which is the other half of the complaint: things existed
//? but were not findable.
//?
//? Every section is an ADDRESS (`/workspaces/workspace/repository/runtime`): linkable, bookmarkable,
//? refresh-safe, and the back button walks out of it. An unknown segment falls back to the first
//? section rather than rendering nothing — a stale bookmark should land somewhere sensible.

/* eslint-disable react-refresh/only-export-components -- the useTrailSegment hook is deliberately co-located with the sections that consume it: they are one mechanism (URL-addressed sub-navigation), and splitting them would hide that. Dev-only fast-refresh rule; this is not a route component. */
import { useEffect, useRef, type ReactNode } from 'react';

import { useWorkspaces } from '../_shell/WorkspacesContext';
import Icon, { type IconName } from './Icon';
import { FOCUS_RING } from './primitives';

export interface PageSection {
  id: string;
  label: ReactNode;
  icon?: IconName;
  /** A count/summary shown beside the label, e.g. the number of services configured. */
  badge?: ReactNode;
  body: ReactNode;
}

/** Read + write one level of the URL trail, validated against the ids that actually exist.
 *  Writing at a level CLEARS the deeper ones: changing tab must not keep the previous tab's section. */
export function useTrailSegment<T extends string>(depth: number, ids: readonly T[], fallback: T): [T, (id: T) => void] {
  const { trail, setTrail } = useWorkspaces();
  const raw = trail[depth] ?? '';
  //? `find` rather than `includes` so the result carries the caller's union type — a page that models
  //? its tabs as a union keeps it, instead of casting a bare string back (never-cast rule).
  const current = ids.find((id) => id === raw) ?? fallback;
  const set = (id: T): void => { setTrail([...trail.slice(0, depth), id]); };
  return [current, set];
}

export function PageSections({ sections, ariaLabel, depth = 1 }: {
  sections: PageSection[];
  /** Names the index for screen readers — say what it indexes ("Repository sections"). */
  ariaLabel: string;
  /** Which trail level these sections occupy. 1 = a section inside a tab (the common case). */
  depth?: number;
}) {
  const ids = sections.map((s) => s.id);
  const [active, setActive] = useTrailSegment(depth, ids, ids[0] ?? '');
  const current = sections.find((s) => s.id === active) ?? sections[0];
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  //? Roving arrow-key navigation, on the BUTTONS: a non-focusable container never receives the event.
  const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0);
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + sections.length) % sections.length;
    itemRefs.current[next]?.focus();
    setActive(sections[next]?.id ?? active);
  };

  //? A deep-linked section may be below the fold on a phone; put it in view on arrival.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active]);

  if (current === undefined) return null;

  return (
    <div className={`flex flex-col lg:flex-row gap-4 lg:gap-6 items-start`}>
      {/* The index: a vertical rail beside the content, a horizontal scroller above it on a phone. */}
      <div
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="vertical"
        className={`w-full lg:w-52 shrink-0 lg:sticky lg:top-4 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0`}
      >
        {sections.map((section, index) => {
          const on = section.id === active;
          return (
            <button
              key={section.id}
              ref={(el) => { itemRefs.current[index] = el; }}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onKeyDown={(e) => { onKeyDown(e, index); }}
              onClick={() => { setActive(section.id); }}
              className={`shrink-0 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-left transition-colors duration-150 cursor-pointer ${FOCUS_RING} ${on ? 'bg-container2 text-title font-semibold' : 'text-muted hover:bg-container2/60 hover:text-common'}`}
            >
              <span className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-xs tabular-nums ${on ? 'bg-primary/15 text-primary' : 'bg-container2 text-meta'}`}>
                {section.icon === undefined ? index + 1 : <Icon name={section.icon} />}
              </span>
              <span className={`min-w-0 flex-1 truncate`}>{section.label}</span>
              {section.badge !== undefined && <span className={`shrink-0 text-xs text-meta tabular-nums`}>{section.badge}</span>}
            </button>
          );
        })}
      </div>

      <div ref={bodyRef} role="tabpanel" className={`min-w-0 flex-1 w-full`}>{current.body}</div>
    </div>
  );
}
