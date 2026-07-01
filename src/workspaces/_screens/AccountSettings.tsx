//? Workspaces — Account settings. Profile, connections, SSH keys, sessions,
//? web-push, data export. SSH keys live on the account (ctx) and are what
//? unlock + drive the terminals — there is NO app-load login. The pasted value
//? (or a dropped ~/.ssh/config containing it) maps to an SSH identity:
//? 123 → test, 456 → mathijs. Dummy data; desktop-first.

import { useMemo, useRef, useState } from 'react';

import { i18nNotify as notify, useSession, useTranslator, useUpdateLanguage } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import { apiRequest } from 'src/_sockets/apiRequest';

import Icon from '../_components/Icon';
import { AvatarBubble, Segmented, Toggle, WsButton } from '../_components/primitives';
import { SESSIONS, SSH_KEY_TO_USER } from '../_data/seed';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import type { SshKeyEntry } from '../_data/types';
import type { SessionLayout } from '../../../config';

//? An example file path shown in the SSH drop-zone — code, not translatable copy.
const SSH_CONFIG_PATH = '~/.ssh/config';

//? Selectable UI languages — one code per `src/_locales/*.json` locale file, each
//? with a `settings.language.<code>` label. Mirrors `src/settings/page.tsx`.
const LANGUAGES = ['nl', 'en', 'de', 'fr'] as const;
type Language = typeof LANGUAGES[number];

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
  const translate = useTranslator();
  const { membersById } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = (raw: string, keyName: string) => {
    const userId = resolveUser(raw);
    if (!userId) { setError(translate({ key: 'workspaces.account.keyNotFound' })); return; }
    onAdd({ id: `k-${raw.trim()}-${userId}`, name: keyName || translate({ key: 'workspaces.account.defaultKeyName', params: [{ key: 'name', value: membersById[userId]?.name ?? userId }] }), type: 'ed25519', fingerprint: `SHA256:${raw.trim().slice(0, 6)}…`, added: 'just now', lastUsed: '—', userId });
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

  if (!open) return <WsButton variant="secondary" icon="plus" onClick={() => { setOpen(true); }}>{translate({ key: 'workspaces.account.addSshKey' })}</WsButton>;
  return (
    <div className="rounded-xl border border-container1-border bg-container2/40 p-4 flex flex-col gap-3 mt-2">
      <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.account.keyNamePlaceholder' })}
        className="h-9 px-3 rounded-lg border border-container1-border bg-container1 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <textarea value={value} onChange={(e) => { setValue(e.target.value); }} placeholder={translate({ key: 'workspaces.account.publicKeyPlaceholder' })} rows={2}
        className="px-3 py-2 rounded-lg border border-container1-border bg-container1 text-sm font-mono text-title resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30" />
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => { setDragOver(false); }}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        className={`rounded-lg border border-dashed p-3 text-center text-xs cursor-pointer transition-colors ${dragOver ? 'border-primary bg-primary/5 text-primary' : 'border-container2-border text-muted hover:bg-container2/60'}`}
      >
        {translate({ key: 'workspaces.account.dropConfigPre' })} <span className="font-mono">{SSH_CONFIG_PATH}</span> {translate({ key: 'workspaces.account.dropConfigPost' })}
        <input ref={fileInput} type="file" className="hidden" onChange={onPick} />
      </div>
      {error && <div className="text-sm text-wrong inline-flex items-center gap-1.5"><Icon name="triangle-exclamation" /> {error}</div>}
      <div className="flex items-center gap-2">
        <WsButton icon="check" onClick={() => { submit(value, name); }}>{translate({ key: 'workspaces.account.verifyAndAdd' })}</WsButton>
        <WsButton variant="ghost" onClick={() => { setOpen(false); setError(''); }}>{translate({ key: 'workspaces.account.cancel' })}</WsButton>
      </div>
    </div>
  );
}

export default function AccountSettings() {
  const translate = useTranslator();
  const { currentUser, theme, setTheme, sshKeys, sshUserId, addSshKey, removeSshKey, membersById } = useWorkspaces();
  const { session } = useSession<SessionLayout>();
  const setLanguage = useUpdateLanguage();
  const [push, setPush] = useState(false);
  const [language, setSelectedLanguage] = useState<Language>(session?.language ?? 'en');
  const sshUser = sshUserId ? membersById[sshUserId] : null;

  //? Theme + language autosave: apply the change instantly (DOM class / active
  //? locale) and persist it to the account via the framework's `settings/updateUser`
  //? route — no save button. `TemplateProvider` + the language source keep both in
  //? sync from the session on reload, so a persisted choice survives.
  const persist = async (data: { theme?: SessionLayout['theme']; language?: Language }) => {
    const response = await apiRequest({ name: 'settings/updateUser', version: 'v1', data });
    if (response.status !== 'success') notify.error({ key: 'settings.failedUpdateUser' });
  };

  const languageItems: DropdownItem[] = useMemo(
    () => LANGUAGES.map((code) => ({ id: code, value: code, item: translate({ key: `settings.language.${code}` }) })),
    [translate],
  );
  const selectedLanguage = languageItems.find((it) => it.id === language);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-6 py-3 md:py-4">
        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'workspaces.account.heading' })}</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pb-8">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
          <Card title={translate({ key: 'workspaces.account.profile' })}>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16"><AvatarBubble user={currentUser} size={64} /></div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-title">{currentUser.name}</div>
                <div className="text-sm text-muted">{currentUser.email}</div>
              </div>
              <WsButton variant="secondary">{translate({ key: 'workspaces.account.edit' })}</WsButton>
            </div>
            <div className="mt-4 flex flex-col gap-1">
              <Row>
                <span className="text-sm text-common">{translate({ key: 'workspaces.account.theme' })}</span>
                <Segmented value={theme} onChange={(next) => { setTheme(next); void persist({ theme: next }); }} options={[{ id: 'light', label: <><Icon name="sun" /> {translate({ key: 'workspaces.account.light' })}</> }, { id: 'dark', label: <><Icon name="moon" /> {translate({ key: 'workspaces.account.dark' })}</> }]} />
              </Row>
              <Row>
                <span className="text-sm text-common">{translate({ key: 'workspaces.account.language' })}</span>
                <Dropdown size="sm" items={languageItems} value={selectedLanguage} onChange={(it) => { const code = LANGUAGES.find((l) => l === it.value); if (!code) return; setSelectedLanguage(code); setLanguage(code); void persist({ language: code }); }} />
              </Row>
            </div>
          </Card>

          <Card title={translate({ key: 'workspaces.account.connectionsTitle' })} desc={translate({ key: 'workspaces.account.connectionsDesc' })}>
            <Row>
              <span className="flex items-center gap-2 text-sm text-title"><Icon name="diagram-project" className="text-muted" /> {translate({ key: 'workspaces.account.gitlab' })}</span>
              <span className="inline-flex items-center gap-1 text-xs text-correct"><Icon name="circle-check" /> {translate({ key: 'workspaces.account.connected' })}</span>
            </Row>
            <Row>
              <span className="flex items-center gap-2 text-sm text-title"><Icon name="diagram-project" className="text-muted" /> {translate({ key: 'workspaces.account.github' })}</span>
              <WsButton variant="secondary">{translate({ key: 'workspaces.account.connect' })}</WsButton>
            </Row>
          </Card>

          <Card
            title={translate({ key: 'workspaces.account.sshKeysTitle' })}
            desc={translate({ key: 'workspaces.account.sshKeysDesc' })}
            right={sshUser
              ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-correct/15 text-correct px-2 h-7 text-xs font-medium"><Icon name="circle-check" /> {translate({ key: 'workspaces.account.terminalSshUser', params: [{ key: 'name', value: sshUser.name }] })}</span>
              : <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 text-warning px-2 h-7 text-xs font-medium"><Icon name="triangle-exclamation" /> {translate({ key: 'workspaces.account.terminalsLocked' })}</span>}
          >
            <div className="flex flex-col">
              {sshKeys.map((k) => (
                <Row key={k.id}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-title">{k.name} <span className="text-xs text-muted font-mono">· {k.type}</span> {k.userId === sshUserId && <span className="ml-1 rounded-md bg-primary/12 text-primary px-1.5 py-0.5 text-[11px]">{translate({ key: 'workspaces.account.active' })}</span>}</div>
                    <div className="text-xs text-muted font-mono truncate">{translate({ key: 'workspaces.account.keyMeta', params: [{ key: 'fingerprint', value: k.fingerprint }, { key: 'added', value: k.added }, { key: 'name', value: membersById[k.userId]?.name ?? k.userId }] })}</div>
                  </div>
                  <button type="button" onClick={() => { removeSshKey(k.id); }} className="text-xs text-wrong hover:underline cursor-pointer shrink-0">{translate({ key: 'workspaces.account.remove' })}</button>
                </Row>
              ))}
              {sshKeys.length === 0 && <div className="text-sm text-muted py-3">{translate({ key: 'workspaces.account.noKeysLinked' })}</div>}
            </div>
            <div className="mt-3"><AddKeyForm onAdd={addSshKey} /></div>
          </Card>

          <Card title={translate({ key: 'workspaces.account.sessionsTitle' })} desc={translate({ key: 'workspaces.account.sessionsDesc' })} right={<button type="button" onClick={() => void menuHandler.confirm({ title: translate({ key: 'workspaces.account.revokeAllTitle' }), content: translate({ key: 'workspaces.account.revokeAllContent' }) })} className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.account.revokeAllOthers' })}</button>}>
            <div className="flex flex-col">
              {SESSIONS.map((s) => (
                <Row key={s.id}>
                  <div>
                    <div className="text-sm font-medium text-title">{s.device} {s.current && <span className="ml-1 rounded-md bg-correct/15 text-correct px-1.5 py-0.5 text-[11px]">{translate({ key: 'workspaces.account.thisDevice' })}</span>}</div>
                    <div className="text-xs text-muted">{s.location} · {s.lastActive}</div>
                  </div>
                  {!s.current && <button type="button" className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.account.revoke' })}</button>}
                </Row>
              ))}
            </div>
          </Card>

          <Card title={translate({ key: 'workspaces.account.notificationsTitle' })} desc={translate({ key: 'workspaces.account.notificationsDesc' })}>
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.webPush' })}</span>
              <Toggle on={push} onChange={setPush} label={push ? translate({ key: 'workspaces.account.enabled' }) : translate({ key: 'workspaces.account.off' })} />
            </Row>
          </Card>

          <Card title={translate({ key: 'workspaces.account.yourDataTitle' })}>
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.downloadData' })}</span>
              <WsButton variant="secondary" icon="up-right-from-square">{translate({ key: 'workspaces.account.export' })}</WsButton>
            </Row>
          </Card>
        </div>
      </div>
    </div>
  );
}
