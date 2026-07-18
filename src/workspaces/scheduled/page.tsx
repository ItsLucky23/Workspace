//? intent: Scheduled tasks — run something on a schedule (a cron job, in plain language). Pick a
//? cadence, then either run an AI agent role (e.g. the Interviewer proposing improvements) or send a
//? notification. Built on the existing automation engine (ADR 0027): each row is a cron-scheduled
//? WorkspaceTrigger written through the Conductor (single-writer, B-23). Reusable — the same surface
//? later drives Marketing scraping or any recurring role.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import BaseDropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import MultiSelectDropdown from 'src/_components/dropdown/MultiSelectDropdown';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import { SectionCard, Toggle, WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';

export const template = 'workspaces';

//? Plain-language cadence presets → cron. "Custom" lets the user type a raw expression.
const CADENCES: { id: string; cron: string }[] = [
  { id: 'hourly', cron: '0 * * * *' },
  { id: 'daily', cron: '0 9 * * *' },
  { id: 'weekdays', cron: '0 9 * * 1-5' },
  { id: 'weekly', cron: '0 9 * * 1' },
  { id: 'custom', cron: '' },
];
const inputCls = 'w-full h-9 px-3 rounded-lg border border-container1-border bg-container2/40 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

//? A friendly label for a cron string (covers the presets; falls back to the raw expression).
function cronLabel(cron: string): string {
  const found = CADENCES.find((c) => c.cron === cron && c.id !== 'custom');
  return found ? found.id : cron;
}

export default function Scheduled() {
  const translate = useTranslator();
  const { triggers, agentRoles, toggleTrigger, deleteTrigger, runTrigger } = useWorkspaces();
  const scheduled = triggers.filter((t) => t.on === 'cron');
  const [creating, setCreating] = useState(false);
  //? #93 — confirm before destroying a scheduled task (a mis-tap should not delete it silently).
  const confirmDelete = async (id: string, taskName: string): Promise<void> => {
    const ok = await menuHandler.confirm({ title: translate({ key: 'workspaces.automation.deleteConfirmTitle' }), content: translate({ key: 'workspaces.automation.deleteConfirmBody', params: [{ key: 'name', value: taskName }] }) });
    if (ok) deleteTrigger(id);
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="px-5 md:px-6 pt-5 pb-3 border-b border-divider flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-title min-w-0">
          <span className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0"><Icon name="clock" /></span>
          <div className="min-w-0"><div className="text-xl font-semibold leading-tight">{translate({ key: 'workspaces.scheduled.title' })}</div><div className="text-xs text-muted truncate">{translate({ key: 'workspaces.scheduled.tagline' })}</div></div>
        </div>
        <div className="flex-1" />
        <WsButton icon={creating ? 'xmark' : 'plus'} variant={creating ? 'secondary' : 'primary'} onClick={() => { setCreating((v) => !v); }}>{translate({ key: creating ? 'workspaces.shell.cancel' : 'workspaces.scheduled.new' })}</WsButton>
      </div>

      <div className="p-5 md:p-6 flex flex-col gap-5 max-w-3xl">
        {creating && <CreateForm onDone={() => { setCreating(false); }} />}

        {scheduled.length === 0 && !creating && (
          <div className="text-sm text-muted py-10 text-center border border-dashed border-container1-border rounded-2xl">{translate({ key: 'workspaces.scheduled.empty' })}</div>
        )}

        <div className="flex flex-col gap-3">
          {scheduled.map((t) => {
            const role = typeof t.params === 'object' && t.params !== null && 'role' in t.params ? String((t.params as Record<string, unknown>).role) : null;
            const roleLabel = role ? (agentRoles.find((r) => r.key === role)?.label ?? role) : null;
            const cl = cronLabel(t.cron ?? '');
            const cadenceText = cl === (t.cron ?? '') ? cl : translate({ key: `workspaces.scheduled.cadence.${cl}` });
            return (
              <div key={t.id} className="rounded-2xl border border-container1-border bg-container1 p-4 flex items-center gap-3">
                <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${t.enabled ? 'bg-primary/12 text-primary' : 'bg-container2 text-muted'}`}><Icon name={t.action === 'notify' ? 'bell' : 'robot'} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-title truncate">{t.name}</div>
                  <div className="text-xs text-muted truncate">
                    {cadenceText}
                    {roleLabel ? ` · ${roleLabel}` : (t.action === 'notify' ? ` · ${translate({ key: 'workspaces.scheduled.actNotify' })}` : '')}
                    {t.lastFiredAt ? ` · ${translate({ key: 'workspaces.scheduled.lastRun', params: [{ key: 'when', value: new Date(t.lastFiredAt).toLocaleString() }] })}` : ''}
                  </div>
                </div>
                <button type="button" onClick={() => { runTrigger(t.id); }} title={translate({ key: 'workspaces.scheduled.runNow' })} className="text-muted hover:text-primary cursor-pointer shrink-0 inline-flex items-center gap-1 text-xs"><Icon name="play" />{translate({ key: 'workspaces.scheduled.runNow' })}</button>
                <Toggle on={t.enabled} onChange={(on) => { toggleTrigger(t.id, on); }} />
                <button type="button" onClick={() => { void confirmDelete(t.id, t.name); }} className="text-muted hover:text-wrong cursor-pointer shrink-0"><Icon name="trash-can" className="text-sm" /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const translate = useTranslator();
  const { agentRoles, saveTrigger, content } = useWorkspaces();
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [customCron, setCustomCron] = useState('0 9 * * *');
  const [mode, setMode] = useState<'role' | 'notify'>(agentRoles.length > 0 ? 'role' : 'notify');
  const [roleKey, setRoleKey] = useState(agentRoles[0]?.key ?? '');
  const [focus, setFocus] = useState('');
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyBody, setNotifyBody] = useState('');
  //? GAP_SCAN A1 — a scheduled task can target MANY channels; the role fans out per channel with an
  //? independent result, so "N channels on a cron timer" is configurable from here.
  const [channelIds, setChannelIds] = useState<string[]>([]);

  const cron = cadence === 'custom' ? customCron.trim() : (CADENCES.find((c) => c.id === cadence)?.cron ?? '0 9 * * *');
  const role = agentRoles.find((r) => r.key === roleKey);
  const canSave = name.trim().length > 0 && cron.length > 0 && (mode === 'notify' ? notifyTitle.trim().length > 0 : roleKey.length > 0);

  const roleItems: DropdownItem[] = agentRoles.map((r) => ({ id: r.key, value: r.key, item: r.label, searchText: r.label }));
  const activeRoleItem = roleItems.find((i) => i.id === roleKey);
  const channelItems: DropdownItem[] = content.channels.map((c) => ({ id: c.id, value: c.id, item: `${c.name}${c.platform && c.platform !== 'none' ? ` · ${c.platform}` : ''}${c.autopilot ? ' · autopilot' : ''}`, searchText: c.name }));

  const save = () => {
    if (!canSave) return;
    const params = mode === 'role'
      ? { role: roleKey, ...(focus.trim() ? { focus: focus.trim() } : {}), ...(channelIds.length > 0 ? { channelIds } : {}) }
      : { title: notifyTitle.trim(), body: notifyBody.trim() };
    saveTrigger({
      name: name.trim(), on: 'cron', cron,
      action: mode === 'role' ? 'invoke-agent-role' : 'notify',
      params,
      requiresApproval: mode === 'role' ? (role?.mutates ?? false) : false,
    });
    onDone();
  };

  return (
    <SectionCard title={translate({ key: 'workspaces.scheduled.new' })}>
      <div className="flex flex-col gap-4">
        <Field label={translate({ key: 'workspaces.scheduled.name' })}>
          <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.scheduled.namePlaceholder' })} className={inputCls} />
        </Field>

        <Field label={translate({ key: 'workspaces.scheduled.cadenceLabel' })}>
          <div className="inline-flex flex-wrap gap-0.5 rounded-xl bg-container2 p-0.5">
            {CADENCES.map((c) => <button key={c.id} type="button" onClick={() => { setCadence(c.id); }} className={`rounded-lg px-3 h-8 text-sm font-medium cursor-pointer transition-colors ${cadence === c.id ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>{translate({ key: `workspaces.scheduled.cadence.${c.id}` })}</button>)}
          </div>
          {cadence === 'custom' && <input value={customCron} onChange={(e) => { setCustomCron(e.target.value); }} placeholder="0 9 * * *" className={`mt-2 font-mono ${inputCls}`} />}
        </Field>

        <Field label={translate({ key: 'workspaces.scheduled.doLabel' })}>
          <div className="inline-flex gap-0.5 rounded-xl bg-container2 p-0.5">
            {(['role', 'notify'] as const).map((m) => <button key={m} type="button" onClick={() => { setMode(m); }} disabled={m === 'role' && agentRoles.length === 0} className={`rounded-lg px-3 h-8 text-sm font-medium transition-colors ${mode === m ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'} ${m === 'role' && agentRoles.length === 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>{translate({ key: `workspaces.scheduled.mode.${m}` })}</button>)}
          </div>
        </Field>

        {mode === 'role' ? (
          <>
            <Field label={translate({ key: 'workspaces.scheduled.role' })}>
              <BaseDropdown items={roleItems} {...(activeRoleItem ? { value: activeRoleItem } : {})} placeholder={translate({ key: 'workspaces.scheduled.rolePlaceholder' })} onChange={(i) => { setRoleKey(String(i.id)); }} size="lg" />
              {role && <div className="text-xs text-muted mt-1">{role.description}{role.mutates ? ` · ${translate({ key: 'workspaces.scheduled.needsApproval' })}` : ''}</div>}
            </Field>
            <Field label={translate({ key: 'workspaces.scheduled.focus' })}>
              <input value={focus} onChange={(e) => { setFocus(e.target.value); }} placeholder={translate({ key: 'workspaces.scheduled.focusPlaceholder' })} className={inputCls} />
            </Field>
            {/* A1 — target N channels; the role runs once per channel with an independent result. */}
            {content.channels.length > 0 && (
              <Field label={translate({ key: 'workspaces.scheduled.channels' })}>
                <MultiSelectDropdown
                  items={channelItems}
                  value={channelItems.filter((i) => channelIds.includes(String(i.id)))}
                  onChange={(sel) => { setChannelIds(sel.map((i) => String(i.id))); }}
                  placeholder={translate({ key: 'workspaces.scheduled.channelsPlaceholder' })}
                  size="lg" showSearch
                  selectedCountText={(n) => translate({ key: 'workspaces.scheduled.channelsSelected', params: [{ key: 'count', value: String(n) }] })}
                />
                <div className="text-xs text-muted mt-1">{translate({ key: 'workspaces.scheduled.channelsHint' })}</div>
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label={translate({ key: 'workspaces.scheduled.notifyTitle' })}>
              <input value={notifyTitle} onChange={(e) => { setNotifyTitle(e.target.value); }} placeholder={translate({ key: 'workspaces.scheduled.notifyTitlePlaceholder' })} className={inputCls} />
            </Field>
            <Field label={translate({ key: 'workspaces.scheduled.notifyBody' })}>
              <input value={notifyBody} onChange={(e) => { setNotifyBody(e.target.value); }} className={inputCls} />
            </Field>
          </>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-xs text-muted flex items-center gap-1.5"><Icon name="clock" className="text-primary" />{translate({ key: 'workspaces.scheduled.runsAt', params: [{ key: 'cron', value: cron }] })}</div>
          <WsButton icon="check" onClick={save} disabled={!canSave}>{translate({ key: 'workspaces.scheduled.create' })}</WsButton>
        </div>
      </div>
    </SectionCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-xs text-muted">{label}</span>{children}</div>;
}
