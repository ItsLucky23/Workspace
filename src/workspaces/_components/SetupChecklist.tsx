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
//? @adr 0314

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
  /** Which capability may complete it — decides fix-button vs "ask someone with X". */
  cap: CapKey;
  target: { view: WsView; tab?: string; section?: string };
}

//? Dismissal is per workspace and local to the device: it is a UI preference, not workspace state, so
//? it does not belong in the snapshot or behind a control-op. Re-appearing on another device is the
//? correct behaviour — the setup genuinely is unfinished there too.
const dismissKey = (workspaceId: string): string => `ws:setup-dismissed:${workspaceId}`;

export default function SetupChecklist() {
  const translate = useTranslator();
  const { activeWorkspace, readiness, can, focusSetup } = useWorkspaces();
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(true);

  //? Read on mount + whenever the workspace changes, so switching to a half-configured workspace
  //? brings its own checklist back.
  useEffect(() => {
    setDismissed(globalThis.localStorage.getItem(dismissKey(activeWorkspace.id)) === '1');
    setOpen(true);
  }, [activeWorkspace.id]);

  const devEnabled = isModuleEnabled(activeWorkspace.enabledSections, 'development');
  const contentEnabled = isModuleEnabled(activeWorkspace.enabledSections, 'content')
    || isModuleEnabled(activeWorkspace.enabledSections, 'design');

  const steps: ChecklistStep[] = [
    //? The AI key comes first for every workspace: without it nothing generates, whatever the module.
    { id: 'aiKey', icon: 'robot', done: readiness.aiText, cap: 'workspaceSettings', target: { view: 'content/settings', tab: 'admin' } },
    ...(devEnabled ? [
      { id: 'repo', icon: 'code-branch', done: readiness.repoLinked, cap: 'workspaceSettings' as CapKey, target: { view: 'workspace' as WsView, tab: 'repository', section: 'link' } },
      //? The runtime command only becomes answerable once a repo is linked, so it is gated on that
      //? rather than shown as a second failure of the same missing step.
      ...(readiness.repoLinked ? [{ id: 'runtime', icon: 'play', done: false, cap: 'workspaceSettings' as CapKey, target: { view: 'workspace' as WsView, tab: 'repository', section: 'runtime' } }] : []),
      { id: 'context', icon: 'book-open', done: false, cap: 'editPipeline' as CapKey, target: { view: 'sources' as WsView } },
    ] : []),
    ...(contentEnabled ? [
      { id: 'media', icon: 'image', done: readiness.media.fal, cap: 'workspaceSettings' as CapKey, target: { view: 'content/settings', tab: 'admin' } },
      { id: 'channel', icon: 'paper-plane', done: readiness.publishing, cap: 'workspaceSettings' as CapKey, target: { view: 'content/settings', tab: 'channels' } },
    ] : []),
    { id: 'push', icon: 'bell', done: readiness.push, cap: 'workTickets', target: { view: 'settings', tab: 'account' } },
  ];

  const remaining = steps.filter((s) => !s.done);
  //? Two rows have no readiness signal of their own (a dev command and a first context document are
  //? not booleans the server computes), so they always read as outstanding. Showing a checklist that
  //? can never reach zero would be a permanent nag, so the list retires once everything that CAN be
  //? measured is done — the unmeasurable rows are guidance, not a gate.
  const measurable = steps.filter((s) => s.id !== 'runtime' && s.id !== 'context');
  const complete = measurable.every((s) => s.done);

  if (dismissed || complete || remaining.length === 0) return null;

  const dismiss = (): void => {
    globalThis.localStorage.setItem(dismissKey(activeWorkspace.id), '1');
    setDismissed(true);
  };

  return (
    <div className={`px-4 md:px-6 pt-3`}>
      <div className={`rounded-2xl border border-container1-border bg-container1 overflow-hidden`}>
        <div className={`flex items-center gap-3 px-4 py-3`}>
          <div className={`w-9 h-9 shrink-0 rounded-xl bg-primary/12 text-primary flex items-center justify-center`}>
            <Icon name="wand-magic-sparkles" />
          </div>
          <button
            type="button"
            onClick={() => { setOpen((o) => !o); }}
            aria-expanded={open}
            className={`min-w-0 flex-1 text-left cursor-pointer rounded-lg ${FOCUS_RING}`}
          >
            <div className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.checklist.title' })}</div>
            <div className={`text-xs text-muted`}>
              {translate({ key: 'workspaces.checklist.progress', params: [{ key: 'done', value: String(steps.length - remaining.length) }, { key: 'total', value: String(steps.length) }] })}
            </div>
          </button>
          <IconButton icon={open ? 'chevron-up' : 'chevron-down'} onClick={() => { setOpen((o) => !o); }} title={translate({ key: open ? 'workspaces.checklist.collapse' : 'workspaces.checklist.expand' })} />
          <IconButton icon="xmark" onClick={dismiss} title={translate({ key: 'workspaces.checklist.dismiss' })} />
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
                        onClick={() => { focusSetup({ view: step.target.view, ...(step.target.tab === undefined ? {} : { tab: step.target.tab }), ...(step.target.section === undefined ? {} : { section: step.target.section }) }); }}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 cursor-pointer ${FOCUS_RING}`}
                      >
                        {translate({ key: 'workspaces.checklist.fix' })}
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
