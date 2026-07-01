//? Workspaces — Account settings. Profile, connections, SSH keys, sessions,
//? web-push, data export. SSH keys live on the account (ctx) and are what
//? unlock + drive the terminals — there is NO app-load login. The pasted value
//? (or a dropped ~/.ssh/config containing it) maps to an SSH identity:
//? 123 → test, 456 → mathijs. Dummy data; desktop-first.

import { useRef, useState } from 'react';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import { AvatarBubble, Segmented, Toggle, WsButton } from '../_components/primitives';
import { MEMBERS, SESSIONS, SSH_KEY_TO_USER } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { SshKeyEntry } from '../_data/types';

function Card({ title, desc, right, children }: { title: string; desc?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-container1-border bg-container1 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-base font-semibold text-title">{title}</div>
          {desc && <div className="text-sm text-muted mt-0.5">{desc}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-3 border-b border-divider last:border-0">{children}</div>;
}

function resolveUser(text: string): string | null {
  const trimmed = text.trim();
  if (SSH_KEY_TO_USER[trimmed]) return SSH_KEY_TO_USER[trimmed];
  for (const [value, userId] of Object.entries(SSH_KEY_TO_USER)) if (text.includes(value)) return userId;
  return null;
}

function AddKeyForm({ onAdd }: { onAdd: (key: SshKeyEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = (raw: string, keyName: string) => {
    const userId = resolveUser(raw);
    if (!userId) { setError('We couldn’t find a private key for the given public key.'); return; }
    onAdd({ id: `k-${raw.trim()}-${userId}`, name: keyName || `${MEMBERS[userId]?.name ?? userId}'s key`, type: 'ed25519', fingerprint: `SHA256:${raw.trim().slice(0, 6)}…`, added: 'just now', lastUsed: '—', userId });
    setOpen(false); setName(''); setValue(''); setError('');
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void file.text().then((t) => { setValue(t); submit(t, name || file.name); });
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void file.text().then((t) => { setValue(t); submit(t, name || file.name); });
  };

  if (!open) return <WsButton variant="secondary" icon="plus" onClick={() => setOpen(true)}>Add SSH key</WsButton>;
  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3 mt-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name (e.g. MacBook Pro)"
        className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste public key (try 123 or 456)…" rows={2}
        className="px-3 py-2 rounded-lg border border-container1-border bg-container1 text-sm font-mono text-title resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        className={`rounded-lg border border-dashed p-3 text-center text-xs cursor-pointer transition-colors ${dragOver ? 'border-primary bg-primary/5 text-primary' : 'border-container2-border text-muted hover:bg-container2/60'}`}
      >
        Drag & drop your <span className="font-mono">~/.ssh/config</span> — or click to choose a file
        <input ref={fileInput} type="file" className="hidden" onChange={onPick} />
      </div>
      {error && <div className="text-sm text-wrong inline-flex items-center gap-1.5"><Icon name="triangle-exclamation" /> {error}</div>}
      <div className="flex items-center gap-2">
        <WsButton icon="check" onClick={() => submit(value, name)}>Verify & add</WsButton>
        <WsButton variant="ghost" onClick={() => { setOpen(false); setError(''); }}>Cancel</WsButton>
      </div>
    </div>
  );
}

export default function AccountSettings() {
  const { currentUser, theme, setTheme, sshKeys, sshUserId, addSshKey, removeSshKey } = useWorkspaces();
  const [push, setPush] = useState(false);
  const sshUser = sshUserId ? MEMBERS[sshUserId] : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">Account</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
          <Card title="Profile">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16"><AvatarBubble user={currentUser} size={64} /></div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-title">{currentUser.name}</div>
                <div className="text-sm text-muted">{currentUser.email}</div>
              </div>
              <WsButton variant="secondary">Edit</WsButton>
            </div>
            <div className="mt-4 flex flex-col gap-1">
              <Row>
                <span className="text-sm text-common">Theme</span>
                <Segmented value={theme} onChange={setTheme} options={[{ id: 'light', label: <><Icon name="sun" /> Light</> }, { id: 'dark', label: <><Icon name="moon" /> Dark</> }]} />
              </Row>
              <Row>
                <span className="text-sm text-common">Language</span>
                <span className="text-sm text-title">English</span>
              </Row>
            </div>
          </Card>

          <Card title="Connections" desc="OAuth identity providers linked to your account.">
            <Row>
              <span className="flex items-center gap-2 text-sm text-title"><Icon name="diagram-project" className="text-muted" /> GitLab</span>
              <span className="inline-flex items-center gap-1 text-xs text-correct"><Icon name="circle-check" /> Connected</span>
            </Row>
            <Row>
              <span className="flex items-center gap-2 text-sm text-title"><Icon name="diagram-project" className="text-muted" /> GitHub</span>
              <WsButton variant="secondary">Connect</WsButton>
            </Row>
          </Card>

          <Card
            title="SSH keys"
            desc="Required to open terminals. Your private key stays on your device; we only store the public half."
            right={sshUser
              ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-correct/15 text-correct px-2 h-7 text-xs font-medium"><Icon name="circle-check" /> Terminal SSH user: {sshUser.name}</span>
              : <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 text-warning px-2 h-7 text-xs font-medium"><Icon name="triangle-exclamation" /> Terminals locked</span>}
          >
            <div className="flex flex-col">
              {sshKeys.map((k) => (
                <Row key={k.id}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-title">{k.name} <span className="text-xs text-muted font-mono">· {k.type}</span> {k.userId === sshUserId && <span className="ml-1 rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px]">active</span>}</div>
                    <div className="text-xs text-muted font-mono truncate">{k.fingerprint} · added {k.added} · authenticates as {MEMBERS[k.userId]?.name ?? k.userId}</div>
                  </div>
                  <button type="button" onClick={() => removeSshKey(k.id)} className="text-xs text-wrong hover:underline cursor-pointer shrink-0">Remove</button>
                </Row>
              ))}
              {sshKeys.length === 0 && <div className="text-sm text-muted py-3">No keys linked — terminals are locked.</div>}
            </div>
            <div className="mt-3"><AddKeyForm onAdd={addSshKey} /></div>
          </Card>

          <Card title="Sessions" desc="Devices currently signed in." right={<button type="button" onClick={() => void menuHandler.confirm({ title: 'Revoke all other sessions?', content: 'Every device except this one will be signed out.' })} className="text-xs text-wrong hover:underline cursor-pointer">Revoke all others</button>}>
            <div className="flex flex-col">
              {SESSIONS.map((s) => (
                <Row key={s.id}>
                  <div>
                    <div className="text-sm font-medium text-title">{s.device} {s.current && <span className="ml-1 rounded-md bg-correct/15 text-correct px-1.5 py-0.5 text-[11px]">this device</span>}</div>
                    <div className="text-xs text-muted">{s.location} · {s.lastActive}</div>
                  </div>
                  {!s.current && <button type="button" className="text-xs text-wrong hover:underline cursor-pointer">Revoke</button>}
                </Row>
              ))}
            </div>
          </Card>

          <Card title="Notifications" desc="Get pinged when an AI needs your input.">
            <Row>
              <span className="text-sm text-common">Web push</span>
              <Toggle on={push} onChange={setPush} label={push ? 'Enabled' : 'Off'} />
            </Row>
          </Card>

          <Card title="Your data">
            <Row>
              <span className="text-sm text-common">Download a copy of your data</span>
              <WsButton variant="secondary" icon="up-right-from-square">Export</WsButton>
            </Row>
          </Card>
        </div>
      </div>
    </div>
  );
}
