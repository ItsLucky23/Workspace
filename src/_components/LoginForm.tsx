import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router-dom";

import { backendUrl, loginRedirectUrl, loginPageUrl, SessionLayout, sessionBasedToken } from "config";
import tryCatch from "shared/tryCatch";

import { i18nNotify as notify, useTranslator } from "@luckystack/core/client";
import { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS, AUTH_STEP_MOTION, PasswordField } from "src/_components/AuthShell";

//? Post-redirect delay in ms: long enough for the success toast to be read,
//? short enough not to feel broken. Named to avoid a bare magic number.
const REDIRECT_DELAY_MS = 1000;

//? Shared session-minting tail: store the token (token mode) / clear stale (cookie mode) + redirect.
//? Reused by the password, 2FA-verify and email-code paths (they all return the same header + envelope).
function completeSession(sessionToken: string | null | undefined, authenticated: boolean, reason?: string): void {
  notify.success({ key: reason ?? 'login.loggedIn' });
  setTimeout(() => {
    if (sessionToken && sessionBasedToken) sessionStorage.setItem("token", sessionToken);
    else if (!sessionBasedToken) sessionStorage.removeItem("token");
    globalThis.location.href = authenticated ? loginRedirectUrl : loginPageUrl;
  }, REDIRECT_DELAY_MS);
}

//? Auth POST helper for the login-completing routes (CSRF-exempt like /auth/api/credentials; plain fetch
//? mirrors that call). Returns the parsed envelope + the session-token header.
// luckystack-allow i18n-jsx: the ": Promise<{ status … }>" match is a TS return-type annotation, not JSX text (linter false positive).
async function authPost(path: string, body: Record<string, unknown>): Promise<{ status: boolean | string; reason?: string; errorCode?: string; authenticated?: boolean; requiresTwoFactor?: boolean; challengeToken?: string; sessionToken: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Session-Based-Token": String(sessionBasedToken) };
  const res = await fetch(`${backendUrl}/auth/${path}`, { method: "POST", headers, body: JSON.stringify(body), credentials: "include" });
  const parsed = (await res.json()) as { status: boolean | string; reason?: string; errorCode?: string; authenticated?: boolean; requiresTwoFactor?: boolean; challengeToken?: string };
  return { ...parsed, sessionToken: res.headers.get("x-session-token") };
}

export default function LoginForm({ formType }: { formType: "login" | "register" }) {
  const translate = useTranslator();
  const isLogin = formType === "login";
  const title = isLogin ? translate({ key: 'login.signInTitle' }) : translate({ key: 'login.registerTitle' });
  const buttonText = isLogin ? translate({ key: 'login.logIn' }) : translate({ key: 'login.signUp' });

  const inputClass = AUTH_INPUT_CLASS;

  const [loading, setLoading] = useState(false);
  //? #2FA/email-code (ADR 0024). `challengeToken` set ⇒ show the 2FA code step (password verified, session not
  //? minted yet). `otcMode` ⇒ passwordless email-code login. `code` is the shared 6-digit / recovery input.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  //? An email-code login can chain STRAIGHT into a 2FA challenge — a second, near-identical 6-digit
  //? prompt. Remember where the challenge came from so we can say so, instead of looking like a repeat.
  const [challengeFromEmailCode, setChallengeFromEmailCode] = useState(false);
  const [otcMode, setOtcMode] = useState(false);
  const [otcSent, setOtcSent] = useState(false);
  const [code, setCode] = useState("");

  //? The login form is driven entirely by the server's env-based registry
  //? (`GET /auth/providers`) — the single source of truth. A provider is active
  //? only when its credentials env vars are set; `credentials` (email+password)
  //? is present when `auth.credentials` is enabled. Secrets never reach the
  //? browser. We split the returned list: `credentials` gates the form fields,
  //? everything else becomes an OAuth button.
  const [oauthProviders, setOauthProviders] = useState<string[]>([]);
  const [showCredentials, setShowCredentials] = useState(false);
  //? Gate the whole form on the providers fetch so the OAuth buttons + credential
  //? fields render once, fully-formed, instead of popping in after the rest
  //? (which caused a visible layout shift on every mount / login↔register nav).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [error, response] = await tryCatch(() =>
        fetch(`${backendUrl}/auth/providers`, { signal: controller.signal }),
      );
      if (error || !response?.ok) { setReady(true); return; }
      const [parseError, body] = await tryCatch(() => response.json() as Promise<{ providers?: string[] }>);
      if (parseError || !Array.isArray(body?.providers)) { setReady(true); return; }
      setShowCredentials(body.providers.includes("credentials"));
      setOauthProviders(body.providers.filter((name) => name !== "credentials"));
      setReady(true);
    })();
    return () => { controller.abort(); };
  }, []);

  //? OAuth leaves the SPA entirely, so it stays a plain button (no form submit involved).
  const startOauth = (provider: string): void => {
    if (loading) return;
    setLoading(true);
    globalThis.location.href = `${backendUrl}/auth/api/${provider}`;
  };

  const submitCredentials = async (form: HTMLFormElement): Promise<void> => {
    setLoading(true);

    const getValue = (name: string): string => {
      const input = form.querySelector(`input[name="${name}"]`);
      return (input as HTMLInputElement | null)?.value ?? "";
    };

    const name = getValue("name");
    const email = getValue("email");
    const password = getValue("password");
    const confirmPassword = getValue("confirmPassword");

    const fetchUser = async () => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Session-Based-Token": String(sessionBasedToken),
      };
      //? In sessionStorage mode there is no auth cookie, so the server can't see
      //? our CURRENT session token on this POST. Send it as a Bearer token so a
      //? re-login while already signed in SUPERSEDES (instead of kicking) this
      //? browser's own session. No-op when signed out or in cookie mode.
      if (sessionBasedToken) {
        const existingToken = sessionStorage.getItem("token");
        if (existingToken) headers.Authorization = `Bearer ${existingToken}`;
      }
      const res = await fetch(`${backendUrl}/auth/api/credentials`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, email, password, confirmPassword, provider: "credentials" }),
        credentials: "include",
      });
      const sessionToken = res.headers.get("x-session-token");
      //? `status` is a BOOLEAN on the auth handler's own responses, but framework
      //? guards (CSRF, rate-limit) reply with the generic error envelope
      //? `{ status: 'error', errorCode }` — a truthy STRING. Type it as the union
      //? so the success check below can't be fooled into treating an error as a win.
      const body = (await res.json()) as {
        status: boolean | string;
        reason?: string;
        errorCode?: string;
        session?: SessionLayout;
        authenticated?: boolean;
        //? #2FA — an enrolled account returns a challenge instead of a session (password verified, not minted).
        requiresTwoFactor?: boolean;
        challengeToken?: string;
      };

      return {
        ...body,
        sessionToken,
      };
    };

    const [error, response] = await tryCatch(fetchUser);

    if (error || !response) {
      notify.error({ key: 'common.404' })
      console.error(error ?? "No JSON response");
      setLoading(false); return;
    }

    //? #2FA — the account has a second factor: switch to the challenge step (password verified, no session yet).
    if (response.requiresTwoFactor && response.challengeToken) {
      setChallengeToken(response.challengeToken);
      setChallengeFromEmailCode(false);
      setCode("");
      setLoading(false);
      return;
    }

    //? Success is ONLY a literal boolean `true`. Anything else — `false`, or the
    //? framework error envelope's `'error'` string — is a failure. (Without the
    //? strict `=== true`, a 403 CSRF reply `{ status: 'error' }` slipped through
    //? as success: empty green toast + bounce back to /login.)
    if (response.status !== true) {
      const reasonKey = [response.reason, response.errorCode].find(
        (key): key is string => typeof key === 'string' && key.length > 0,
      ) ?? 'api.internalServerError';
      notify.error({ key: reasonKey });
      setLoading(false);
      return;
    }

    completeSession(response.sessionToken, response.authenticated === true, response.reason);
  };

  //? Verify the pending 2FA challenge (TOTP or recovery code) → mint the session.
  const verifyChallenge = async (): Promise<void> => {
    if (!challengeToken || code.trim().length === 0 || loading) return;
    setLoading(true);
    const [err, res] = await tryCatch(() => authPost("api/2fa", { challengeToken, code: code.trim() }));
    setLoading(false);
    if (err || res?.status !== true) { notify.error({ key: res?.errorCode ?? res?.reason ?? 'login.twoFactorInvalid' }); return; }
    completeSession(res.sessionToken, res.authenticated === true, res.reason);
  };

  //? Passwordless email-code: request a code (anti-enumeration — always "ok"), then verify it.
  const requestEmailCode = async (): Promise<void> => {
    if (loading) return;
    const form = document.querySelector("form");
    const email = (form?.querySelector('input[name="email"]') as HTMLInputElement | null)?.value ?? "";
    if (email.trim().length === 0) { notify.error({ key: 'login.emailRequired' }); return; }
    setLoading(true);
    await tryCatch(() => authPost("api/email-code/request", { email: email.trim() }));
    setLoading(false);
    setOtcSent(true);
    notify.success({ key: 'login.emailCodeSent' });
  };

  const verifyEmailCode = async (): Promise<void> => {
    if (code.trim().length === 0 || loading) return;
    const form = document.querySelector("form");
    const email = (form?.querySelector('input[name="email"]') as HTMLInputElement | null)?.value ?? "";
    setLoading(true);
    const [err, res] = await tryCatch(() => authPost("api/email-code/verify", { email: email.trim(), code: code.trim() }));
    setLoading(false);
    if (err || !res) { notify.error({ key: 'common.404' }); return; }
    //? Email-code can ALSO return a 2FA challenge (an enrolled user logging in passwordlessly).
    if (res.requiresTwoFactor && res.challengeToken) { setChallengeToken(res.challengeToken); setChallengeFromEmailCode(true); setCode(""); return; }
    if (res.status !== true) { notify.error({ key: res.errorCode ?? res.reason ?? 'login.twoFactorInvalid' }); return; }
    completeSession(res.sessionToken, res.authenticated === true, res.reason);
  };

  //? One NATIVE submit for every step (2FA verify, email-code request/verify, credentials). Password
  //? managers only offer to save a password on a real submit event — the old Enter-key relay into a
  //? `type="button"` click never fired one, so the browser's "save password?" prompt stayed away.
  const handleFormSubmit = (event: React.SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) return;
    if (challengeToken !== null) { void verifyChallenge(); return; }
    if (isLogin && otcMode) { void (otcSent ? verifyEmailCode() : requestEmailCode()); return; }
    void submitCredentials(event.currentTarget);
  };

  //? Which of the mutually-exclusive steps is on screen, as ONE value so the AnimatePresence below
  //? can swap them by key (and so the step logic doesn't live inside the JSX).
  const step = ((): 'pending' | 'challenge' | 'credentials' | 'none' => {
    if (!ready) return 'pending';
    if (challengeToken !== null) return 'challenge';
    return showCredentials ? 'credentials' : 'none';
  })();

  //? In passwordless mode the primary button first REQUESTS the code, then verifies it.
  const submitLabel = isLogin && otcMode
    ? translate({ key: otcSent ? 'login.emailCodeVerify' : 'login.emailCodeSend' })
    : buttonText;

  return (
    <form onSubmit={handleFormSubmit} className="flex flex-col gap-5 w-full">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-semibold text-lg leading-tight">{title}</h1>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {step === 'pending' && (
            <motion.div key="pending" {...AUTH_STEP_MOTION} className="flex items-center justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-container1-border border-t-primary animate-spin" />
            </motion.div>
          )}

          {/* #2FA — the challenge step: password/email-code verified, enter the authenticator (or recovery) code. */}
          {step === 'challenge' && (
            <motion.div key="challenge" {...AUTH_STEP_MOTION} className="flex flex-col gap-3">
              {challengeFromEmailCode && (
                <p className="text-xs text-correct font-medium">{translate({ key: 'login.twoFactorAfterEmailCode' })}</p>
              )}
              <p className="text-xs text-common">{translate({ key: 'login.twoFactorPrompt' })}</p>
              <input
                name="twoFactorCode" type="text" inputMode="numeric" autoComplete="one-time-code"
                value={code} onChange={(e) => { setCode(e.target.value); }}
                placeholder={translate({ key: 'login.twoFactorPlaceholder' })}
                className={`${inputClass} font-mono tracking-widest`}
              />
              <button type="submit" disabled={loading || code.trim().length === 0} className={AUTH_BUTTON_CLASS}>
                {loading ? translate({ key: 'login.loading' }) : translate({ key: 'login.twoFactorVerify' })}
              </button>
              <button type="button" className="text-xs text-muted hover:text-title cursor-pointer" onClick={() => { setChallengeToken(null); setChallengeFromEmailCode(false); setCode(""); }}>
                {translate({ key: 'login.twoFactorBack' })}
              </button>
            </motion.div>
          )}

          {step === 'credentials' && (
            <motion.div key="credentials" {...AUTH_STEP_MOTION} className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                {!isLogin && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="name" className="font-medium text-xs">{translate({ key: 'login.name' })}</label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      placeholder="John Pork"
                      className={inputClass}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <label htmlFor="email" className="font-medium text-xs">{translate({ key: 'login.emailAddress' })}</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    //? `username` is what password managers pair with the password field on a login;
                    //? on register the field is a plain new email address.
                    autoComplete={isLogin ? "username" : "email"}
                    placeholder="johnpork@gmail.com"
                    className={inputClass}
                  />
                </div>

                {/* #email-code — password field ⇄ emailed-code field, cross-faded so neither pops. */}
                <AnimatePresence mode="wait" initial={false}>
                  {isLogin && otcMode ? (
                    otcSent && (
                      <motion.div key="otc" {...AUTH_STEP_MOTION} className="flex flex-col gap-1">
                        <label htmlFor="otc" className="font-medium text-xs">{translate({ key: 'login.emailCodeLabel' })}</label>
                        {/* Distinct from the 2FA prompt: this code arrives by EMAIL and replaces the password. */}
                        <p className="text-xs text-common">{translate({ key: 'login.emailCodePrompt' })}</p>
                        <input id="otc" name="emailCode" type="text" inputMode="numeric" autoComplete="one-time-code"
                          value={code} onChange={(e) => { setCode(e.target.value); }}
                          placeholder={translate({ key: 'login.twoFactorPlaceholder' })} className={`${inputClass} font-mono tracking-widest`} />
                      </motion.div>
                    )
                  ) : (
                    <motion.div key="password" {...AUTH_STEP_MOTION}>
                      <PasswordField
                        id="password"
                        label={translate({ key: 'login.password' })}
                        autoComplete={isLogin ? "current-password" : "new-password"}
                        hint={isLogin ? undefined : translate({ key: 'login.passwordHint' })}
                        trailing={isLogin ? (
                          <Link to="/reset-password" className="text-xs text-primary hover:text-primary-hover cursor-pointer">
                            {translate({ key: 'login.forgotPassword' })}
                          </Link>
                        ) : undefined}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {!isLogin && (
                  <PasswordField
                    id="confirmPassword"
                    label={translate({ key: 'login.confirmPassword' })}
                    autoComplete="new-password"
                  />
                )}

                {/* #email-code passwordless login: send a code, then verify it. Else the normal credentials submit. */}
                <button type="submit" disabled={loading} className={`mt-1 ${AUTH_BUTTON_CLASS}`}>
                  {loading ? translate({ key: 'login.loading' }) : submitLabel}
                </button>

                {/* #email-code toggle (login only): passwordless ⇄ password. */}
                {isLogin && (
                  <button type="button" className="text-xs text-primary hover:text-primary-hover cursor-pointer self-center"
                    onClick={() => { setOtcMode((v) => !v); setOtcSent(false); setCode(""); }}>
                    {translate({ key: otcMode ? 'login.usePassword' : 'login.useEmailCode' })}
                  </button>
                )}
              </div>

              {oauthProviders.length > 0 && (
                <div className="flex items-center w-full text-common text-xs before:flex-1 before:border-t before:border-container1-border before:content-[''] after:flex-1 after:border-t after:border-container1-border after:content-['']">
                  <span className="px-3">{translate({ key: 'login.orContinueWith' })}</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {ready && oauthProviders.length > 0 && (
          /* A lone provider stretches full width — a single button in a 2-column grid left an empty
             cell beside it, which read as an unfinished layout. */
          <div className={`grid gap-2 ${oauthProviders.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {oauthProviders.map((provider) => (
              <button
                type="button"
                key={provider}
                onClick={() => { startOauth(provider); }}
                className="h-11 rounded-lg cursor-pointer bg-container1 text-title text-sm border border-container1-border flex gap-2 items-center justify-center hover:bg-container1-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/60"
              >
                <img src={`/${provider}.png`} alt={provider} className="w-4 h-4" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span>{provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
              </button>
            ))}
          </div>
        )}
    </form>
  );
}
