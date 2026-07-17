//? Workspaces — Account settings. Profile, connections, SSH keys, sessions,
//? web-push, data export. SSH keys live on the account (ctx) and are what
//? unlock + drive the terminals — there is NO app-load login. The pasted value
//? (or a dropped ~/.ssh/config containing it) maps to an SSH identity:
//? 123 → test, 456 → mathijs. Dummy data; desktop-first.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { i18nNotify as notify, tryCatch, useSession, useTranslator, useUpdateLanguage } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';
import Dropdown, { type DropdownItem } from 'src/_components/dropdown/Dropdown';
import TwoFactorSection from 'src/_components/TwoFactorSection';
import { apiRequest } from 'src/_sockets/apiRequest';

import Icon from '../_components/Icon';
import { AvatarBubble, Segmented, Toggle, WsButton } from '../_components/primitives';
import { isModuleEnabled } from '../_data/modules';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import { enablePush, disablePush, hasPushSubscription } from '../_functions/pushSubscribe';
import { canInstall, promptInstall, subscribeInstall } from '../_functions/installPrompt';
import type { SessionLayout } from '../../../config';

//? Real session shape from `settings/listSessions` (framework auth session, not
//? [control-API] tenant data) — handle/expiry only, no device/location metadata.
interface AccountSession {
  handle: string;
  expiresInSeconds: number | null;
  isCurrent: boolean;
}

//? An example file path shown in the SSH drop-zone — code, not translatable copy.
const SSH_CONFIG_PATH = '~/.ssh/config';

//? Gap-fix — read a workspace-export JSON file and recreate it as a NEW workspace (module-scope:
//? it touches no component state).
const importWorkspace = (file: File): void => {
  void (async () => {
    const [parseErr, bundle] = await tryCatch(async () => JSON.parse(await file.text()) as unknown);
    if (parseErr) { notify.error({ key: 'workspaces.account.importInvalid' }); return; }
    const [err, res] = await tryCatch(() => apiRequest({ name: 'workspaces/workspaceImport', version: 'v1', data: { bundle } }));
    if (err || res?.status !== 'success') { notify.error({ key: 'workspaces.account.importFailed' }); return; }
    notify.success({ key: 'workspaces.account.importDone' });
    globalThis.location.reload();
  })();
};

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

//? Per-project forge connect form (ADR 0036) — pick GitLab/GitHub, enter repo + token (+ optional
//? API base) for the ACTIVE project. Rendered in the menuHandler overlay from the Connections card.
function ForgeConnectForm({ projectId, onConnect }: { projectId: string; onConnect: (input: { projectId: string; mode: 'gitlab' | 'github'; baseUrl?: string; token?: string; repoPath?: string }) => void }) {
  const translate = useTranslator();
  const [mode, setMode] = useState<'gitlab' | 'github'>('github');
  const [repoPath, setRepoPath] = useState('');
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const modeItems: DropdownItem[] = [{ id: 'github', value: 'github', item: 'GitHub' }, { id: 'gitlab', value: 'gitlab', item: 'GitLab' }];
  const submit = () => {
    onConnect({ projectId, mode, ...(repoPath.trim() ? { repoPath: repoPath.trim() } : {}), ...(token.trim() ? { token: token.trim() } : {}), ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) });
    void menuHandler.close();
  };
  const inputCls = `h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30`;
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.account.forgeConnectTitle' })}</div>
      <span className="text-sm text-muted -mt-2">{translate({ key: 'workspaces.account.forgeConnectFor' })}</span>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-common">{translate({ key: 'workspaces.account.forgeProvider' })}</span>
        <Dropdown size="sm" items={modeItems} value={modeItems.find((it) => it.id === mode)} onChange={(it) => { setMode(it.value === 'gitlab' ? 'gitlab' : 'github'); }} />
      </div>
      <input value={repoPath} onChange={(e) => { setRepoPath(e.target.value); }} placeholder={translate({ key: 'workspaces.account.forgeRepoPathPh' })} className={inputCls} />
      <input value={token} onChange={(e) => { setToken(e.target.value); }} type="password" placeholder={translate({ key: 'workspaces.account.forgeTokenPh' })} className={inputCls} />
      <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); }} placeholder={translate({ key: 'workspaces.account.forgeBaseUrlPh' })} className={inputCls} />
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="circle-check" onClick={submit}>{translate({ key: 'workspaces.account.connect' })}</WsButton>
      </div>
    </div>
  );
}

//? #75 — profile edit (name + avatar) via the framework's settings/updateUser route. Rendered in the
//? menuHandler overlay from the Profile card's Edit button. On success we reload so the session
//? re-fetches (useSession exposes no imperative refresh) and the new name/avatar show everywhere.
function ProfileEditForm({ currentName }: { currentName: string }) {
  const translate = useTranslator();
  const [name, setName] = useState(currentName);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldCls = 'h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30';
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => { setAvatar(typeof reader.result === 'string' ? reader.result : null); });
    reader.readAsDataURL(file);
  };
  const save = () => {
    if (busy || name.trim().length === 0) return;
    setBusy(true);
    void apiRequest({ name: 'settings/updateUser', version: 'v1', data: { name: name.trim(), ...(avatar ? { avatar } : {}) } }).then((r) => {
      setBusy(false);
      if (r.status === 'success') { void menuHandler.close(); globalThis.location.reload(); }
      else notify.error({ key: 'settings.failedUpdateUser' });
    });
  };
  return (
    <div className="w-full flex flex-col gap-3 p-5">
      <div className="text-base font-semibold text-title">{translate({ key: 'workspaces.account.editProfileTitle' })}</div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{translate({ key: 'workspaces.account.nameLabel' })}</span>
        <input value={name} onChange={(e) => { setName(e.target.value); }} className={fieldCls} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{translate({ key: 'workspaces.account.avatarLabel' })}</span>
        <input type="file" accept="image/*" onChange={onPick} className="text-sm text-common" />
      </label>
      <div className="flex items-center justify-end gap-2">
        <WsButton variant="ghost" onClick={() => void menuHandler.close()}>{translate({ key: 'workspaces.shell.cancel' })}</WsButton>
        <WsButton icon="check" disabled={busy || name.trim().length === 0} onClick={save}>{translate({ key: 'workspaces.account.save' })}</WsButton>
      </div>
    </div>
  );
}

//? X3 — API tokens (Personal Access Tokens) panel: issue (raw token shown ONCE), list (prefix + scopes), revoke.
//? Talks to the issuePat/listPats/revokePat `_api` routes directly (not a [control-API] op — it's account state).
interface PatRow { id: string; name: string; prefix: string; scopes: string[] }
function PatPanel({ workspaceId }: { workspaceId: string }) {
  const translate = useTranslator();
  const [rows, setRows] = useState<PatRow[]>([]);
  const [name, setName] = useState('');
  const [scopeTickets, setScopeTickets] = useState(true);
  const [scopeContent, setScopeContent] = useState(false);
  const [rawOnce, setRawOnce] = useState<string | null>(null);
  const load = useCallback(() => {
    void apiRequest({ name: 'workspaces/listPats', version: 'v1', data: { workspaceId } }).then((r) => { if (r.status === 'success') setRows(r.result.tokens); });
  }, [workspaceId]);
  useEffect(() => { load(); }, [load]);
  const issue = () => {
    const scopes = [...(scopeTickets ? ['tickets:write'] : []), ...(scopeContent ? ['content:write'] : [])];
    if (scopes.length === 0) return;
    void apiRequest({ name: 'workspaces/issuePat', version: 'v1', data: { workspaceId, name: name.trim() || 'API token', scopes } }).then((r) => {
      if (r.status === 'success') { setRawOnce(r.result.token); setName(''); load(); }
    });
  };
  const revoke = (patId: string) => { void apiRequest({ name: 'workspaces/revokePat', version: 'v1', data: { patId } }).then(() => { load(); }); };
  return (
    <Card title={translate({ key: 'workspaces.pat.title' })} desc={translate({ key: 'workspaces.pat.desc' })}>
      {rawOnce !== null && (
        <div className="rounded-lg border border-warning-border bg-warning/10 p-2.5 mb-2 text-xs">
          <div className="text-title font-semibold mb-1">{translate({ key: 'workspaces.pat.copyNow' })}</div>
          <code className="block bg-container2 rounded px-2 py-1 font-mono break-all text-common">{rawOnce}</code>
          <button type="button" onClick={() => { setRawOnce(null); }} className="text-muted hover:text-common mt-1 cursor-pointer">{translate({ key: 'workspaces.shell.cancel' })}</button>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap pb-3 border-b border-divider">
        <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder={translate({ key: 'workspaces.pat.namePh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary flex-1 min-w-32" />
        <label className="flex items-center gap-1 text-xs text-common cursor-pointer"><input type="checkbox" checked={scopeTickets} onChange={(e) => { setScopeTickets(e.target.checked); }} /> tickets:write</label>
        <label className="flex items-center gap-1 text-xs text-common cursor-pointer"><input type="checkbox" checked={scopeContent} onChange={(e) => { setScopeContent(e.target.checked); }} /> content:write</label>
        <WsButton variant="secondary" onClick={issue}>{translate({ key: 'workspaces.pat.issue' })}</WsButton>
      </div>
      {rows.length === 0 && <div className="text-xs text-muted pt-2">{translate({ key: 'workspaces.pat.empty' })}</div>}
      {rows.map((t) => (
        <Row key={t.id}>
          <span className="flex items-center gap-2 min-w-0"><span className="text-sm text-title">{t.name}</span><code className="text-xs text-muted font-mono">{t.prefix}…</code><span className="text-xs text-muted truncate">{t.scopes.join(', ')}</span></span>
          <button type="button" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.pat.revoke' }), content: t.name }).then((ok) => { if (ok) revoke(t.id); }); }} className="text-xs text-wrong hover:underline cursor-pointer shrink-0">{translate({ key: 'workspaces.pat.revoke' })}</button>
        </Row>
      ))}
    </Card>
  );
}

function AddKeyForm({ onAdd }: { onAdd: (input: { name: string; type: string; fingerprint: string; publicKey: string }) => void }) {
  const translate = useTranslator();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  //? #76 — the pasted key authenticates as the LOGGED-IN user (the server sets userId from the session),
  //? so there is no demo user-resolution; we just persist the key's name + fingerprint.
  const submit = (raw: string, keyName: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) { setError(translate({ key: 'workspaces.account.keyRequired' })); return; }
    onAdd({ name: keyName.trim() || translate({ key: 'workspaces.account.defaultKeyNameSelf' }), type: 'ed25519', fingerprint: `SHA256:${trimmed.slice(0, 12)}…`, publicKey: trimmed });
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

export const template = 'workspaces';

export default function AccountSettings() {
  const translate = useTranslator();
  const { currentUser, theme, setTheme, sshKeys, sshUserId, addSshKey, removeSshKey, membersById, activeWorkspace, activeProject, connectForge, environments, deployEnv, teardownEnv, promoteEnv, buildArtifacts, exportBuild, services, serviceStacks, provisionServiceStack, teardownServiceStack, dbConnections, migrations, dbConnect, dbMigrateCreate, dbMigrateApply, dbIntrospect } = useWorkspaces();
  //? K1/K3 — the curated service presets (stable client-side list; each maps to a server preset key).
  const SERVICE_PRESETS = useMemo(() => [
    { key: 'postgres', label: 'PostgreSQL' }, { key: 'redis', label: 'Redis' }, { key: 'kafka', label: 'Kafka' },
    { key: 'rabbitmq', label: 'RabbitMQ' }, { key: 'elasticsearch', label: 'Elasticsearch' }, { key: 'minio', label: 'MinIO (S3)' }, { key: 'mailpit', label: 'Mailpit' },
  ], []);
  const [servicePreset, setServicePreset] = useState('postgres');
  //? D1/D3 — the commit to pin the demo host at (blank = follow main + auto-redeploy).
  const [pinnedCommit, setPinnedCommit] = useState('');
  //? D2/D3 — the DNS for the demo host: a chosen subdomain on the base domain, or a fully custom domain.
  const [demoSubdomain, setDemoSubdomain] = useState('');
  const [demoCustomDomain, setDemoCustomDomain] = useState('');
  //? ADR 0043 — DB panel form state (connect a database + author a migration).
  const DB_KINDS = useMemo(() => [{ key: 'postgres', label: 'PostgreSQL' }, { key: 'mysql', label: 'MySQL' }, { key: 'mongo', label: 'MongoDB' }], []);
  const [dbName, setDbName] = useState('');
  const [dbKind, setDbKind] = useState('postgres');
  const [dbUrl, setDbUrl] = useState('');
  const [dbEnvKind, setDbEnvKind] = useState('dev');
  const [migName, setMigName] = useState('');
  const [migSql, setMigSql] = useState('');
  const dbInputCls = `h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30`;
  const { session } = useSession<SessionLayout>();
  const setLanguage = useUpdateLanguage();
  //? A1 — real web-push subscribe/unsubscribe (the toggle drives the browser subscription + the server store).
  const [push, setPush] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  //? #122 — reconcile the toggle with the actual browser subscription on mount (survives reload).
  useEffect(() => { void hasPushSubscription().then(setPush); }, []);
  //? #123 — the PWA install prompt (captured at boot) becomes available only when the browser offers it.
  const canInstallApp = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  const togglePush = (next: boolean) => {
    if (pushBusy) return;
    setPushBusy(true);
    void (async () => {
      if (next) { const r = await enablePush(); setPush(r === 'ok'); }
      else { await disablePush(); setPush(false); }
      setPushBusy(false);
    })();
  };
  //? A3 — per-type push opt-out (default on). Persisted to User.preferences.
  const rawPrefs = session?.preferences;
  const prefRec: Record<string, unknown> = rawPrefs !== null && typeof rawPrefs === 'object' && !Array.isArray(rawPrefs) ? rawPrefs : {};
  const [pushCats, setPushCats] = useState({
    assignment: prefRec.pushOnAssignment !== false,
    automation: prefRec.pushOnAutomation !== false,
    aiSuggestion: prefRec.pushOnAiSuggestion !== false,
  });
  const savePushCat = (key: 'assignment' | 'automation' | 'aiSuggestion', prefKey: string, next: boolean) => {
    setPushCats((c) => ({ ...c, [key]: next }));
    void apiRequest({ name: 'settings/updatePreferences', version: 'v1', data: { preferences: { [prefKey]: next } } });
  };
  const [language, setSelectedLanguage] = useState<Language>(session?.language ?? 'en');
  const sshUser = sshUserId ? membersById[sshUserId] : null;
  //? Simplify: dev/ops surfaces (forge, SSH, PATs, deploy, services, DB, raw SQL) are only shown when the
  //? development module is on AND the current user is admin/owner (fail-open: an unresolved role is not 'member',
  //? so it stays visible). A plain 'member' or a content/design-only workspace sees a clean account page.
  //? Collapsed by default so even an admin's first paint stays light (progressive disclosure).
  const showDevOps = isModuleEnabled(activeWorkspace.enabledSections, 'development') && activeWorkspace.role !== 'member';
  const [devOpen, setDevOpen] = useState(false);

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
  //? Real forge-connection state for the active project: a linked repo path/url means connected.
  const forgeConnected = Boolean(activeProject?.gitUrl?.trim());
  //? #63 — the active project's declared services (monorepo units) that deploy per-service.
  const projectServices = activeProject ? services.filter((s) => s.projectId === activeProject.id) : [];

  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const refreshSessions = useCallback(() => {
    void (async () => {
      const response = await apiRequest({ name: 'settings/listSessions', version: 'v1', data: {} });
      if (response.status === 'success') setSessions(response.result.sessions);
    })();
  }, []);
  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  const revokeSession = (handle: string) => {
    void (async () => {
      const response = await apiRequest({ name: 'settings/revokeSession', version: 'v1', data: { handle } });
      if (response.status === 'success') { notify.success({ key: 'workspaces.account.sessionRevoked' }); refreshSessions(); }
      else notify.error({ key: response.errorCode });
    })();
  };
  //? Keeps the caller's own session alive — server-side "sign out OTHER devices" (see settings/_api/signOutEverywhere_v1.ts).
  const revokeAllOtherSessions = () => {
    void (async () => {
      const response = await apiRequest({ name: 'settings/signOutEverywhere', version: 'v1', data: {} });
      if (response.status === 'success') { notify.success({ key: 'workspaces.account.revokeAllDone' }); refreshSessions(); }
      else notify.error({ key: response.errorCode });
    })();
  };

  //? Client-side export of the visible profile — no server round-trip needed.
  const exportData = () => {
    const blob = new Blob([JSON.stringify(currentUser, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `account-${currentUser.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
              {/* #75 — profile editing (name/avatar) via settings/updateUser. */}
              <WsButton variant="secondary" onClick={() => { void menuHandler.open(<ProfileEditForm currentName={currentUser.name} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); }}>{translate({ key: 'workspaces.account.edit' })}</WsButton>
            </div>
            <div className="mt-4 flex flex-col gap-1">
              <Row>
                <span className="text-sm text-common">{translate({ key: 'workspaces.account.theme' })}</span>
                <Segmented value={theme} onChange={(next) => { setTheme(next); void persist({ theme: next }); }} options={[{ id: 'light', label: <><Icon name="sun" /> {translate({ key: 'workspaces.account.light' })}</> }, { id: 'dark', label: <><Icon name="moon" /> {translate({ key: 'workspaces.account.dark' })}</> }]} />
              </Row>
              {/* Fase 2: language switching is display-only here — no per-account language write yet */}
              <Row>
                <span className="text-sm text-common">{translate({ key: 'workspaces.account.language' })}</span>
                <Dropdown size="sm" items={languageItems} value={selectedLanguage} onChange={(it) => { const code = LANGUAGES.find((l) => l === it.value); if (!code) return; setSelectedLanguage(code); setLanguage(code); void persist({ language: code }); }} />
              </Row>
            </div>
          </Card>

          {showDevOps && (
            <>
              <button type="button" onClick={() => { setDevOpen((o) => !o); }} className="flex items-center justify-between gap-3 rounded-xl border border-container1-border bg-container1 px-4 py-3 text-sm font-medium text-title cursor-pointer">
                <span className="flex items-center gap-2"><Icon name="diagram-project" className="text-muted" /> {translate({ key: 'workspaces.account.devOpsSection' })}</span>
                <Icon name="caret-down" className={`text-muted transition-transform motion-reduce:transition-none ${devOpen ? 'rotate-180' : ''}`} />
              </button>
              {devOpen && (
          <><Card title={translate({ key: 'workspaces.account.connectionsTitle' })} desc={translate({ key: 'workspaces.account.connectionsDesc' })}>
            {/* Per-project forge connect (ADR 0036): GitLab OR GitHub for the active project. The
                label + connected badge reflect REAL state — the workspace's chosen forge and whether
                the active project has a linked repo (no more hardcoded "connected"). */}
            <Row>
              <span className="flex items-center gap-2 text-sm text-title"><Icon name="diagram-project" className="text-muted" /> {translate({ key: activeWorkspace.forgeType === 'github' ? 'workspaces.account.github' : 'workspaces.account.gitlab' })}{activeProject ? ` · ${activeProject.name}` : ''}</span>
              <div className="flex items-center gap-2">
                {forgeConnected && <span className="inline-flex items-center gap-1 text-xs text-correct"><Icon name="circle-check" /> {translate({ key: 'workspaces.account.connected' })}</span>}
                <WsButton variant="secondary" disabled={!activeProject} onClick={() => { if (activeProject) void menuHandler.open(<ForgeConnectForm projectId={activeProject.id} onConnect={connectForge} />, { dimBackground: true, background: 'bg-container1', size: 'sm' }); }}>{translate({ key: 'workspaces.account.connect' })}</WsButton>
              </div>
            </Row>
          </Card>

          {/* Environments (ADR 0037): deploy the active project to dev/staging/prod at a stable URL. */}
          <Card title={translate({ key: 'workspaces.account.environmentsTitle' })} desc={translate({ key: 'workspaces.account.environmentsDesc' })}>
            {['dev', 'staging', 'prod'].map((kind) => {
              const env = environments.find((e) => e.kind === kind && e.serviceId === undefined);
              return (
                <Row key={kind}>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-title uppercase w-16">{kind}</span>
                    {env
                      ? <span className={`inline-flex items-center gap-1 text-xs ${env.status === 'live' ? 'text-correct' : (env.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${env.status === 'live' ? 'bg-correct' : (env.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} />{env.status}{env.status === 'live' && env.url ? <a href={env.url} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1 truncate">{env.route}</a> : null}</span>
                      : <span className="text-xs text-disabled">—</span>}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {env?.status === 'live' && kind !== 'prod' && (
                      <button type="button" onClick={() => { const toProd = kind === 'staging'; if (!toProd) { promoteEnv({ fromKind: kind }); return; } void menuHandler.confirm({ title: translate({ key: 'workspaces.account.promote' }), content: `${kind} → prod` }).then((ok) => { if (ok) promoteEnv({ fromKind: kind, approved: true }); }); }} className="text-xs text-primary hover:underline cursor-pointer">{translate({ key: 'workspaces.account.promote' })}</button>
                    )}
                    {/* SEC7 — prod has NO direct deploy (it bypasses the approval/CI/security gates); it is only reachable via promote. */}
                    {kind !== 'prod' && <WsButton variant="secondary" disabled={!activeProject || env?.status === 'deploying'} onClick={() => { deployEnv({ kind }); }}>{translate({ key: 'workspaces.account.deploy' })}</WsButton>}
                    {/* SEC8 — teardown kills the container + route: explicit confirm first (B-23). */}
                    {env && <button type="button" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.account.teardown' }), content: `${kind} — ${env.route}` }).then((ok) => { if (ok) teardownEnv(env.id); }); }} className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.account.teardown' })}</button>}
                  </span>
                </Row>
              );
            })}
            {/* D1/D3 — demo host: "commit X at a stable URL". Pin a commit (frozen demo) or leave blank + auto-redeploy on main. */}
            {(() => {
              const demo = environments.find((e) => e.kind === 'demo' && e.serviceId === undefined);
              return (
                <Row>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-title uppercase w-16">demo</span>
                    {demo
                      ? <span className={`inline-flex items-center gap-1 text-xs ${demo.status === 'live' ? 'text-correct' : (demo.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${demo.status === 'live' ? 'bg-correct' : (demo.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} />{demo.status}{demo.status === 'live' && demo.url ? <a href={demo.url} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1 truncate">{demo.route}</a> : null}</span>
                      : <input value={pinnedCommit} onChange={(e) => { setPinnedCommit(e.target.value); }} placeholder={translate({ key: 'workspaces.account.pinCommitPh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary w-40" />}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <WsButton variant="secondary" disabled={!activeProject || demo?.status === 'deploying'} onClick={() => { deployEnv({ kind: 'demo', ...(pinnedCommit.trim() ? { pinnedCommit: pinnedCommit.trim(), autoRedeploy: false } : { autoRedeploy: true }), ...(demoSubdomain.trim() ? { subdomain: demoSubdomain.trim() } : {}), ...(demoCustomDomain.trim() ? { customDomain: demoCustomDomain.trim() } : {}) }); }}>{translate({ key: pinnedCommit.trim() ? 'workspaces.account.pinDeploy' : 'workspaces.account.deploy' })}</WsButton>
                    {demo && <button type="button" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.account.teardown' }), content: `demo — ${demo.route}` }).then((ok) => { if (ok) teardownEnv(demo.id); }); }} className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.account.teardown' })}</button>}
                  </span>
                </Row>
              );
            })()}
            {/* D2/D3/D4 — choose the DNS for the demo host: a subdomain on the base domain, or a fully custom domain. */}
            <div className="flex flex-wrap items-center gap-2 px-1">
              <input value={demoSubdomain} onChange={(e) => { setDemoSubdomain(e.target.value); }} placeholder={translate({ key: 'workspaces.account.subdomainPh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary w-40" />
              <input value={demoCustomDomain} onChange={(e) => { setDemoCustomDomain(e.target.value); }} placeholder={translate({ key: 'workspaces.account.customDomainPh' })} className="h-8 px-2 rounded-lg border border-container1-border bg-container2/50 text-xs text-title focus:outline-none focus:border-primary flex-1 min-w-48" />
            </div>
            {demoCustomDomain.trim().length > 0 && (
              <div className="px-1 text-[11px] text-muted">{translate({ key: 'workspaces.account.dnsInstruction', params: [{ key: 'domain', value: demoCustomDomain.trim() }] })}</div>
            )}
            {/* #63 — per-service environments: a monorepo project's services deploy/teardown INDIVIDUALLY
                (serviceId-scoped). Only shown when the active project declares services. */}
            {projectServices.length > 0 && (
              <div className="mt-2 pt-2 border-t border-divider flex flex-col gap-1.5">
                <div className="text-xs font-semibold text-muted px-1">{translate({ key: 'workspaces.account.perServiceEnvs' })}</div>
                {projectServices.map((svc) => (
                  <div key={svc.id} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-title px-1">{svc.name}</span>
                    {['dev', 'staging'].map((kind) => {
                      const env = environments.find((e) => e.kind === kind && e.serviceId === svc.id);
                      return (
                        <Row key={`${svc.id}-${kind}`}>
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-muted uppercase w-16 pl-2">{kind}</span>
                            {env
                              ? <span className={`inline-flex items-center gap-1 text-xs ${env.status === 'live' ? 'text-correct' : (env.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${env.status === 'live' ? 'bg-correct' : (env.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} />{env.status}{env.status === 'live' && env.url ? <a href={env.url} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1 truncate">{env.route}</a> : null}</span>
                              : <span className="text-xs text-disabled">—</span>}
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            <WsButton variant="secondary" disabled={env?.status === 'deploying'} onClick={() => { deployEnv({ kind, serviceId: svc.id }); }}>{translate({ key: 'workspaces.account.deploy' })}</WsButton>
                            {env && <button type="button" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.account.teardown' }), content: `${svc.name}/${kind} — ${env.route}` }).then((ok) => { if (ok) teardownEnv(env.id); }); }} className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.account.teardown' })}</button>}
                          </span>
                        </Row>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.buildExports' })}</span>
              {/* #62 — offer BOTH export kinds (the real prod bundle was UI-less; the button hardcoded 'image'). */}
              <div className="flex items-center gap-2">
                <WsButton variant="secondary" disabled={!activeProject} onClick={() => { exportBuild('image'); }}>{translate({ key: 'workspaces.account.exportImage' })}</WsButton>
                <WsButton variant="secondary" disabled={!activeProject} onClick={() => { exportBuild('bundle'); }}>{translate({ key: 'workspaces.account.exportBundle' })}</WsButton>
              </div>
            </Row>
            {buildArtifacts.map((b) => (
              <Row key={b.id}>
                <span className="flex items-center gap-2 text-sm text-title min-w-0"><Icon name="diagram-project" className="text-muted" /> {b.kind} <span className="text-xs text-muted">{b.status}{b.sizeBytes > 0 ? ` · ${String(Math.round(b.sizeBytes / 1_048_576))} MB` : ''}</span></span>
                <span className="flex items-center gap-2 shrink-0">
                  {/* #64 — the D4 deploy-hook outcome for this export (only shown when a hook actually fired). */}
                  {b.deployHookFired === true && <span className={`text-[11px] rounded-md px-1.5 py-0.5 ${b.deployHookOk ? 'bg-correct/10 text-correct' : 'bg-wrong/10 text-wrong'}`}>{translate({ key: b.deployHookOk ? 'workspaces.account.deployHookOk' : 'workspaces.account.deployHookFail' })}{b.deployHookStatus === undefined ? '' : ` ${String(b.deployHookStatus)}`}</span>}
                  {b.status === 'ready' && b.downloadUrl ? <a href={b.downloadUrl} className="text-xs text-primary hover:underline">{translate({ key: 'workspaces.account.download' })}</a> : <span className="text-xs text-disabled">{b.error ?? '—'}</span>}
                </span>
              </Row>
            ))}
          </Card>

          {/* K1/K3 — Services: spin up a third-party service stack (Kafka/Postgres/…) to develop/test against. */}
          <Card title={translate({ key: 'workspaces.services.title' })} desc={translate({ key: 'workspaces.services.desc' })}>
            <Row>
              <span className="flex items-center gap-2 min-w-0">
                <Dropdown size="sm" items={SERVICE_PRESETS.map((p) => ({ id: p.key, value: p.key, item: p.label }))} value={SERVICE_PRESETS.map((p) => ({ id: p.key, value: p.key, item: p.label })).find((it) => it.id === servicePreset)} onChange={(it) => { setServicePreset(String(it.value)); }} />
              </span>
              <WsButton variant="secondary" onClick={() => { provisionServiceStack({ name: servicePreset, preset: servicePreset }); }}>{translate({ key: 'workspaces.services.provision' })}</WsButton>
            </Row>
            {serviceStacks.length === 0 && <div className="text-xs text-muted px-1 py-1">{translate({ key: 'workspaces.services.empty' })}</div>}
            {serviceStacks.map((s) => (
              <Row key={s.id}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`inline-flex items-center gap-1 text-xs ${s.status === 'running' ? 'text-correct' : (s.status === 'error' ? 'text-wrong' : 'text-muted')}`}><span className={`w-1.5 h-1.5 rounded-full ${s.status === 'running' ? 'bg-correct' : (s.status === 'error' ? 'bg-wrong' : 'bg-muted')}`} /></span>
                  <span className="text-sm font-medium text-title">{s.name}</span>
                  <span className="text-xs text-muted truncate">{s.services.join(', ')}</span>
                </span>
                <button type="button" onClick={() => { void menuHandler.confirm({ title: translate({ key: 'workspaces.services.teardown' }), content: s.name }).then((ok) => { if (ok) teardownServiceStack(s.name); }); }} className="text-xs text-wrong hover:underline cursor-pointer shrink-0">{translate({ key: 'workspaces.services.teardown' })}</button>
              </Row>
            ))}
          </Card>

          {/* ADR 0043 — Database: connect a user-app DB, author + apply migrations, introspect schema. */}
          <Card title={translate({ key: 'workspaces.db.title' })} desc={translate({ key: 'workspaces.db.desc' })}>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input value={dbName} onChange={(e) => { setDbName(e.target.value); }} placeholder={translate({ key: 'workspaces.db.namePh' })} className={dbInputCls} />
                <Dropdown size="sm" items={DB_KINDS.map((k) => ({ id: k.key, value: k.key, item: k.label }))} value={DB_KINDS.map((k) => ({ id: k.key, value: k.key, item: k.label })).find((it) => it.id === dbKind)} onChange={(it) => { setDbKind(String(it.value)); }} />
                <Dropdown size="sm" items={['dev', 'staging', 'prod'].map((k) => ({ id: k, value: k, item: k }))} value={['dev', 'staging', 'prod'].map((k) => ({ id: k, value: k, item: k })).find((it) => it.id === dbEnvKind)} onChange={(it) => { setDbEnvKind(String(it.value)); }} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={dbUrl} onChange={(e) => { setDbUrl(e.target.value); }} type="password" placeholder={translate({ key: 'workspaces.db.urlPh' })} className={`${dbInputCls} flex-1 min-w-48`} />
                <WsButton variant="secondary" disabled={!dbName || !dbUrl} onClick={() => { dbConnect({ name: dbName, kind: dbKind, url: dbUrl, envKind: dbEnvKind }); setDbName(''); setDbUrl(''); }}>{translate({ key: 'workspaces.db.connect' })}</WsButton>
              </div>
            </div>
            {dbConnections.length === 0 && <div className="text-xs text-muted px-1 py-1">{translate({ key: 'workspaces.db.noConnections' })}</div>}
            {dbConnections.map((c) => (
              <Row key={c.id}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-title">{c.name}</span>
                  <span className="text-xs text-muted">{c.kind} · {c.envKind}</span>
                </span>
                <button type="button" onClick={() => { dbIntrospect(c.id); }} className="text-xs text-primary hover:underline cursor-pointer shrink-0">{translate({ key: 'workspaces.db.introspect' })}</button>
              </Row>
            ))}
            <div className="flex flex-col gap-2 mt-2 border-t border-divider pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <input value={migName} onChange={(e) => { setMigName(e.target.value); }} placeholder={translate({ key: 'workspaces.db.migNamePh' })} className={dbInputCls} />
                <WsButton variant="secondary" disabled={!migName || !migSql} onClick={() => { dbMigrateCreate({ name: migName, sql: migSql, envKind: dbEnvKind }); setMigName(''); setMigSql(''); }}>{translate({ key: 'workspaces.db.createMigration' })}</WsButton>
              </div>
              <textarea value={migSql} onChange={(e) => { setMigSql(e.target.value); }} placeholder={translate({ key: 'workspaces.db.sqlPh' })} rows={3} className={`${dbInputCls} h-auto py-2 font-mono text-xs`} />
            </div>
            {migrations.map((m) => (
              <Row key={m.id}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`inline-flex w-1.5 h-1.5 rounded-full ${m.status === 'applied' ? 'bg-correct' : (m.status === 'failed' ? 'bg-wrong' : 'bg-warning')}`} />
                  <span className="text-sm font-medium text-title">{m.name}</span>
                  <span className="text-xs text-muted">{m.envKind} · {m.status}</span>
                  {m.error && <span className="text-xs text-wrong truncate">{m.error}</span>}
                </span>
                {m.status === 'pending' && (
                  <button type="button" onClick={() => { if (m.envKind === 'prod') { void menuHandler.confirm({ title: translate({ key: 'workspaces.db.applyProdConfirm' }), content: m.name }).then((ok) => { if (ok) dbMigrateApply({ migrationId: m.id, approved: true }); }); } else { dbMigrateApply({ migrationId: m.id }); } }} className="text-xs text-primary hover:underline cursor-pointer shrink-0">{translate({ key: 'workspaces.db.apply' })}</button>
                )}
              </Row>
            ))}
          </Card>

          {/* X3 — API tokens (issue/list/revoke) for the public API. */}
          <PatPanel workspaceId={activeWorkspace.id} />

          {/* H4 — download a tenant-scoped JSON export of the workspace (portability/backup; secrets excluded). */}
          <Card title={translate({ key: 'workspaces.dataExport.title' })} desc={translate({ key: 'workspaces.dataExport.desc' })}>
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.dataExport.hint' })}</span>
              <WsButton variant="secondary" icon="download" onClick={() => {
                void apiRequest({ name: 'workspaces/workspaceExport', version: 'v1', data: { workspaceId: activeWorkspace.id } }).then((r) => {
                  if (r.status !== 'success') return;
                  const blob = new Blob([JSON.stringify(r.result, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `workspace-${activeWorkspace.id}.json`; a.click();
                  URL.revokeObjectURL(url);
                });
              }}>{translate({ key: 'workspaces.dataExport.download' })}</WsButton>
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
          </Card></>
              )}
            </>
          )}

          <Card
            title={translate({ key: 'workspaces.account.sessionsTitle' })}
            desc={translate({ key: 'workspaces.account.sessionsDesc' })}
            right={
              <button
                type="button"
                onClick={() => {
                  void menuHandler.confirm({ title: translate({ key: 'workspaces.account.revokeAllTitle' }), content: translate({ key: 'workspaces.account.revokeAllContent' }) })
                    .then((ok) => { if (ok) revokeAllOtherSessions(); });
                }}
                className="text-xs text-wrong hover:underline cursor-pointer"
              >
                {translate({ key: 'workspaces.account.revokeAllOthers' })}
              </button>
            }
          >
            <div className="flex flex-col">
              {sessions.map((s) => (
                <Row key={s.handle}>
                  <div>
                    <div className="text-sm font-medium text-title font-mono">
                      ...{s.handle.slice(-8)} {s.isCurrent && <span className="ml-1 rounded-md bg-correct/15 text-correct px-1.5 py-0.5 text-[11px] font-sans">{translate({ key: 'workspaces.account.thisDevice' })}</span>}
                    </div>
                    {s.expiresInSeconds !== null && (
                      <div className="text-xs text-muted">{translate({ key: 'workspaces.account.sessionExpiresIn', params: [{ key: 'hours', value: String(Math.round(s.expiresInSeconds / 3600)) }] })}</div>
                    )}
                  </div>
                  {!s.isCurrent && <button type="button" onClick={() => { revokeSession(s.handle); }} className="text-xs text-wrong hover:underline cursor-pointer">{translate({ key: 'workspaces.account.revoke' })}</button>}
                </Row>
              ))}
              {sessions.length === 0 && <div className="text-sm text-muted py-3">{translate({ key: 'workspaces.account.noSessions' })}</div>}
            </div>
          </Card>

          <Card title={translate({ key: 'workspaces.account.notificationsTitle' })} desc={translate({ key: 'workspaces.account.notificationsDesc' })}>
            {/* A1: real web-push — the toggle subscribes the browser + stores it server-side. */}
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.webPush' })}</span>
              <Toggle on={push} onChange={togglePush} label={push ? translate({ key: 'workspaces.account.enabled' }) : translate({ key: 'workspaces.account.off' })} />
            </Row>
            {/* #123 — install the PWA to the home screen (only shown when the browser offers the prompt). */}
            {canInstallApp && (
              <Row>
                <span className="text-sm text-common">{translate({ key: 'workspaces.account.installApp' })}</span>
                <WsButton variant="secondary" icon="download" onClick={() => { void promptInstall(); }}>{translate({ key: 'workspaces.account.install' })}</WsButton>
              </Row>
            )}
            {/* A3 — per-type push opt-out (only meaningful once push is enabled). */}
            {push && (
              <div className="flex flex-col gap-1 pl-3 border-l border-divider mt-1">
                <Row>
                  <span className="text-sm text-muted">{translate({ key: 'workspaces.account.pushAssignment' })}</span>
                  <Toggle on={pushCats.assignment} onChange={(v) => { savePushCat('assignment', 'pushOnAssignment', v); }} label="" />
                </Row>
                <Row>
                  <span className="text-sm text-muted">{translate({ key: 'workspaces.account.pushAutomation' })}</span>
                  <Toggle on={pushCats.automation} onChange={(v) => { savePushCat('automation', 'pushOnAutomation', v); }} label="" />
                </Row>
                <Row>
                  <span className="text-sm text-muted">{translate({ key: 'workspaces.account.pushAiSuggestion' })}</span>
                  <Toggle on={pushCats.aiSuggestion} onChange={(v) => { savePushCat('aiSuggestion', 'pushOnAiSuggestion', v); }} label="" />
                </Row>
              </div>
            )}
          </Card>

          {/* Account & security — the 2FA/GDPR/mail-preference flows were fully built on /settings but
              unreachable from Workspaces (gap-scan A8): embed 2FA here + a visible route to the rest. */}
          <Card title={translate({ key: 'workspaces.account.securityTitle' })} desc={translate({ key: 'workspaces.account.securityDesc' })}>
            <TwoFactorSection />
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.fullSettings' })}</span>
              <WsButton variant="secondary" icon="up-right-from-square" onClick={() => { globalThis.location.assign('/settings'); }}>{translate({ key: 'workspaces.account.openFullSettings' })}</WsButton>
            </Row>
          </Card>

          <Card title={translate({ key: 'workspaces.account.yourDataTitle' })}>
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.downloadData' })}</span>
              <WsButton variant="secondary" icon="up-right-from-square" onClick={exportData}>{translate({ key: 'workspaces.account.export' })}</WsButton>
            </Row>
            {/* Gap-fix — import a workspace-export JSON back as a NEW workspace (there was no import path). */}
            <Row>
              <span className="text-sm text-common">{translate({ key: 'workspaces.account.importWorkspace' })}</span>
              <label className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-container1-border bg-container1 hover:bg-container2 text-sm text-common cursor-pointer">
                <Icon name="download" /> {translate({ key: 'workspaces.account.importPick' })}
                <input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importWorkspace(f); e.target.value = ''; }} />
              </label>
            </Row>
          </Card>
        </div>
      </div>
    </div>
  );
}
