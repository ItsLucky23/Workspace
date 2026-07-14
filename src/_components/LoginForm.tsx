import { faRightToBracket, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { backendUrl, loginRedirectUrl, loginPageUrl, SessionLayout, sessionBasedToken } from "config";
import tryCatch from "shared/tryCatch";

import { i18nNotify as notify, useTranslator } from "@luckystack/core/client";

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
  const subtitleText = isLogin ? translate({ key: 'login.noAccount' }) : translate({ key: 'login.haveAccount' });
  const subtitleLink = isLogin ? translate({ key: 'login.createAccount' }) : translate({ key: 'login.logIn' });
  const redirectURL = isLogin ? "/register" : "/login";
  const buttonText = isLogin ? translate({ key: 'login.logIn' }) : translate({ key: 'login.signUp' });
  const headerIcon = isLogin ? faRightToBracket : faUserPlus;

  const inputClass = "rounded-md w-full h-9 border border-container1-border bg-container1 px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  //? #2FA/email-code (ADR 0024). `challengeToken` set ⇒ show the 2FA code step (password verified, session not
  //? minted yet). `otcMode` ⇒ passwordless email-code login. `code` is the shared 6-digit / recovery input.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buttonRef.current?.click();
    }
  };

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>, provider: string) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    if (provider !== "credentials") {
      globalThis.location.href = `${backendUrl}/auth/api/${provider}`;
      return;
    }

    const form = (e.target as HTMLElement).closest("form");
    if (!form) {
      setLoading(false);
      console.error("Form not found"); return;
    }

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
        body: JSON.stringify({ name, email, password, confirmPassword, provider }),
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
    if (res.requiresTwoFactor && res.challengeToken) { setChallengeToken(res.challengeToken); return; }
    if (res.status !== true) { notify.error({ key: res.errorCode ?? res.reason ?? 'login.twoFactorInvalid' }); return; }
    completeSession(res.sessionToken, res.authenticated === true, res.reason);
  };

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- form container needs Enter key handling */
    <form
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="p-6 bg-container1 border border-container1-border rounded-xl shadow-sm text-title flex flex-col gap-5 max-w-[360px] w-full"
    >
        <div className="flex flex-col items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <FontAwesomeIcon icon={headerIcon} size="lg" />
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="font-semibold text-lg leading-tight">{title}</h1>
            <p className="text-xs text-common">
              {subtitleText}
              <Link to={redirectURL} className="text-primary hover:text-primary-hover font-medium cursor-pointer">
                {subtitleLink}
              </Link>
            </p>
          </div>
        </div>

        {!ready && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-container1-border border-t-primary animate-spin" />
          </div>
        )}

        {/* #2FA — the challenge step: password/email-code verified, enter the authenticator (or recovery) code. */}
        {ready && challengeToken !== null && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-common">{translate({ key: 'login.twoFactorPrompt' })}</p>
            <input
              name="twoFactorCode" type="text" inputMode="numeric" autoComplete="one-time-code"
              value={code} onChange={(e) => { setCode(e.target.value); }}
              placeholder={translate({ key: 'login.twoFactorPlaceholder' })}
              className={`${inputClass} font-mono tracking-widest`}
            />
            <button type="button" ref={buttonRef} disabled={loading || code.trim().length === 0}
              className="h-9 rounded-md bg-primary text-title-primary text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
              onClick={() => void verifyChallenge()}>
              {loading ? translate({ key: 'login.loading' }) : translate({ key: 'login.twoFactorVerify' })}
            </button>
            <button type="button" className="text-xs text-muted hover:text-title cursor-pointer" onClick={() => { setChallengeToken(null); setCode(""); }}>
              {translate({ key: 'login.twoFactorBack' })}
            </button>
          </div>
        )}

        {ready && showCredentials && challengeToken === null && (
          <>
            <div className="flex flex-col gap-3">
              {!isLogin && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="name" className="font-medium text-xs">{translate({ key: 'login.name' })}</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
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
                  placeholder="johnpork@gmail.com"
                  className={inputClass}
                />
              </div>
              {/* #email-code — in passwordless login mode the password field is hidden. */}
              {!(isLogin && otcMode) && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="font-medium text-xs">{translate({ key: 'login.password' })}</label>
                    {isLogin && (
                      <Link to="/reset-password" className="text-xs text-primary hover:text-primary-hover cursor-pointer">
                        {translate({ key: 'login.forgotPassword' })}
                      </Link>
                    )}
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="********"
                    className={inputClass}
                  />
                </div>
              )}
              {/* #email-code — the code input appears once a code has been sent (passwordless login mode). */}
              {isLogin && otcMode && otcSent && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="otc" className="font-medium text-xs">{translate({ key: 'login.emailCodeLabel' })}</label>
                  <input id="otc" name="emailCode" type="text" inputMode="numeric" autoComplete="one-time-code"
                    value={code} onChange={(e) => { setCode(e.target.value); }}
                    placeholder={translate({ key: 'login.twoFactorPlaceholder' })} className={`${inputClass} font-mono tracking-widest`} />
                </div>
              )}
              {!isLogin && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="confirmPassword" className="font-medium text-xs">{translate({ key: 'login.confirmPassword' })}</label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    placeholder="********"
                    className={inputClass}
                  />
                </div>
              )}

              {/* #email-code passwordless login: send a code, then verify it. Else the normal credentials submit. */}
              {isLogin && otcMode ? (
                <button type="button" ref={buttonRef}
                  className="mt-1 h-9 rounded-md bg-primary text-title-primary text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
                  onClick={() => void (otcSent ? verifyEmailCode() : requestEmailCode())} disabled={loading}>
                  {loading ? translate({ key: 'login.loading' }) : translate({ key: otcSent ? 'login.emailCodeVerify' : 'login.emailCodeSend' })}
                </button>
              ) : (
                <button
                  type="button"
                  ref={buttonRef}
                  className="mt-1 h-9 rounded-md bg-primary text-title-primary text-sm font-medium hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-60"
                  onClick={(e) => void handleSubmit(e, "credentials")}
                  disabled={loading}
                >
                  {loading ? translate({ key: 'login.loading' }) : buttonText}
                </button>
              )}
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
          </>
        )}

        {ready && oauthProviders.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {oauthProviders.map((provider) => (
              <button
                type="button"
                key={provider}
                onClick={(e) => void handleSubmit(e, provider)}
                className="h-9 rounded-md cursor-pointer bg-container1 text-title text-sm border border-container1-border flex gap-2 items-center justify-center hover:bg-container1-hover transition-colors"
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
