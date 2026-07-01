import { faMoon, faRightFromBracket, faSun, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Avatar from "src/_components/Avatar";
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

import { backendUrl, SessionLayout } from "../../config";

const stripAvatarVersion = (url: string) => url.replace(/[?&]v=\d+/, '');

//? Keep in sync with the locale files under `src/_locales/`. Each code here
//? must match both a key in `settings.language.*` AND a `.json` locale file.
const LANGUAGES = ['nl', 'en', 'de', 'fr'] as const;
type Language = typeof LANGUAGES[number];

const THEMES = [
  { value: 'light', icon: faSun },
  { value: 'dark', icon: faMoon },
] as const;
type Theme = typeof THEMES[number]['value'];

interface UserPreferences {
  notifyOnNewSignIn?: boolean;
  notifyOnPasswordChange?: boolean;
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-container1 border border-container1-border rounded-xl p-5 flex flex-col gap-3">
      <h2 className="text-base font-semibold text-title">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

const segmentedClass = (active: boolean) =>
  `flex-1 h-9 rounded-md text-sm font-medium border transition-colors cursor-pointer
   ${active
      ? 'bg-primary border-primary text-white'
      : 'bg-container2 border-container2-border text-common hover:bg-container2-hover hover:text-title'}`;

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

  const saveProfile = useCallback(async (newAvatar?: string) => {
    if (!session) return;

    const avatarChanged = newAvatar
      ? stripAvatarVersion(newAvatar) !== stripAvatarVersion(session.avatar)
      : false;
    const avatarToSave = avatarChanged ? newAvatar : undefined;

    if (
      newLanguage === session.language
      && newName === session.name
      && newTheme === session.theme
      && !newAvatar
    ) {
      notify.info({ key: 'settings.noChangesMade' });
      return;
    }

    const response = await apiRequest({
      name: "settings/updateUser",
      version: 'v1',
      data: {
        language: newLanguage === session.language ? undefined : newLanguage,
        avatar: avatarToSave,
        name: newName === session.name ? undefined : newName,
        theme: newTheme === session.theme ? undefined : newTheme,
      },
    });
    if (response.status === 'success') {
      notify.success({ key: 'settings.updatedUser' });
    } else {
      notify.error({ key: 'settings.failedUpdateUser' });
    }
  }, [newLanguage, newName, newTheme, session]);

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
        void saveProfile(`${result}?v=${String(Date.now())}`);
      }
    });
    reader.readAsDataURL(file);
  }, [saveProfile]);

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

  //? Credentials accounts must reconfirm with their password before the
  //? server (`deleteAccount_v1`) will erase them — collected here and sent as
  //? `data.password`. OAuth-only accounts have no hash, so the field is hidden
  //? and the server skips the check.
  const deletePasswordRef = useRef<HTMLInputElement>(null);

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
  const togglePreference = async (key: keyof UserPreferences) => {
    const next = { ...preferences, [key]: !preferences[key] };
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
    const password = deletePasswordRef.current?.value ?? '';

    const response = await apiRequest({
      name: 'settings/deleteAccount',
      version: 'v1',
      data: { confirmation: 'DELETE', password: isCredentials ? password : undefined },
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

  const inputClass = "w-full h-9 bg-container2 border border-container2-border rounded-md px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";

  return (
    <div className='w-full h-full overflow-y-auto bg-background'>
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">

        {/* Profile section */}
        <Section title={translate({ key: 'settings.name' })}>
          <div className="flex gap-4 items-center">
            <div className="rounded-xl w-20 h-20 aspect-square select-none">
              <Avatar
                user={{ name: session.name ?? '', avatar: displayUrl, avatarFallback: session.avatarFallback }}
                textSize="text-2xl"
              />
            </div>
            <div className="flex flex-col gap-2 flex-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFile}
              />
              <button
                type="button"
                className="w-full h-9 px-3 bg-container2 border border-container2-border hover:bg-container2-hover rounded-md text-title text-sm font-medium transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                {translate({ key: 'settings.changeAvatar' })}
              </button>
              <div className="text-xs text-common">
                {translate({ key: 'settings.changeAvatarDescription' })}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="settings-name" className="text-xs font-medium">{translate({ key: 'settings.name' })}</label>
            <input id="settings-name" className={inputClass} value={newName} onChange={(e) => { setNewName(e.target.value); }} />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="settings-email" className="text-xs font-medium">{translate({ key: 'settings.email' })}</label>
            <div className="flex gap-2">
              <input
                id="settings-email"
                type="email"
                className={inputClass}
                value={newEmail}
                onChange={(e) => { setNewEmail(e.target.value); }}
                disabled={emailChangePending}
              />
              <button
                type="button"
                onClick={() => void handleRequestEmailChange()}
                disabled={emailChangePending || !newEmail.trim() || newEmail.trim().toLowerCase() === session.email.toLowerCase() || (session.provider === 'credentials' && !emailChangePassword)}
                className="h-9 px-3 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {translate({ key: 'settings.emailChange.button' })}
              </button>
            </div>
            {session.provider === 'credentials' && (
              <input
                id="settings-email-password"
                type="password"
                autoComplete="current-password"
                className={inputClass}
                placeholder={translate({ key: 'settings.currentPassword' })}
                value={emailChangePassword}
                onChange={(e) => { setEmailChangePassword(e.target.value); }}
                disabled={emailChangePending}
              />
            )}
            <p className="text-xs text-common">{translate({ key: 'settings.emailChange.label' })}</p>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs font-medium">{translate({ key: 'settings.language.title' })}</div>
            <Dropdown
              items={languageItems}
              value={selectedLanguageItem}
              onChange={(item) => {
                const lang = item.value as Language;
                setNewLanguage(lang);
                setLanguage(lang);
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs font-medium">{translate({ key: 'settings.theme.title' })}</div>
            <div className="flex w-full gap-2">
              {THEMES.map(({ value, icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setNewTheme(value); updateTheme(value); }}
                  className={`${segmentedClass(newTheme === value)} flex items-center justify-center gap-2`}
                >
                  <FontAwesomeIcon icon={icon} />
                  {translate({ key: `settings.theme.${value}` })}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="w-full h-9 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer"
            onClick={() => void saveProfile()}
          >
            {translate({ key: 'settings.saveChanges' })}
          </button>
        </Section>

        {/* Password change — only relevant for credentials accounts */}
        {session.provider === 'credentials' && (
          <Section title={translate({ key: 'settings.passwordSection' })}>
            <form onSubmit={(e) => void handleChangePassword(e)} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" htmlFor="current-pw">{translate({ key: 'settings.currentPassword' })}</label>
                <input id="current-pw" type="password" autoComplete="current-password" ref={passwordCurrentRef} className={inputClass} required />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" htmlFor="new-pw">{translate({ key: 'settings.newPassword' })}</label>
                <input id="new-pw" type="password" autoComplete="new-password" ref={passwordNewRef} className={inputClass} required />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" htmlFor="confirm-pw">{translate({ key: 'settings.confirmNewPassword' })}</label>
                <input id="confirm-pw" type="password" autoComplete="new-password" ref={passwordConfirmRef} className={inputClass} required />
              </div>
              <button
                type="submit"
                disabled={passwordLoading}
                className="self-start h-9 px-4 bg-primary hover:bg-primary-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:opacity-60"
              >
                {translate({ key: 'settings.changePassword' })}
              </button>
            </form>
          </Section>
        )}

        {/* Active sessions */}
        <Section title={translate({ key: 'settings.sessionsSection' })}>
          {activeSessions.length === 0
            ? <div className="text-sm text-common">{translate({ key: 'settings.sessionsEmpty' })}</div>
            : (
              <ul className="flex flex-col gap-2">
                {activeSessions.map((s) => (
                  <li key={s.handle} className="flex items-center gap-3 p-3 rounded-md border border-container1-border">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-title">
                        {s.isCurrent ? translate({ key: 'settings.currentSession' }) : `…${s.handle.slice(-8)}`}
                      </div>
                      {s.expiresInSeconds !== null && (
                        <div className="text-xs text-common">
                          {translate({ key: 'settings.sessionExpiresIn', params: [{ key: 'hours', value: String(Math.round(s.expiresInSeconds / 3600)) }] })}
                        </div>
                      )}
                    </div>
                    {!s.isCurrent && (
                      <button
                        type="button"
                        onClick={() => void handleRevokeSession(s.handle)}
                        className="h-9 px-3 rounded-md bg-container2 hover:bg-container2-hover border border-container2-border text-title text-sm font-medium transition-colors cursor-pointer"
                      >
                        {translate({ key: 'settings.revokeSession' })}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </Section>

        {/* Notification preferences */}
        <Section title={translate({ key: 'settings.preferencesSection' })}>
          <PreferenceToggle
            label={translate({ key: 'settings.prefNotifySignIn' })}
            checked={preferences.notifyOnNewSignIn ?? false}
            onToggle={() => void togglePreference('notifyOnNewSignIn')}
          />
          <PreferenceToggle
            label={translate({ key: 'settings.prefNotifyPassword' })}
            checked={preferences.notifyOnPasswordChange ?? false}
            onToggle={() => void togglePreference('notifyOnPasswordChange')}
          />
        </Section>

        {/* Danger zone */}
        <Section title={translate({ key: 'settings.dangerSection' })}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSignOutEverywhere()}
              className="h-9 px-4 rounded-md bg-container2 border border-container2-border hover:bg-container2-hover text-title text-sm font-medium transition-colors cursor-pointer flex items-center gap-2"
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
              {translate({ key: 'settings.signOutEverywhere' })}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              className="h-9 px-4 rounded-md bg-wrong hover:bg-wrong-hover text-white text-sm font-medium transition-colors cursor-pointer flex items-center gap-2"
            >
              <FontAwesomeIcon icon={faTrash} />
              {translate({ key: 'settings.deleteAccount' })}
            </button>
          </div>
          {session.provider === 'credentials' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="delete-pw" className="text-xs font-medium">{translate({ key: 'settings.currentPassword' })}</label>
              <input id="delete-pw" type="password" autoComplete="current-password" ref={deletePasswordRef} className={inputClass} />
            </div>
          )}
          <p className="text-xs text-common flex items-center gap-2">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            {translate({ key: 'settings.deleteAccountConfirm' })}
          </p>
        </Section>

      </div>
    </div>
  );
}

interface PreferenceToggleProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
}

function PreferenceToggle({ label, checked, onToggle }: PreferenceToggleProps) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer text-sm text-title">
      <span>{label}</span>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors
          ${checked ? 'bg-primary' : 'bg-container2 border border-container2-border'}`}
      >
        <span
          className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform
            ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
    </label>
  );
}
