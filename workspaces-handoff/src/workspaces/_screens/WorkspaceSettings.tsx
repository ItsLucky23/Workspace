//? Workspaces — workspace settings. Members + per-member role (searchable
//? dropdown), the editable RBAC permissions matrix, pending invites, GitLab
//? integration, and the danger zone (transfer / delete, type-to-confirm). The
//? RBAC matrix + member roles live in app context so edits survive tab/route
//? changes. Dummy data; desktop-first.

import { useState } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

import Dropdown from 'src/_components/Dropdown';

import Icon from '../_components/Icon';
import { AvatarBubble, IconButton, PopMenu, Tabs, Toggle, WsButton, type PopMenuItem, type TabDef } from '../_components/primitives';
import { INTEGRATION_TYPES, INVITES, MEMBERS, RBAC_CAPABILITIES, ROLE_DISPLAY } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { IntegrationField, IntegrationTool, Member } from '../_data/types';

const TABS: TabDef[] = [
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'permissions', label: 'Permissions', icon: 'circle-check' },
  { id: 'env', label: 'Env', icon: 'sliders' },
  { id: 'integrations', label: 'Integrations', icon: 'database' },
  { id: 'invites', label: 'Invites', icon: 'plus' },
  { id: 'gitlab', label: 'GitLab', icon: 'diagram-project' },
  { id: 'danger', label: 'Danger zone', icon: 'triangle-exclamation' },
];

const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';

function removeMenu(member: Member): PopMenuItem[] {
  return [
    { label: 'Remove from workspace', icon: 'triangle-exclamation', danger: true, onClick: () => void menuHandler.confirm({ title: `Remove ${member.name}?`, content: 'They lose access to this workspace immediately.' }) },
  ];
}

function MembersTab() {
  const { memberRoles, setMemberRole, permRoles, activeWorkspace } = useWorkspaces();
  const members = Object.values(MEMBERS);
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
              <span className="rounded-full bg-container2 px-2.5 py-1 text-[11px] font-medium text-muted">Owner</span>
            ) : (
              <Dropdown
                size="sm" showSearch searchPlaceholder="Find role…"
                value={current} placeholder="Set role"
                items={roleItems}
                onChange={(it) => setMemberRole(m.id, String(it.id))}
              />
            )}
            {isOwner ? <span className="w-7" /> : <PopMenu items={removeMenu(m)} />}
          </div>
        );
      })}
    </div>
  );
}

function PermCell({ on, locked, onToggle }: { on: boolean; locked?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" disabled={locked} onClick={onToggle} title={on ? 'Allowed' : 'Denied'}
      className={`w-8 h-6 rounded-md flex items-center justify-center transition-colors ${locked ? 'cursor-default' : 'cursor-pointer'} ${on ? 'bg-primary/15 text-primary' : 'bg-container2 text-disabled hover:bg-container2-hover'}`}
    >
      <Icon name={on ? 'check' : 'xmark'} className="text-xs" />
    </button>
  );
}

//? Editable per-workspace RBAC. The matrix + custom roles live in app context,
//? so toggles and added roles survive switching tabs / navigating away.
function PermissionsTab() {
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
          <span className="text-sm font-semibold text-title">Roles &amp; permissions</span>
          <span className="text-sm text-muted ml-2">this workspace</span>
        </div>
        {adding ? (
          <div className="flex items-center gap-2">
            <input value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="Role name…"
              className="h-8 px-2.5 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
            <WsButton onClick={submit}>Add</WsButton>
            <WsButton variant="ghost" onClick={() => { setAdding(false); setNewRole(''); }}>Cancel</WsButton>
          </div>
        ) : <WsButton variant="secondary" icon="plus" onClick={() => setAdding(true)}>Add role</WsButton>}
      </div>

      <div className="rounded-2xl border border-container1-border bg-container1 overflow-x-auto">
        <div className="grid items-center gap-x-3 px-4 h-10 border-b border-divider text-xs font-medium text-muted min-w-max" style={{ gridTemplateColumns: cols }}>
          <span>Capability</span>
          {permRoles.map((r) => <span key={r.name} className="text-center capitalize">{r.name}</span>)}
        </div>
        {RBAC_CAPABILITIES.map((action, ci) => (
          <div key={action} className="grid items-center gap-x-3 px-4 py-2 border-b border-divider last:border-0 text-sm text-common min-w-max" style={{ gridTemplateColumns: cols }}>
            <span>{action}</span>
            {permRoles.map((r, ri) => (
              <span key={r.name} className="flex justify-center">
                <PermCell on={r.perms[ci] ?? false} locked={r.locked} onToggle={() => togglePerm(ri, ci)} />
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Owner always has every permission. Changes apply to this workspace only.</p>
    </div>
  );
}

function InvitesTab() {
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-title">Pending invites</span>
        <WsButton icon="plus">Invite members</WsButton>
      </div>
      <div className="rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
        {INVITES.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-9 h-9 rounded-full bg-container2 text-muted flex items-center justify-center"><Icon name="plus" /></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-title truncate">{i.email}</div>
              <div className="text-xs text-muted">{ROLE_DISPLAY[i.role]} · sent {i.sent}</div>
            </div>
            <button type="button" className="text-xs text-wrong hover:underline cursor-pointer">Revoke</button>
          </div>
        ))}
        {INVITES.length === 0 && <div className="px-4 py-6 text-sm text-muted text-center">No pending invites</div>}
      </div>
    </div>
  );
}

function EnvTab() {
  const { envVars, saveEnvVar, removeEnvVar } = useWorkspaces();
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [newSecret, setNewSecret] = useState(true);
  const add = () => { const k = newKey.trim(); if (!k) return; saveEnvVar({ id: `env-${String(Date.now())}`, key: k, value: newVal, secret: newSecret }); setNewKey(''); setNewVal(''); setNewSecret(true); };
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div><span className="text-sm font-semibold text-title">Environment variables</span><span className="text-sm text-muted ml-2">workspace-wide · used by integrations + stage processes</span></div>
      <div className="rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
        {envVars.map((v) => (
          <div key={v.id} className="flex items-center gap-2 px-4 py-2.5">
            <span className="font-mono text-sm text-title w-44 shrink-0 truncate">{v.key}</span>
            <input value={v.secret && !reveal[v.id] ? '••••••••••' : v.value} readOnly={v.secret && !reveal[v.id]} onChange={(e) => saveEnvVar({ ...v, value: e.target.value })} className={`flex-1 min-w-0 font-mono ${fieldCls}`} />
            {v.secret && <IconButton icon="eye" title={reveal[v.id] ? 'Hide' : 'Reveal'} onClick={() => setReveal((s) => ({ ...s, [v.id]: !s[v.id] }))} />}
            <button type="button" onClick={() => removeEnvVar(v.id)} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>
          </div>
        ))}
        {envVars.length === 0 && <div className="px-4 py-4 text-sm text-muted text-center">No env vars yet.</div>}
      </div>
      <div className="rounded-xl border border-container1-border bg-container2/40 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="KEY" className={`w-44 font-mono ${fieldCls}`} />
          <input value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder="value" className={`flex-1 min-w-0 font-mono ${fieldCls}`} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Toggle on={newSecret} onChange={setNewSecret} label="Secret (masked)" />
          <WsButton icon="plus" onClick={add}>Add variable</WsButton>
        </div>
      </div>
    </div>
  );
}

function IntegrationToolForm({ tool, onSave, onCancel }: { tool: IntegrationTool | null; onSave: (t: IntegrationTool) => void; onCancel: () => void }) {
  const { envVars } = useWorkspaces();
  const [typeKey, setTypeKey] = useState(tool?.type ?? INTEGRATION_TYPES[0]!.key);
  const [name, setName] = useState(tool?.name ?? '');
  const [fields, setFields] = useState<IntegrationField[]>(tool?.fields ?? INTEGRATION_TYPES[0]!.fields.map((f, i) => ({ id: `imf-${String(i)}`, label: f.label, placeholder: f.placeholder, envVarId: null })));
  const [mcpEnabled, setMcpEnabled] = useState(tool?.mcp.enabled ?? true);
  const [mcpCmd, setMcpCmd] = useState(tool?.mcp.command ?? INTEGRATION_TYPES[0]!.mcp);

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
        <div><div className="text-xs text-muted mb-1">Type</div><Dropdown size="sm" value={typeItems.find((t) => t.id === typeKey)} items={typeItems} onChange={(it) => applyType(String(it.id))} /></div>
        <div><div className="text-xs text-muted mb-1">Name</div><input value={name} onChange={(e) => setName(e.target.value)} placeholder="MongoDB (prod)" className={`w-full ${fieldCls}`} /></div>
      </div>
      <div>
        <div className="text-xs text-muted mb-1">Config fields → env vars</div>
        <div className="flex flex-col gap-2">
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <span className="text-sm text-title w-40 shrink-0 truncate">{f.label}</span>
              <Dropdown size="sm" showSearch searchPlaceholder="Find env var…" placeholder="Select env var" value={envItems.find((i) => i.id === (f.envVarId ?? '__none__'))} items={envItems} onChange={(it) => { const id = String(it.id); setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, envVarId: id === '__none__' ? null : id } : x))); }} />
            </div>
          ))}
          {fields.length === 0 && <span className="text-sm text-muted">Pick a type to load its config fields.</span>}
        </div>
      </div>
      <Toggle on={mcpEnabled} onChange={setMcpEnabled} label="Expose to the AI via an MCP server" />
      {mcpEnabled && <div><div className="text-xs text-muted mb-1">MCP server command</div><input value={mcpCmd} onChange={(e) => setMcpCmd(e.target.value)} placeholder="node /pty-agent/mcp/…" className={`w-full font-mono ${fieldCls}`} /></div>}
      <div className="flex items-center gap-2">
        <WsButton icon="check" onClick={submit}>Save integration</WsButton>
        <WsButton variant="ghost" onClick={onCancel}>Cancel</WsButton>
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const { integrationTools, saveIntegrationTool, removeIntegrationTool, envVars } = useWorkspaces();
  const [editing, setEditing] = useState<IntegrationTool | null>(null);
  const [adding, setAdding] = useState(false);
  const envName = (id: string | null) => (id ? (envVars.find((v) => v.id === id)?.key ?? '—') : '— none —');
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div><span className="text-sm font-semibold text-title">Integration tools</span><span className="text-sm text-muted ml-2">third-party tools the AI can use</span></div>
        {!adding && !editing && <WsButton variant="secondary" icon="plus" onClick={() => setAdding(true)}>Set up integration</WsButton>}
      </div>
      {(adding || editing) && <IntegrationToolForm tool={editing} onSave={(t) => { saveIntegrationTool(t); setAdding(false); setEditing(null); }} onCancel={() => { setAdding(false); setEditing(null); }} />}
      <div className="rounded-2xl border border-container1-border bg-container1 divide-y divide-divider">
        {integrationTools.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-9 h-9 rounded-lg bg-container2 text-muted flex items-center justify-center shrink-0"><Icon name="database" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="text-sm font-medium text-title">{t.name}</span><span className="rounded-md bg-container2 px-1.5 py-0.5 text-[11px] text-muted">{t.type}</span>{t.mcp.enabled && <span className="rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px]">MCP</span>}</div>
              <div className="text-xs text-muted truncate">{t.fields.map((f) => `${f.label}: ${envName(f.envVarId)}`).join(' · ')}</div>
            </div>
            <button type="button" onClick={() => { setEditing(t); setAdding(false); }} className="text-xs text-common hover:text-title cursor-pointer shrink-0">Edit</button>
            <button type="button" onClick={() => removeIntegrationTool(t.id)} className="text-muted hover:text-wrong cursor-pointer w-7 h-7 flex items-center justify-center shrink-0"><Icon name="trash" className="text-xs" /></button>
          </div>
        ))}
        {integrationTools.length === 0 && <div className="px-4 py-6 text-sm text-muted text-center">No integrations yet — set one up to expose it to the AI.</div>}
      </div>
    </div>
  );
}

function GitLabTab() {
  const { activeWorkspace } = useWorkspaces();
  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-container1-border bg-container1 p-5 flex flex-col gap-3">
      <div className="text-base font-semibold text-title">GitLab</div>
      <div className="text-sm text-muted">GitLab is the source of truth for issues. The token is stored encrypted on the workspace.</div>
      <span className="text-xs text-muted mt-1">Base URL</span>
      <input defaultValue={activeWorkspace.slug === 'youcomm-core' ? 'https://gitlab.youcomm.nl' : 'https://gitlab.com'}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <span className="text-xs text-muted">Access token</span>
      <div className="flex items-center gap-2">
        <input type="password" defaultValue="glpat-••••••••••••" className="flex-1 h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm font-mono text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
        <WsButton variant="secondary" icon="circle-check">Verify</WsButton>
      </div>
    </div>
  );
}

function DangerTab() {
  const { activeWorkspace } = useWorkspaces();
  return (
    <div className="max-w-2xl mx-auto w-full rounded-2xl border border-wrong/40 bg-wrong/5 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">Transfer ownership</div>
          <div className="text-sm text-muted">Hand this workspace to another member.</div>
        </div>
        <WsButton variant="secondary" onClick={() => void menuHandler.confirm({ title: 'Transfer ownership?', content: 'You will become an Admin and the new owner gets full control.', input: activeWorkspace.slug })}>Transfer</WsButton>
      </div>
      <div className="h-px bg-wrong/20" />
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-title">Delete workspace</div>
          <div className="text-sm text-muted">Purges all tickets, events, RAG and tears down containers. Irreversible.</div>
        </div>
        <WsButton variant="danger" onClick={() => void menuHandler.confirm({ title: `Delete ${activeWorkspace.name}?`, content: 'This permanently deletes everything in the workspace.', input: activeWorkspace.slug })}>Delete</WsButton>
      </div>
    </div>
  );
}

export default function WorkspaceSettings() {
  const { activeWorkspace } = useWorkspaces();
  const [tab, setTab] = useState('members');
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{activeWorkspace.name}</h1>
        <span className="text-sm text-muted">Workspace settings</span>
      </div>
      <div className="px-4 md:px-6">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
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
