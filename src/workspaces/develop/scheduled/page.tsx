//? intent: Scheduled tasks — run something on a timer, in plain language. One primary "New task"
//? button; each row is name + cadence + an enabled toggle, with Run-now and Delete tucked in a per-row
//? overflow menu so phone-width rows stay clean. The create form keeps Name + Cadence + What-to-run
//? top-level and collapses focus/channel fan-out behind an Advanced disclosure; the empty state teaches
//? what scheduling is for. Built on the automation engine (ADR 0027): each row is a cron-scheduled
//? WorkspaceTrigger written through the Conductor (single-writer, B-23).

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import BaseDropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import MultiSelectDropdown from 'src/_components/dropdown/MultiSelectDropdown';
import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../../_components/Icon';
import { Disclosure, EmptyState, InfoTip, PopMenu, SectionCard, Toggle, WsButton } from '../../_components/primitives';
import { EmptyPicker } from '../../_components/SetupNotice';
import { useWorkspaces } from '../../_shell/WorkspacesContext';

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

//? Short relative format ("2h ago") so a row's last-run time survives phone-width truncation
//? instead of the full locale date/time string, which was the first thing clipped off the line.
function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / (60 * 24)), 'day');
}

//? Structural cron validation — 5 space-separated fields, each a wildcard/number/range/list/step.
//? No month or weekday names, since the presets above (and everything this form ever writes) are
//? numeric. Catches the "0 9 * * 8" class of typo before it silently saves and never fires.
const CRON_FIELD_RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
function isValidCronField(field: string, [min, max]: [number, number]): boolean {
  return field.split(',').every((part) => {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) return false;
    const [, range, step] = match;
    if (range === undefined) return false;
    if (step !== undefined && Number(step) <= 0) return false;
    if (range === '*') return true;
    const bounds = range.split('-').map(Number);
    return bounds.every((n) => n >= min && n <= max) && (bounds.length === 1 || (bounds[0] ?? 0) <= (bounds[1] ?? 0));
  });
}
function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5 && fields.every((field, i) => isValidCronField(field, CRON_FIELD_RANGES[i] ?? [0, 59]));
}

//? Best-effort plain-language preview for the common "run at this time, every day" shape a typed
//? custom cron usually is; anything with ranges/lists/steps in minute or hour returns null so the
//? caller falls back to the raw (now-validated) expression instead of a wrong paraphrase.
function describeSimpleCron(cron: string): string | null {
  const [min, hour, dom, month, dow] = cron.trim().split(/\s+/);
  if (min === undefined || hour === undefined || !/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  if (dom !== '*' || month !== '*' || dow !== '*') return null;
  return `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
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
    <div className={`h-full min-h-0 overflow-y-auto`}>
      <div className={`px-5 md:px-6 pt-5 pb-3 border-b border-divider flex flex-wrap items-center gap-3`}>
        <div className={`flex items-center gap-2 text-title min-w-0`}>
          <span className={`w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0`}><Icon name="clock" /></span>
          <div className={`min-w-0`}><div className={`text-xl font-semibold leading-tight`}>{translate({ key: 'workspaces.scheduled.title' })}</div><div className={`text-xs text-muted truncate`}>{translate({ key: 'workspaces.scheduled.tagline' })}</div></div>
        </div>
        <div className={`flex-1`} />
        <WsButton icon={creating ? 'xmark' : 'plus'} variant={creating ? 'secondary' : 'primary'} onClick={() => { setCreating((v) => !v); }}>{translate({ key: creating ? 'workspaces.shell.cancel' : 'workspaces.scheduled.new' })}</WsButton>
      </div>

      <div className={`p-5 md:p-6 flex flex-col gap-5 max-w-3xl`}>
        {creating && <CreateForm onDone={() => { setCreating(false); }} />}

        {scheduled.length === 0 && !creating && (
          <EmptyState
            icon="clock"
            title={translate({ key: 'workspaces.scheduled.emptyTitle' })}
            sub={translate({ key: 'workspaces.scheduled.emptySub' })}
            action={<WsButton icon="plus" onClick={() => { setCreating(true); }}>{translate({ key: 'workspaces.scheduled.emptyCta' })}</WsButton>}
          />
        )}

        <div className={`flex flex-col gap-3`}>
          {scheduled.map((t) => {
            const role = typeof t.params === 'object' && t.params !== null && 'role' in t.params ? String((t.params as Record<string, unknown>).role) : null;
            const roleLabel = role ? (agentRoles.find((r) => r.key === role)?.label ?? role) : null;
            const cl = cronLabel(t.cron ?? '');
            const cadenceText = cl === (t.cron ?? '') ? cl : translate({ key: `workspaces.scheduled.cadence.${cl}` });
            return (
              <div key={t.id} className={`rounded-2xl border border-container1-border bg-container1 p-4 flex items-center gap-3`}>
                <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${t.enabled ? 'bg-primary/12 text-primary' : 'bg-container2 text-muted'}`}><Icon name={t.action === 'notify' ? 'bell' : 'robot'} /></span>
                <div className={`min-w-0 flex-1`}>
                  <div className={`text-sm font-medium text-title truncate`}>{t.name}</div>
                  <div className={`text-xs text-muted truncate`}>
                    {cadenceText}
                    {roleLabel ? ` · ${roleLabel}` : (t.action === 'notify' ? ` · ${translate({ key: 'workspaces.scheduled.actNotify' })}` : '')}
                  </div>
                  {/*? #3 — its own non-truncating slot + a short relative format, so the most useful piece of
                      row state survives phone width instead of being the first thing the truncated line clips. */}
                  {t.lastFiredAt && (
                    <div className={`text-xs text-meta mt-0.5 flex items-center gap-1.5`}>
                      {translate({ key: 'workspaces.scheduled.lastRun', params: [{ key: 'when', value: timeAgo(t.lastFiredAt) }] })}
                      <InfoTip
                        align="start"
                        label={translate({ key: 'workspaces.tips.backlog.lastRunTitle' })}
                        title={translate({ key: 'workspaces.tips.backlog.lastRunTitle' })}
                        body={translate({ key: 'workspaces.tips.backlog.lastRunBody' })}
                      />
                    </div>
                  )}
                </div>
                <Toggle on={t.enabled} onChange={(on) => { toggleTrigger(t.id, on); }} ariaLabel={t.name} />
                {/*? Run-now + Delete live behind the kebab so a phone-width row stays name + toggle; the delete keeps its #93 confirm gate. */}
                <PopMenu
                  ariaLabel={translate({ key: 'workspaces.scheduled.taskMenu' })}
                  items={[
                    { label: translate({ key: 'workspaces.scheduled.runNow' }), icon: 'play', onClick: () => { runTrigger(t.id); } },
                    { divider: true },
                    { label: translate({ key: 'workspaces.scheduled.delete' }), icon: 'trash', danger: true, onClick: () => { void confirmDelete(t.id, t.name); } },
                  ]}
                />
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
  //? #1 — a typo'd custom cron (e.g. "0 9 * * 8") used to save silently and never fire; validate
  //? before Create is even enabled.
  const cronOk = cadence !== 'custom' || isValidCron(cron);
  const canSave = name.trim().length > 0 && cron.length > 0 && cronOk && (mode === 'notify' ? notifyTitle.trim().length > 0 : roleKey.length > 0);
  const presetLabel = cadence === 'custom' ? null : translate({ key: `workspaces.scheduled.cadence.${cadence}` });
  const simpleTime = cadence === 'custom' && cronOk ? describeSimpleCron(cron) : null;

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
      <div className={`flex flex-col gap-4`}>
        <Field label={translate({ key: 'workspaces.scheduled.name' })}>
          <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.scheduled.namePlaceholder' })} className={inputCls} />
        </Field>

        <Field label={translate({ key: 'workspaces.scheduled.cadenceLabel' })}>
          <div className={`inline-flex flex-wrap gap-0.5 rounded-xl bg-container2 p-0.5`}>
            {CADENCES.map((c) => <button key={c.id} type="button" onClick={() => { setCadence(c.id); }} className={`rounded-lg px-3 h-8 text-sm font-medium cursor-pointer transition-colors ${cadence === c.id ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'}`}>{translate({ key: `workspaces.scheduled.cadence.${c.id}` })}</button>)}
          </div>
          {cadence === 'custom' && (
            <>
              <input
                value={customCron} onChange={(e) => { setCustomCron(e.target.value); }} placeholder="0 9 * * *"
                className={`mt-2 font-mono ${inputCls} ${cronOk ? '' : 'border-wrong focus:border-wrong focus:ring-wrong/30'}`}
                aria-invalid={!cronOk} aria-describedby={cronOk ? undefined : 'scheduled-cron-error'}
              />
              {!cronOk && <div id="scheduled-cron-error" className={`text-xs text-wrong mt-1`}>{translate({ key: 'workspaces.scheduled.runsAtInvalid' })}</div>}
            </>
          )}
        </Field>

        <Field label={translate({ key: 'workspaces.scheduled.doLabel' })}>
          <div className={`inline-flex flex-wrap gap-0.5 rounded-xl bg-container2 p-0.5`}>
            {(['role', 'notify'] as const).map((m) => <button key={m} type="button" onClick={() => { setMode(m); }} disabled={m === 'role' && agentRoles.length === 0} className={`rounded-lg px-3 h-8 text-sm font-medium transition-colors ${mode === m ? 'bg-container1 text-title shadow-sm' : 'text-muted hover:text-common'} ${m === 'role' && agentRoles.length === 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>{translate({ key: `workspaces.scheduled.mode.${m}` })}</button>)}
          </div>
          {/* ADR 0312 — a disabled "Run an AI role" with no text reads as broken. Roles are registered
              in code (no screen creates one), so this states the situation without a dead fix button. */}
          {agentRoles.length === 0 && (
            <div className={`mt-2`}>
              <EmptyPicker icon="robot" label={translate({ key: 'workspaces.tips.backlog.noRolesLabel' })} />
            </div>
          )}
        </Field>

        {mode === 'role' ? (
          <>
            <Field label={translate({ key: 'workspaces.scheduled.role' })}>
              <BaseDropdown items={roleItems} {...(activeRoleItem ? { value: activeRoleItem } : {})} placeholder={translate({ key: 'workspaces.scheduled.rolePlaceholder' })} onChange={(i) => { setRoleKey(String(i.id)); }} size="md" width="full" />
              {role && (
                <div className={`text-xs text-muted mt-1 flex items-center gap-1.5`}>
                  <span className={`min-w-0`}>{role.description}{role.mutates ? ` · ${translate({ key: 'workspaces.scheduled.needsApproval' })}` : ''}</span>
                  {role.mutates && (
                    <InfoTip
                      align="start"
                      label={translate({ key: 'workspaces.tips.backlog.approvalTitle' })}
                      title={translate({ key: 'workspaces.tips.backlog.approvalTitle' })}
                      body={translate({ key: 'workspaces.tips.backlog.approvalBody' })}
                    />
                  )}
                </div>
              )}
            </Field>
            {/*? Focus + channel fan-out are power options — collapsed so the everyday path stays Name + Cadence + Role.
                #5 — the summary now names what it hides + a live channel-count badge, so a collapsed row still
                communicates active configuration instead of reading as an empty, unconfigured "Advanced". */}
            <Disclosure summary={
              <span className={`inline-flex items-center gap-2`}>
                {translate({ key: 'workspaces.scheduled.advancedSummary' })}
                {channelIds.length > 0 && <span className={`rounded-full bg-container2 text-muted text-[10px] font-medium px-1.5 py-0.5`}>{translate({ key: 'workspaces.scheduled.channelsSelected', params: [{ key: 'count', value: String(channelIds.length) }] })}</span>}
              </span>
            }>
              <div className={`flex flex-col gap-4`}>
                <Field label={translate({ key: 'workspaces.scheduled.focus' })}>
                  <input value={focus} onChange={(e) => { setFocus(e.target.value); }} placeholder={translate({ key: 'workspaces.scheduled.focusPlaceholder' })} className={inputCls} />
                </Field>
                {/* A1 — target N channels; the role runs once per channel with an independent result. */}
                <Field label={translate({ key: 'workspaces.scheduled.channels' })}>
                  {content.channels.length > 0 ? (
                    <>
                      <MultiSelectDropdown
                        items={channelItems}
                        value={channelItems.filter((i) => channelIds.includes(String(i.id)))}
                        onChange={(sel) => { setChannelIds(sel.map((i) => String(i.id))); }}
                        placeholder={translate({ key: 'workspaces.scheduled.channelsPlaceholder' })}
                        size="md" width="full" showSearch
                        selectedCountText={(n) => translate({ key: 'workspaces.scheduled.channelsSelected', params: [{ key: 'count', value: String(n) }] })}
                      />
                      <div className={`text-xs text-muted mt-1 flex items-start gap-1.5`}>
                        <span className={`min-w-0`}>{translate({ key: 'workspaces.scheduled.channelsHint' })}</span>
                        {/* ADR 0312 — that promise holds for the idea generator only; the other roles
                            receive the selection and ignore it (same for Focus). */}
                        <InfoTip
                          align="start"
                          label={translate({ key: 'workspaces.tips.backlog.roleFieldsTitle' })}
                          title={translate({ key: 'workspaces.tips.backlog.roleFieldsTitle' })}
                          points={[
                            { id: 'channels', label: translate({ key: 'workspaces.tips.backlog.channelsPointLabel' }), desc: translate({ key: 'workspaces.tips.backlog.channelsPointDesc' }) },
                            { id: 'focus', label: translate({ key: 'workspaces.tips.backlog.focusPointLabel' }), desc: translate({ key: 'workspaces.tips.backlog.focusPointDesc' }) },
                          ]}
                        />
                      </div>
                    </>
                  ) : (
                    <EmptyPicker
                      icon="bullhorn"
                      label={translate({ key: 'workspaces.tips.backlog.noChannelsLabel' })}
                      fix={{ cap: 'workTickets', view: 'content/settings', tab: 'channels', cta: translate({ key: 'workspaces.tips.backlog.noChannelsCta' }) }}
                    />
                  )}
                </Field>
              </div>
            </Disclosure>
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

        <div className={`flex items-center justify-between gap-2 pt-1`}>
          {/*? #1 — the footer used to echo the raw cron string back even for the plain-language presets
              ("Runs on: 0 9 * * *"), which isn't more readable than what was typed. Presets now reuse
              their own translated label; a parseable custom expression gets a real time; anything else
              still shows the raw (now-validated) expression, and an invalid one shows the error instead. */}
          <div className={`text-xs flex items-center gap-1.5 ${cronOk ? 'text-muted' : 'text-wrong'}`}>
            <Icon name="clock" className={cronOk ? 'text-primary' : 'text-wrong'} />
            {cronOk
              ? (presetLabel ?? (simpleTime
                ? translate({ key: 'workspaces.scheduled.runsAtSimple', params: [{ key: 'time', value: simpleTime }] })
                : translate({ key: 'workspaces.scheduled.runsAt', params: [{ key: 'cron', value: cron }] })))
              : translate({ key: 'workspaces.scheduled.runsAtInvalid' })}
            <InfoTip
              align="start"
              label={translate({ key: 'workspaces.tips.backlog.clockTitle' })}
              title={translate({ key: 'workspaces.tips.backlog.clockTitle' })}
              body={translate({ key: 'workspaces.tips.backlog.clockBody' })}
            />
          </div>
          <WsButton icon="check" onClick={save} disabled={!canSave}>{translate({ key: 'workspaces.scheduled.create' })}</WsButton>
        </div>
      </div>
    </SectionCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={`flex flex-col gap-1`}><span className={`text-xs text-muted`}>{label}</span>{children}</div>;
}
