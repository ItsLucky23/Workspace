//? Workspaces — workspace settings. Members + per-member role (searchable
//? dropdown), the editable RBAC permissions matrix, pending invites, GitLab
//? integration, and the danger zone (transfer / delete, type-to-confirm). The
//? RBAC matrix + member roles live in app context so edits survive tab/route
//? changes. Dummy data; desktop-first.

import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { loadThemeId } from 'src/_components/editor/editorThemes';

//? Lazy so Monaco (multi-MB) never lands in the workspace-settings route chunk — it loads
//? only when the Dockerfile review card actually mounts.
const LazyMonaco = lazy(() => import('src/_components/editor/MonacoEditor').then((m) => ({ default: m.MonacoEditor })));

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { Table, type TableColumn } from '../_components/dataDisplay';
import { LayerNote, useLayerTip } from '../_components/EffectivePromptPreview';
import { Collapse } from '../_components/motion';
import { AvatarBubble, IconButton, InfoTip, PopMenu, Tabs, Toggle, WsButton, type PopMenuItem, type TabDef } from '../_components/primitives';
import { EmptyPicker } from '../_components/SetupNotice';
import { CAP } from '../_data/capabilities';
import { PageSections, useTrailSegment } from '../_components/sections';
import { RepoInventoryPanel, RepoScriptPicker, useRepoIntrospection } from './repoIntrospection';
import { RunProcessList, anyRowIncomplete, rowCommand, seedProcesses } from './runProcesses';
import { SkillsSection } from './skillsEditor';
import { AiProvidersSection, CodingAgentSection } from './aiProviders';
import { FormSection, INPUT_CLS_FULL as fieldCls, INPUT_CLS_FULL_MONO as inputCls, SavePill, SettingRow, useAutosave } from '../_components/settings';
import { resolveAiLayers } from '../_functions/aiLayers';
import { INTEGRATION_TYPES, RBAC_CAPABILITIES, ROLE_DISPLAY } from '../_data/seed';
import { GATEABLE_SECTIONS, WORKSPACE_MODULES, WORKSPACE_SECTIONS, isModuleEnabled } from '../_data/modules';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { StageProcessCfg, BranchStrategyKind, EnvVar, GitConfig, IntegrationField, IntegrationTool, InviteEntry, Member, PushPolicy } from '../_data/types';

//? `w-full` was missing, so every input built from this class rendered at the browser's intrinsic
//? text-input width (~150px) inside a column sized for far more — a settings page of stubby boxes.
//? SettingRow already caps the control column (`sm:max-w-sm`), so filling it is the intended size.
const RBAC_CAPABILITY_KEYS: Record<string, string> = {
  'Use terminals + work on tickets': 'terminals',
  'Edit pipeline / stages': 'pipeline',
  'Workspace settings / GitLab token': 'workspaceSettings',
  'Invite / remove members': 'members',
  'Manage sprints + labels, teardown': 'sprints',
  'Promote a member to Admin': 'promoteAdmin',
  'Downgrade / remove an Admin': 'downgradeAdmin',
  'Transfer ownership / delete workspace': 'ownership',
};

function removeMenu(member: Member, translate: ReturnType<typeof useTranslator>, onRemove: () => void): PopMenuItem[] {
  return [
    {
      label: translate({ key: 'workspaces.workspaceSettings.removeFromWorkspace' }), icon: 'triangle-exclamation', danger: true,
      onClick: () => {
        void menuHandler.confirm({
          title: translate({ key: 'workspaces.workspaceSettings.removeMemberConfirmTitle', params: [{ key: 'name', value: member.name }] }),
          content: translate({ key: 'workspaces.workspaceSettings.removeMemberConfirmContent' }),
        }).then((ok) => { if (ok) onRemove(); });
      },
    },
  ];
}

function MembersTab() {
  const translate = useTranslator();
  const { memberRoles, setMemberRole, permRoles, activeWorkspace, members, removeMember } = useWorkspaces();
  //? You assign any non-Owner role; ownership changes via the danger zone only. `locked` means the
  //? permission MATRIX is read-only (built-ins), not that the role is unassignable — filtering on it
  //? left a default workspace with zero pickable roles. Items carry the KEY: the conductor's
  //? change-role looks roles up by key, and memberRoles holds the raw key.
  const roleItems = permRoles.filter((r) => r.key !== 'owner').map((r) => ({ id: r.key, value: r.key, item: r.name }));

  const columns: TableColumn<Member>[] = [
    {
      id: 'member',
      header: translate({ key: 'workspaces.workspaceSettings.member' }),
      cell: (m) => (
        <div className="flex items-center gap-3 min-w-0">
          <AvatarBubble user={m} size={32} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-title truncate">{m.name}</div>
            <div className="text-xs text-muted truncate">{m.email}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: translate({ key: 'workspaces.workspaceSettings.role' }),
      className: 'w-52',
      cell: (m) => {
        if (m.id === activeWorkspace.ownerId) return <span className="rounded-full bg-container2 px-2.5 py-1 text-[11px] font-medium text-muted">{translate({ key: 'workspaces.workspaceSettings.ownerBadge' })}</span>;
        const current = roleItems.find((r) => r.id === memberRoles[m.id]);
        return (
          <Dropdown
            size="sm" width="full" showSearch searchPlaceholder={translate({ key: 'workspaces.workspaceSettings.findRolePlaceholder' })}
            value={current} placeholder={translate({ key: 'workspaces.workspaceSettings.setRolePlaceholder' })}
            items={roleItems}
            onChange={(it) => { setMemberRole(m.id, String(it.id)); }}
          />
        );
      },
    },
    {
      id: 'actions',
      header: '',
      className: 'w-10',
      cell: (m) => (m.id === activeWorkspace.ownerId ? null : <div className="flex justify-end"><PopMenu items={removeMenu(m, translate, () => { removeMember(m.id); })} /></div>),
    },
  ];

  return (
    <div className="max-w-2xl mx-auto w-full">
      <Table columns={columns} rows={members} rowKey={(m) => m.id} />
    </div>
  );
}

function PermCell({ on, locked, onToggle, ariaLabel }: { on: boolean; locked?: boolean; onToggle: () => void; ariaLabel: string }) {
  const translate = useTranslator();
  const status = on ? translate({ key: 'workspaces.workspaceSettings.allowed' }) : translate({ key: 'workspaces.workspaceSettings.denied' });
  return (
    <button
      //? a11y (gap-fix): the icon alone announced nothing but "button" — the label now states which
      //? capability × role this cell is, not just its on/off state. Bumped to a 36px touch target.
      type="button" disabled={locked} onClick={onToggle} title={status} aria-label={`${ariaLabel} — ${status}`}
      className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${locked ? 'cursor-default' : 'cursor-pointer'} ${on ? 'bg-primary/15 text-primary' : 'bg-container2 text-disabled hover:bg-container2-hover'}`}
    >
      <Icon name={on ? 'check' : 'xmark'} className="text-xs" />
    </button>
  );
}

//? Editable per-workspace RBAC. The matrix + custom roles live in app context,
//? so toggles and added roles survive switching tabs / navigating away.
function PermissionsTab() {
  const translate = useTranslator();
  const { permRoles, togglePerm, addRole } = useWorkspaces();
  const [adding, setAdding] = useState(false);
  const [newRole, setNewRole] = useState('');

  const submit = () => {
    const name = newRole.trim();
    if (!name) return;
    addRole(name);
    setNewRole(''); setAdding(false);
  };

  const columns: TableColumn<string>[] = [
    { id: 'capability', header: translate({ key: 'workspaces.workspaceSettings.capability' }), cell: (action) => translate({ key: `workspaces.workspaceSettings.capabilityLabels.${RBAC_CAPABILITY_KEYS[action] ?? 'unknown'}` }) },
    ...permRoles.map((r, ri) => ({
      id: r.name,
      header: <span className="block text-center capitalize">{r.name}</span>,
      cell: (action: string) => {
        const ci = RBAC_CAPABILITIES.indexOf(action);
        const label = translate({ key: `workspaces.workspaceSettings.capabilityLabels.${RBAC_CAPABILITY_KEYS[action] ?? 'unknown'}` });
        return (
          <div className="flex justify-center">
            <PermCell on={r.perms[ci] ?? false} locked={r.locked} onToggle={() => { togglePerm(ri, ci); }} ariaLabel={`${label} — ${r.name}`} />
          </div>
        );
      },
    })),
  ];

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.rolesAndPermissions' })}</span>
          <span className="text-sm text-muted ml-2">{translate({ key: 'workspaces.workspaceSettings.thisWorkspace' })}</span>
          {/* The matrix looks like eight local checkboxes; each tick is in fact re-checked on every
              action (hasCapability re-reads role.perms per op) and scopes to THIS workspace only
              (WorkspaceRole rows are per-workspace). The three built-in roles refuse the change
              server-side (role.builtInImmutable), but the snapshot only marks Owner `locked`, so
              Admin/Member cells still look clickable and silently fail — hence the wording. */}
          <InfoTip
            className={`ml-2 align-middle`}
            label={translate({ key: 'workspaces.tips.workspace.permsAria' })}
            title={translate({ key: 'workspaces.tips.workspace.permsTitle' })}
            body={translate({ key: 'workspaces.tips.workspace.permsBody' })}
            points={[
              { id: 'builtin', label: translate({ key: 'workspaces.tips.workspace.permsBuiltinLabel' }), desc: translate({ key: 'workspaces.tips.workspace.permsBuiltinDesc' }) },
              { id: 'instant', label: translate({ key: 'workspaces.tips.workspace.permsInstantLabel' }), desc: translate({ key: 'workspaces.tips.workspace.permsInstantDesc' }) },
              { id: 'widest', label: translate({ key: 'workspaces.tips.workspace.permsWidestLabel' }), desc: translate({ key: 'workspaces.tips.workspace.permsWidestDesc' }) },
            ]}
            align="start"
          />
        </div>
        {adding ? (
          <div className="flex items-center gap-2">
            <input value={newRole} onChange={(e) => { setNewRole(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder={translate({ key: 'workspaces.workspaceSettings.roleNamePlaceholder' })}
              className="h-8 px-2.5 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
            <WsButton onClick={submit}>{translate({ key: 'workspaces.workspaceSettings.add' })}</WsButton>
            <WsButton variant="ghost" onClick={() => { setAdding(false); setNewRole(''); }}>{translate({ key: 'workspaces.workspaceSettings.cancel' })}</WsButton>
          </div>
        ) : <WsButton variant="secondary" icon="plus" onClick={() => { setAdding(true); }}>{translate({ key: 'workspaces.workspaceSettings.addRole' })}</WsButton>}
      </div>

      <Table columns={columns} rows={RBAC_CAPABILITIES} rowKey={(action) => action} />
      <p className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.permissionsFootnote' })}</p>
    </div>
  );
}

function InvitesTab() {
  const translate = useTranslator();
  const { invites, permRoles, inviteMember, revokeInvite } = useWorkspaces();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('');
  //? Ownership only changes via the danger zone — invites offer non-Owner roles only (built-in
  //? Admin/Member included: `locked` only guards the matrix).
  const roleItems = permRoles.filter((r) => r.key !== 'owner').map((r) => ({ id: r.key, value: r.key, item: r.name }));

  const cancel = () => { setInviting(false); setEmail(''); setRoleKey(''); };
  const submit = () => {
    const trimmed = email.trim();
    if (!trimmed || !roleKey) return;
    inviteMember(trimmed, roleKey);
    cancel();
  };

  const columns: TableColumn<InviteEntry>[] = [
    {
      id: 'email',
      header: translate({ key: 'workspaces.workspaceSettings.email' }),
      cell: (i) => (
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-full bg-container2 text-muted flex items-center justify-center shrink-0"><Icon name="plus" /></span>
          <span className="text-sm font-medium text-title truncate">{i.email}</span>
        </div>
      ),
    },
    { id: 'role', header: translate({ key: 'workspaces.workspaceSettings.role' }), cell: (i) => i.roleLabel ?? ROLE_DISPLAY[i.role] },
    {
      id: 'sent',
      header: translate({ key: 'workspaces.workspaceSettings.sentColumn' }),
      cell: (i) => (
        <span className="text-muted">
          {translate({ key: 'workspaces.workspaceSettings.sentAt', params: [{ key: 'when', value: new Date(i.sentAt).toLocaleDateString() }] })}
          {i.expiresAt !== null && ` · ${translate({ key: 'workspaces.workspaceSettings.expiresIn', params: [{ key: 'days', value: Math.max(0, Math.ceil((new Date(i.expiresAt).getTime() - Date.now()) / 86_400_000)) }] })}`}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'w-20',
      cell: (i) => <div className="flex justify-end"><button type="button" onClick={() => { revokeInvite(i.id); }} className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.workspaceSettings.revoke' })}</button></div>,
    },
  ];

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.pendingInvites' })}</span>
        {!inviting && <WsButton icon="plus" onClick={() => { setInviting(true); }}>{translate({ key: 'workspaces.workspaceSettings.inviteMembers' })}</WsButton>}
      </div>
      <Collapse open={inviting}>
        <div className="rounded-xl border border-container1-border bg-container2/40 p-3 flex flex-wrap items-center gap-2">
          <input value={email} onChange={(e) => { setEmail(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={translate({ key: 'workspaces.workspaceSettings.inviteEmailPlaceholder' })} className={`flex-1 min-w-[10rem] ${fieldCls}`} />
          <Dropdown
            size="sm" showSearch searchPlaceholder={translate({ key: 'workspaces.workspaceSettings.findRolePlaceholder' })}
            value={roleItems.find((r) => r.id === roleKey)} placeholder={translate({ key: 'workspaces.workspaceSettings.inviteRolePlaceholder' })}
            items={roleItems}
            onChange={(it) => { setRoleKey(String(it.id)); }}
          />
          <WsButton icon="paper-plane" onClick={submit}>{translate({ key: 'workspaces.workspaceSettings.sendInvite' })}</WsButton>
          <WsButton variant="ghost" onClick={cancel}>{translate({ key: 'workspaces.workspaceSettings.cancel' })}</WsButton>
        </div>
      </Collapse>
      <Table columns={columns} rows={invites} rowKey={(i) => i.id} empty={translate({ key: 'workspaces.workspaceSettings.noPendingInvites' })} />
    </div>
  );
}

//? Autosave (ADR 0309): typing debounces into a write, and the row shows the same saved/error
//? pill AiBehaviorTab uses — a blur with zero feedback used to be the only confirmation a value
//? actually persisted.
function EnvRow({ v, reveal, onToggleReveal, onCommit, onRemove }: {
  v: EnvVar; reveal: boolean; onToggleReveal: () => void; onCommit: (value: string) => void; onRemove: () => void;
}) {
  const translate = useTranslator();
  const [val, setVal] = useState(v.value);
  //? Seed only when the row identity changes. An autosave delta for the same row must not
  //? overwrite characters the user typed after the debounce fired.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the server echo must not reseed the local draft
  useEffect(() => { setVal(v.value); }, [v.id]);
  const status = useAutosave([val], () => { onCommit(val); }, { resetKey: v.id });
  //? A secret's value never leaves the server, so this row cannot show it — but it CAN show whether
  //? there IS one, and that is the whole difference between "saved" and "did nothing". Before this,
  //? every secret rendered the same ten dots whether it held a value or not, and the eye that promised
  //? to reveal it produced an empty box: the honest reading of that screen is "my value was not saved".
  const stored = v.secret ? (v.configured ?? false) : v.value.length > 0;
  //? Masked only when there is something to mask. An unset secret is a plain, directly editable box —
  //? there is nothing to hide, and making the user click an eye first was pure ceremony.
  const masked = v.secret && !reveal && stored;
  return (
    <div className="flex items-center gap-2">
      <input
        value={masked ? '••••••••••' : val}
        readOnly={masked}
        onChange={(e) => { setVal(e.target.value); }}
        placeholder={translate({ key: v.secret && stored ? 'workspaces.workspaceSettings.envReplacePlaceholder' : 'workspaces.workspaceSettings.envEmptyPlaceholder' })}
        className={`flex-1 min-w-0 font-mono ${fieldCls}`}
      />
      {v.secret && (
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${stored ? 'bg-correct/15 text-correct' : 'bg-warning/15 text-warning'}`}>
          {translate({ key: stored ? 'workspaces.workspaceSettings.envStored' : 'workspaces.workspaceSettings.envNotStored' })}
        </span>
      )}
      <SavePill status={status} />
      {/* "Reveal" would be a lie: the plaintext is not here to reveal. What this button does is clear
          the mask so you can type a REPLACEMENT, so that is what it says. */}
      {v.secret && stored && (
        <IconButton
          icon={reveal ? 'xmark' : 'pen'}
          title={translate({ key: reveal ? 'workspaces.workspaceSettings.envKeepStored' : 'workspaces.workspaceSettings.envReplace' })}
          onClick={onToggleReveal}
        />
      )}
      <IconButton icon="trash" title={translate({ key: 'workspaces.workspaceSettings.removeVariable' })} onClick={onRemove} />
    </div>
  );
}

function EnvTab() {
  const translate = useTranslator();
  const { envVars, saveEnvVar, removeEnvVar } = useWorkspaces();
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [newSecret, setNewSecret] = useState(true);
  const add = () => { const k = newKey.trim(); if (!k) return; saveEnvVar({ id: `env-${String(Date.now())}`, key: k, value: newVal, secret: newSecret, configured: newVal.length > 0 }); setNewKey(''); setNewVal(''); setNewSecret(true); };

  const columns: TableColumn<EnvVar>[] = [
    { id: 'key', header: translate({ key: 'workspaces.workspaceSettings.envKeyColumn' }), className: 'w-44', cell: (v) => <span className="font-mono text-title">{v.key}</span> },
    {
      id: 'value',
      header: translate({ key: 'workspaces.workspaceSettings.envValueColumn' }),
      cell: (v) => (
        <EnvRow
          v={v} reveal={!!reveal[v.id]}
          onToggleReveal={() => { setReveal((s) => ({ ...s, [v.id]: !s[v.id] })); }}
          onCommit={(value) => { saveEnvVar({ ...v, value }); }}
          onRemove={() => { removeEnvVar(v.id); }}
        />
      ),
    },
  ];

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      {/* The dots are a placeholder, not the stored value — revealing a secret shows an EMPTY box,
          and saving it empty deliberately keeps whatever is stored. */}
      <div><span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.environmentVariables' })}</span><span className="text-sm text-muted ml-2">{translate({ key: 'workspaces.workspaceSettings.envSubtitle' })}</span>
        <InfoTip
          className={`ml-2 align-middle`}
          label={translate({ key: 'workspaces.tips.workspace.envSecretAria' })}
          title={translate({ key: 'workspaces.tips.workspace.envSecretTitle' })}
          body={translate({ key: 'workspaces.tips.workspace.envSecretBody' })}
          points={[
            { id: 'reveal', label: translate({ key: 'workspaces.tips.workspace.envSecretRevealLabel' }), desc: translate({ key: 'workspaces.tips.workspace.envSecretRevealDesc' }) },
            { id: 'keep', label: translate({ key: 'workspaces.tips.workspace.envSecretKeepLabel' }), desc: translate({ key: 'workspaces.tips.workspace.envSecretKeepDesc' }) },
            { id: 'replace', label: translate({ key: 'workspaces.tips.workspace.envSecretReplaceLabel' }), desc: translate({ key: 'workspaces.tips.workspace.envSecretReplaceDesc' }) },
          ]}
          align="start"
        />
      </div>
      {/* #64 — discoverability: the deploy-hook target is just two env vars, set here (save-env), used on export. */}
      <div className="text-xs text-muted rounded-xl border border-container1-border bg-container2/30 px-3 py-2">{translate({ key: 'workspaces.workspaceSettings.deployHookHint' })}</div>
      <Table columns={columns} rows={envVars} rowKey={(v) => v.id} empty={translate({ key: 'workspaces.workspaceSettings.noEnvVars' })} />
      <div className="rounded-xl border border-container1-border bg-container2/40 p-3 flex flex-col gap-2">
        {/* A grid, not flex with a `w-44` on the key: `fieldCls` carries `w-full`, and two width
            utilities on one element are decided by their order in the generated stylesheet rather than
            in the class attribute — `w-full` won, the key box took the row, and the value box collapsed
            to a few characters you could type into but not read. Tracks cannot lose that argument. */}
        <div className="grid grid-cols-[11rem_1fr] gap-2">
          <input value={newKey} onChange={(e) => { setNewKey(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.keyPlaceholder' })} className={`min-w-0 font-mono ${fieldCls}`} />
          <input value={newVal} onChange={(e) => { setNewVal(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.valuePlaceholder' })} className={`min-w-0 font-mono ${fieldCls}`} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Toggle on={newSecret} onChange={setNewSecret} label={translate({ key: 'workspaces.workspaceSettings.secretMasked' })} />
          <WsButton icon="plus" onClick={add}>{translate({ key: 'workspaces.workspaceSettings.addVariable' })}</WsButton>
        </div>
      </div>
    </div>
  );
}

function IntegrationToolForm({ tool, onSave, onCancel }: { tool: IntegrationTool | null; onSave: (t: IntegrationTool) => void; onCancel: () => void }) {
  const translate = useTranslator();
  const { envVars, navigate } = useWorkspaces();
  const [typeKey, setTypeKey] = useState(tool?.type ?? INTEGRATION_TYPES[0]?.key ?? '');
  //? Seeded from the pre-selected type, not empty. The form OPENS with MongoDB chosen, and `applyType`
  //? — which is what filled the name — only runs when you CHANGE the type. So the default path was:
  //? open, map your env var, click Save, and nothing happens, silently, because `submit` bails on an
  //? empty name. A form whose visible state is already valid must be saveable.
  const [name, setName] = useState(tool?.name ?? INTEGRATION_TYPES[0]?.label ?? '');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<IntegrationField[]>(tool?.fields ?? INTEGRATION_TYPES[0]?.fields.map((f, i) => ({ id: `imf-${String(i)}`, label: f.label, placeholder: f.placeholder, envVarId: null })) ?? []);
  const [mcpEnabled, setMcpEnabled] = useState(tool?.mcp.enabled ?? true);
  const [mcpCmd, setMcpCmd] = useState(tool?.mcp.command ?? INTEGRATION_TYPES[0]?.mcp ?? '');

  const applyType = (key: string) => {
    setTypeKey(key);
    const t = INTEGRATION_TYPES.find((x) => x.key === key);
    if (!t) return;
    if (!name.trim()) setName(t.label);
    setFields(t.fields.map((f, i) => ({ id: `imf-${String(Date.now())}-${String(i)}`, label: f.label, placeholder: f.placeholder, envVarId: null })));
    setMcpCmd(t.mcp);
  };

  const envItems = [{ id: '__none__', value: '__none__', item: translate({ key: 'workspaces.workspaceSettings.noneOption' }) }, ...envVars.map((v) => ({ id: v.id, value: v.id, item: v.key }))];
  const typeItems = INTEGRATION_TYPES.map((t) => ({ id: t.key, value: t.key, item: t.label }));
  //? Says why instead of returning. A dead button teaches nothing — the user concludes the page is
  //? broken, which is the correct conclusion to draw from a control that does nothing when pressed.
  const submit = () => {
    const n = name.trim();
    if (!n) { setError(translate({ key: 'workspaces.workspaceSettings.integrationNameRequired' })); return; }
    onSave({ id: tool?.id ?? `tool-${String(Date.now())}`, name: n, type: typeKey, fields, mcp: { enabled: mcpEnabled, command: mcpCmd.trim() } });
  };

  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.type' })}</div><Dropdown size="sm" width="full" value={typeItems.find((t) => t.id === typeKey)} items={typeItems} onChange={(it) => { applyType(String(it.id)); }} /></div>
        <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.name' })}</div><input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder={translate({ key: 'workspaces.workspaceSettings.namePlaceholder' })} className={`w-full ${fieldCls}`} /></div>
      </div>
      <div>
        <div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.configFieldsToEnvVars' })}</div>
        <div className="flex flex-col gap-2">
          {/* Every picker below would hold only "— none —": say so, and say where variables are made. */}
          {envVars.length === 0 && fields.length > 0 && (
            <EmptyPicker
              icon="sliders"
              label={translate({ key: 'workspaces.tips.workspace.noEnvVarsLabel' })}
              fix={{ cap: 'workspaceSettings', view: 'workspace', tab: 'env', cta: translate({ key: 'workspaces.tips.workspace.noEnvVarsCta' }) }}
            />
          )}
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <span className="text-sm text-title w-40 shrink-0 truncate">{f.label}</span>
              <div className="flex-1 min-w-0">
                <Dropdown size="sm" width="full" showSearch searchPlaceholder={translate({ key: 'workspaces.workspaceSettings.findEnvVarPlaceholder' })} placeholder={translate({ key: 'workspaces.workspaceSettings.selectEnvVar' })} value={envItems.find((i) => i.id === (f.envVarId ?? '__none__'))} items={envItems} onChange={(it) => { const id = String(it.id); setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, envVarId: id === '__none__' ? null : id } : x))); }} />
              </div>
            </div>
          ))}
          {fields.length === 0 && <span className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.pickTypeHint' })}</span>}
        </div>
      </div>
      {/* The switch alone mounts nothing: the MCP server needs a non-empty command AND a stage that
          selects this tool at the read+write tier (server/orchestrator/stageRunner.ts). */}
      <div className={`flex items-center gap-2`}>
        <Toggle on={mcpEnabled} onChange={setMcpEnabled} label={translate({ key: 'workspaces.workspaceSettings.exposeViaMcp' })} />
        <InfoTip
          label={translate({ key: 'workspaces.tips.workspace.mcpAria' })}
          title={translate({ key: 'workspaces.tips.workspace.mcpTitle' })}
          body={translate({ key: 'workspaces.tips.workspace.mcpBody' })}
          points={[
            { id: 'command', label: translate({ key: 'workspaces.tips.workspace.mcpCommandLabel' }), desc: translate({ key: 'workspaces.tips.workspace.mcpCommandDesc' }) },
            {
              id: 'stage',
              label: translate({ key: 'workspaces.tips.workspace.mcpStageLabel' }),
              desc: translate({ key: 'workspaces.tips.workspace.mcpStageDesc' }),
              onGo: () => { navigate('pipeline'); },
              goLabel: translate({ key: 'workspaces.tips.workspace.mcpStageGo' }),
            },
          ]}
          align="start"
        />
      </div>
      <Collapse open={mcpEnabled}>
        <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.mcpServerCommand' })}</div><input value={mcpCmd} onChange={(e) => { setMcpCmd(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.mcpCommandPlaceholder' })} className={`w-full font-mono ${fieldCls}`} /></div>
      </Collapse>
      <div className="flex items-center gap-2">
        <WsButton icon="check" onClick={submit}>{translate({ key: 'workspaces.workspaceSettings.saveIntegration' })}</WsButton>
        <WsButton variant="ghost" onClick={onCancel}>{translate({ key: 'workspaces.workspaceSettings.cancel' })}</WsButton>
        {error.length > 0 && <span className={`text-xs text-wrong`}>{error}</span>}
      </div>
    </div>
  );
}

//? The tint per verdict. `reachable` is amber on purpose: it is a partial answer, and colouring it green
//? next to a real `ok` would erase the only distinction this feature is built around.
const TEST_TINT: Record<string, string> = {
  ok: 'bg-correct/15 text-correct',
  reachable: 'bg-warning/15 text-warning',
  failed: 'bg-wrong/15 text-wrong',
  unsupported: 'bg-container2 text-muted',
};

//? One row's test button + the verdict it produced. Its own component because it holds the in-flight
//? state: without that the button is a click with no feedback for the seconds a TCP dial can take, and
//? the user clicks again.
function IntegrationTestButton({ tool, onTest }: { tool: IntegrationTool; onTest: (id: string) => Promise<{ ok: boolean; status?: string; detail?: string }> }) {
  const translate = useTranslator();
  const [busy, setBusy] = useState(false);
  const last = tool.lastTest;
  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    await onTest(tool.id);
    setBusy(false);
  };
  return (
    <>
      {last && !busy && (
        //? The detail line is the whole value of a failure ("ECONNREFUSED", "no answer within 6s"), and
        //? it is too long for the row — so the chip carries the verdict and its title carries the reason.
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] ${TEST_TINT[last.status] ?? TEST_TINT.unsupported ?? ''}`} title={last.detail}>
          {translate({ key: `workspaces.workspaceSettings.testStatus.${last.status}` })}
        </span>
      )}
      <button
        type="button" onClick={() => { void run(); }} disabled={busy}
        className={`text-xs text-common hover:text-title cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {translate({ key: busy ? 'workspaces.workspaceSettings.testingIntegration' : 'workspaces.workspaceSettings.testIntegration' })}
      </button>
    </>
  );
}

function IntegrationsTab() {
  const translate = useTranslator();
  const { integrationTools, saveIntegrationTool, removeIntegrationTool, testIntegrationTool, envVars } = useWorkspaces();
  const [editing, setEditing] = useState<IntegrationTool | null>(null);
  const [adding, setAdding] = useState(false);
  const envName = (id: string | null) => (id ? (envVars.find((v) => v.id === id)?.key ?? '—') : translate({ key: 'workspaces.workspaceSettings.noneOption' }));

  const columns: TableColumn<IntegrationTool>[] = [
    {
      id: 'tool',
      header: translate({ key: 'workspaces.workspaceSettings.name' }),
      cell: (t) => (
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-container2 text-muted flex items-center justify-center shrink-0"><Icon name="database" /></span>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="text-sm font-medium text-title">{t.name}</span><span className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] text-muted">{t.type}</span>{t.mcp.enabled && <span className="rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px]">{translate({ key: 'workspaces.workspaceSettings.mcpBadge' })}</span>}</div>
            <div className="text-xs text-muted truncate">{t.fields.map((f) => `${f.label}: ${envName(f.envVarId)}`).join(' · ')}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'w-44',
      cell: (t) => (
        <div className="flex justify-end items-center gap-1">
          <IntegrationTestButton tool={t} onTest={testIntegrationTool} />
          <button type="button" onClick={() => { setEditing(t); setAdding(false); }} className="text-xs text-common hover:text-title cursor-pointer shrink-0">{translate({ key: 'workspaces.workspaceSettings.edit' })}</button>
          <IconButton icon="trash" title={translate({ key: 'workspaces.workspaceSettings.removeIntegration' })} onClick={() => { removeIntegrationTool(t.id); }} />
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div><span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.integrationTools' })}</span><span className="text-sm text-muted ml-2">{translate({ key: 'workspaces.workspaceSettings.integrationToolsSubtitle' })}</span></div>
        {!adding && !editing && <WsButton variant="secondary" icon="plus" onClick={() => { setAdding(true); }}>{translate({ key: 'workspaces.workspaceSettings.setUpIntegration' })}</WsButton>}
      </div>
      <Collapse open={adding || editing !== null}>
        <IntegrationToolForm tool={editing} onSave={(t) => { saveIntegrationTool(t); setAdding(false); setEditing(null); }} onCancel={() => { setAdding(false); setEditing(null); }} />
      </Collapse>
      <Table columns={columns} rows={integrationTools} rowKey={(t) => t.id} empty={translate({ key: 'workspaces.workspaceSettings.noIntegrations' })} />
    </div>
  );
}

//? The forge DEFAULT for the workspace + the inbound webhook. Single-owner split (F-018/F-026, ADR 0036):
//? per-project ForgeConnection (Settings › Developer › Connections) is the authority — server/git/forgeResolve
//? reads it FIRST and falls back to these workspace fields. Neither surface used to mention the other, so a
//? token typed here could be silently shadowed by a project connection. The tab now says what it is (the
//? default), shows the ACTIVE project's resolved state read-only, and links to the override editor.
const forgeDefaultUrl = (forge: 'gitlab' | 'github'): string => (forge === 'github' ? 'https://api.github.com' : 'https://gitlab.com');
function GitLabTab() {
  const translate = useTranslator();
  const { activeWorkspace, activeProject, saveGitlab, resyncForge, rotateWebhookSecret, focusSetup } = useWorkspaces();
  const [forge, setForge] = useState<'gitlab' | 'github'>(activeWorkspace.forgeType === 'github' ? 'github' : 'gitlab');
  //? F-025 — seeded from the STORED base URL (exposed in the snapshot; it is not a secret). The field used to
  //? start at the hardcoded default, so opening the tab to paste a new token and hitting Save overwrote a
  //? self-hosted URL with gitlab.com.
  const storedBaseUrl = (activeWorkspace.forgeBaseUrl ?? '').trim();
  const [baseUrl, setBaseUrl] = useState(() => (storedBaseUrl.length > 0 ? storedBaseUrl : forgeDefaultUrl(forge)));
  //? Never pre-filled from the (write-only, encrypted) stored token — an empty
  //? value tells `saveGitlab` to keep the existing token unchanged.
  const [token, setToken] = useState('');
  const projectOverride = activeProject?.forgeMode !== undefined;
  const overrideUrl = (activeProject?.forgeBaseUrl ?? '').trim();
  const forgeItems = [
    { id: 'gitlab', value: 'gitlab', item: translate({ key: 'workspaces.workspaceSettings.forgeGitlab' }) },
    { id: 'github', value: 'github', item: translate({ key: 'workspaces.workspaceSettings.forgeGithub' }) },
  ];
  //? #27 — the inbound forge-webhook endpoint for this workspace (continuous GitLab/GitHub issue ingest).
  //? Derived client-side from the origin + workspace id; paste it (+ the configured shared secret) into the
  //? forge's Webhooks settings so new issues stream in as tickets.
  const webhookUrl = `${globalThis.location.origin}/webhooks/forge/${activeWorkspace.id}`;
  //? The snapshot says only whether a secret exists. A newly minted plaintext value stays in
  //? component state for this initiator alone, so it disappears on navigation/reload.
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [rotatingWebhookSecret, setRotatingWebhookSecret] = useState(false);
  useEffect(() => { setWebhookSecret(null); }, [activeWorkspace.id]);
  const webhookConfigured = activeWorkspace.webhookConfigured === true;
  const rotateSecret = async () => {
    if (rotatingWebhookSecret) return;
    setRotatingWebhookSecret(true);
    const secret = await rotateWebhookSecret();
    if (secret !== null) setWebhookSecret(secret);
    setRotatingWebhookSecret(false);
  };
  const webhookLastEventAt = activeWorkspace.webhookLastEventAt ?? '';
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
      <FormSection title={translate({ key: 'workspaces.workspaceSettings.forgeScopeTitle' })} desc={translate({ key: 'workspaces.workspaceSettings.forgeScopeBody' })}>
        {/* The resolved state for the ACTIVE project — what the sync/MR/webhook flows will actually use. */}
        {activeProject && (
          <div className="px-5 py-3 flex flex-wrap items-center gap-2 text-xs text-muted border-b border-divider">
            <Icon name={projectOverride ? 'circle-info' : 'circle-check'} className={projectOverride ? 'text-warning' : 'text-correct'} />
            <span className="flex-1 min-w-0">
              {projectOverride
                ? translate({ key: 'workspaces.workspaceSettings.forgeOverrideActive', params: [{ key: 'project', value: activeProject.name }, { key: 'mode', value: activeProject.forgeMode === 'github' ? translate({ key: 'workspaces.workspaceSettings.forgeGithub' }) : translate({ key: 'workspaces.workspaceSettings.forgeGitlab' }) }, { key: 'url', value: overrideUrl.length > 0 ? ` (${overrideUrl})` : '' }] })
                : translate({ key: 'workspaces.workspaceSettings.forgeOverrideNone', params: [{ key: 'project', value: activeProject.name }] })}
            </span>
            <button type="button" onClick={() => { focusSetup({ view: 'settings', tab: 'developer' }); }} className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1 shrink-0">
              {translate({ key: 'workspaces.workspaceSettings.forgeOverrideLink' })} <Icon name="arrow-right-long" className="text-[10px]" />
            </button>
          </div>
        )}
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.forgeProvider' })}
          control={<Dropdown width="full" size="sm" items={forgeItems} value={forgeItems.find((i) => i.id === forge)} onChange={(it) => { const next = it.id === 'github' ? 'github' : 'gitlab'; setForge(next); if (baseUrl === forgeDefaultUrl(forge)) setBaseUrl(forgeDefaultUrl(next)); }} />}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.baseUrl' })}
          {...(storedBaseUrl.length > 0 ? { help: translate({ key: 'workspaces.workspaceSettings.baseUrlConfigured', params: [{ key: 'host', value: storedBaseUrl }] }) } : {})}
          control={<input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); }} className={fieldCls} />}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.forgeApiToken' })}
          //? #22 — the live-verify round-trip is a deliberate no-op (owner decision); the dead Verify
          //? button was removed so the token field doesn't render a click with zero feedback.
          control={<input type="password" value={token} onChange={(e) => { setToken(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.tokenPlaceholder' })} className={`${fieldCls} font-mono`} />}
        />
        <div className="px-5 py-4 flex items-center gap-2">
          <WsButton icon="check" onClick={() => { saveGitlab(baseUrl, token, forge); setToken(''); }}>{translate({ key: 'workspaces.workspaceSettings.save' })}</WsButton>
          {/* gitlab-resync: pull open forge issues → tickets (was UI-less). */}
          <WsButton variant="secondary" icon="rotate" onClick={() => { resyncForge(); }}>{translate({ key: 'workspaces.workspaceSettings.resyncIssues' })}</WsButton>
        </div>
      </FormSection>

      {/* #27 — inbound webhook card: URL + rotatable secret + last-event indicator. Continuous issue ingest. */}
      <FormSection title={translate({ key: 'workspaces.workspaceSettings.webhookTitle' })} desc={translate({ key: 'workspaces.workspaceSettings.webhookDesc' })}>
        <SettingRow
          stacked
          label={translate({ key: 'workspaces.workspaceSettings.webhookTitle' })}
          control={(
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate h-9 px-3 flex items-center rounded-lg border border-container1-border bg-container2/50 text-xs font-mono text-title">{webhookUrl}</code>
              <WsButton variant="secondary" icon="copy" onClick={() => { void navigator.clipboard.writeText(webhookUrl); }}>{translate({ key: 'workspaces.workspaceSettings.webhookCopy' })}</WsButton>
            </div>
          )}
        />
        <SettingRow
          stacked
          label={translate({ key: 'workspaces.workspaceSettings.webhookSecretLabel' })}
          help={webhookLastEventAt === '' ? translate({ key: 'workspaces.workspaceSettings.webhookNoEvent' }) : translate({ key: 'workspaces.workspaceSettings.webhookLastEvent', params: [{ key: 'when', value: new Date(webhookLastEventAt).toLocaleString() }] })}
          control={(
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate h-9 px-3 flex items-center rounded-lg border border-container1-border bg-container2/50 text-xs font-mono text-title">{webhookSecret ?? (webhookConfigured ? '••••••••••' : translate({ key: 'workspaces.workspaceSettings.webhookNoSecret' }))}</code>
              {webhookSecret !== null && <WsButton variant="secondary" icon="copy" onClick={() => { void navigator.clipboard.writeText(webhookSecret); }}>{translate({ key: 'workspaces.workspaceSettings.webhookCopy' })}</WsButton>}
              <WsButton variant="secondary" icon={rotatingWebhookSecret ? 'spinner' : 'rotate'} disabled={rotatingWebhookSecret} className={rotatingWebhookSecret ? '[&_svg]:animate-spin' : ''} onClick={() => { void rotateSecret(); }}>{translate({ key: webhookConfigured ? 'workspaces.workspaceSettings.webhookRotate' : 'workspaces.workspaceSettings.webhookGenerate' })}</WsButton>
            </div>
          )}
        />
      </FormSection>
    </div>
  );
}

//? Workflow tab (hosting-proxy plan) — the STRUCTURED git config (branch strategy → branch
//? name + preview host, push policy) plus a read-only list of the starter-guidance docs
//? (curated conventions the AI follows in every stage). Sources owns the aiEditable toggle
//? for these (same doc id, same op) — this list used to carry its own copy of that toggle
//? with no cross-link, so a flip here silently changed Sources and vice versa. Now it only
//? reads, and links out to the single home.
function WorkflowTab() {
  const translate = useTranslator();
  const { gitConfig, saveGitConfig, docs, navigate } = useWorkspaces();
  const [cfg, setCfg] = useState<GitConfig>(gitConfig);
  const patch = (p: Partial<GitConfig>) => { setCfg((c) => ({ ...c, ...p })); };
  const starter = docs.filter((d) => d.note === 'starter');

  const strategyItems = [
    { id: 'ticket-prefix', value: 'ticket-prefix', item: translate({ key: 'workspaces.workspaceSettings.branchStrategyTicketPrefix' }) },
    { id: 'typed', value: 'typed', item: translate({ key: 'workspaces.workspaceSettings.branchStrategyTyped' }) },
    { id: 'custom', value: 'custom', item: translate({ key: 'workspaces.workspaceSettings.branchStrategyCustom' }) },
  ];
  const pushItems = [
    { id: 'local-only', value: 'local-only', item: translate({ key: 'workspaces.workspaceSettings.pushLocalOnly' }) },
    { id: 'push', value: 'push', item: translate({ key: 'workspaces.workspaceSettings.pushPush' }) },
    { id: 'merge-request', value: 'merge-request', item: translate({ key: 'workspaces.workspaceSettings.pushMergeRequest' }) },
  ];
  //? Live example of the branch the current strategy produces (also the preview subdomain).
  const exType = cfg.defaultBranchType || 'feature';
  const exampleBranch = cfg.branchStrategy === 'ticket-prefix'
    ? 'DEV-1240'
    : (cfg.branchStrategy === 'typed'
      ? `${exType}/DEV-1240-add-login`
      : cfg.branchTemplate.replaceAll('{{type}}', exType).replaceAll('{{prefix}}', 'DEV').replaceAll('{{key}}', 'DEV-1240').replaceAll('{{number}}', '1240').replaceAll('{{slug}}', 'add-login'));

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
      <FormSection title={translate({ key: 'workspaces.workspaceSettings.workflowTitle' })} desc={translate({ key: 'workspaces.workspaceSettings.workflowDescription' })}>
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.branchStrategy' })}
          control={<Dropdown width="full" size="sm" value={strategyItems.find((i) => i.id === cfg.branchStrategy)} items={strategyItems} onChange={(it) => { const v = String(it.id); if (v === 'ticket-prefix' || v === 'typed' || v === 'custom') patch({ branchStrategy: v satisfies BranchStrategyKind }); }} />}
        />
        <Collapse open={cfg.branchStrategy !== 'ticket-prefix'}>
          <SettingRow
            label={translate({ key: 'workspaces.workspaceSettings.defaultBranchType' })}
            control={<input value={cfg.defaultBranchType} onChange={(e) => { patch({ defaultBranchType: e.target.value }); }} className={fieldCls} />}
          />
        </Collapse>
        <Collapse open={cfg.branchStrategy === 'custom'}>
          <SettingRow
            label={translate({ key: 'workspaces.workspaceSettings.branchTemplate' })}
            control={<input value={cfg.branchTemplate} onChange={(e) => { patch({ branchTemplate: e.target.value }); }} className={`${fieldCls} font-mono`} />}
          />
        </Collapse>
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.previewBranch' })}
          control={<span className="font-mono text-sm text-title">{exampleBranch}</span>}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.pushPolicy' })}
          control={<Dropdown width="full" size="sm" value={pushItems.find((i) => i.id === cfg.pushPolicy)} items={pushItems} onChange={(it) => { const v = String(it.id); if (v === 'local-only' || v === 'push' || v === 'merge-request') patch({ pushPolicy: v satisfies PushPolicy }); }} />}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.targetBranch' })}
          control={<input value={cfg.targetBranch} onChange={(e) => { patch({ targetBranch: e.target.value }); }} className={fieldCls} />}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.protectedBranches' })}
          control={<input value={cfg.protectedBranches.join(', ')} onChange={(e) => { patch({ protectedBranches: e.target.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0) }); }} className={fieldCls} />}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.commitSigning' })}
          control={<Toggle on={cfg.commitSigning} onChange={() => { patch({ commitSigning: !cfg.commitSigning }); }} ariaLabel={translate({ key: 'workspaces.workspaceSettings.commitSigning' })} />}
        />
        <div className="px-5 py-4"><WsButton icon="check" onClick={() => { saveGitConfig(cfg); }}>{translate({ key: 'workspaces.workspaceSettings.save' })}</WsButton></div>
      </FormSection>

      <FormSection
        title={translate({ key: 'workspaces.workspaceSettings.starterTitle' })}
        desc={translate({ key: 'workspaces.workspaceSettings.starterDescriptionLocked' })}
        right={(
          <button
            type="button" onClick={() => { navigate('sources'); }}
            className={`shrink-0 text-xs text-primary hover:underline cursor-pointer inline-flex items-center gap-1`}
          >
            {translate({ key: 'workspaces.workspaceSettings.manageInSources' })} <Icon name="arrow-right" />
          </button>
        )}
      >
        {/* No longer a SettingRow (a "decision") — there is nothing to decide here anymore,
            just what exists; the decision (aiEditable) is made on Sources now. */}
        {starter.map((d) => (
          <div key={d.id} className={`px-5 py-3 flex items-center gap-2 min-w-0`}>
            <Icon name="file-lines" className={`text-muted shrink-0`} />
            <div className={`min-w-0`}>
              <div className={`text-sm font-medium text-title truncate`}>{d.name}</div>
              <div className={`text-xs text-muted truncate`}>{d.summary}</div>
            </div>
          </div>
        ))}
      </FormSection>
    </div>
  );
}

//? Register-flow C — review + edit the AI-authored draft `.workspaces/Dockerfile` before the
//? L2 image build. Generate (AI), edit in a monospace textarea, save the draft (the server
//? re-validates it extends the L1 base), then build the project image. All three are direct
//? `_api` ops (a slow AI turn / docker build must not block the serial writer), so this keeps
//? LOCAL state, not the realtime snapshot. Committing the draft into the linked repo is a
//? later slice.
//
//? Set the project's dev command (the command that starts the app inside the ticket container
//? for the live preview flow). Empty clears it → falls back to package.json scripts.dev.
//? ADR 0313 — how this project RUNS. Three changes over the card this replaces:
//?
//?   1. It shows what is SAVED. The fields used to start empty on every mount, because devCommand /
//?      prodCommand were persisted but never sent to the client — you could overwrite your command
//?      but never see it.
//?   2. The repo's own scripts are pickable, instead of asking you to remember what your package.json
//?      calls things. The server already read that file; it just never told you.
//?   3. It says what actually happens when a ticket runs, which is the question the owner asked and
//?      the screen never answered: ONE dev command per project (a monorepo service may override it),
//?      started in that ticket's preview container — not a terminal per command.
//?
//? Autosave per row like the rest of the settings surface, so there is no save button to forget.
function RuntimeSection({ workspaceId }: { workspaceId: string }) {
  const translate = useTranslator();
  const { activeProject, navigate } = useWorkspaces();
  const projectId = activeProject?.id;
  const { data: repoScan, loading: scanning } = useRepoIntrospection(workspaceId, projectId);

  //? Seeded from the project, and re-seeded ONLY when the project CHANGES.
  //?
  //? Not on every server value: the snapshot rebuilds its arrays on each refresh, and this workspace
  //? broadcasts a refresh on every write, so re-seeding from the server threw away whatever was being
  //? typed. Worse with a debounced save — a row you have named but not yet given a command to is
  //? correctly dropped server-side, and the echo would then delete the row out from under you
  //? mid-sentence. While this form is open, the form is what the user is editing; the server's copy
  //? only wins on a project switch.
  const [procs, setProcs] = useState<StageProcessCfg[]>(seedProcesses(activeProject?.runProcesses, activeProject?.devCommand ?? ''));
  const [previewId, setPreviewId] = useState(activeProject?.previewProcessId ?? 'dev');
  const [prodCmd, setProdCmd] = useState(activeProject?.prodCommand ?? '');
  const [stack, setStack] = useState(activeProject?.stack ?? 'node');
  const [allowCustomBase, setAllowCustomBase] = useState(activeProject?.allowCustomBase ?? false);
  useEffect(() => {
    setProcs(seedProcesses(activeProject?.runProcesses, activeProject?.devCommand ?? ''));
    setPreviewId(activeProject?.previewProcessId ?? 'dev');
    setProdCmd(activeProject?.prodCommand ?? '');
    setStack(activeProject?.stack ?? 'node');
    setAllowCustomBase(activeProject?.allowCustomBase ?? false);
    //? Deliberately keyed on the project alone — see the note above. Adding the value deps back is
    //? what made the form unusable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id]);

  const [saveError, setSaveError] = useState('');
  //? A draft row blocks the save outright rather than being silently dropped: the Conductor discards a
  //? process with no command, so saving here would delete the row the user is still typing. The form
  //? says which half is missing instead — see the red fields in RunProcessList.
  const incomplete = anyRowIncomplete(procs);
  //? Owner decision 2026-08-19: debounce, no save button and no toast per keystroke. The delay is
  //? longer than the page default because this form is typed into rather than clicked.
  const status = useAutosave([procs, previewId, prodCmd, stack, allowCustomBase], async () => {
    if (!projectId || incomplete) return;
    setSaveError('');
    //? `devCommand` is kept in sync with the PREVIEW process's command. It is still the fallback for an
    //? empty list and the source deploy reads for a dev-kind environment, so letting the two drift
    //? would mean the preview and the deployment run different things without saying so.
    const previewCmd = rowCommand(procs.find((p) => p.id === previewId) ?? procs[0] ?? { id: '', name: '', cwd: '', env: [], commands: [] });
    const [err, res] = await tryCatch(() => apiRequest({ name: 'workspaces/saveDevCommand', version: 'v1', data: { workspaceId, projectId, clientRequestId: globalThis.crypto.randomUUID(), devCommand: previewCmd, runProcesses: procs, previewProcessId: previewId, prodCommand: prodCmd, stack, allowCustomBase } }));
    if (err || res?.status !== 'success') {
      setSaveError(translate({ key: 'workspaces.workspaceSettings.devCommandError' }));
      throw new Error('save.failed');
    }
  }, { delay: 1200, resetKey: projectId ?? '' });

  const STACK_ITEMS = (['node', 'python', 'go', 'rust', 'java', 'php', 'dotnet', 'ruby', 'generic'] as const).map((s) => ({ id: s, value: s, item: s }));

  //? The verified answer to "is a separate terminal started per command?" — resolution order from
  //? server/container/previewSession.ts, which reads Service.devCommand → Project.devCommand → the
  //? stack default and runs it in the ticket's preview container.
  const runInfo = (
    <InfoTip
      title={translate({ key: 'workspaces.repoScan.howItRunsTitle' })}
      body={translate({ key: 'workspaces.repoScan.howItRunsBody' })}
      points={[
        { id: 'service', label: translate({ key: 'workspaces.repoScan.orderService' }), desc: translate({ key: 'workspaces.repoScan.orderServiceDesc' }) },
        { id: 'project', label: translate({ key: 'workspaces.repoScan.orderProject' }), desc: translate({ key: 'workspaces.repoScan.orderProjectDesc' }) },
        { id: 'stack', label: translate({ key: 'workspaces.repoScan.orderStack' }), desc: translate({ key: 'workspaces.repoScan.orderStackDesc' }) },
      ]}
      align="start"
    />
  );

  return (
    <div className={`flex flex-col gap-4`}>
      <FormSection
        title={translate({ key: 'workspaces.workspaceSettings.devCommandTitle' })}
        desc={translate({ key: 'workspaces.workspaceSettings.devCommandDescription' })}
        right={(
          <div className={`flex items-center gap-2`}>
            {/* Never a "saved" pill while a row is a draft: nothing was written, and a success chip
                next to two red fields is the most confusing thing this form could say. */}
            {incomplete
              ? (
                <span className={`inline-flex items-center gap-1.5 text-xs text-wrong`}>
                  <Icon name="triangle-exclamation" className={`text-[10px]`} />
                  {translate({ key: 'workspaces.runtime.blockedByDraft' })}
                </span>
              )
              : <SavePill status={status} errorText={saveError} />}
            {runInfo}
          </div>
        )}
      >
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.stack' })}
          help={translate({ key: 'workspaces.repoScan.stackHelp' })}
          control={<Dropdown size="sm" width="full" items={STACK_ITEMS} value={STACK_ITEMS.find((it) => it.id === stack)} onChange={(it) => { setStack(String(it.value)); }} />}
        />
        <SettingRow
          stacked
          label={translate({ key: 'workspaces.runtime.processesLabel' })}
          help={translate({ key: 'workspaces.runtime.processesHelp' })}
          control={(
            <RunProcessList
              processes={procs} previewId={previewId}
              onChange={(next, nextPreview) => { setProcs(next); setPreviewId(nextPreview); }}
              scripts={repoScan.scripts} packageManager={repoScan.packageManager}
            />
          )}
        />
        <SettingRow
          stacked
          label={translate({ key: 'workspaces.repoScan.prodCommandLabel' })}
          help={translate({ key: 'workspaces.repoScan.prodCommandHelp' })}
          control={(
            <div className={`flex flex-col gap-2.5`}>
              <input value={prodCmd} onChange={(e) => { setProdCmd(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.prodCommandPlaceholder' })} className={inputCls} />
              <RepoScriptPicker scripts={repoScan.scripts} packageManager={repoScan.packageManager} activeCommand={prodCmd} onPick={setProdCmd} />
            </div>
          )}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.allowCustomBase' })}
          help={translate({ key: 'workspaces.repoScan.customBaseHelp' })}
          control={<Toggle on={allowCustomBase} onChange={setAllowCustomBase} />}
        />
      </FormSection>

      {/* Nothing detected is a real answer worth showing: it means the picker above is empty because
          the repo has no package scripts, not because the scan is broken. */}
      {!scanning && repoScan.scripts.length === 0 && (
        <EmptyPicker
          icon="terminal"
          label={translate({ key: 'workspaces.repoScan.noScripts' })}
        />
      )}
      {repoScan.units.length > 1 && (
        <EmptyPicker
          icon="diagram-project"
          label={translate({ key: 'workspaces.repoScan.monorepoHint', params: [{ key: 'n', value: String(repoScan.units.length) }] })}
          //? The `developer` tab, not `workspace`: per-service rows render under
          //? `showDevOps && tab === 'developer'` (settings/page.tsx). The `workspace` tab holds API
          //? tokens, experiments, storage and the data export — a button called "Manage services"
          //? landed on a page with no service anywhere on it.
          fix={{ cap: 'workspaceSettings', view: 'settings', tab: 'developer', cta: translate({ key: 'workspaces.repoScan.manageServices' }) }}
        />
      )}
      <button type="button" onClick={() => { navigate('code'); }} className={`self-start text-xs text-primary hover:text-primary-hover cursor-pointer`}>
        {translate({ key: 'workspaces.repoScan.browseCode' })}
      </button>
    </div>
  );
}

function DockerfileReview({ workspaceId }: { workspaceId: string }) {
  const translate = useTranslator();
  //? #44 — target the ACTIVE project so a multi-project workspace builds the right image (not project #1).
  const { activeProject } = useWorkspaces();
  const projectId = activeProject?.id;
  const projectData = () => ({ workspaceId, ...(projectId ? { projectId } : {}) });
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const loadedDraftRef = useRef<string | null>(null);
  const setDraftValue = (value: string) => { draftRef.current = value; setDraft(value); };
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'generate' | 'save' | 'build' | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  //? Map a server error code to a translated line (generic fallback keeps it i18n-safe).
  const errText = (code: string | undefined): string => {
    if (code?.startsWith('image.buildFailed')) return translate({ key: 'workspaces.workspaceSettings.dockerfileErrBuild' });
    const map: Record<string, string> = {
      'dockerfile.invalidBase': 'dockerfileErrInvalidBase',
      'dockerfile.noDraft': 'dockerfileErrNoDraft',
      'dockerfile.empty': 'dockerfileErrEmpty',
      'repo.notLinked': 'dockerfileErrRepo',
      'ai.turnFailed': 'dockerfileErrAi',
      'docker.unavailable': 'dockerfileErrDocker',
    };
    return translate({ key: `workspaces.workspaceSettings.${map[code ?? ''] ?? 'dockerfileErrGeneric'}` });
  };

  //? Load the persisted draft for the active project. A project switch is a data-boundary: if the
  //? current draft differs from the last loaded value, ask before replacing the user's local edits.
  useEffect(() => {
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/getDockerfile', version: 'v1', data: { workspaceId, ...(projectId ? { projectId } : {}) } }));
      if (!error && res?.status === 'success' && res.result.ok) {
        const next = res.result.dockerfile;
        const dirty = loadedDraftRef.current !== null && draftRef.current !== loadedDraftRef.current;
        if (dirty) {
          const discard = await menuHandler.confirm({
            title: translate({ key: 'workspaces.workspaceSettings.dockerfileSwitchConfirmTitle' }),
            content: translate({ key: 'workspaces.workspaceSettings.dockerfileSwitchConfirmContent' }),
          });
          if (!discard) { setLoaded(true); return; }
        }
        loadedDraftRef.current = next;
        setDraftValue(next);
      }
      setLoaded(true);
    })();
  }, [workspaceId, projectId, translate]);

  const generate = async (): Promise<void> => {
    setBusy('generate'); setStatus(null);
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/generateDockerfile', version: 'v1', data: projectData() }));
    setBusy(null);
    if (error || res?.status !== 'success') { setStatus({ kind: 'err', text: errText(res?.status === 'error' ? res.errorCode : undefined) }); return; }
    if (!res.result.ok) { setStatus({ kind: 'err', text: errText(res.result.error) }); return; }
    loadedDraftRef.current = res.result.dockerfile;
    setDraftValue(res.result.dockerfile);
  };

  const save = async (): Promise<void> => {
    setBusy('save'); setStatus(null);
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/saveDockerfile', version: 'v1', data: { ...projectData(), dockerfile: draft } }));
    setBusy(null);
    if (error || res?.status !== 'success') { setStatus({ kind: 'err', text: errText(res?.status === 'error' ? res.errorCode : undefined) }); return; }
    if (!res.result.ok) { setStatus({ kind: 'err', text: errText(res.result.error) }); return; }
    loadedDraftRef.current = draft;
    setStatus({ kind: 'ok', text: translate({ key: 'workspaces.workspaceSettings.dockerfileSaved' }) });
  };

  const build = async (): Promise<void> => {
    setBusy('build'); setStatus(null);
    //? Save the on-screen edits first so the build reads exactly what the user sees.
    const [saveErr, saveRes] = await tryCatch(() => apiRequest({ name: 'workspaces/saveDockerfile', version: 'v1', data: { ...projectData(), dockerfile: draft } }));
    if (saveErr || saveRes?.status !== 'success' || !saveRes.result.ok) {
      setBusy(null);
      const code = saveErr || saveRes?.status !== 'success' ? (saveRes?.status === 'error' ? saveRes.errorCode : undefined) : saveRes.result.error;
      setStatus({ kind: 'err', text: errText(code) });
      return;
    }
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/buildProjectImage', version: 'v1', data: projectData() }));
    setBusy(null);
    if (error || res?.status !== 'success') { setStatus({ kind: 'err', text: errText(res?.status === 'error' ? res.errorCode : undefined) }); return; }
    if (!res.result.ok) { setStatus({ kind: 'err', text: errText(res.result.error) }); return; }
    setStatus({ kind: 'ok', text: translate({ key: 'workspaces.workspaceSettings.dockerfileBuilt', params: [{ key: 'tag', value: res.result.tag ?? '—' }] }) });
  };

  const hasDraft = draft.trim().length > 0;
  //? Shared editor theme: reuse the id the user picked in the code editors (localStorage),
  //? falling back to the app's light/dark mode. Keeps this editor in step with the others.
  const editorTheme = loadThemeId(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  return (
    <div className="w-full rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.dockerfileTitle' })}</div>
      <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.dockerfileDescription' })}</div>
      {/* #45 — persisted image identity so a reload shows what image is built (was a transient toast). */}
      {(activeProject?.baseImageRef ?? activeProject?.stack) && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Icon name="cube" className="text-muted" />
          <span className="font-mono">{activeProject.baseImageRef ?? translate({ key: 'workspaces.workspaceSettings.dockerfileStackImage', params: [{ key: 'stack', value: activeProject.stack ?? '—' }] })}</span>
        </div>
      )}
      {status !== null && (
        <div className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${status.kind === 'ok' ? 'border-correct-border bg-correct/10 text-common' : 'border-wrong-border bg-wrong/10 text-wrong'}`}>
          <Icon name={status.kind === 'ok' ? 'circle-check' : 'triangle-exclamation'} className={status.kind === 'ok' ? 'text-correct' : ''} />
          <span>{status.text}</span>
        </div>
      )}
      <div className="w-full h-72 rounded-lg border border-container1-border overflow-hidden">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.dockerfileEmptyHint' })}</div>}>
          <LazyMonaco value={draft} language="dockerfile" theme={editorTheme} onChange={setDraftValue} />
        </Suspense>
      </div>
      {!hasDraft && loaded && <div className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.dockerfileEmptyHint' })}</div>}
      <div className="flex items-center gap-2">
        <WsButton variant="secondary" icon="wand-magic-sparkles" disabled={busy !== null} onClick={() => { void generate(); }}>
          {translate({ key: busy === 'generate' ? 'workspaces.workspaceSettings.dockerfileGenerating' : (hasDraft ? 'workspaces.workspaceSettings.dockerfileRegenerate' : 'workspaces.workspaceSettings.dockerfileGenerate') })}
        </WsButton>
        <WsButton icon="check" disabled={busy !== null || !hasDraft} onClick={() => { void save(); }}>
          {translate({ key: busy === 'save' ? 'workspaces.workspaceSettings.dockerfileSaving' : 'workspaces.workspaceSettings.dockerfileSave' })}
        </WsButton>
        <WsButton icon="bolt" disabled={busy !== null || !hasDraft} onClick={() => { void build(); }}>
          {translate({ key: busy === 'build' ? 'workspaces.workspaceSettings.dockerfileBuilding' : 'workspaces.workspaceSettings.dockerfileBuild' })}
        </WsButton>
      </div>
    </div>
  );
}

//? Register-flow step A — link a git repo. Clones it (bare) into data/workspaces/<id>/
//? server-side; the status card reflects the on-disk linked branch/head (or a scrubbed
//? clone error). Token is write-only (never pre-filled). Realtime via the linkRepo op.
function RepositoryTab() {
  const translate = useTranslator();
  const { repo, linkRepo, unlinkRepo, activeWorkspace, activeProject } = useWorkspaces();
  const [gitUrl, setGitUrl] = useState(repo.gitUrl ?? '');
  const [token, setToken] = useState('');
  const [linking, setLinking] = useState(false);
  useEffect(() => { setGitUrl(repo.gitUrl ?? ''); }, [repo.gitUrl]);
  //? A repo delta (linked or error) ends the in-flight link.
  useEffect(() => { setLinking(false); }, [repo]);
  const submit = () => {
    const u = gitUrl.trim();
    if (u.length === 0) return;
    setLinking(true);
    linkRepo(u, token.trim().length > 0 ? token.trim() : undefined);
    setToken('');
  };
  const disconnect = (): void => {
    if (!activeProject) return;
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.workspaceSettings.repoUnlinkConfirmTitle' }),
      content: translate({ key: 'workspaces.workspaceSettings.repoUnlinkConfirmContent' }),
      input: activeProject.name,
    }).then((ok) => { if (ok) { setLinking(true); unlinkRepo(); } });
  };
  //? ADR 0312/0313 — four sections instead of one stacked wall. The tab mixed three lifecycles:
  //? linking a repo (once), describing how it runs (rarely), and its container image (iteratively).
  //? Each is now its own address, so "Repository → Runtime" is a link you can send someone.
  const linkSection = (
    <div className="max-w-2xl w-full flex flex-col gap-4">
      <FormSection title={translate({ key: 'workspaces.workspaceSettings.tabRepository' })} desc={translate({ key: 'workspaces.workspaceSettings.repoDescription' })}>
        {repo.linked && (
          <div className="px-5 py-3">
            <div className="rounded-lg border border-correct-border bg-correct/10 px-3 py-2 text-sm text-common flex items-center gap-2">
              <Icon name="circle-check" className="text-correct" />
              <span>{translate({ key: 'workspaces.workspaceSettings.repoLinked', params: [{ key: 'branch', value: repo.branch ?? '—' }, { key: 'head', value: repo.head ?? '—' }] })}</span>
            </div>
          </div>
        )}
        {repo.error !== undefined && (
          <div className="px-5 py-3">
            <div className="rounded-lg border border-wrong-border bg-wrong/10 px-3 py-2 text-sm text-wrong flex items-center gap-2">
              <Icon name="triangle-exclamation" /> <span>{repo.error === 'repo.inUse'
                ? translate({ key: 'workspaces.workspaceSettings.repoInUse' })
                : (repo.error === 'repo.runtimeUnavailable' ? translate({ key: 'workspaces.workspaceSettings.repoRuntimeUnavailable' }) : repo.error)}</span>
            </div>
          </div>
        )}
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.repoUrl' })}
          control={<input value={gitUrl} onChange={(e) => { setGitUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.repoUrlPlaceholder' })} className={fieldCls} />}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.cloneToken' })}
          control={<input type="password" value={token} onChange={(e) => { setToken(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.tokenPlaceholder' })} className={`${fieldCls} font-mono`} />}
        />
        <div className="px-5 py-4 flex flex-wrap gap-2">
          <WsButton icon={linking ? 'spinner' : 'link'} disabled={linking} onClick={submit}>
            {translate({ key: linking ? 'workspaces.workspaceSettings.repoLinking' : (repo.linked ? 'workspaces.workspaceSettings.repoRelink' : 'workspaces.workspaceSettings.repoLinkBtn') })}
          </WsButton>
          {repo.linked && <WsButton variant="danger" icon="xmark" disabled={linking} onClick={disconnect}>{translate({ key: 'workspaces.workspaceSettings.repoUnlink' })}</WsButton>}
        </div>
      </FormSection>
      <RepoInventoryPanel workspaceId={activeWorkspace.id} />
    </div>
  );

  //? Until a repo is linked there is nothing for the other three sections to describe, so the tab
  //? stays a single form rather than an index of three empty pages.
  if (!repo.linked) return <div className="mx-auto w-full max-w-2xl">{linkSection}</div>;

  return (
    <PageSections
      ariaLabel={translate({ key: 'workspaces.workspaceSettings.tabRepository' })}
      sections={[
        { id: 'link', label: translate({ key: 'workspaces.repoScan.sectionLink' }), icon: 'link', body: linkSection },
        { id: 'runtime', label: translate({ key: 'workspaces.repoScan.sectionRuntime' }), icon: 'play', body: <div className="max-w-2xl w-full"><RuntimeSection key={`rt-${activeWorkspace.id}`} workspaceId={activeWorkspace.id} /></div> },
        { id: 'image', label: translate({ key: 'workspaces.repoScan.sectionImage' }), icon: 'cube', body: <div className="max-w-2xl w-full"><DockerfileReview key={activeWorkspace.id} workspaceId={activeWorkspace.id} /></div> },
      ]}
    />
  );
}

function DangerTab() {
  const translate = useTranslator();
  const { activeWorkspace, members, transferOwnership, deleteWorkspace, cloneWorkspace, can, myPerms } = useWorkspaces();
  //? F-028 — transfer-ownership + delete-workspace require ownerActions server-side (rbac.ts); a built-in
  //? Admin holds no such bit, so the buttons were dead. Hidden (with a one-line reason) instead of refused.
  const ownerActions = myPerms.length > 0 ? can(CAP.ownerActions) : activeWorkspace.role === 'owner';
  const [transferTarget, setTransferTarget] = useState('');
  const memberItems = members.filter((m) => m.id !== activeWorkspace.ownerId).map((m) => ({ id: m.id, value: m.id, item: m.name }));

  const startTransfer = () => {
    if (!transferTarget) return;
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.workspaceSettings.transferConfirmTitle' }),
      content: translate({ key: 'workspaces.workspaceSettings.transferConfirmContent' }),
      input: activeWorkspace.slug,
    }).then((ok) => { if (ok) transferOwnership(transferTarget); });
  };

  //? G2 — the duplicate is named after the source ("<name> (copy)"); renaming it afterwards is one click
  //? in the same settings page, which is cheaper than asking for a name before the user has seen the copy.
  const startClone = (): void => {
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.workspaceSettings.cloneWorkspace' }),
      content: translate({ key: 'workspaces.workspaceSettings.cloneWorkspaceDesc' }),
    }).then((ok) => { if (ok) cloneWorkspace(`${activeWorkspace.name} (copy)`); });
  };


  const startDelete = () => {
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.workspaceSettings.deleteConfirmTitle', params: [{ key: 'name', value: activeWorkspace.name }] }),
      content: translate({ key: 'workspaces.workspaceSettings.deleteConfirmContent' }),
      input: activeWorkspace.slug,
    }).then((ok) => { if (ok) deleteWorkspace(); });
  };

  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-wrong/40 bg-wrong/5 p-5 flex flex-col gap-4">
      {!ownerActions && (
        <div className="flex items-start gap-2 text-xs text-muted"><Icon name="circle-info" className="mt-0.5 shrink-0" /><span>{translate({ key: 'workspaces.workspaceSettings.ownerActionsOnly' })}</span></div>
      )}
      {ownerActions && <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.transferOwnership' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.transferOwnershipDesc' })}</div>
        </div>
        {/* Alone in the workspace there is nobody to hand it to: the picker was empty ("No results")
            next to a Transfer button that silently did nothing. Say WHY, and where members come from. */}
        {memberItems.length === 0 ? (
          <EmptyPicker
            icon="users"
            label={translate({ key: 'workspaces.tips.workspace.noTransferTargetLabel' })}
            fix={{ cap: 'manageMembers', view: 'workspace', tab: 'invites', cta: translate({ key: 'workspaces.tips.workspace.noTransferTargetCta' }) }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <Dropdown
              size="sm" showSearch searchPlaceholder={translate({ key: 'workspaces.workspaceSettings.findMemberPlaceholder' })}
              value={memberItems.find((m) => m.id === transferTarget)} placeholder={translate({ key: 'workspaces.workspaceSettings.transferToPlaceholder' })}
              items={memberItems}
              onChange={(it) => { setTransferTarget(String(it.id)); }}
            />
            <WsButton variant="secondary" onClick={startTransfer}>{translate({ key: 'workspaces.workspaceSettings.transfer' })}</WsButton>
          </div>
        )}
      </div>}
      {ownerActions && <div className="h-px bg-wrong/20" />}
      {/* GAP_SCAN G2 — start a second workspace from this one's setup instead of re-onboarding from zero.
          Copies configuration only: no tickets, no content, no credentials, no members. */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.cloneWorkspace' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.cloneWorkspaceDesc' })}</div>
        </div>
        <WsButton variant="secondary" icon="copy" onClick={startClone}>{translate({ key: 'workspaces.workspaceSettings.clone' })}</WsButton>
      </div>
      {ownerActions && (
        <>
          <div className="h-px bg-wrong/20" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.deleteWorkspace' })}</div>
              <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.deleteWorkspaceDesc' })}</div>
            </div>
            <WsButton variant="danger" onClick={startDelete}>{translate({ key: 'workspaces.workspaceSettings.delete' })}</WsButton>
          </div>
        </>
      )}
    </div>
  );
}

//? Module-gating settings: per-section toggles grouped by module (Development / Content /
//? Design). Individual sections toggle independently — a Development workspace can add
//? just the Interviewer without the rest of Design. Persists via the [save-sections]
//? control-op; an EMPTY resolved set is disallowed (a workspace must keep ≥1 section).
function SectionsTab() {
  const translate = useTranslator();
  const { activeWorkspace, saveSections } = useWorkspaces();
  const stored = activeWorkspace.enabledSections;
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(!stored || stored.length === 0 ? GATEABLE_SECTIONS : stored));
  const toggle = (id: string) => {
    setEnabled((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const save = () => { if (enabled.size > 0) saveSections(GATEABLE_SECTIONS.filter((s) => enabled.has(s))); };
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="text-sm text-muted">{translate({ key: 'workspaces.sections.intro' })}</div>
      {WORKSPACE_MODULES.map((m) => (
        <FormSection
          key={m.id}
          title={(
            <span className="inline-flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-container2 text-muted flex items-center justify-center"><Icon name={m.icon} /></span>
              {translate({ key: m.labelKey })}
            </span>
          )}
        >
          {WORKSPACE_SECTIONS.filter((s) => s.moduleId === m.id).map((s) => (
            // ws-<page>-<element>: the shared `Toggle` primitive renders a bare icon-only
            // button with no accessible name, and section labels ("Content"/"Documents") can
            // collide with the module-header text above — a testid on the row disambiguates
            // it for tests without touching the primitive itself.
            <div key={s.id} data-testid={`ws-workspace-section-${s.id}`}>
              <SettingRow
                label={translate({ key: s.labelKey })}
                control={<Toggle on={enabled.has(s.id)} onChange={() => { toggle(s.id); }} ariaLabel={translate({ key: s.labelKey })} />}
              />
            </div>
          ))}
        </FormSection>
      ))}
      <div className="flex items-center gap-3">
        <WsButton icon="check" onClick={save} disabled={enabled.size === 0}>{translate({ key: 'workspaces.sections.save' })}</WsButton>
        {enabled.size === 0 && <span className="text-xs text-wrong">{translate({ key: 'workspaces.sections.needOne' })}</span>}
      </div>
    </div>
  );
}

//? Q4 — the workspace-wide "how the AI should work here" instruction, prepended to EVERY AI completion
//? (all features, dev + content). Distinct from per-stage prompts (specific tasks) and the content brand
//? context (creative facts) — this is the always-on behavioural steer. Persisted via save-ai-instruction.
//? K4 — the preferred AI OUTPUT language options (the value is the language name used in the directive;
//? empty = the model's default / auto).
const OUTPUT_LANGUAGES: { id: string; label: string }[] = [
  { id: '', label: '' }, { id: 'English', label: 'English' }, { id: 'Dutch', label: 'Nederlands' },
  { id: 'German', label: 'Deutsch' }, { id: 'French', label: 'Français' }, { id: 'Spanish', label: 'Español' },
  { id: 'Italian', label: 'Italiano' }, { id: 'Portuguese', label: 'Português' },
];
//? P1 — the AI features where switching provider (Claude ↔ Gemini) is meaningful (non-coding reasoning/
//? creative; the coding + chat features stay on the subscription-billed Claude PTY by design).
const PROVIDER_FEATURES = ['script', 'docs-generate', 'studio-designer', 'studio-marketer', 'designer-theme', 'interviewer', 'mr-review', 'root-cause', 'plan-critique'];
//? The routing options are built from the CONNECTED backends, not a hardcoded pair. This list still
//? read `Claude | Gemini` after the catalog grew to eight, and routing a feature at a backend nobody
//? has connected is a dead end that fails silently at dispatch.

//? #92 — a custom task's prompt template can carry {{var}} placeholders; extract the distinct names so we
//? can ask the user to fill them before running (else the task renders its placeholders empty).
const extractTaskVars = (tpl: string): string[] => [...new Set([...tpl.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]).filter((v): v is string => v !== undefined))];

//? A small form that collects a value per {{var}} of a custom task, then runs it. Rendered in the
//? menuHandler overlay; resolves by calling onRun with the collected vars and closing itself.
function CustomTaskVarsForm({ vars, onRun }: { vars: string[]; onRun: (values: Record<string, string>) => void }) {
  const translate = useTranslator();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(vars.map((v) => [v, ''])));
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.customTaskVarsTitle' })}</div>
      {vars.map((v) => (
        <label key={v} className="flex flex-col gap-1">
          <span className="text-xs text-muted font-mono">{v}</span>
          <input value={values[v] ?? ''} onChange={(e) => { setValues((prev) => ({ ...prev, [v]: e.target.value })); }} className={fieldCls} />
        </label>
      ))}
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="play" onClick={() => { onRun(values); void menuHandler.close(); }}>{translate({ key: 'workspaces.workspaceSettings.customTaskRun' })}</WsButton>
      </div>
    </div>
  );
}

//? SK1 — one AI-skill row: toggle + expandable editor (builtin = resettable, never deletable).
function AiBehaviorTab() {
  const translate = useTranslator();
  const { activeWorkspace, saveAiInstruction, aiOverrides, aiConnections, aiProviderCatalog, aiFeatureDefaults, aiRuns, saveAiProvider, saveAutonomy, customTasks, saveCustomTask, runCustomTask, deleteCustomTask, aiSkills, navigate } = useWorkspaces();
  const [newTaskName, setNewTaskName] = useState('');
  //? P4-7 — the REAL availability probe per backend (Claude CLI on the host, a usable key for a metered
  //? one), fetched once per workspace. Until it answers, the connection row's own state stands in.
  const [health, setHealth] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    setHealth(null);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/aiProviderHealth', version: 'v1', data: { workspaceId: activeWorkspace.id } }));
      if (error || res?.status !== 'success') return;
      setHealth(Object.fromEntries(res.result.providers.map((p) => [p.id, p.available])));
    })();
  }, [activeWorkspace.id]);
  const [newTaskTemplate, setNewTaskTemplate] = useState('');
  const autonomyItems = (['gate-every', 'gate-key-stages', 'full-auto'] as const).map((id) => ({ id, value: id, item: translate({ key: `workspaces.workspaceSettings.autonomy.${id}` }) }));
  const autonomyLevel = activeWorkspace.autonomyLevel ?? 'gate-key-stages';
  const [value, setValue] = useState(activeWorkspace.aiInstruction ?? '');
  const [language, setLanguage] = useState(activeWorkspace.outputLanguage ?? '');
  //? ADR 0007 — the Gemini model/temperature/base-URL columns are LEGACY: the provider section above
  //? owns those settings now, per backend, in the generic store. They are still passed through here
  //? unchanged so this op never clears what an older workspace has stored — read, never edited.
  const geminiModel = activeWorkspace.geminiModel ?? '';
  const geminiTemp = activeWorkspace.geminiTemperature ?? '';
  const geminiBaseUrl = activeWorkspace.geminiBaseUrl ?? '';
  //? ADR 0309 — autosave with a per-row pill instead of a Save button. The five fields persist
  //? through one op, so they share one status; switching workspace re-seeds without writing.
  const aiStatus = useAutosave(
    [value, language, geminiModel, geminiTemp, geminiBaseUrl],
    () => { saveAiInstruction(value.trim(), language, geminiModel.trim(), geminiTemp.trim(), geminiBaseUrl.trim()); },
    { resetKey: activeWorkspace.id },
  );
  //? ADR 0308 — layers 1-2 resolve here (the stage-scoped 3-5 stay empty on this page, which is
  //? itself the point: the preview shows the user that stages add three more).
  const layers = resolveAiLayers({ workspace: activeWorkspace, skills: aiSkills });
  const workspaceTip = useLayerTip(layers, 'workspace');
  const languageOptions = OUTPUT_LANGUAGES.map((l) => ({ id: l.id, value: l.id, item: l.id.length === 0 ? translate({ key: 'workspaces.workspaceSettings.languageAuto' }) : l.label }));
  //? P4-7 — honest availability in the picker. Each backend carries a badge (probe result, else the
  //? connection's own state), the "Default" choice names the backend it actually resolves to (workspace
  //? default, else the built-in feature default), and a feature routed at an unavailable backend says so.
  const backendLabel = (id: string): string => aiProviderCatalog.find((p) => p.id === id)?.label ?? aiConnections.find((c) => c.providerId === id)?.label ?? id;
  const isAvailable = (id: string): boolean => {
    if (health !== null && id in health) return health[id] === true;
    return aiConnections.some((c) => c.providerId === id && (c.kind === 'subscription' || c.hasKey) && c.lastError === null);
  };
  const dot = (id: string): ReactNode => (
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAvailable(id) ? 'bg-correct' : 'bg-wrong'}`} title={translate({ key: isAvailable(id) ? 'workspaces.workspaceSettings.providerAvailable' : 'workspaces.workspaceSettings.providerUnavailable' })} />
  );
  const badge = (id: string): ReactNode => <span className={`inline-flex items-center gap-2`}>{dot(id)}{backendLabel(id)}</span>;
  //? One entry per DISTINCT connected backend — a feature can only be routed somewhere that can answer it.
  const connectedIds = [...new Set(aiConnections.map((c) => c.providerId))];
  const wsDefault = aiOverrides.find((o) => o.feature === '_default');
  const providerFor = (feature: string): string => aiOverrides.find((o) => o.feature === feature)?.providerId ?? 'default';
  //? What "Default" means for this feature: the workspace default (P4-1) when set, else the built-in one.
  const resolvedDefault = (feature: string): string => wsDefault?.providerId ?? aiFeatureDefaults[feature] ?? '';
  const providerItemsFor = (feature: string) => [
    { id: 'default', value: 'default', searchText: translate({ key: 'workspaces.workspaceSettings.providerDefault' }), item: (
      <span className={`inline-flex items-center gap-2`}>
        {dot(resolvedDefault(feature))}
        {translate({ key: 'workspaces.workspaceSettings.providerDefaultResolved', params: [{ key: 'backend', value: backendLabel(resolvedDefault(feature)) }] })}
      </span>
    ) },
    ...connectedIds.map((id) => ({ id, value: id, searchText: backendLabel(id), item: badge(id) })),
  ];
  const wsDefaultItems = [
    { id: 'default', value: 'default', item: translate({ key: 'workspaces.workspaceSettings.workspaceDefaultBuiltIn' }) },
    ...connectedIds.map((id) => ({ id, value: id, searchText: backendLabel(id), item: badge(id) })),
  ];
  //? The help line under a feature: the unavailable warning first (it is the actionable one), then the
  //? pinned model (P4-2) and what actually ran last (from the AI-activity ring, newest first).
  const featureHelp = (feature: string): ReactNode => {
    const chosen = providerFor(feature);
    const effective = chosen === 'default' ? resolvedDefault(feature) : chosen;
    const pinned = aiOverrides.find((o) => o.feature === feature)?.model;
    const last = aiRuns.find((r) => r.feature === feature);
    const camel = feature.replaceAll(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    return (
      <span className={`flex flex-col gap-0.5`}>
        <span>{translate({ key: `workspaces.workspaceSettings.providerFeatureDesc.${camel}` })}</span>
        {effective.length > 0 && !isAvailable(effective) && (
          <span className={`text-warning`}>{translate({ key: 'workspaces.workspaceSettings.providerRoutedUnavailable', params: [{ key: 'backend', value: backendLabel(effective) }] })}</span>
        )}
        {pinned !== undefined && pinned.length > 0 && (
          <span className={`font-mono text-[11px]`}>{translate({ key: 'workspaces.workspaceSettings.providerPinnedModel', params: [{ key: 'model', value: pinned }] })}</span>
        )}
        <span className={last?.status === 'error' ? 'text-wrong' : ''}>
          {last === undefined
            ? translate({ key: 'workspaces.workspaceSettings.providerNeverRan' })
            : translate({
              key: last.status === 'error' ? 'workspaces.workspaceSettings.providerLastFailed' : 'workspaces.workspaceSettings.providerLastRan',
              params: [
                { key: 'backend', value: backendLabel(last.providerId) },
                { key: 'model', value: last.model ? ` · ${last.model}` : '' },
                { key: 'error', value: last.error ?? '' },
                { key: 'when', value: new Date(last.createdAt).toLocaleString() },
              ],
            })}
        </span>
      </span>
    );
  };
  //? Provider health used to be fetched here for a row of green/red chips. A connection now carries
  //? its OWN verified/failed state, tested on demand against the real backend — which answers the
  //? question the chips only gestured at ("a key is present" vs "this key works").
  //? ADR 0312 — the same sectioned shape the Repository tab uses. This page had six stacked panels:
  //? instruction, autonomy, connected backends, skills, custom tasks and per-feature routing, all in
  //? one column. Each is a separate job, and scrolling past five of them to reach the sixth is what
  //? made the page feel like a wall. Each section is its own URL, so a deep link lands on it.
  //?
  //? Autonomy sits WITH the instruction rather than alone: both answer "how does the AI behave here",
  //? and a section holding one dial is a section that reads as a mistake. Routing sits with the
  //? backends, because it is meaningless without them — it chooses among the ones you connected.
  return (
    <PageSections
      ariaLabel={translate({ key: 'workspaces.workspaceSettings.tabAi' })}
      sections={[
        {
          id: 'instructions', label: translate({ key: 'workspaces.aiSections.instructions' }), icon: 'comments',
          body: (
            <div className="max-w-3xl w-full flex flex-col gap-4">
      {/* The composition is stated where it is edited — behind the "?" ON the field (ADR 0311 for the
          two-channel model). The full "what the AI actually receives" block used to sit here too; it
          is the same information in the container the owner asked twice to be rid of, and it belongs
          on the pipeline where the stage layers are edited, not on a page with one field. */}
      <FormSection
        title={translate({ key: 'workspaces.workspaceSettings.aiInstructionTitle' })}
        desc={translate({ key: 'workspaces.workspaceSettings.aiInstructionDesc' })}
      >
        <SettingRow
          stacked
          label={translate({ key: 'workspaces.aiLayers.workspace' })}
          inherits={<LayerNote layers={layers} id="workspace" />}
          //? The same "?" the pipeline's persona field has. This field is the FIRST layer of the system
          //? channel and steers every stage, and until now the only explanation on this page sat four
          //? settings rows further down, where nobody looks for it.
          infoTitle={workspaceTip.title}
          info={workspaceTip.body}
          infoPoints={workspaceTip.points}
          status={aiStatus}
          control={(
            <textarea
              value={value} onChange={(e) => { setValue(e.target.value); }} rows={6}
              placeholder={translate({ key: 'workspaces.workspaceSettings.aiInstructionPlaceholder' })}
              className={fieldCls.replace('h-9', 'min-h-32') + ' py-2 resize-none'}
            />
          )}
        />
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.outputLanguage' })}
          status={aiStatus}
          control={<Dropdown width="full" value={languageOptions.find((o) => o.id === language)} items={languageOptions} onChange={(it) => { setLanguage(String(it.id)); }} />}
        />
      </FormSection>
      {/* A4 — autonomy dial: how often the human is asked to approve a stage. */}
      <FormSection title={translate({ key: 'workspaces.workspaceSettings.autonomyTitle' })}>
        {/* This dial overrides each stage's own "ask for approval" mark at the stage EXIT only
            (resolveStageGate — whether a finished stage auto-advances). The stage ENTRY is decided
            elsewhere: the watchdog's idle sweep reads `stage.gateForApproval` raw, with no autonomy
            level, so even on full-auto a gated stage never auto-STARTS — the ticket advances into it
            and parks. The copy below says exactly that. */}
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.autonomyTitle' })}
          help={translate({ key: 'workspaces.workspaceSettings.autonomyDesc' })}
          infoTitle={translate({ key: 'workspaces.tips.workspace.autonomyTitle' })}
          info={translate({ key: 'workspaces.tips.workspace.autonomyBody' })}
          infoPoints={[
            { id: 'full-auto', label: translate({ key: 'workspaces.tips.workspace.autonomyFullLabel' }), desc: translate({ key: 'workspaces.tips.workspace.autonomyFullDesc' }) },
            { id: 'gate-every', label: translate({ key: 'workspaces.tips.workspace.autonomyEveryLabel' }), desc: translate({ key: 'workspaces.tips.workspace.autonomyEveryDesc' }) },
            {
              id: 'gate-key-stages',
              label: translate({ key: 'workspaces.tips.workspace.autonomyKeyLabel' }),
              desc: translate({ key: 'workspaces.tips.workspace.autonomyKeyDesc' }),
              onGo: () => { navigate('pipeline'); },
              goLabel: translate({ key: 'workspaces.tips.workspace.autonomyKeyGo' }),
            },
          ]}
          control={<Dropdown width="full" value={autonomyItems.find((a) => a.id === autonomyLevel)} items={autonomyItems} onChange={(it) => { saveAutonomy(String(it.id)); }} />}
        />
      </FormSection>
            </div>
          ),
        },
        {
          id: 'backends', label: translate({ key: 'workspaces.aiSections.backends' }), icon: 'robot',
          body: (
            <div className="max-w-3xl w-full flex flex-col gap-4">
      {/* ADR 0007 — the general AI setup, rendered from the server's provider catalog: status, key,
          a PREDEFINED model list, endpoint and temperature, per backend. It used to be a status dot
          plus three free-text Gemini fields, with the key itself on the Content settings page next to
          ElevenLabs and Suno — so this page read as "Gemini's settings" and the one thing you had to
          do was somewhere else entirely. Media providers stay with media; this one runs the product. */}
      <AiProvidersSection />
      {/* ADR 0322 — which subscription seat + harness writes the code in the ticket container. */}
      <CodingAgentSection />
      {/* P1 — which AI backend runs each feature (persists on change). */}
      <FormSection
        title={translate({ key: 'workspaces.workspaceSettings.aiProviderTitle' })}
        desc={translate({ key: 'workspaces.workspaceSettings.aiProviderDesc' })}
      >
        {/* P4-1 — the workspace default backend: every feature that keeps "Default" resolves here first. */}
        <SettingRow
          label={translate({ key: 'workspaces.workspaceSettings.workspaceDefaultTitle' })}
          help={translate({ key: 'workspaces.workspaceSettings.workspaceDefaultDesc' })}
          control={<Dropdown width="full" size="sm" value={wsDefaultItems.find((p) => p.id === (wsDefault?.providerId ?? 'default'))} items={wsDefaultItems} onChange={(it) => { saveAiProvider('_default', String(it.id)); }} />}
        />
        {PROVIDER_FEATURES.map((f) => {
          //? #82 — human label + one-line description per feature (no raw slugs). The camelCase key
          //? maps the internal slug to a translation entry under workspaceSettings.providerFeature.
          const camel = f.replaceAll(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
          const items = providerItemsFor(f);
          return (
            <SettingRow
              key={f}
              label={translate({ key: `workspaces.workspaceSettings.providerFeature.${camel}` })}
              help={featureHelp(f)}
              control={<Dropdown width="full" size="sm" value={items.find((p) => p.id === providerFor(f))} items={items} onChange={(it) => { saveAiProvider(f, String(it.id)); }} />}
            />
          );
        })}
      </FormSection>
            </div>
          ),
        },
        {
          id: 'skills', label: translate({ key: 'workspaces.aiSections.skills' }), icon: 'wand-magic-sparkles',
          body: (
            <div className="max-w-3xl w-full flex flex-col gap-4">
      {/* SK1 — the universal AI-skills layer (humanizer, tone-of-voice, …). */}
      <SkillsSection />
            </div>
          ),
        },
        {
          id: 'tasks', label: translate({ key: 'workspaces.aiSections.tasks' }), icon: 'list-check',
          body: (
            <div className="max-w-3xl w-full flex flex-col gap-4">
      {/* E5 — user-defined custom AI tasks: a named prompt-template, run on demand (output only). */}
      <FormSection
        title={translate({ key: 'workspaces.workspaceSettings.customTasksTitle' })}
        desc={translate({ key: 'workspaces.workspaceSettings.customTasksDesc' })}
      >
        <div className="px-5 pb-5 flex flex-col gap-2">
          {customTasks.map((t) => (
            <div key={t.id} className="rounded-lg border border-container1-border bg-container1 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-title truncate">{t.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <WsButton icon="play" onClick={() => { const vars = extractTaskVars(t.promptTemplate); if (vars.length === 0) { runCustomTask(t.id); return; } void menuHandler.open(<CustomTaskVarsForm vars={vars} onRun={(values) => { runCustomTask(t.id, values); }} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); }}>{translate({ key: 'workspaces.workspaceSettings.customTaskRun' })}</WsButton>
                  <button type="button" onClick={() => { deleteCustomTask(t.id); }} className="text-xs text-muted hover:text-wrong px-1.5 py-1 cursor-pointer"><Icon name="trash" /></button>
                </div>
              </div>
              {t.lastOutput != null && t.lastOutput.length > 0 && <div className="text-xs text-common mt-1.5 whitespace-pre-wrap max-h-40 overflow-auto rounded bg-container2 p-2">{t.lastOutput}</div>}
            </div>
          ))}
        </div>
        <div className="px-5 pb-5 flex flex-col gap-2 border-t border-divider pt-4">
          <input value={newTaskName} onChange={(e) => { setNewTaskName(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.customTaskNamePlaceholder' })} className={fieldCls} />
          <textarea value={newTaskTemplate} onChange={(e) => { setNewTaskTemplate(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.customTaskTemplatePlaceholder' })} rows={2} className={`${fieldCls} resize-y`} />
          <div>
            <WsButton icon="plus" onClick={() => { if (newTaskName.trim() && newTaskTemplate.trim()) { saveCustomTask({ name: newTaskName.trim(), promptTemplate: newTaskTemplate.trim() }); setNewTaskName(''); setNewTaskTemplate(''); } }}>{translate({ key: 'workspaces.workspaceSettings.customTaskAdd' })}</WsButton>
          </div>
        </div>
      </FormSection>
            </div>
          ),
        },
      ]}
    />
  );
}

//? #70 — the admin/security audit trail: who changed roles/members/secrets/ownership, newest-first.
//? Reads the workspaces/auditLog `_api` route (workspaceSettings-gated server-side).
interface AuditRow { id: string; action: string; target: string | null; actorName: string; createdAt: string }
function AuditTab() {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void apiRequest({ name: 'workspaces/auditLog', version: 'v1', data: { workspaceId: activeWorkspace.id } }).then((r) => {
      if (r.status === 'success') setEntries(r.result.entries);
      setLoaded(true);
    });
  }, [activeWorkspace.id]);
  const columns: TableColumn<AuditRow>[] = [
    {
      id: 'entry',
      header: translate({ key: 'workspaces.workspaceSettings.auditAction' }),
      cell: (e) => (
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-container2 text-muted flex items-center justify-center shrink-0"><Icon name="clock-rotate-left" /></span>
          <div className="min-w-0">
            <div className="text-sm text-title truncate"><span className="font-medium">{e.actorName}</span> · <span className="font-mono text-xs">{e.action}</span>{e.target !== null && e.target.length > 0 ? ` · ${e.target}` : ''}</div>
          </div>
        </div>
      ),
    },
    { id: 'when', header: translate({ key: 'workspaces.workspaceSettings.auditWhen' }), className: 'w-44', cell: (e) => <span className="text-muted">{new Date(e.createdAt).toLocaleString()}</span> },
  ];

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col gap-2">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.auditTitle' })}</div>
      <div className="text-sm text-muted -mt-1 mb-1">{translate({ key: 'workspaces.workspaceSettings.auditDesc' })}</div>
      {loaded && <Table columns={columns} rows={entries} rowKey={(e) => e.id} empty={translate({ key: 'workspaces.workspaceSettings.auditEmpty' })} />}
    </div>
  );
}

export const template = 'workspaces';

export default function WorkspaceSettings() {
  const translate = useTranslator();
  const { activeWorkspace, renameWorkspace, can, myPerms, navigate, focusSetup } = useWorkspaces();
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(activeWorkspace.name);
  //? Repository / GitLab / Workflow are Development-lane setup — hide them for a
  //? content/design-only workspace (no repo/Dockerfile prompt when you didn't ask for code).
  const devEnabled = isModuleEnabled(activeWorkspace.enabledSections, 'development');
  //? F-028 — tabs are gated on the caller's resolved CAPABILITIES (snapshot `myPerms`, the same vector the
  //? server's hasCapability checks), not on the flattened role: `role` collapses every custom role to 'member',
  //? which locked a custom role holding workspaceSettings out of the tabs the server would let it use, while a
  //? built-in Admin (no ownerActions) saw Transfer/Delete the server always refuses.
  //?   config tabs (permissions, modules, AI, env, integrations, audit, dev setup) → workspaceSettings
  //?   invites → manageMembers · danger (transfer/delete) → ownerActions; clone → workspaceSettings.
  //? Fail-open only where the matrix is absent (an empty myPerms = snapshot not loaded), matching the old rule.
  const hasPerms = myPerms.length > 0;
  const canSettings = hasPerms ? can(CAP.workspaceSettings) : activeWorkspace.role !== 'member';
  const canInvite = hasPerms ? can(CAP.manageMembers) : activeWorkspace.role !== 'member';
  const configTabs: TabDef[] = [
    { id: 'permissions', label: translate({ key: 'workspaces.workspaceSettings.tabPermissions' }), icon: 'circle-check' },
    { id: 'modules', label: translate({ key: 'workspaces.workspaceSettings.tabModules' }), icon: 'table-cells-large' },
    { id: 'aibehavior', label: translate({ key: 'workspaces.workspaceSettings.tabAi' }), icon: 'robot' },
    { id: 'env', label: translate({ key: 'workspaces.workspaceSettings.tabEnv' }), icon: 'sliders' },
    { id: 'integrations', label: translate({ key: 'workspaces.workspaceSettings.tabIntegrations' }), icon: 'database' },
  ];
  const inviteTab: TabDef = { id: 'invites', label: translate({ key: 'workspaces.workspaceSettings.tabInvites' }), icon: 'plus' };
  const laterConfigTabs: TabDef[] = [
    { id: 'audit', label: translate({ key: 'workspaces.workspaceSettings.tabAudit' }), icon: 'clock-rotate-left' },
    ...(devEnabled ? [
      { id: 'repository', label: translate({ key: 'workspaces.workspaceSettings.tabRepository' }), icon: 'code-branch' as const },
      { id: 'gitlab', label: translate({ key: 'workspaces.workspaceSettings.tabGitlab' }), icon: 'diagram-project' as const },
      { id: 'workflow', label: translate({ key: 'workspaces.workspaceSettings.tabWorkflow' }), icon: 'code-merge' as const },
    ] : []),
    //? Danger hosts clone (workspaceSettings) too, so the tab itself follows settings; the owner-only
    //? sections inside hide themselves (DangerTab) for a role without ownerActions.
    { id: 'danger', label: translate({ key: 'workspaces.workspaceSettings.tabDanger' }), icon: 'triangle-exclamation' },
  ];
  const tabs: TabDef[] = [
    { id: 'members', label: translate({ key: 'workspaces.workspaceSettings.tabMembers' }), icon: 'users' },
    ...(canSettings ? configTabs : []),
    ...(canInvite ? [inviteTab] : []),
    ...(canSettings ? laterConfigTabs : []),
  ];

  //? ADR 0312 — the tab IS the URL (`/workspaces/workspace/repository`), so it is linkable, survives a
  //? refresh and the back button leaves it. `useTrailSegment` validates against the tabs that actually
  //? exist, which also covers the old fallback: a tab gated away (dev tabs hidden after disabling the
  //? module) or a stale bookmark resolves to Members rather than rendering a blank panel.
  const [activeTab, setTab] = useTrailSegment(0, tabs.map((t) => t.id), 'members');

  const startRename = () => { setNameInput(activeWorkspace.name); setRenaming(true); };
  const commitRename = () => {
    if (!renaming) return;
    setRenaming(false);
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== activeWorkspace.name) renameWorkspace(trimmed);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        {renaming ? (
          <input
            value={nameInput} onChange={(e) => { setNameInput(e.target.value); }}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            className="text-xl md:text-2xl font-semibold text-title bg-transparent border-b border-primary focus:outline-none"
          />
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-semibold text-title">{activeWorkspace.name}</h1>
            <button type="button" onClick={startRename} title={translate({ key: 'workspaces.workspaceSettings.renameWorkspaceTooltip' })} className="text-xs text-muted hover:text-title cursor-pointer">{translate({ key: 'workspaces.workspaceSettings.edit' })}</button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.workspaceSettings' })}</span>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
            <button type="button" onClick={() => { focusSetup({ view: 'settings', tab: 'workspace' }); }} className="text-primary hover:text-primary-hover cursor-pointer inline-flex items-center gap-1"><Icon name="arrow-right-long" /> {translate({ key: 'workspaces.workspaceSettings.toolsWorkspaceLink' })}</button>
            <button type="button" onClick={() => { focusSetup({ view: 'settings', tab: 'developer' }); }} className="text-primary hover:text-primary-hover cursor-pointer inline-flex items-center gap-1"><Icon name="arrow-right-long" /> {translate({ key: 'workspaces.workspaceSettings.toolsDeveloperLink' })}</button>
            <button type="button" onClick={() => { navigate('board'); }} className="text-primary hover:text-primary-hover cursor-pointer inline-flex items-center gap-1"><Icon name="wand-magic-sparkles" /> {translate({ key: 'workspaces.setup.title' })}</button>
          </div>
        </div>
      </div>
      <div className="px-4 md:px-6">
        <Tabs tabs={tabs} active={activeTab} onChange={setTab} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        {activeTab === 'members' && <MembersTab />}
        {activeTab === 'permissions' && <PermissionsTab />}
        {/* keyed on the workspace: `setActiveWorkspace` swaps the snapshot without navigating, so an
                unkeyed SectionsTab kept the PREVIOUS workspace's toggles in state and Save wrote them
                onto the new one. Its siblings were already keyed; this one was missed. */}
            {activeTab === 'modules' && <SectionsTab key={activeWorkspace.id} />}
        {/* F-027 — keyed like its siblings: the tab seeds its instruction/language state once, so an
            unkeyed instance showed the PREVIOUS workspace's text after a switch and autosaved it into the new one. */}
        {activeTab === 'aibehavior' && <AiBehaviorTab key={activeWorkspace.id} />}
        {activeTab === 'env' && <EnvTab />}
        {activeTab === 'integrations' && <IntegrationsTab />}
        {activeTab === 'invites' && <InvitesTab />}
        {activeTab === 'audit' && <AuditTab />}
        {activeTab === 'repository' && <RepositoryTab />}
        {activeTab === 'gitlab' && <GitLabTab key={activeWorkspace.id} />}
        {activeTab === 'workflow' && <WorkflowTab key={activeWorkspace.id} />}
        {activeTab === 'danger' && <DangerTab />}
      </div>
    </div>
  );
}
