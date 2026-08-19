//? ADR 0314 — the standing "finish setting up this workspace" list.
//?
//? A fresh workspace is a wall of empty pickers: no repo, no AI key, no context documents, no
//? notifications. Every one of those is explained where you hit it (SetupNotice at page scale,
//? EmptyPicker at field scale), but only AFTER you have wandered into the feature it blocks. Nothing
//? ever told a new user what "set up" even means, so the honest answer to "why does nothing work
//? yet?" was: go and find out, one blocked screen at a time.
//?
//? This is the missing front door, and it is deliberately NOT a tour. A tour interrupts, is clicked
//? away, and is gone the moment it is needed. A checklist waits, states what is left, and each row
//? goes straight to the place that fixes it. It disappears on its own once everything applicable is
//? done — a permanent nag is the same defect as a dead end.
//?
//? It invents no state: every row reads a `readiness` boolean the snapshot already computes, and
//? every row is filtered by the workspace's enabled MODULES, so a content-only workspace is never
//? told to link a git repository. Rows the current user may not fix stay visible but say who to ask,
//? because "you are missing an AI key" is worth knowing even when you cannot add one yourself.
//?
//? ADR 0316 changed two things here after the owner walked into both of them:
//?   • There is no "hide forever" any more. It shipped with a chevron AND an X sitting side by side,
//?     both icon-only; the X wrote a localStorage flag with no way back in the entire product. The
//?     owner clicked it expecting the collapse it looked like and lost the checklist permanently.
//?     Now the chevron is the only control and its state is remembered per workspace — collapsed is
//?     one slim title bar, and the list still retires itself once everything measurable is done.
//?   • It absorbed the board's separate first-steps banner, so the two first-run surfaces that used
//?     to stack on the same spot are one. Hence rows that run an ACTION rather than open a settings
//?     page: creating the first ticket and opening the Workspace-AI are things you do, not settings.
//? @adr 0314 @adr 0316

import { useEffect, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { CAP, capLabelKey, type CapKey } from '../_data/capabilities';
import { isModuleEnabled } from '../_data/modules';
import { useWorkspaces, type WsView } from '../_shell/WorkspacesContext';
import Icon, { type IconName } from './Icon';
import { Collapse } from './motion';
import { FOCUS_RING, IconButton } from './primitives';

interface ChecklistStep {
  id: string;
  icon: IconName;
  done: boolean;
  /** Which capability may complete it — decides action-button vs "ask someone with X". */
  cap: CapKey;
  /** Where the fix lives. Mutually exclusive with `action`. */
  target?: { view: WsView; tab?: string; section?: string };
  /** …or what to DO, for a step that is an act rather than a setting (absorbed from the old banner). */
  action?: () => void;
  /** Steps with no readiness signal of their own are guidance: they never block the list from retiring. */
  guidance?: true;
}

//? Collapsed-ness is per workspace and local to the device: it is a UI preference, not workspace
//? state, so it belongs in neither the snapshot nor a control-op. A deliberately NEW key — the old
//? one meant "hidden forever", and anyone who set it did so believing it meant collapse, so it is
//? read by nothing and their checklist simply comes back.
const collapsedKey = (workspaceId: string): string => `ws:setup-collapsed:${workspaceId}`;

export default function SetupChecklist() {
  const translate = useTranslator();
  const { activeWorkspace, readiness, tickets, can, focusSetup, quickAdd, toggleAi } = useWorkspaces();
  const [open, setOpen] = useState(true);

  //? Read on mount + whenever the workspace changes, so each workspace keeps its own collapsed state.
  useEffect(() => {
    setOpen(globalThis.localStorage.getItem(collapsedKey(activeWorkspace.id)) !== '1');
  }, [activeWorkspace.id]);

  const toggle = (): void => {
    setOpen((wasOpen) => {
      globalThis.localStorage.setItem(collapsedKey(activeWorkspace.id), wasOpen ? '1' : '0');
      return !wasOpen;
    });
  };

  const devEnabled = isModuleEnabled(activeWorkspace.enabledSections, 'development');
  const contentEnabled = isModuleEnabled(activeWorkspace.enabledSections, 'content')
    || isModuleEnabled(activeWorkspace.enabledSections, 'design');

  const steps: ChecklistStep[] = [
    //? The AI key comes first for every workspace: without it nothing generates, whatever the module.
    { id: 'aiKey', icon: 'robot', done: readiness.aiText, cap: 'workspaceSettings', target: { view: 'content/settings', tab: 'admin' } },
    ...(devEnabled ? [
      { id: 'repo', icon: 'code-branch', done: readiness.repoLinked, cap: 'workspaceSettings' as CapKey, target: { view: 'workspace' as WsView, tab: 'repository', section: 'link' } },
      //? Absorbed from the board's first-steps banner: an ACT, not a setting, and measurable — this
      //? project having a ticket is exactly what the banner used to test before showing itself.
      { id: 'firstTicket', icon: 'plus', done: tickets.length > 0, cap: 'workTickets' as CapKey, action: () => { quickAdd({ title: translate({ key: 'workspaces.checklist.firstTicketTitle' }) }); } },
      //? The runtime command only becomes answerable once a repo is linked, so it is gated on that
      //? rather than shown as a second failure of the same missing step.
      ...(readiness.repoLinked ? [{ id: 'runtime', icon: 'play', done: false, cap: 'workspaceSettings' as CapKey, target: { view: 'workspace' as WsView, tab: 'repository', section: 'runtime' }, guidance: true as const }] : []),
      { id: 'context', icon: 'book-open', done: false, cap: 'editPipeline' as CapKey, target: { view: 'sources' as WsView }, guidance: true as const },
    ] : []),
    ...(contentEnabled ? [
      { id: 'media', icon: 'image', done: readiness.media.fal, cap: 'workspaceSettings' as CapKey, target: { view: 'content/settings', tab: 'admin' } },
      { id: 'channel', icon: 'paper-plane', done: readiness.publishing, cap: 'workspaceSettings' as CapKey, target: { view: 'content/settings', tab: 'channels' } },
    ] : []),
    { id: 'push', icon: 'bell', done: readiness.push, cap: 'workTickets', target: { view: 'settings', tab: 'account' } },
    //? Also from the banner. Nothing records "has talked to the AI", so it is guidance: it never keeps
    //? the checklist alive on its own, it just tells a new user the panel exists.
    { id: 'askAi', icon: 'comments', done: false, cap: 'workTickets', action: toggleAi, guidance: true },
  ];

  const remaining = steps.filter((s) => !s.done);
  //? Some rows have no readiness signal of their own (a dev command, a first context document and
  //? "has used the AI" are not booleans anything computes), so they always read as outstanding. A
  //? checklist that can never reach zero is a permanent nag, so it retires once everything that CAN
  //? be measured is done — the unmeasurable rows are guidance, not a gate. The flag lives ON the step
  //? rather than in a list of ids next to it, so a new row cannot silently make the list immortal.
  if (steps.every((s) => s.done || s.guidance === true)) return null;

  //? A step either opens the place that fixes it or performs the act itself; nothing does both.
  const runStep = (step: ChecklistStep): void => {
    if (step.action !== undefined) { step.action(); return; }
    if (step.target === undefined) return;
    const { view, tab, section } = step.target;
    focusSetup({ view, ...(tab === undefined ? {} : { tab }), ...(section === undefined ? {} : { section }) });
  };

  return (
    <div className={`px-4 md:px-6 pt-3`}>
      {/* testid: the collapse/expand control is an icon-only button whose accessible name ("Expand")
          is shared with the nav rail's own collapse pill, so an e2e locator needs this scope. */}
      <div data-testid="ws-setup-checklist" className={`rounded-2xl border border-container1-border bg-container1 overflow-hidden`}>
        <div className={`flex items-center gap-3 px-4 py-3`}>
          <div className={`w-9 h-9 shrink-0 rounded-xl bg-primary/12 text-primary flex items-center justify-center`}>
            <Icon name="wand-magic-sparkles" />
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className={`min-w-0 flex-1 text-left cursor-pointer rounded-lg ${FOCUS_RING}`}
          >
            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.checklist.title' })}</div>
            <div className={`text-xs text-muted`}>
              {translate({ key: 'workspaces.checklist.progress', params: [{ key: 'done', value: String(steps.length - remaining.length) }, { key: 'total', value: String(steps.length) }] })}
            </div>
          </button>
          {/* ONE control. It used to sit next to an X that hid the checklist forever with no way back
              anywhere in the product — two icon-only buttons, one of them a dead end. */}
          <IconButton icon={open ? 'chevron-up' : 'chevron-down'} onClick={toggle} title={translate({ key: open ? 'workspaces.checklist.collapse' : 'workspaces.checklist.expand' })} />
        </div>

        <Collapse open={open}>
          <div className={`px-4 pb-3 flex flex-col gap-1`}>
            {steps.map((step) => {
              const allowed = can(CAP[step.cap]);
              return (
                <div key={step.id} className={`flex items-center gap-3 rounded-xl px-2.5 py-2 ${step.done ? '' : 'hover:bg-container2/60'}`}>
                  <Icon
                    name={step.done ? 'circle-check' : step.icon}
                    className={step.done ? `text-correct shrink-0` : `text-muted shrink-0`}
                  />
                  <div className={`min-w-0 flex-1`}>
                    <div className={`text-sm ${step.done ? 'text-muted line-through' : 'text-title font-medium'}`}>
                      {translate({ key: `workspaces.checklist.${step.id}Label` })}
                    </div>
                    {!step.done && <div className={`text-xs text-meta`}>{translate({ key: `workspaces.checklist.${step.id}Desc` })}</div>}
                  </div>
                  {!step.done && (allowed
                    ? (
                      <button
                        type="button"
                        onClick={() => { runStep(step); }}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 cursor-pointer ${FOCUS_RING}`}
                      >
                        {translate({ key: `workspaces.checklist.${step.action === undefined ? 'fix' : `${step.id}Cta`}` })}
                        <Icon name="arrow-right" className={`text-[10px]`} />
                      </button>
                    )
                    : <span className={`shrink-0 text-xs text-meta`}>{translate({ key: 'workspaces.setup.askCapability', params: [{ key: 'cap', value: translate({ key: capLabelKey(step.cap) }) }] })}</span>)}
                </div>
              );
            })}
          </div>
        </Collapse>
      </div>
    </div>
  );
}
