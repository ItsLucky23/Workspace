//? Automation panel (#2) — manage EVENT-driven WorkspaceTriggers: list them (name · event → action ·
//? approval), enable/disable, delete, and create a new one. A trigger fires an action when its event
//? happens (a ticket is created, a stage is entered, …); `requiresApproval` gates the action behind a
//? human-accepted suggestion. CRON triggers have ONE owner — the Schedules page (F-019): it validates the
//? expression (a typo'd cron used to save silently and never fire) and this panel used to list and
//? create the same rows with an unvalidated text field. Cron rows show here only as a count that links out. Deliberately compact — the common `notify` /
//? `emit-signal` / `start-stage` actions get first-class fields; richer params are a follow-up. The
//? outputs an agent-role produces land in the notification bell (the ArtifactViewer).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { confirmDeleteTrigger } from '../_functions/confirmDeleteTrigger';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import { WsButton, IconButton, InfoTip } from './primitives';
import { EmptyPicker } from './SetupNotice';
import { Collapse } from './motion';
import Icon from './Icon';
import type { TriggerActionKind, TriggerEventKind } from '../_data/types';

//? #83 — stage.on_signal (a WorkspaceSignal was emitted) + stage.on_approval (a gated automation was approved)
//? are now real fired events, so a trigger can chain off them. No 'cron' here — see the header.
const EVENTS: TriggerEventKind[] = ['ticket.created', 'stage.on_enter', 'stage.on_complete', 'stage.on_signal', 'stage.on_approval', 'ticket.merged', 'suggestion.accepted'];
//? #50/#88 — 'invoke-agent-role' is now event-attachable (was cron-only on the Scheduled page).
//? #90 — run-command (operator-gated in-container shell) + invoke-workspace-ai (a non-coding AI Q&A) are
//? now real executors, so they're offered here. run-command always opens an approval before it runs.
const ACTIONS: TriggerActionKind[] = ['notify', 'emit-signal', 'start-stage', 'invoke-agent-role', 'invoke-workspace-ai', 'run-command', 'webhook'];
//? Flat i18n keys (the event kinds contain dots, which would break the translator's dot-nesting).
const EVENT_KEY: Record<string, string> = {
  'ticket.created': 'workspaces.automation.evTicketCreated', 'ticket.merged': 'workspaces.automation.evTicketMerged',
  'stage.on_enter': 'workspaces.automation.evStageEnter', 'stage.on_complete': 'workspaces.automation.evStageComplete',
  'stage.on_signal': 'workspaces.automation.evStageSignal', 'stage.on_approval': 'workspaces.automation.evStageApproval',
  'suggestion.accepted': 'workspaces.automation.evSuggestionAccepted',
};
const ACTION_KEY: Record<string, string> = {
  notify: 'workspaces.automation.acNotify', 'emit-signal': 'workspaces.automation.acEmitSignal', 'start-stage': 'workspaces.automation.acStartStage', webhook: 'workspaces.automation.acWebhook',
  'invoke-workspace-ai': 'workspaces.automation.acInvokeAi', 'invoke-agent-role': 'workspaces.automation.acInvokeRole', 'run-command': 'workspaces.automation.acRunCommand',
};
const evKey = (e: string): string => EVENT_KEY[e] ?? 'workspaces.automation.evTicketCreated';
const acKey = (a: string): string => ACTION_KEY[a] ?? 'workspaces.automation.acNotify';

export default function AutomationPanel() {
  const translate = useTranslator();
  const { triggers: allTriggers, saveTrigger, toggleTrigger, deleteTrigger, runTrigger, agentRoles, stages, navigate } = useWorkspaces();
  const triggers = allTriggers.filter((t) => t.on !== 'cron');
  const cronCount = allTriggers.length - triggers.length;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [on, setOn] = useState<TriggerEventKind>('ticket.created');
  const [action, setAction] = useState<TriggerActionKind>('notify');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [signalKind, setSignalKind] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [targetStage, setTargetStage] = useState('');
  const [matchStage, setMatchStage] = useState('');   // #91 — '' = any stage
  const [debounce, setDebounce] = useState('');        // #91 — seconds; '' = no debounce
  const [webhookUrl, setWebhookUrl] = useState('');
  const [command, setCommand] = useState('');       // #90 — run-command shell (runs in the ticket container)
  const [aiPrompt, setAiPrompt] = useState('');      // #90 — invoke-workspace-ai prompt

  const eventItems: DropdownItem[] = EVENTS.map((e) => ({ id: e, value: e, item: translate({ key: evKey(e) }) }));
  const actionItems: DropdownItem[] = ACTIONS.map((a) => ({ id: a, value: a, item: translate({ key: acKey(a) }) }));
  const stageItems: DropdownItem[] = stages.map((st) => ({ id: st.id, value: st.id, item: st.name }));
  const roleItems: DropdownItem[] = agentRoles.map((r) => ({ id: r.key, value: r.key, item: r.label, searchText: r.label }));
  const matchStageItems: DropdownItem[] = [{ id: '', value: '', item: translate({ key: 'workspaces.automation.matchAnyStage' }) }, ...stageItems];

  const reset = () => { setCreating(false); setName(''); setTitle(''); setBody(''); setSignalKind(''); setRoleKey(''); setTargetStage(''); setMatchStage(''); setDebounce(''); setWebhookUrl(''); setCommand(''); setAiPrompt(''); setRequiresApproval(false); };
  const webhookValid = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(webhookUrl.trim());
  let actionReady = true;
  if (action === 'start-stage') actionReady = stageItems.length > 0 && targetStage.length > 0;
  if (action === 'invoke-agent-role') actionReady = roleKey.length > 0;
  if (action === 'webhook') actionReady = webhookValid;
  if (action === 'run-command') actionReady = command.trim().length > 0;
  if (action === 'invoke-workspace-ai') actionReady = aiPrompt.trim().length > 0;
  const canCreate = name.trim().length > 0 && actionReady;
  const create = () => {
    if (!canCreate) return;
    const params: Record<string, unknown> = {};
    if (action === 'notify') { params.title = title || name; params.body = body; }
    if (action === 'emit-signal') { params.kind = signalKind.trim() || 'custom'; }
    if (action === 'start-stage') { params.targetStageId = targetStage; }
    if (action === 'invoke-agent-role') { params.role = roleKey; }
    if (action === 'webhook') { params.url = webhookUrl.trim(); }
    if (action === 'run-command') { params.command = command.trim(); }
    if (action === 'invoke-workspace-ai') { params.prompt = aiPrompt.trim(); }
    //? #91 — optional match facet (stage) + debounce.
    const match = matchStage ? { stageIds: [matchStage] } : undefined;
    const debounceSec = Number(debounce);
    const debounceMs = debounce.trim() && Number.isFinite(debounceSec) && debounceSec > 0 ? Math.round(debounceSec * 1000) : undefined;
    saveTrigger({
      name: name.trim(), on, action, requiresApproval, params,
      ...(match ? { match } : {}),
      ...(debounceMs === undefined ? {} : { debounceMs }),
    });
    reset();
  };

  //? #93 — a mis-tap should not destroy a trigger silently; confirm first (shared helper).
  const confirmDelete = async (id: string, triggerName: string): Promise<void> => {
    if (await confirmDeleteTrigger(translate, triggerName)) deleteTrigger(id);
  };

  //? #96 — one-line plain-language preview ("when <event> → <action>") so the user can sanity-check the
  //? rule before creating it, instead of only finding out what it does via "run now" after the fact.
  const previewPlaceholder = translate({ key: 'workspaces.automation.previewPlaceholder' });
  const previewDetail = ((): string => {
    switch (action) {
      case 'notify': { return translate({ key: 'workspaces.automation.previewNotify', params: [{ key: 'title', value: title || name || previewPlaceholder }] }); }
      case 'emit-signal': { return translate({ key: 'workspaces.automation.previewEmitSignal', params: [{ key: 'kind', value: signalKind.trim() || 'custom' }] }); }
      case 'start-stage': { return translate({ key: 'workspaces.automation.previewStartStage', params: [{ key: 'stage', value: stages.find((st) => st.id === targetStage)?.name ?? previewPlaceholder }] }); }
      case 'invoke-agent-role': { return translate({ key: 'workspaces.automation.previewInvokeRole', params: [{ key: 'role', value: agentRoles.find((r) => r.key === roleKey)?.label ?? previewPlaceholder }] }); }
      case 'invoke-workspace-ai': { return translate({ key: 'workspaces.automation.previewInvokeAi', params: [{ key: 'prompt', value: aiPrompt.trim() || previewPlaceholder }] }); }
      case 'run-command': { return translate({ key: 'workspaces.automation.previewRunCommand', params: [{ key: 'command', value: command.trim() || previewPlaceholder }] }); }
      case 'webhook': { return translate({ key: 'workspaces.automation.previewWebhook', params: [{ key: 'url', value: webhookUrl.trim() || previewPlaceholder }] }); }
      default: { return ''; }
    }
  })();
  const previewEvent = translate({ key: evKey(on) });
  const preview = translate({ key: 'workspaces.automation.previewTemplate', params: [{ key: 'event', value: previewEvent }, { key: 'detail', value: previewDetail }] });

  return (
    <div className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.automation.title' })}</div>
          <div className="text-sm text-muted mt-0.5">{translate({ key: 'workspaces.automation.subtitle' })}</div>
        </div>
        <div className={`flex items-center gap-2 shrink-0`}>
          {/* the play button on every row below hides two surprises (no ticket context + it still asks for
              approval), so the explanation lives once in the header instead of on each row */}
          {triggers.length > 0 && (
            <InfoTip
              align="end"
              label={translate({ key: 'workspaces.tips.automations.runNowLabel' })}
              title={translate({ key: 'workspaces.tips.automations.runNowTitle' })}
              body={translate({ key: 'workspaces.tips.automations.runNowBody' })}
            />
          )}
          {!creating && <WsButton icon="plus" onClick={() => { setCreating(true); }}>{translate({ key: 'workspaces.automation.add' })}</WsButton>}
        </div>
      </div>

      {triggers.length === 0 && !creating && (
        <div className="text-sm text-muted py-6 text-center">{translate({ key: 'workspaces.automation.empty' })}</div>
      )}

      {/* Cron rows belong to Schedules — a read-only count that links there, never a second editor. */}
      {cronCount > 0 && (
        <button
          type="button" onClick={() => { navigate('scheduled'); }}
          className="mb-3 w-full flex items-center gap-2 rounded-xl border border-container1-border bg-container2/40 px-3 py-2.5 text-sm text-muted hover:text-common hover:bg-container2 cursor-pointer transition-colors"
        >
          <Icon name="clock" className="text-primary" />
          <span className="flex-1 text-left">{translate({ key: 'workspaces.automation.cronCountRow', params: [{ key: 'count', value: String(cronCount) }] })}</span>
          <span className="text-primary">{translate({ key: 'workspaces.automation.cronCountLink' })}</span>
          <Icon name="arrow-right-long" className="text-xs text-primary" />
        </button>
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
            <IconButton icon="play" onClick={() => { runTrigger(t.id); }} title={translate({ key: 'workspaces.automation.runNow' })} className="shrink-0 hover:text-primary" />
            <IconButton icon="trash-can" onClick={() => { void confirmDelete(t.id, t.name); }} title={translate({ key: 'workspaces.automation.delete' })} className="shrink-0 hover:text-wrong" />
          </div>
        ))}
      </div>

      {/* #94 — motion gap-fix: the create form used to snap into existence; Collapse gives it a height+fade entrance. */}
      <Collapse open={creating}>
        <div className="mt-3 rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3">
          <input
            value={name} onChange={(e) => { setName(e.target.value); }}
            placeholder={translate({ key: 'workspaces.automation.namePlaceholder' })}
            className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.whenLabel' })}</span>
              <Dropdown size="sm" width="full" items={eventItems} value={eventItems.find((i) => i.id === on)} onChange={(it) => { setOn(EVENTS.find((e) => e === it.id) ?? 'ticket.created'); }} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.doLabel' })}</span>
              <Dropdown size="sm" width="full" items={actionItems} value={actionItems.find((i) => i.id === action)} onChange={(it) => { setAction(ACTIONS.find((a) => a === it.id) ?? 'notify'); }} />
            </div>
          </div>
          {/* #94 — each conditional action/event field block animates in/out instead of popping as `action`/`on` change. */}
          <Collapse open={action === 'notify'}>
            <div className="flex flex-col gap-3">
              <input value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.automation.notifyTitlePlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
              <input value={body} onChange={(e) => { setBody(e.target.value); }} placeholder={translate({ key: 'workspaces.automation.notifyBodyPlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
            </div>
          </Collapse>
          <Collapse open={action === 'emit-signal'}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.signalKindLabel' })}</span>
              <input value={signalKind} onChange={(e) => { setSignalKind(e.target.value); }} placeholder={translate({ key: 'workspaces.automation.signalKindPlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm font-mono text-title focus:outline-none focus:border-primary" />
              <span className="text-xs text-disabled">{translate({ key: 'workspaces.automation.signalKindHelp' })}</span>
            </div>
          </Collapse>
          <Collapse open={action === 'start-stage'}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.targetStage' })}</span>
              {/* Dropdown renders nothing at all when it has no items, leaving an orphan label above empty
                  space — and the rule would still save with an empty target and noop on every fire. */}
              {stageItems.length === 0
                ? (
                  <EmptyPicker
                    icon="diagram-project"
                    label={translate({ key: 'workspaces.tips.automations.noStages' })}
                    fix={{ cap: 'editPipeline', view: 'pipeline', cta: translate({ key: 'workspaces.tips.automations.noStagesCta' }) }}
                  />
                )
                : <Dropdown size="sm" width="full" items={stageItems} value={stageItems.find((i) => i.id === targetStage)} onChange={(it) => { setTargetStage(String(it.id)); }} />}
            </div>
          </Collapse>
          <Collapse open={action === 'invoke-agent-role'}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.roleLabel' })}</span>
              {/* no in-app fix on purpose: roles are registered by the server at boot, not created here */}
              {roleItems.length === 0
                ? <EmptyPicker icon="robot" label={translate({ key: 'workspaces.tips.automations.noRoles' })} />
                : <Dropdown size="sm" width="full" items={roleItems} value={roleItems.find((i) => i.id === roleKey)} onChange={(it) => { setRoleKey(String(it.id)); }} />}
            </div>
          </Collapse>
          <Collapse open={action === 'webhook'}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.webhookUrl' })}</span>
              <input value={webhookUrl} onChange={(e) => { setWebhookUrl(e.target.value); }} placeholder="https://example.com/hook" className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary font-mono" />
            </div>
          </Collapse>
          <Collapse open={action === 'run-command'}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.commandLabel' })}</span>
              <input value={command} onChange={(e) => { setCommand(e.target.value); }} placeholder={translate({ key: 'workspaces.automation.commandPlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm font-mono text-title focus:outline-none focus:border-primary" />
              <span className="text-xs text-disabled">{translate({ key: 'workspaces.automation.commandHelp' })}</span>
            </div>
          </Collapse>
          <Collapse open={action === 'invoke-workspace-ai'}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{translate({ key: 'workspaces.automation.aiPromptLabel' })}</span>
              <input value={aiPrompt} onChange={(e) => { setAiPrompt(e.target.value); }} placeholder={translate({ key: 'workspaces.automation.aiPromptPlaceholder' })} className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
            </div>
          </Collapse>
          {/* #91 — optional match facet (stage) + debounce for event triggers (hidden for cron). #95 — help text
              disambiguates "match stage" from the stage the event itself already fires from: for a stage.* event
              it narrows WHICH stage's event counts; for every other event it filters by the ticket's current stage. */}
          <Collapse open={on !== 'cron'}>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className={`text-xs text-muted flex items-center gap-1.5`}>
                    {translate({ key: 'workspaces.automation.matchStageLabel' })}
                    <InfoTip
                      align="start"
                      label={translate({ key: 'workspaces.tips.automations.matchStageLabel' })}
                      title={translate({ key: 'workspaces.tips.automations.matchStageTitle' })}
                      body={translate({ key: 'workspaces.tips.automations.matchStageBody' })}
                    />
                  </span>
                  <Dropdown size="sm" width="full" items={matchStageItems} value={matchStageItems.find((i) => i.id === matchStage)} onChange={(it) => { setMatchStage(String(it.id)); }} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className={`text-xs text-muted flex items-center gap-1.5`}>
                    {translate({ key: 'workspaces.automation.debounceLabel' })}
                    <InfoTip
                      align="end"
                      label={translate({ key: 'workspaces.tips.automations.debounceLabel' })}
                      title={translate({ key: 'workspaces.tips.automations.debounceTitle' })}
                      body={translate({ key: 'workspaces.tips.automations.debounceBody' })}
                    />
                  </span>
                  <input type="number" min="0" value={debounce} onChange={(e) => { setDebounce(e.target.value); }} placeholder="0" className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary" />
                </div>
              </div>
              {/* the non-stage help line said the opposite of what the engine does (it matches the stage the
                  EVENT reports, never the ticket's current one), so it points at a corrected string now */}
              <span className="text-xs text-disabled">{translate({ key: on.startsWith('stage.') ? 'workspaces.automation.matchStageHelpStage' : 'workspaces.tips.automations.matchStageHelp' })}</span>
            </div>
          </Collapse>
          {/* the tip sits OUTSIDE the label so opening it doesn't toggle the checkbox */}
          <div className={`flex items-center gap-2`}>
            <label className="flex items-center gap-2 text-sm text-common cursor-pointer">
              <input type="checkbox" checked={requiresApproval} onChange={(e) => { setRequiresApproval(e.target.checked); }} className="accent-primary" />
              {translate({ key: 'workspaces.automation.requireApproval' })}
            </label>
            <InfoTip
              align="start"
              label={translate({ key: 'workspaces.tips.automations.approvalLabel' })}
              title={translate({ key: 'workspaces.tips.automations.approvalTitle' })}
              body={translate({ key: 'workspaces.tips.automations.approvalBody' })}
            />
          </div>
          {/* #96 — a one-line plain-language preview of the rule, so the user can sanity-check the sentence
              before creating it instead of finding out via "run now" after the fact. */}
          <div className="flex items-start gap-2 rounded-lg border border-container1-border bg-container1 px-3 py-2">
            <Icon name="arrow-right-long" className="text-primary mt-0.5 shrink-0" />
            <span className="text-sm text-common">{preview}</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <WsButton variant="ghost" onClick={reset}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
            <WsButton icon="plus" disabled={!canCreate} onClick={create}>{translate({ key: 'workspaces.automation.create' })}</WsButton>
          </div>
        </div>
      </Collapse>
    </div>
  );
}
