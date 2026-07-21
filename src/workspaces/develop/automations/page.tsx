//? intent: Automations — the WorkspaceTriggers that react to pipeline + workspace events (a ticket is
//? created, a stage completes, a cron fires) and run an action. Its own destination now, moved out of the
//? Pipeline editor. One list; create / enable / delete each trigger. Built on the automation engine
//? (ADR 0027) — every trigger is written through the Conductor (single-writer, B-23).

import { useTranslator } from '@luckystack/core/client';

import Icon from '../../_components/Icon';
import AutomationPanel from '../../_components/AutomationPanel';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

export const template = 'workspaces';

export default function Automations() {
  const translate = useTranslator();
  const { triggers } = useWorkspaces();
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 md:py-4 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.automations.title' })}</h1>
          <span className="text-sm text-muted">{translate({ key: 'workspaces.automations.subtitle' })}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8 pt-2 flex flex-col gap-4">
        {/* teaching intro — only while there is nothing yet (the panel's own list takes over after) */}
        {triggers.length === 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-container1-border bg-container1 px-4 py-3.5">
            <Icon name="bolt" className="text-primary mt-0.5 shrink-0" />
            <span className="text-sm text-muted">{translate({ key: 'workspaces.pipeline.automationsIntro' })}</span>
          </div>
        )}
        <AutomationPanel />
      </div>
    </div>
  );
}
