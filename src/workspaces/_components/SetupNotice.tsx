//? Workspaces — the ONE canonical "this feature needs setup X" notice (new-user UX). A blocked feature (no
//? git repo linked, no AI/media key, no connected account, Docker down, …) renders this instead of a silent
//? empty state, so the user always learns three things:
//?   WHAT is missing (title), WHY the feature can't work (body), and HOW to fix it (the action).
//? The action is PERMISSION-AWARE: when the current user MAY do the setup, it is a button that deep-links to
//? the exact settings tab that holds the fix (`focusSetup`, not a bare `navigate` that lands on the default
//? tab); when they may NOT, it degrades to "ask someone with <capability>" rather than a dead button. An
//? INFRA-only gate (host env / Docker) omits `fix` entirely and shows an explanation + a muted env hint.
//? Reuses EmptyState / SectionCard / WsButton — no parallel notice implementation.

import type { ReactNode } from 'react';
import { useTranslator } from '@luckystack/core/client';

import { useWorkspaces, type WsView } from '../_shell/WorkspacesContext';
import { CAP, capLabelKey, type CapKey } from '../_data/capabilities';
import { EmptyState, SectionCard, WsButton } from './primitives';
import Icon, { type IconName } from './Icon';

//? The in-app fix descriptor: which capability it needs, where it lives, and the button label. Omit the whole
//? object for an infra-only gate (no in-app fix — the notice then explains + shows the env `hint`).
export interface SetupFix {
  cap: CapKey;        // the capability required — the button shows only when `can(cap)`
  view: WsView;       // the settings destination the button deep-links to
  tab?: string;       // the tab to pre-select on that page (via focusSetup)
  cta: ReactNode;     // the button label (already translated by the caller)
}

export interface SetupNoticeProps {
  icon?: IconName;          // WHAT is missing, as a glyph
  title: ReactNode;         // WHAT (translated)
  body: ReactNode;          // WHY it's blocked (translated)
  fix?: SetupFix;           // HOW (in-app) — omit for an infra-only gate
  hint?: ReactNode;         // an extra muted footnote (e.g. the env var to set) — mainly for infra gates
  variant?: 'block' | 'card'; // 'block' = centered full-page EmptyState (default); 'card' = inline boxed notice
}

//? The permission-aware action: a deep-link button when the user may fix it, else an "ask someone with X" line.
function FixAction({ fix }: { fix: SetupFix }) {
  const translate = useTranslator();
  const { can, focusSetup } = useWorkspaces();
  if (can(CAP[fix.cap])) {
    return (
      <WsButton icon="gear" onClick={() => { focusSetup({ view: fix.view, ...(fix.tab === undefined ? {} : { tab: fix.tab }) }); }}>
        {fix.cta}
      </WsButton>
    );
  }
  return (
    <div className="text-sm text-muted max-w-xs">
      {translate({ key: 'workspaces.setup.askCapability', params: [{ key: 'cap', value: translate({ key: capLabelKey(fix.cap) }) }] })}
    </div>
  );
}

export function SetupNotice({ icon, title, body, fix, hint, variant = 'block' }: SetupNoticeProps) {
  const action = fix ? <FixAction fix={fix} /> : undefined;
  if (variant === 'card') {
    return (
      <SectionCard>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 shrink-0 rounded-xl bg-warning/15 text-warning flex items-center justify-center">
            <Icon name={icon ?? 'triangle-exclamation'} className="text-xl" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-title">{title}</div>
            <div className="text-sm text-muted mt-1">{body}</div>
            {(action ?? hint) && (
              <div className="mt-3 flex flex-col gap-2">
                {action}
                {hint && <div className="text-xs text-muted">{hint}</div>}
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    );
  }
  return (
    <EmptyState
      icon={icon}
      title={title}
      sub={hint ? <>{body}<div className="text-xs text-disabled mt-2">{hint}</div></> : body}
      action={action}
    />
  );
}

/* --------------------------------------------------------------- empty picker */
//? SetupNotice's field-level sibling (ADR 0312). A picker with nothing to pick — "link a context
//? document", "attach a skill" — used to render an empty list or a disabled dropdown, which reads as
//? BROKEN rather than as not-yet-created. The user cannot tell whether the feature is unavailable,
//? whether they lack permission, or whether they simply haven't made one yet, and nothing on screen
//? says where such a thing is created. That dead end is the single most common shape of "the app
//? doesn't explain itself", and it is worst for a new user, who meets nothing BUT empty pickers.
//?
//? Same three answers as SetupNotice (what · why · how) at row scale, and the same permission
//? awareness: it deep-links when the user may create one, and names the capability to ask for when
//? they may not. Deliberately quiet — a dashed row, not a warning box — because an empty picker on a
//? fresh workspace is the normal state, not an error.
export function EmptyPicker({ icon, label, fix }: {
  icon?: IconName;
  /** What is missing, e.g. "No context documents yet" (already translated). */
  label: ReactNode;
  /** Where they are created. Omit when there is nowhere to send the user. */
  fix?: SetupFix;
}) {
  const translate = useTranslator();
  const { can, focusSetup } = useWorkspaces();

  return (
    <div className="rounded-lg border border-dashed border-container1-border px-3 py-2.5 flex items-center gap-2.5 flex-wrap">
      <Icon name={icon ?? 'circle-info'} className="text-disabled shrink-0" />
      <span className="text-sm text-muted min-w-0 flex-1">{label}</span>
      {fix && (can(CAP[fix.cap])
        ? (
          <WsButton
            variant="ghost"
            icon="arrow-right"
            onClick={() => { focusSetup({ view: fix.view, ...(fix.tab === undefined ? {} : { tab: fix.tab }) }); }}
          >
            {fix.cta}
          </WsButton>
        )
        : <span className="text-xs text-meta">{translate({ key: 'workspaces.setup.askCapability', params: [{ key: 'cap', value: translate({ key: capLabelKey(fix.cap) }) }] })}</span>)}
    </div>
  );
}
