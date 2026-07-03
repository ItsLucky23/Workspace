//? Workspaces — workspace settings. Members + per-member role (searchable
//? dropdown), the editable RBAC permissions matrix, pending invites, GitLab
//? integration, and the danger zone (transfer / delete, type-to-confirm). The
//? RBAC matrix + member roles live in app context so edits survive tab/route
//? changes. Dummy data; desktop-first.

import { Suspense, lazy, useEffect, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import { loadThemeId } from 'src/_components/editor/editorThemes';

//? Lazy so Monaco (multi-MB) never lands in the workspace-settings route chunk — it loads
//? only when the Dockerfile review card actually mounts.
const LazyMonaco = lazy(() => import('src/_components/editor/MonacoEditor').then((m) => ({ default: m.MonacoEditor })));

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/dropdown/Dropdown';

import Icon from '../_components/Icon';
import { AvatarBubble, IconButton, PopMenu, Tabs, Toggle, WsButton, type PopMenuItem, type TabDef } from '../_components/primitives';
import { INTEGRATION_TYPES, RBAC_CAPABILITIES, ROLE_DISPLAY } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { BranchStrategyKind, EnvVar, GitConfig, IntegrationField, IntegrationTool, Member, PushPolicy } from '../_data/types';

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

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
            {isOwner ? <span className="w-7" /> : <PopMenu items={removeMenu(m, translate, () => { removeMember(m.id); })} />}
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
  const { invites, permRoles, inviteMember, revokeInvite } = useWorkspaces();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState('');
  //? Ownership only changes via the danger zone — invites offer non-Owner roles only.
  const roleItems = permRoles.filter((r) => !r.locked).map((r) => ({ id: r.key, value: r.key, item: r.name }));

  const cancel = () => { setInviting(false); setEmail(''); setRoleKey(''); };
  const submit = () => {
    const trimmed = email.trim();
    if (!trimmed || !roleKey) return;
    inviteMember(trimmed, roleKey);
    cancel();
  };

  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.pendingInvites' })}</span>
        {!inviting && <WsButton icon="plus" onClick={() => { setInviting(true); }}>{translate({ key: 'workspaces.workspaceSettings.inviteMembers' })}</WsButton>}
      </div>
      {inviting && (
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
      )}
      <div className="rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
        {invites.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-9 h-9 rounded-full bg-container2 text-muted flex items-center justify-center"><Icon name="plus" /></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-title truncate">{i.email}</div>
              <div className="text-xs text-muted">{ROLE_DISPLAY[i.role]} · {translate({ key: 'workspaces.workspaceSettings.sentAt', params: [{ key: 'when', value: i.sent }] })}</div>
            </div>
            <button type="button" onClick={() => { revokeInvite(i.id); }} className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.workspaceSettings.revoke' })}</button>
          </div>
        ))}
        {invites.length === 0 && <div className="px-4 py-6 text-sm text-muted text-center">{translate({ key: 'workspaces.workspaceSettings.noPendingInvites' })}</div>}
      </div>
    </div>
  );
}

//? Local edit buffer, committed on blur/Enter (not on every keystroke) so
//? typing a new value doesn't fire a save round-trip per character.
function EnvRow({ v, reveal, onToggleReveal, onCommit, onRemove }: {
  v: EnvVar; reveal: boolean; onToggleReveal: () => void; onCommit: (value: string) => void; onRemove: () => void;
}) {
  const translate = useTranslator();
  const [val, setVal] = useState(v.value);
  useEffect(() => { setVal(v.value); }, [v.value]);
  const commit = () => { if (val !== v.value) onCommit(val); };
  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <span className="font-mono text-sm text-title w-44 shrink-0 truncate">{v.key}</span>
      <input
        value={v.secret && !reveal ? '••••••••••' : val}
        readOnly={v.secret && !reveal}
        onChange={(e) => { setVal(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }}
        className={`flex-1 min-w-0 font-mono ${fieldCls}`}
      />
      {v.secret && <IconButton icon="eye" title={reveal ? translate({ key: 'workspaces.workspaceSettings.hide' }) : translate({ key: 'workspaces.workspaceSettings.reveal' })} onClick={onToggleReveal} />}
      <button type="button" onClick={onRemove} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>
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
          <EnvRow
            key={v.id} v={v} reveal={!!reveal[v.id]}
            onToggleReveal={() => { setReveal((s) => ({ ...s, [v.id]: !s[v.id] })); }}
            onCommit={(value) => { saveEnvVar({ ...v, value }); }}
            onRemove={() => { removeEnvVar(v.id); }}
          />
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
  const [typeKey, setTypeKey] = useState(tool?.type ?? INTEGRATION_TYPES[0]?.key ?? '');
  const [name, setName] = useState(tool?.name ?? '');
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
  const { activeWorkspace, saveGitlab } = useWorkspaces();
  const [forge, setForge] = useState<'gitlab' | 'github'>(activeWorkspace.forgeType === 'github' ? 'github' : 'gitlab');
  const [baseUrl, setBaseUrl] = useState(() => (activeWorkspace.slug === 'youcomm-core' ? 'https://gitlab.youcomm.nl' : 'https://gitlab.com'));
  //? Never pre-filled from the (write-only, encrypted) stored token — an empty
  //? value tells `saveGitlab` to keep the existing token unchanged.
  const [token, setToken] = useState('');
  const forgeItems = [
    { id: 'gitlab', value: 'gitlab', item: translate({ key: 'workspaces.workspaceSettings.forgeGitlab' }) },
    { id: 'github', value: 'github', item: translate({ key: 'workspaces.workspaceSettings.forgeGithub' }) },
  ];
  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.tabGitlab' })}</div>
      <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.gitlabDescription' })}</div>
      <span className="text-xs text-muted mt-1">{translate({ key: 'workspaces.workspaceSettings.forgeProvider' })}</span>
      <Dropdown size="sm" items={forgeItems} value={forgeItems.find((i) => i.id === forge)} onChange={(it) => { setForge(it.id === 'github' ? 'github' : 'gitlab'); if (it.id === 'github') setBaseUrl('https://api.github.com'); }} />
      <span className="text-xs text-muted mt-1">{translate({ key: 'workspaces.workspaceSettings.baseUrl' })}</span>
      <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); }}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <span className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.accessToken' })}</span>
      <div className="flex items-center gap-2">
        <input type="password" value={token} onChange={(e) => { setToken(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.tokenPlaceholder' })}
          className="flex-1 h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm font-mono text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <WsButton variant="secondary" icon="circle-check" onClick={() => { /* Fase 2: live GitLab token verification round-trip via the orchestrator */ }}>{translate({ key: 'workspaces.workspaceSettings.verify' })}</WsButton>
      </div>
      <div>
        <WsButton icon="check" onClick={() => { saveGitlab(baseUrl, token, forge); setToken(''); }}>{translate({ key: 'workspaces.workspaceSettings.save' })}</WsButton>
      </div>
    </div>
  );
}

//? Workflow tab (hosting-proxy plan) — the STRUCTURED git config (branch strategy → branch
//? name + preview host, push policy) plus the starter-guidance toggles (curated conventions
//? the AI follows in every stage). The freeform half (write-your-own) lives on the Sources page.
function WorkflowTab() {
  const translate = useTranslator();
  const { gitConfig, saveGitConfig, docs, toggleSkill } = useWorkspaces();
  const [cfg, setCfg] = useState<GitConfig>(gitConfig);
  const patch = (p: Partial<GitConfig>) => { setCfg((c) => ({ ...c, ...p })); };
  const starter = docs.filter((d) => d.note === 'starter');
  const inputCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

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
      <div className="rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.workflowTitle' })}</div>
        <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.workflowDescription' })}</div>

        <span className="text-xs text-muted mt-1">{translate({ key: 'workspaces.workspaceSettings.branchStrategy' })}</span>
        <Dropdown size="sm" value={strategyItems.find((i) => i.id === cfg.branchStrategy)} items={strategyItems} onChange={(it) => { const v = String(it.id); if (v === 'ticket-prefix' || v === 'typed' || v === 'custom') patch({ branchStrategy: v satisfies BranchStrategyKind }); }} />

        {cfg.branchStrategy !== 'ticket-prefix' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.defaultBranchType' })}</span>
            <input value={cfg.defaultBranchType} onChange={(e) => { patch({ defaultBranchType: e.target.value }); }} className={inputCls} />
          </div>
        )}
        {cfg.branchStrategy === 'custom' && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.branchTemplate' })}</span>
            <input value={cfg.branchTemplate} onChange={(e) => { patch({ branchTemplate: e.target.value }); }} className={`${inputCls} font-mono`} />
          </div>
        )}
        <div className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.previewBranch' })}: <span className="font-mono text-title">{exampleBranch}</span></div>

        <span className="text-xs text-muted mt-2">{translate({ key: 'workspaces.workspaceSettings.pushPolicy' })}</span>
        <Dropdown size="sm" value={pushItems.find((i) => i.id === cfg.pushPolicy)} items={pushItems} onChange={(it) => { const v = String(it.id); if (v === 'local-only' || v === 'push' || v === 'merge-request') patch({ pushPolicy: v satisfies PushPolicy }); }} />

        <span className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.targetBranch' })}</span>
        <input value={cfg.targetBranch} onChange={(e) => { patch({ targetBranch: e.target.value }); }} className={inputCls} />

        <span className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.protectedBranches' })}</span>
        <input value={cfg.protectedBranches.join(', ')} onChange={(e) => { patch({ protectedBranches: e.target.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0) }); }} className={inputCls} />

        <label className="flex items-center gap-2 mt-1 cursor-pointer"><Toggle on={cfg.commitSigning} onChange={() => { patch({ commitSigning: !cfg.commitSigning }); }} /><span className="text-sm text-title">{translate({ key: 'workspaces.workspaceSettings.commitSigning' })}</span></label>

        <div className="mt-1"><WsButton icon="check" onClick={() => { saveGitConfig(cfg); }}>{translate({ key: 'workspaces.workspaceSettings.save' })}</WsButton></div>
      </div>

      <div className="rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
        <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.starterTitle' })}</div>
        <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.starterDescription' })}</div>
        <div className="flex flex-col gap-2">
          {starter.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg border border-container1-border bg-container2/40 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-title truncate">{d.name}</div>
                <div className="text-xs text-muted truncate">{d.summary}</div>
              </div>
              <Toggle on={d.aiEditable} onChange={() => { toggleSkill(d.id, !d.aiEditable); }} />
            </div>
          ))}
        </div>
      </div>
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
function DevCommandCard({ workspaceId }: { workspaceId: string }) {
  const translate = useTranslator();
  const [cmd, setCmd] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const save = async (): Promise<void> => {
    setSaving(true); setStatus(null);
    const [err, res] = await tryCatch(() => apiRequest({ name: 'workspaces/saveDevCommand', version: 'v1', data: { workspaceId, devCommand: cmd } }));
    setSaving(false);
    if (err || res?.status !== 'success') { setStatus({ kind: 'err', text: translate({ key: 'workspaces.workspaceSettings.devCommandError' }) }); return; }
    setStatus({ kind: 'ok', text: translate({ key: 'workspaces.workspaceSettings.devCommandSaved' }) });
  };
  return (
    <div className="w-full rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.devCommandTitle' })}</div>
      <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.devCommandDescription' })}</div>
      {status !== null && (
        <div className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${status.kind === 'ok' ? 'border-correct-border bg-correct/10 text-common' : 'border-wrong-border bg-wrong/10 text-wrong'}`}>
          <Icon name={status.kind === 'ok' ? 'circle-check' : 'triangle-exclamation'} className={status.kind === 'ok' ? 'text-correct' : ''} /><span>{status.text}</span>
        </div>
      )}
      <input value={cmd} onChange={(e) => { setCmd(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.devCommandPlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm font-mono text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <div><WsButton icon="check" disabled={saving} onClick={() => { void save(); }}>{translate({ key: saving ? 'workspaces.workspaceSettings.devCommandSaving' : 'workspaces.workspaceSettings.devCommandSave' })}</WsButton></div>
    </div>
  );
}

function DockerfileReview({ workspaceId }: { workspaceId: string }) {
  const translate = useTranslator();
  const [draft, setDraft] = useState('');
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

  //? Load the persisted draft on mount so edits survive a reload without a fresh AI turn.
  //? The component is keyed by workspace, so `workspaceId` never changes during a mount —
  //? no cancel guard is needed (the effect runs once per mounted workspace).
  useEffect(() => {
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/getDockerfile', version: 'v1', data: { workspaceId } }));
      if (!error && res?.status === 'success' && res.result.ok) setDraft(res.result.dockerfile);
      setLoaded(true);
    })();
  }, [workspaceId]);

  const generate = async (): Promise<void> => {
    setBusy('generate'); setStatus(null);
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/generateDockerfile', version: 'v1', data: { workspaceId } }));
    setBusy(null);
    if (error || res?.status !== 'success') { setStatus({ kind: 'err', text: errText(res?.status === 'error' ? res.errorCode : undefined) }); return; }
    if (!res.result.ok) { setStatus({ kind: 'err', text: errText(res.result.error) }); return; }
    setDraft(res.result.dockerfile);
  };

  const save = async (): Promise<void> => {
    setBusy('save'); setStatus(null);
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/saveDockerfile', version: 'v1', data: { workspaceId, dockerfile: draft } }));
    setBusy(null);
    if (error || res?.status !== 'success') { setStatus({ kind: 'err', text: errText(res?.status === 'error' ? res.errorCode : undefined) }); return; }
    if (!res.result.ok) { setStatus({ kind: 'err', text: errText(res.result.error) }); return; }
    setStatus({ kind: 'ok', text: translate({ key: 'workspaces.workspaceSettings.dockerfileSaved' }) });
  };

  const build = async (): Promise<void> => {
    setBusy('build'); setStatus(null);
    //? Save the on-screen edits first so the build reads exactly what the user sees.
    const [saveErr, saveRes] = await tryCatch(() => apiRequest({ name: 'workspaces/saveDockerfile', version: 'v1', data: { workspaceId, dockerfile: draft } }));
    if (saveErr || saveRes?.status !== 'success' || !saveRes.result.ok) {
      setBusy(null);
      const code = saveErr || saveRes?.status !== 'success' ? (saveRes?.status === 'error' ? saveRes.errorCode : undefined) : saveRes.result.error;
      setStatus({ kind: 'err', text: errText(code) });
      return;
    }
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/buildProjectImage', version: 'v1', data: { workspaceId } }));
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
      {status !== null && (
        <div className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${status.kind === 'ok' ? 'border-correct-border bg-correct/10 text-common' : 'border-wrong-border bg-wrong/10 text-wrong'}`}>
          <Icon name={status.kind === 'ok' ? 'circle-check' : 'triangle-exclamation'} className={status.kind === 'ok' ? 'text-correct' : ''} />
          <span>{status.text}</span>
        </div>
      )}
      <div className="w-full h-72 rounded-lg border border-container1-border overflow-hidden">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.dockerfileEmptyHint' })}</div>}>
          <LazyMonaco value={draft} language="dockerfile" theme={editorTheme} onChange={setDraft} />
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
  const { repo, linkRepo, activeWorkspace } = useWorkspaces();
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
  return (
    <>
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.tabRepository' })}</div>
      <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.repoDescription' })}</div>
      {repo.linked && (
        <div className="rounded-lg border border-correct-border bg-correct/10 px-3 py-2 text-sm text-common flex items-center gap-2">
          <Icon name="circle-check" className="text-correct" />
          <span>{translate({ key: 'workspaces.workspaceSettings.repoLinked', params: [{ key: 'branch', value: repo.branch ?? '—' }, { key: 'head', value: repo.head ?? '—' }] })}</span>
        </div>
      )}
      {repo.error !== undefined && (
        <div className="rounded-lg border border-wrong-border bg-wrong/10 px-3 py-2 text-sm text-wrong flex items-center gap-2">
          <Icon name="triangle-exclamation" /> <span>{repo.error}</span>
        </div>
      )}
      <span className="text-xs text-muted mt-1">{translate({ key: 'workspaces.workspaceSettings.repoUrl' })}</span>
      <input value={gitUrl} onChange={(e) => { setGitUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.repoUrlPlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <span className="text-xs text-muted">{translate({ key: 'workspaces.workspaceSettings.accessToken' })}</span>
      <input type="password" value={token} onChange={(e) => { setToken(e.target.value); }} placeholder={translate({ key: 'workspaces.workspaceSettings.tokenPlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm font-mono text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <div>
        <WsButton icon={linking ? 'spinner' : 'link'} disabled={linking} onClick={submit}>
          {translate({ key: linking ? 'workspaces.workspaceSettings.repoLinking' : (repo.linked ? 'workspaces.workspaceSettings.repoRelink' : 'workspaces.workspaceSettings.repoLinkBtn') })}
        </WsButton>
      </div>
    </div>
    {repo.linked && <div className="max-w-2xl mx-auto w-full mt-4"><DockerfileReview key={activeWorkspace.id} workspaceId={activeWorkspace.id} /></div>}
    {repo.linked && <div className="max-w-2xl mx-auto w-full mt-4"><DevCommandCard key={`dc-${activeWorkspace.id}`} workspaceId={activeWorkspace.id} /></div>}
    </>
  );
}

function DangerTab() {
  const translate = useTranslator();
  const { activeWorkspace, members, transferOwnership, deleteWorkspace } = useWorkspaces();
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

  const startDelete = () => {
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.workspaceSettings.deleteConfirmTitle', params: [{ key: 'name', value: activeWorkspace.name }] }),
      content: translate({ key: 'workspaces.workspaceSettings.deleteConfirmContent' }),
      input: activeWorkspace.slug,
    }).then((ok) => { if (ok) deleteWorkspace(); });
  };

  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-wrong/40 bg-wrong/5 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.transferOwnership' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.transferOwnershipDesc' })}</div>
        </div>
        <div className="flex items-center gap-2">
          <Dropdown
            size="sm" showSearch searchPlaceholder={translate({ key: 'workspaces.workspaceSettings.findMemberPlaceholder' })}
            value={memberItems.find((m) => m.id === transferTarget)} placeholder={translate({ key: 'workspaces.workspaceSettings.transferToPlaceholder' })}
            items={memberItems}
            onChange={(it) => { setTransferTarget(String(it.id)); }}
          />
          <WsButton variant="secondary" onClick={startTransfer}>{translate({ key: 'workspaces.workspaceSettings.transfer' })}</WsButton>
        </div>
      </div>
      <div className="h-px bg-wrong/20" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">{translate({ key: 'workspaces.workspaceSettings.deleteWorkspace' })}</div>
          <div className="text-sm text-muted">{translate({ key: 'workspaces.workspaceSettings.deleteWorkspaceDesc' })}</div>
        </div>
        <WsButton variant="danger" onClick={startDelete}>{translate({ key: 'workspaces.workspaceSettings.delete' })}</WsButton>
      </div>
    </div>
  );
}

export const template = 'workspaces';

export default function WorkspaceSettings() {
  const translate = useTranslator();
  const { activeWorkspace, renameWorkspace } = useWorkspaces();
  const [tab, setTab] = useState('members');
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(activeWorkspace.name);
  const tabs: TabDef[] = [
    { id: 'members', label: translate({ key: 'workspaces.workspaceSettings.tabMembers' }), icon: 'users' },
    { id: 'permissions', label: translate({ key: 'workspaces.workspaceSettings.tabPermissions' }), icon: 'circle-check' },
    { id: 'env', label: translate({ key: 'workspaces.workspaceSettings.tabEnv' }), icon: 'sliders' },
    { id: 'integrations', label: translate({ key: 'workspaces.workspaceSettings.tabIntegrations' }), icon: 'database' },
    { id: 'invites', label: translate({ key: 'workspaces.workspaceSettings.tabInvites' }), icon: 'plus' },
    { id: 'repository', label: translate({ key: 'workspaces.workspaceSettings.tabRepository' }), icon: 'code-branch' },
    { id: 'gitlab', label: translate({ key: 'workspaces.workspaceSettings.tabGitlab' }), icon: 'diagram-project' },
    { id: 'workflow', label: translate({ key: 'workspaces.workspaceSettings.tabWorkflow' }), icon: 'code-merge' },
    { id: 'danger', label: translate({ key: 'workspaces.workspaceSettings.tabDanger' }), icon: 'triangle-exclamation' },
  ];

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
        {tab === 'repository' && <RepositoryTab />}
        {tab === 'gitlab' && <GitLabTab key={activeWorkspace.id} />}
        {tab === 'workflow' && <WorkflowTab key={activeWorkspace.id} />}
        {tab === 'danger' && <DangerTab />}
      </div>
    </div>
  );
}
