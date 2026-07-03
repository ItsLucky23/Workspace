//? Automation panel (#2) — manage WorkspaceTriggers: list them (name · event → action · approval),
//? enable/disable, delete, and create a new one. A trigger fires an action when its event happens
//? (a ticket is created, a stage is entered, …) or on a cron schedule; `requiresApproval` gates the
//? action behind a human-accepted suggestion. Deliberately compact — the common `notify` /
//? `emit-signal` / `start-stage` actions get first-class fields; richer params are a follow-up. The
//? outputs an agent-role produces land in the notification bell (the ArtifactViewer).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import { WsButton } from './primitives';
import Icon from './Icon';
import type { TriggerActionKind, TriggerEventKind } from '../_data/types';

const EVENTS: TriggerEventKind[] = ['ticket.created', 'stage.on_enter', 'stage.on_complete', 'ticket.merged', 'suggestion.accepted', 'cron'];
const ACTIONS: TriggerActionKind[] = ['notify', 'emit-signal', 'start-stage'];
//? Flat i18n keys (the event kinds contain dots, which would break the translator's dot-nesting).
const EVENT_KEY: Record<string, string> = {
  'ticket.created': 'workspaces.automation.evTicketCreated', 'ticket.merged': 'workspaces.automation.evTicketMerged',
  'stage.on_enter': 'workspaces.automation.evStageEnter', 'stage.on_complete': 'workspaces.automation.evStageComplete',
  'stage.on_signal': 'workspaces.automation.evStageSignal', 'stage.on_approval': 'workspaces.automation.evStageApproval',
  'suggestion.accepted': 'workspaces.automation.evSuggestionAccepted', cron: 'workspaces.automation.evCron',
};
const ACTION_KEY: Record<string, string> = {
  notify: 'workspaces.automation.acNotify', 'emit-signal': 'workspaces.automation.acEmitSignal', 'start-stage': 'workspaces.automation.acStartStage',
  'invoke-workspace-ai': 'workspaces.automation.acInvokeAi', 'invoke-agent-role': 'workspaces.automation.acInvokeRole', 'run-command': 'workspaces.automation.acRunCommand',
};
const evKey = (e: string): string => EVENT_KEY[e] ?? 'workspaces.automation.evTicketCreated';
const acKey = (a: string): string => ACTION_KEY[a] ?? 'workspaces.automation.acNotify';

export default function AutomationPanel() {
  const translate = useTranslator();
  const { triggers, saveTrigger, toggleTrigger, deleteTrigger, stages } = useWorkspaces();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [on, setOn] = useState<TriggerEventKind>('ticket.created');
  const [action, setAction] = useState<TriggerActionKind>('notify');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetStage, setTargetStage] = useState('');
  const [cron, setCron] = useState('0 9 * * *');

  const eventItems: DropdownItem[] = EVENTS.map((e) => ({ id: e, value: e, item: translate({ key: evKey(e) }) }));
  const actionItems: DropdownItem[] = ACTIONS.map((a) => ({ id: a, value: a, item: translate({ key: acKey(a) }) }));
  const stageItems: DropdownItem[] = stages.map((st) => ({ id: st.id, value: st.id, item: st.name }));

  const reset = () => { setCreating(false); setName(''); setTitle(''); setBody(''); setTargetStage(''); setRequiresApproval(false); };
  const create = () => {
    if (!name.trim()) return;
    const params: Record<string, unknown> = {};
    if (action === 'notify') { params.title = title || name; params.body = body; }
    if (action === 'emit-signal') { params.kind = title || 'custom'; }
    if (action === 'start-stage') { params.targetStageId = targetStage; }
    saveTrigger({ name: name.trim(), on, action, requiresApproval, params, ...(on === 'cron' ? { cron } : {}) });
    reset();
  };

  return (
    <div className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.automation.title' })}</div>
          <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.automation.subtitle' })}</div>
        </div>
        {!creating && <WsButton icon="plus" onClick={() => { setCreating(true); }}>{translate({ key: 'workspaces.automation.add' })}</WsButton>}
      </div>

      {triggers.length === 0 && !creating && (
        <div className="text-sm text-muted py-6 text-center">{translate({ key: 'workspaces.automation.empty' })}</div>
      )}

      <div className="flex flex-col gap-2">
        {triggers.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-xl border border-container1-border bg-container2/40 px-3 py-2.5">
            <button
              type="button" onClick={() => { toggleTrigger(t.id, !t.enabled); }}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${t.enabled ? 'bg-primary' : 'bg-container2-border'}`}
              title={translate({ key: t.enabled ? 'workspaces.automation.enabled' : 'workspaces.automation.disabled' })}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${t.enabled ? 'translate-x-4.5' : 'translate-x-1'}`} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-title truncate">{t.name}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted mt-0.5">
                <span className="rounded bg-container2 px-1.5 py-0.5">{translate({ key: evKey(t.on) })}</span>
                <Icon name="arrow-right-long" className="text-disabled" />
                <span className="rounded bg-container2 px-1.5 py-0.5">{translate({ key: acKey(t.action) })}</span>
                {t.requiresApproval && <span className="rounded bg-warning/15 text-warning px-1.5 py-0.5">{translate({ key: 'workspaces.automation.needsApproval' })}</span>}
              </div>
            </div>
            <button type="button" onClick={() => { deleteTrigger(t.id); }} className="text-muted hover:text-wrong cursor-pointer shrink-0" title={translate({ key: 'workspaces.automation.delete' })}>
              <Icon name="trash-can" />
            </button>
          </div>
        ))}
      </div>

      {creating && (
        <div className="mt-3 rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3">
          <input
            value={name} onChange={(e) => { setName(e.target.value); }}
            placeholder={translate({ key: 'workspaces.automation.namePlaceholder' })}
            className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.whenLabel' })}</span>
              <Dropdown size="sm" items={eventItems} value={eventItems.find((i) => i.id === on)} onChange={(it) => { setOn(EVENTS.find((e) => e === it.id) ?? 'ticket.created'); }} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.doLabel' })}</span>
              <Dropdown size="sm" items={actionItems} value={actionItems.find((i) => i.id === action)} onChange={(it) => { setAction(ACTIONS.find((a) => a === it.id) ?? 'notify'); }} />
            </div>
          </div>
          {on === 'cron' && (
            <input value={cron} onChange={(e) => { setCron(e.target.value); }} placeholder="0 9 * * *" className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm font-mono text-title focus:outline-none focus:border-primary" />
          )}
          {action === 'notify' && (
            <>
              <input value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.automation.notifyTitlePlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
              <input value={body} onChange={(e) => { setBody(e.target.value); }} placeholder={translate({ key: 'workspaces.automation.notifyBodyPlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
            </>
          )}
          {action === 'start-stage' && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.targetStage' })}</span>
              <Dropdown size="sm" items={stageItems} value={stageItems.find((i) => i.id === targetStage)} onChange={(it) => { setTargetStage(String(it.id)); }} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-common cursor-pointer">
            <input type="checkbox" checked={requiresApproval} onChange={(e) => { setRequiresApproval(e.target.checked); }} className="accent-primary" />
            {translate({ key: 'workspaces.automation.requireApproval' })}
          </label>
          <div className="flex items-center justify-end gap-2">
            <WsButton variant="ghost" onClick={reset}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
            <WsButton icon="plus" onClick={create}>{translate({ key: 'workspaces.automation.create' })}</WsButton>
          </div>
        </div>
      )}
    </div>
  );
}
