//? Workspaces — workspace settings. Members + per-member role (searchable
//? dropdown), the editable RBAC permissions matrix, pending invites, GitLab
//? integration, and the danger zone (transfer / delete, type-to-confirm). The
//? RBAC matrix + member roles live in app context so edits survive tab/route
//? changes. Dummy data; desktop-first.

import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { AvatarBubble, IconButton, PopMenu, Tabs, Toggle, WsButton, type PopMenuItem, type TabDef } from '../_components/primitives';
import { INTEGRATION_TYPES, RBAC_CAPABILITIES, ROLE_DISPLAY } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { IntegrationField, IntegrationTool, Member } from '../_data/types';

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

function removeMenu(member: Member, translate: ReturnType<typeof useTranslator>): PopMenuItem[] {
  return [
    { label: translate({ key: 'workspaces.workspaceSettings.removeFromWorkspace' }), icon: 'triangle-exclamation', danger: true, onClick: () => void menuHandler.confirm({ title: translate({ key: 'workspaces.workspaceSettings.removeMemberConfirmTitle', params: [{ key: 'name', value: member.name }] }), content: translate({ key: 'workspaces.workspaceSettings.removeMemberConfirmContent' }) }) },
  ];
}

function MembersTab() {
  const translate = useTranslator();
  const { memberRoles, setMemberRole, permRoles, activeWorkspace, members } = useWorkspaces();
  //? You assign any non-Owner role; ownership changes via the danger zone only.
  const roleItems = permRoles.filter((r) => !r.locked).map((r) => ({ id: r.name, value: r.name, item: r.name }));

  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
      {members.map((m) => {
        const isOwner = m.id === activeWorkspace.ownerId;
        const current = roleItems.find((r) => r.id === memberRoles[m.id]);
        return (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9"><AvatarBubble user={m} size={36} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-title">{m.name}</div>
              <div className="text-xs text-muted">{m.email}</div>
            </div>
            {isOwner ? (
              <span className="rounded-full bg-container2 px-2.5 py-1 text-[11px] font-medium text-muted">{translate({ key: 'workspaces.workspaceSettings.ownerBadge' })}</span>
            ) : (
              <Dropdown
                size="sm" showSearch searchPlaceholder={translate({ key: 'workspaces.workspaceSettings.findRolePlaceholder' })}
                value={current} placeholder={translate({ key: 'workspaces.workspaceSettings.setRolePlaceholder' })}
                items={roleItems}
                onChange={(it) => { setMemberRole(m.id, String(it.id)); }}
              />
            )}
            {isOwner ? <span className="w-7" /> : <PopMenu items={removeMenu(m, translate)} />}
          </div>
        );
      })}
    </div>
  );
}

function PermCell({ on, locked, onToggle }: { on: boolean; locked?: boolean; onToggle: () => void }) {
  const translate = useTranslator();
  return (
    <button
      type="button" disabled={locked} onClick={onToggle} title={on ? translate({ key: 'workspaces.workspaceSettings.allowed' }) : translate({ key: 'workspaces.workspaceSettings.denied' })}
      className={`w-8 h-6 rounded-md flex items-center justify-center transition-colors ${locked ? 'cursor-default' : 'cursor-pointer'} ${on ? 'bg-primary/15 text-primary' : 'bg-container2 text-disabled hover:bg-container2-hover'}`}
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

  const cols = `minmax(0,1fr) repeat(${String(permRoles.length)}, 4.5rem)`;

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.rolesAndPermissions' })}</span>
          <span className="text-sm text-muted ml-2">{translate({ key: 'workspaces.workspaceSettings.thisWorkspace' })}</span>
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

      <div className="rounded-2xl border border-container1-border bg-container1 overflow-x-auto">
        <div className="grid items-center gap-x-3 px-4 h-10 border-b border-divider text-xs font-medium text-muted min-w-max" style={{ gridTemplateColumns: cols }}>
          <span>{translate({ key: 'workspaces.workspaceSettings.capability' })}</span>
          {permRoles.map((r) => <span key={r.name} className="text-center capitalize">{r.name}</span>)}
        </div>
        {RBAC_CAPABILITIES.map((action, ci) => (
          <div key={action} className="grid items-center gap-x-3 px-4 py-2 border-b border-divider last:border-0 text-sm text-common min-w-max" style={{ gridTemplateColumns: cols }}>
            <span>{action}</span>
            {permRoles.map((r, ri) => (
              <span key={r.name} className="flex justify-center">
                <PermCell on={r.perms[ci] ?? false} locked={r.locked} onToggle={() => { togglePerm(ri, ci); }} />
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.permissionsFootnote' })}</p>
    </div>
  );
}

function InvitesTab() {
  const translate = useTranslator();
  const { invites } = useWorkspaces();
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.pendingInvites' })}</span>
        <WsButton icon="plus">{translate({ key: 'workspaces.workspaceSettings.inviteMembers' })}</WsButton>
      </div>
      <div className="rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
        {invites.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-9 h-9 rounded-full bg-container2 text-muted flex items-center justify-center"><Icon name="plus" /></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-title truncate">{i.email}</div>
              <div className="text-xs text-muted">{ROLE_DISPLAY[i.role]} · {translate({ key: 'workspaces.workspaceSettings.sentAt', params: [{ key: 'when', value: i.sent }] })}</div>
            </div>
            <button type="button" className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.workspaceSettings.revoke' })}</button>
          </div>
        ))}
        {invites.length === 0 && <div className="px-4 py-6 text-sm text-muted text-center">{translate({ key: 'workspaces.workspaceSettings.noPendingInvites' })}</div>}
      </div>
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
  const add = () => { const k = newKey.trim(); if (!k) return; saveEnvVar({ id: `env-${String(Date.now())}`, key: k, value: newVal, secret: newSecret }); setNewKey(''); setNewVal(''); setNewSecret(true); };
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div><span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.environmentVariables' })}</span><span className="text-sm text-muted ml-2">{translate({ key: 'workspaces.workspaceSettings.envSubtitle' })}</span></div>
      <div className="rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
        {envVars.map((v) => (
          <div key={v.id} className="flex items-center gap-2 px-4 py-2.5">
            <span className="font-mono text-sm text-title w-44 shrink-0 truncate">{v.key}</span>
            <input value={v.secret && !reveal[v.id] ? '••••••••••' : v.value} readOnly={v.secret && !reveal[v.id]} onChange={(e) => { saveEnvVar({ ...v, value: e.target.value }); }} className={`flex-1 min-w-0 font-mono ${fieldCls}`} />
            {v.secret && <IconButton icon="eye" title={reveal[v.id] ? translate({ key: 'workspaces.workspaceSettings.hide' }) : translate({ key: 'workspaces.workspaceSettings.reveal' })} onClick={() => { setReveal((s) => ({ ...s, [v.id]: !s[v.id] })); }} />}
            <button type="button" onClick={() => { removeEnvVar(v.id); }} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>
          </div>
        ))}
        {envVars.length === 0 && <div className="px-4 py-4 text-sm text-muted text-center">{translate({ key: 'workspaces.workspaceSettings.noEnvVars' })}</div>}
      </div>
      <div className="rounded-xl border border-container1-border bg-container2/40 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input value={newKey} onChange={(e) => { setNewKey(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.keyPlaceholder' })} className={`w-44 font-mono ${fieldCls}`} />
          <input value={newVal} onChange={(e) => { setNewVal(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.valuePlaceholder' })} className={`flex-1 min-w-0 font-mono ${fieldCls}`} />
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
  const { envVars } = useWorkspaces();
  const [typeKey, setTypeKey] = useState(tool?.type ?? INTEGRATION_TYPES[0].key);
  const [name, setName] = useState(tool?.name ?? '');
  const [fields, setFields] = useState<IntegrationField[]>(tool?.fields ?? INTEGRATION_TYPES[0].fields.map((f, i) => ({ id: `imf-${String(i)}`, label: f.label, placeholder: f.placeholder, envVarId: null })));
  const [mcpEnabled, setMcpEnabled] = useState(tool?.mcp.enabled ?? true);
  const [mcpCmd, setMcpCmd] = useState(tool?.mcp.command ?? INTEGRATION_TYPES[0].mcp);

  const applyType = (key: string) => {
    setTypeKey(key);
    const t = INTEGRATION_TYPES.find((x) => x.key === key);
    if (!t) return;
    if (!name.trim()) setName(t.label);
    setFields(t.fields.map((f, i) => ({ id: `imf-${String(Date.now())}-${String(i)}`, label: f.label, placeholder: f.placeholder, envVarId: null })));
    setMcpCmd(t.mcp);
  };

  const envItems = [{ id: '__none__', value: '__none__', item: '— none —' }, ...envVars.map((v) => ({ id: v.id, value: v.id, item: v.key }))];
  const typeItems = INTEGRATION_TYPES.map((t) => ({ id: t.key, value: t.key, item: t.label }));
  const submit = () => { const n = name.trim(); if (!n) return; onSave({ id: tool?.id ?? `tool-${String(Date.now())}`, name: n, type: typeKey, fields, mcp: { enabled: mcpEnabled, command: mcpCmd.trim() } }); };

  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.type' })}</div><Dropdown size="sm" value={typeItems.find((t) => t.id === typeKey)} items={typeItems} onChange={(it) => { applyType(String(it.id)); }} /></div>
        <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.name' })}</div><input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.namePlaceholder' })} className={`w-full ${fieldCls}`} /></div>
      </div>
      <div>
        <div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.configFieldsToEnvVars' })}</div>
        <div className="flex flex-col gap-2">
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <span className="text-sm text-title w-40 shrink-0 truncate">{f.label}</span>
              <Dropdown size="sm" showSearch searchPlaceholder={translate({ key: 'workspaces.workspaceSettings.findEnvVarPlaceholder' })} placeholder={translate({ key: 'workspaces.workspaceSettings.selectEnvVar' })} value={envItems.find((i) => i.id === (f.envVarId ?? '__none__'))} items={envItems} onChange={(it) => { const id = String(it.id); setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, envVarId: id === '__none__' ? null : id } : x))); }} />
            </div>
          ))}
          {fields.length === 0 && <span className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.pickTypeHint' })}</span>}
        </div>
      </div>
      <Toggle on={mcpEnabled} onChange={setMcpEnabled} label={translate({ key: 'workspaces.workspaceSettings.exposeViaMcp' })} />
      {mcpEnabled && <div><div className="text-xs text-muted mb-1">{translate({ key: 'workspaces.workspaceSettings.mcpServerCommand' })}</div><input value={mcpCmd} onChange={(e) => { setMcpCmd(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.mcpCommandPlaceholder' })} className={`w-full font-mono ${fieldCls}`} /></div>}
      <div className="flex items-center gap-2">
        <WsButton icon="check" onClick={submit}>{translate({ key: 'workspaces.workspaceSettings.saveIntegration' })}</WsButton>
        <WsButton variant="ghost" onClick={onCancel}>{translate({ key: 'workspaces.workspaceSettings.cancel' })}</WsButton>
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const translate = useTranslator();
  const { integrationTools, saveIntegrationTool, removeIntegrationTool, envVars } = useWorkspaces();
  const [editing, setEditing] = useState<IntegrationTool | null>(null);
  const [adding, setAdding] = useState(false);
  const envName = (id: string | null) => (id ? (envVars.find((v) => v.id === id)?.key ?? '—') : '— none —');
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div><span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.integrationTools' })}</span><span className="text-sm text-muted ml-2">{translate({ key: 'workspaces.workspaceSettings.integrationToolsSubtitle' })}</span></div>
        {!adding && !editing && <WsButton variant="secondary" icon="plus" onClick={() => { setAdding(true); }}>{translate({ key: 'workspaces.workspaceSettings.setUpIntegration' })}</WsButton>}
      </div>
      {(adding || editing) && <IntegrationToolForm tool={editing} onSave={(t) => { saveIntegrationTool(t); setAdding(false); setEditing(null); }} onCancel={() => { setAdding(false); setEditing(null); }} />}
      <div className="rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
        {integrationTools.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-9 h-9 rounded-lg bg-container2 text-muted flex items-center justify-center shrink-0"><Icon name="database" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="text-sm font-medium text-title">{t.name}</span><span className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] text-muted">{t.type}</span>{t.mcp.enabled && <span className="rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px]">{translate({ key: 'workspaces.workspaceSettings.mcpBadge' })}</span>}</div>
              <div className="text-xs text-muted truncate">{t.fields.map((f) => `${f.label}: ${envName(f.envVarId)}`).join(' · ')}</div>
            </div>
            <button type="button" onClick={() => { setEditing(t); setAdding(false); }} className="text-xs text-common hover:text-title cursor-pointer shrink-0">{translate({ key: 'workspaces.workspaceSettings.edit' })}</button>
            <button type="button" onClick={() => { removeIntegrationTool(t.id); }} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>
          </div>
        ))}
        {integrationTools.length === 0 && <div className="px-4 py-6 text-sm text-muted text-center">{translate({ key: 'workspaces.workspaceSettings.noIntegrations' })}</div>}
      </div>
    </div>
  );
}

function GitLabTab() {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.tabGitlab' })}</div>
      <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.gitlabDescription' })}</div>
      <span className="text-xs text-muted mt-1">{translate({ key: 'workspaces.workspaceSettings.baseUrl' })}</span>
      <input defaultValue={activeWorkspace.slug === 'youcomm-core' ? 'https://gitlab.youcomm.nl' : 'https://gitlab.com'}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <span className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.accessToken' })}</span>
      <div className="flex items-center gap-2">
        <input type="password" defaultValue="glpat-••••••••••••" className="flex-1 h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm font-mono text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <WsButton variant="secondary" icon="circle-check">{translate({ key: 'workspaces.workspaceSettings.verify' })}</WsButton>
      </div>
    </div>
  );
}

function DangerTab() {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-wrong/40 bg-wrong/5 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.transferOwnership' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.transferOwnershipDesc' })}</div>
        </div>
        <WsButton variant="secondary" onClick={() => void menuHandler.confirm({ title: translate({ key: 'workspaces.workspaceSettings.transferConfirmTitle' }), content: translate({ key: 'workspaces.workspaceSettings.transferConfirmContent' }), input: activeWorkspace.slug })}>{translate({ key: 'workspaces.workspaceSettings.transfer' })}</WsButton>
      </div>
      <div className="h-px bg-wrong/20" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.deleteWorkspace' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.deleteWorkspaceDesc' })}</div>
        </div>
        <WsButton variant="danger" onClick={() => void menuHandler.confirm({ title: translate({ key: 'workspaces.workspaceSettings.deleteConfirmTitle', params: [{ key: 'name', value: activeWorkspace.name }] }), content: translate({ key: 'workspaces.workspaceSettings.deleteConfirmContent' }), input: activeWorkspace.slug })}>{translate({ key: 'workspaces.workspaceSettings.delete' })}</WsButton>
      </div>
    </div>
  );
}

export default function WorkspaceSettings() {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  const [tab, setTab] = useState('members');
  const tabs: TabDef[] = [
    { id: 'members', label: translate({ key: 'workspaces.workspaceSettings.tabMembers' }), icon: 'users' },
    { id: 'permissions', label: translate({ key: 'workspaces.workspaceSettings.tabPermissions' }), icon: 'circle-check' },
    { id: 'env', label: translate({ key: 'workspaces.workspaceSettings.tabEnv' }), icon: 'sliders' },
    { id: 'integrations', label: translate({ key: 'workspaces.workspaceSettings.tabIntegrations' }), icon: 'database' },
    { id: 'invites', label: translate({ key: 'workspaces.workspaceSettings.tabInvites' }), icon: 'plus' },
    { id: 'gitlab', label: translate({ key: 'workspaces.workspaceSettings.tabGitlab' }), icon: 'diagram-project' },
    { id: 'danger', label: translate({ key: 'workspaces.workspaceSettings.tabDanger' }), icon: 'triangle-exclamation' },
  ];
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{activeWorkspace.name}</h1>
        <span className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.workspaceSettings' })}</span>
      </div>
      <div className="px-4 md:px-6">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        {tab === 'members' && <MembersTab />}
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'env' && <EnvTab />}
        {tab === 'integrations' && <IntegrationsTab />}
        {tab === 'invites' && <InvitesTab />}
        {tab === 'gitlab' && <GitLabTab />}
        {tab === 'danger' && <DangerTab />}
      </div>
    </div>
  );
}
