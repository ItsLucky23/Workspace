import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Avatar from "src/_components/Avatar";
import TwoFactorSection from "src/_components/TwoFactorSection";
import Dropdown, { type DropdownItem } from "src/_components/dropdown/Dropdown";
import {
  i18nNotify as notify,
  useSession,
  useTheme,
  useTranslator,
  useUpdateLanguage,
} from "@luckystack/core/client";
import type { PageMiddleware } from "@luckystack/core/client";
import { menuHandler } from "src/_functions/menuHandler";
import { apiRequest } from "src/_sockets/apiRequest";

import Icon from "../workspaces/_components/Icon";
import { EmptyState, Segmented, WsButton } from "../workspaces/_components/primitives";
import { FormSection, SettingRow, useAutosave } from "../workspaces/_components/settings";
import { backendUrl, SessionLayout } from "../../config";

const stripAvatarVersion = (url: string) => url.replace(/[?&]v=\d+/, '');

//? Keep in sync with the locale files under `src/_locales/`. Each code here
//? must match both a key in `settings.language.*` AND a `.json` locale file.
const LANGUAGES = ['nl', 'en', 'de', 'fr'] as const;
type Language = typeof LANGUAGES[number];

const THEMES = [
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
] as const;
type Theme = typeof THEMES[number]['value'];

interface UserPreferences {
  notifyOnNewSignIn?: boolean;
  notifyOnPasswordChange?: boolean;
  notifyOnAssignment?: boolean; // Workspaces in-app assignment bell (#13) — opt-out, default on
}

interface ActiveSession {
  handle: string;
  expiresInSeconds: number | null;
  isCurrent: boolean;
}

export const template = 'home';

//? Per-page route guard. Example of the framework's per-page middleware
//? pattern (see `docs/luckystack/ARCHITECTURE_ROUTING.md`). Auto-registered
//? by `src/main.tsx`'s `getRoutes()` loop. To require additional checks
//? (admin role, paid tier, etc.) extend the function body — return
//? `{ success: false, redirect: '/...' }` to bounce, or `undefined` to
//? send the user back in browser history with an optional toast.
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

//? Shared field style — mirrors the settings-row field look used elsewhere (`workspace/page.tsx`'s `fieldCls`).
const fieldCls = "h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

export default function Home() {
  const { session } = useSession<SessionLayout>();
  const { setTheme: updateTheme } = useTheme();
  const setLanguage = useUpdateLanguage();
  const translate = useTranslator();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newLanguage, setNewLanguage] = useState<Language>(session?.language ?? 'en');
  const [newName, setNewName] = useState<string>(session?.name ?? '');
  const [newTheme, setNewTheme] = useState<Theme>(session?.theme ?? 'dark');
  const [newEmail, setNewEmail] = useState<string>(session?.email ?? '');
  const [emailChangePending, setEmailChangePending] = useState<boolean>(false);
  const [emailChangePassword, setEmailChangePassword] = useState<string>('');
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>(
    (session?.preferences as UserPreferences | undefined) ?? {},
  );
  const [deletePassword, setDeletePassword] = useState<string>('');

  //? ADR 0309 — autosave with a per-row pill instead of a Save button. The three fields persist
  //? through one op (same shape as `workspace/page.tsx`'s `aiStatus`), so they share one status;
  //? switching account (sign-out/sign-in as someone else) re-seeds without writing.
  const saveProfileFields = useCallback(async () => {
    if (!session) return;
    const diff: { language?: Language; name?: string; theme?: Theme } = {
      language: newLanguage === session.language ? undefined : newLanguage,
      name: newName === session.name ? undefined : newName,
      theme: newTheme === session.theme ? undefined : newTheme,
    };
    if (diff.language === undefined && diff.name === undefined && diff.theme === undefined) return;

    const response = await apiRequest({ name: "settings/updateUser", version: 'v1', data: diff });
    if (response.status !== 'success') {
      notify.error({ key: response.errorCode });
      throw new Error(response.errorCode);
    }
  }, [newLanguage, newName, newTheme, session]);

  const profileStatus = useAutosave(
    [newName, newLanguage, newTheme],
    saveProfileFields,
    { resetKey: session?.id ?? '' },
  );

  //? Avatar upload is its own discrete action (picking a file IS the change event, unlike typing) —
  //? it persists immediately with its own toast rather than joining the debounced pill above.
  const saveAvatar = useCallback(async (newAvatar: string) => {
    if (!session) return;
    if (stripAvatarVersion(newAvatar) === stripAvatarVersion(session.avatar)) return;

    const response = await apiRequest({ name: "settings/updateUser", version: 'v1', data: { avatar: newAvatar } });
    if (response.status === 'success') {
      notify.success({ key: 'settings.updatedUser' });
    } else {
      notify.error({ key: 'settings.failedUpdateUser' });
    }
  }, [session]);

  //? Email change routes through a confirmation email + one-shot token
  //? rather than being applied directly. The actual write happens on the
  //? user clicking the link sent to the new address.
  const handleRequestEmailChange = useCallback(async () => {
    if (!session) return;
    const trimmed = newEmail.trim();
    if (!trimmed || trimmed.toLowerCase() === session.email.toLowerCase()) return;

    //? Credentials accounts must confirm their current password — the route
    //? rejects the change without it. OAuth accounts have no password; the field
    //? isn't shown and the empty value is ignored server-side.
    const isCredentials = session.provider === 'credentials';
    if (isCredentials && !emailChangePassword) {
      notify.error({ key: 'settings.emailChange.currentPasswordRequired' });
      return;
    }

    setEmailChangePending(true);
    const response = await apiRequest({
      name: 'settings/requestEmailChange',
      version: 'v1',
      data: { newEmail: trimmed, currentPassword: emailChangePassword },
    });
    setEmailChangePending(false);

    if (response.status === 'success') {
      setEmailChangePassword('');
      notify.info({ key: 'settings.emailChange.checkInbox' });
    } else {
      notify.error({ key: response.errorCode });
    }
  }, [newEmail, session, emailChangePassword]);

  const handleAvatarFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      notify.error({ key: 'settings.sizeToLarge' });
      return;
    }

    notify.info({ key: 'settings.loadingImg' });
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if (typeof result === 'string') {
        void saveAvatar(`${result}?v=${String(Date.now())}`);
      }
    });
    reader.readAsDataURL(file);
  }, [saveAvatar]);

  const refreshSessions = useCallback(async () => {
    const response = await apiRequest({
      name: 'settings/listSessions',
      version: 'v1',
      data: {},
    });
    if (response.status === 'success') {
      setActiveSessions(response.result.sessions);
    }
  }, []);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  const languageItems: DropdownItem[] = useMemo(() => LANGUAGES.map((lang) => ({
    id: lang,
    value: lang,
    placeholder: translate({ key: `settings.language.${lang}` }),
  })), [translate]);
  const selectedLanguageItem = languageItems.find((item) => item.id === newLanguage);

  // ------- password change -------
  const passwordCurrentRef = useRef<HTMLInputElement>(null);
  const passwordNewRef = useRef<HTMLInputElement>(null);
  const passwordConfirmRef = useRef<HTMLInputElement>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleChangePassword = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (passwordLoading) return;

    setPasswordLoading(true);
    const response = await apiRequest({
      name: 'settings/changePassword',
      version: 'v1',
      data: {
        currentPassword: passwordCurrentRef.current?.value ?? '',
        newPassword: passwordNewRef.current?.value ?? '',
        confirmPassword: passwordConfirmRef.current?.value ?? '',
      },
    });
    setPasswordLoading(false);

    if (response.status === 'success') {
      notify.success({ key: 'settings.passwordChanged' });
      if (passwordCurrentRef.current) passwordCurrentRef.current.value = '';
      if (passwordNewRef.current) passwordNewRef.current.value = '';
      if (passwordConfirmRef.current) passwordConfirmRef.current.value = '';
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  // ------- sessions -------
  const handleRevokeSession = async (handle: string) => {
    const response = await apiRequest({
      name: 'settings/revokeSession',
      version: 'v1',
      data: { handle },
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.sessionRevoked' });
      void refreshSessions();
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  // ------- preferences -------
  //? `current` is the effective checked value the toggle is showing (callers pass it so
  //? an opt-OUT default-on preference like notifyOnAssignment flips correctly on first click).
  const togglePreference = async (key: keyof UserPreferences, current: boolean) => {
    const next = { ...preferences, [key]: !current };
    setPreferences(next);
    const response = await apiRequest({
      name: 'settings/updatePreferences',
      version: 'v1',
      data: { preferences: next },
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.preferencesSaved' });
    } else {
      // Roll back on error
      setPreferences(preferences);
      notify.error({ key: response.errorCode });
    }
  };

  // ------- danger zone -------
  const handleSignOutEverywhere = async () => {
    const confirmed = await menuHandler.confirm({
      title: translate({ key: 'settings.signOutEverywhere' }),
      content: translate({ key: 'settings.signOutEverywhereConfirm' }),
    });
    if (!confirmed) return;

    const response = await apiRequest({
      name: 'settings/signOutEverywhere',
      version: 'v1',
      data: {},
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.signOutEverywhereDone' });
      // Server will close our socket; redirect happens via session update
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = await menuHandler.confirm({
      title: translate({ key: 'settings.deleteAccount' }),
      content: translate({ key: 'settings.deleteAccountConfirm' }),
      input: 'DELETE',
    });
    if (!confirmed) return;

    //? Credentials accounts must re-enter their password — the server
    //? (`deleteAccount_v1`) rejects with `login.wrongPassword` otherwise.
    //? OAuth-only accounts have no hash, so the field is hidden and we send
    //? `undefined` (server skips the check).
    const isCredentials = session?.provider === 'credentials';

    const response = await apiRequest({
      name: 'settings/deleteAccount',
      version: 'v1',
      data: { confirmation: 'DELETE', password: isCredentials ? deletePassword : undefined },
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.deleteAccountDone' });
    } else {
      notify.error({ key: response.errorCode });
    }
  };

  if (!session) return null;

  const displayUrl = session.avatar.startsWith('http')
    ? session.avatar
    : `${backendUrl}/uploads/${session.avatar}`;
  const isCredentialsAccount = session.provider === 'credentials';

  return (
    <div className='w-full h-full overflow-y-auto bg-background'>
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">

        <h1 className="text-xl md:text-2xl font-semibold text-title">{translate({ key: 'settings.pageTitle' })}</h1>

        {/* Profile section — ADR 0309: one autosave model for the whole card, no Save button. */}
        <FormSection title={translate({ key: 'settings.profileSection' })}>
          <SettingRow
            stacked
            label={translate({ key: 'settings.avatarLabel' })}
            help={translate({ key: 'settings.changeAvatarDescription' })}
            control={(
              <div className="flex items-center gap-3">
                <div className="rounded-xl w-14 h-14 aspect-square select-none shrink-0">
                  <Avatar
                    user={{ name: session.name ?? '', avatar: displayUrl, avatarFallback: session.avatarFallback }}
                    textSize="text-lg"
                  />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFile}
                />
                <WsButton variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  {translate({ key: 'settings.changeAvatar' })}
                </WsButton>
              </div>
            )}
          />

          <SettingRow
            label={translate({ key: 'settings.name' })}
            htmlFor="settings-name"
            status={profileStatus}
            control={<input id="settings-name" className={`${fieldCls} w-full`} value={newName} onChange={(e) => { setNewName(e.target.value); }} />}
          />

          <SettingRow
            label={translate({ key: 'settings.language.title' })}
            status={profileStatus}
            control={(
              <Dropdown
                width="full"
                items={languageItems}
                value={selectedLanguageItem}
                onChange={(item) => {
                  const lang = item.value as Language;
                  setNewLanguage(lang);
                  setLanguage(lang);
                }}
              />
            )}
          />

          <SettingRow
            label={translate({ key: 'settings.theme.title' })}
            status={profileStatus}
            control={(
              <Segmented
                options={THEMES.map(({ value, icon }) => ({
                  id: value,
                  label: <span className="inline-flex items-center gap-1.5"><Icon name={icon} />{translate({ key: `settings.theme.${value}` })}</span>,
                }))}
                value={newTheme}
                onChange={(value) => { setNewTheme(value); updateTheme(value); }}
              />
            )}
          />

          <SettingRow
            stacked
            label={translate({ key: 'settings.email' })}
            help={translate({ key: 'settings.emailChange.label' })}
            control={(
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    id="settings-email"
                    type="email"
                    className={`${fieldCls} w-full`}
                    value={newEmail}
                    onChange={(e) => { setNewEmail(e.target.value); }}
                    disabled={emailChangePending}
                  />
                  <WsButton
                    variant="secondary"
                    onClick={() => void handleRequestEmailChange()}
                    disabled={emailChangePending || !newEmail.trim() || newEmail.trim().toLowerCase() === session.email.toLowerCase() || (isCredentialsAccount && !emailChangePassword)}
                    className="whitespace-nowrap"
                  >
                    {translate({ key: 'settings.emailChange.button' })}
                  </WsButton>
                </div>
                {isCredentialsAccount && (
                  <input
                    id="settings-email-password"
                    type="password"
                    autoComplete="current-password"
                    className={`${fieldCls} w-full`}
                    placeholder={translate({ key: 'settings.currentPassword' })}
                    value={emailChangePassword}
                    onChange={(e) => { setEmailChangePassword(e.target.value); }}
                    disabled={emailChangePending}
                  />
                )}
              </div>
            )}
          />
        </FormSection>

        {/* Password change — only relevant for credentials accounts. Its own deliberate confirm flow (ADR 0309 exception). */}
        {isCredentialsAccount && (
          <form onSubmit={(e) => void handleChangePassword(e)}>
            <FormSection title={translate({ key: 'settings.passwordSection' })}>
              <SettingRow
                stacked
                label={translate({ key: 'settings.currentPassword' })}
                htmlFor="current-pw"
                control={<input id="current-pw" type="password" autoComplete="current-password" ref={passwordCurrentRef} className={`${fieldCls} w-full`} required />}
              />
              <SettingRow
                stacked
                label={translate({ key: 'settings.newPassword' })}
                htmlFor="new-pw"
                control={<input id="new-pw" type="password" autoComplete="new-password" ref={passwordNewRef} className={`${fieldCls} w-full`} required />}
              />
              <SettingRow
                stacked
                label={translate({ key: 'settings.confirmNewPassword' })}
                htmlFor="confirm-pw"
                control={<input id="confirm-pw" type="password" autoComplete="new-password" ref={passwordConfirmRef} className={`${fieldCls} w-full`} required />}
              />
              <div className="px-5 py-4">
                <WsButton type="submit" disabled={passwordLoading}>
                  {translate({ key: 'settings.changePassword' })}
                </WsButton>
              </div>
            </FormSection>
          </form>
        )}

        {/* Two-factor authentication (ADR 0024) — TOTP enrollment + recovery codes. Its own deliberate confirm flow (ADR 0309 exception). */}
        <FormSection title={translate({ key: 'settings.twoFactorSection' })}>
          <div className="px-5 py-4">
            <TwoFactorSection />
          </div>
        </FormSection>

        {/* Active sessions */}
        <FormSection title={translate({ key: 'settings.sessionsSection' })}>
          {activeSessions.length === 0
            ? <EmptyState icon="shield-halved" title={translate({ key: 'settings.sessionsEmpty' })} />
            : activeSessions.map((s) => (
              <SettingRow
                key={s.handle}
                label={s.isCurrent ? translate({ key: 'settings.currentSession' }) : `…${s.handle.slice(-8)}`}
                help={s.expiresInSeconds === null
                  ? undefined
                  : translate({ key: 'settings.sessionExpiresIn', params: [{ key: 'hours', value: String(Math.round(s.expiresInSeconds / 3600)) }] })}
                control={!s.isCurrent && (
                  <WsButton variant="secondary" onClick={() => void handleRevokeSession(s.handle)}>
                    {translate({ key: 'settings.revokeSession' })}
                  </WsButton>
                )}
              />
            ))}
        </FormSection>

        {/* Notification preferences */}
        <FormSection title={translate({ key: 'settings.preferencesSection' })}>
          <SettingRow
            label={translate({ key: 'settings.prefNotifySignIn' })}
            control={(
              <PreferenceToggle
                ariaLabel={translate({ key: 'settings.prefNotifySignIn' })}
                checked={preferences.notifyOnNewSignIn ?? false}
                onToggle={() => void togglePreference('notifyOnNewSignIn', preferences.notifyOnNewSignIn ?? false)}
              />
            )}
          />
          <SettingRow
            label={translate({ key: 'settings.prefNotifyPassword' })}
            control={(
              <PreferenceToggle
                ariaLabel={translate({ key: 'settings.prefNotifyPassword' })}
                checked={preferences.notifyOnPasswordChange ?? false}
                onToggle={() => void togglePreference('notifyOnPasswordChange', preferences.notifyOnPasswordChange ?? false)}
              />
            )}
          />
          <SettingRow
            label={translate({ key: 'settings.prefNotifyAssignment' })}
            control={(
              <PreferenceToggle
                ariaLabel={translate({ key: 'settings.prefNotifyAssignment' })}
                checked={preferences.notifyOnAssignment ?? true}
                onToggle={() => void togglePreference('notifyOnAssignment', preferences.notifyOnAssignment ?? true)}
              />
            )}
          />
        </FormSection>

        {/* Danger zone — a colored ring (not a competing border-color utility) marks it as the one destructive card among six otherwise-identical ones. */}
        <FormSection
          className="ring-1 ring-wrong/25 ring-inset"
          title={<span className="inline-flex items-center gap-2 text-wrong"><Icon name="triangle-exclamation" />{translate({ key: 'settings.dangerSection' })}</span>}
        >
          <SettingRow
            label={translate({ key: 'settings.signOutEverywhere' })}
            help={translate({ key: 'settings.signOutEverywhereConfirm' })}
            control={<WsButton variant="secondary" icon="right-from-bracket" onClick={() => void handleSignOutEverywhere()}>{translate({ key: 'settings.signOutEverywhere' })}</WsButton>}
          />
          <SettingRow
            stacked
            label={translate({ key: 'settings.deleteAccount' })}
            help={translate({ key: 'settings.deleteAccountConfirm' })}
            control={(
              <div className="flex flex-col gap-2 items-start">
                {isCredentialsAccount && (
                  <input
                    id="delete-pw"
                    type="password"
                    autoComplete="current-password"
                    placeholder={translate({ key: 'settings.currentPassword' })}
                    className={`${fieldCls} w-full`}
                    value={deletePassword}
                    onChange={(e) => { setDeletePassword(e.target.value); }}
                  />
                )}
                <WsButton
                  variant="danger"
                  icon="trash"
                  disabled={isCredentialsAccount && !deletePassword}
                  onClick={() => void handleDeleteAccount()}
                >
                  {translate({ key: 'settings.deleteAccount' })}
                </WsButton>
              </div>
            )}
          />
        </FormSection>

      </div>
    </div>
  );
}

interface PreferenceToggleProps {
  ariaLabel: string;
  checked: boolean;
  onToggle: () => void;
}

//? A thin switch tuned for a SettingRow control slot (right-aligned, no inline label — the row's
//? own label already names it). Kept local rather than pulled from `_components/primitives` because
//? that shared `Toggle` renders its own label alongside the knob; this page's rows already have one.
function PreferenceToggle({ ariaLabel, checked, onToggle }: PreferenceToggleProps) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      className={`focus-ring relative inline-flex h-6 w-10 items-center rounded-full transition-colors cursor-pointer
        ${checked ? 'bg-primary' : 'bg-container2 border border-container2-border'}`}
    >
      <span
        className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform
          ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </span>
  );
}
