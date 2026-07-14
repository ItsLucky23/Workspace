//? 2FA enrollment UI (ADR 0024 / @luckystack/login). Drives the authenticated `/auth/api/2fa/*` routes:
//? setup → show the secret + otpauth URI (add to an authenticator app) → confirm the first code → enable →
//? show the one-time recovery codes; plus disable + regenerate-recovery-codes for an enrolled user. Uses the
//? CSRF-aware `httpFetch` (the authed 2FA routes are CSRF-enforced in cookie mode) + a Bearer token in
//? sessionStorage (token) mode. Mounted in Settings; reads `session.twoFactorEnabled` for the current state.

import { useState } from "react";

import { httpFetch, useSession, i18nNotify as notify, useTranslator } from "@luckystack/core/client";

import { backendUrl, SessionLayout, sessionBasedToken } from "../../config";

//? Call an authed /auth/api/2fa/* route: CSRF-aware + Bearer in token mode. Returns the parsed JSON body.
// luckystack-allow i18n-jsx: the ": Promise<{ status … }>" match is a TS return-type annotation, not JSX text (linter false positive).
async function post2fa(path: string, body: Record<string, unknown>): Promise<{ status: boolean | string; errorCode?: string; reason?: string; secret?: string; otpauthUri?: string; recoveryCodes?: string[] }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Session-Based-Token": String(sessionBasedToken) };
  if (sessionBasedToken) { const t = sessionStorage.getItem("token"); if (t) headers.Authorization = `Bearer ${t}`; }
  const res = await httpFetch(`${backendUrl}/auth/api/2fa/${path}`, { method: "POST", headers, body: JSON.stringify(body), credentials: "include" });
  return res.json() as Promise<{ status: boolean | string }>;
}

export default function TwoFactorSection() {
  const translate = useTranslator();
  const { session } = useSession<SessionLayout>();
  const enrolled = session?.twoFactorEnabled === true;
  //? Local flow state: 'idle' → 'enrolling' (secret shown, awaiting first code) → 'codes' (recovery shown once).
  const [phase, setPhase] = useState<"idle" | "enrolling" | "codes">("idle");
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const inputCls = "h-9 px-3 rounded-lg border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 w-full font-mono tracking-widest";
  const btnCls = "rounded-lg bg-primary text-title-primary px-3 h-9 text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
  const ghostCls = "rounded-lg border border-container1-border px-3 h-9 text-sm text-muted hover:text-title cursor-pointer disabled:opacity-50";

  const startSetup = async (): Promise<void> => {
    setBusy(true);
    const res = await post2fa("setup", {});
    setBusy(false);
    if (res.status !== true || !res.secret) { notify.error({ key: res.errorCode ?? res.reason ?? "settings.twoFactor.setupFailed" }); return; }
    setSecret(res.secret); setOtpauthUri(res.otpauthUri ?? ""); setCode(""); setPhase("enrolling");
  };

  const confirmEnable = async (): Promise<void> => {
    if (code.trim().length === 0) return;
    setBusy(true);
    const res = await post2fa("enable", { code: code.trim() });
    setBusy(false);
    if (res.status !== true) { notify.error({ key: res.errorCode ?? res.reason ?? "settings.twoFactor.codeInvalid" }); return; }
    setRecoveryCodes(res.recoveryCodes ?? []); setCode(""); setPhase("codes");
    notify.success({ key: "settings.twoFactor.enabled" });
  };

  const disable = async (): Promise<void> => {
    if (code.trim().length === 0) return;
    setBusy(true);
    const res = await post2fa("disable", { code: code.trim() });
    setBusy(false);
    if (res.status !== true) { notify.error({ key: res.errorCode ?? res.reason ?? "settings.twoFactor.codeInvalid" }); return; }
    setCode(""); setPhase("idle");
    notify.success({ key: "settings.twoFactor.disabled" });
    //? Reload so the session (twoFactorEnabled) refreshes across the app.
    setTimeout(() => { globalThis.location.reload(); }, 800);
  };

  const regenerate = async (): Promise<void> => {
    if (code.trim().length === 0) return;
    setBusy(true);
    const res = await post2fa("recovery-codes", { code: code.trim() });
    setBusy(false);
    if (res.status !== true) { notify.error({ key: res.errorCode ?? res.reason ?? "settings.twoFactor.codeInvalid" }); return; }
    setRecoveryCodes(res.recoveryCodes ?? []); setCode(""); setPhase("codes");
    notify.success({ key: "settings.twoFactor.recoveryRegenerated" });
  };

  //? One-time recovery-code display (shared by enable + regenerate).
  if (phase === "codes") {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-sm text-common">{translate({ key: "settings.twoFactor.recoveryIntro" })}</div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-container1-border bg-container2/40 p-3 font-mono text-sm text-title">
          {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
        </div>
        <button type="button" className={btnCls} onClick={() => { void navigator.clipboard.writeText(recoveryCodes.join("\n")); }}>{translate({ key: "settings.twoFactor.copyCodes" })}</button>
        <button type="button" className={ghostCls} onClick={() => { setPhase("idle"); setRecoveryCodes([]); }}>{translate({ key: "settings.twoFactor.done" })}</button>
      </div>
    );
  }

  //? Enrolled: offer disable + regenerate (both require a current code).
  if (enrolled) {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-sm text-correct flex items-center gap-1.5">{translate({ key: "settings.twoFactor.activeState" })}</div>
        <input value={code} onChange={(e) => { setCode(e.target.value); }} placeholder={translate({ key: "settings.twoFactor.codePlaceholder" })} className={inputCls} inputMode="numeric" autoComplete="one-time-code" />
        <div className="flex gap-2">
          <button type="button" disabled={busy || code.trim().length === 0} className={btnCls} onClick={() => { void regenerate(); }}>{translate({ key: "settings.twoFactor.regenerate" })}</button>
          <button type="button" disabled={busy || code.trim().length === 0} className={ghostCls} onClick={() => { void disable(); }}>{translate({ key: "settings.twoFactor.disable" })}</button>
        </div>
      </div>
    );
  }

  //? Enrolling: secret shown, awaiting the first code.
  if (phase === "enrolling") {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-sm text-common">{translate({ key: "settings.twoFactor.enrollIntro" })}</div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">{translate({ key: "settings.twoFactor.secretLabel" })}</span>
          <code className="rounded-lg border border-container1-border bg-container2/40 px-3 py-2 text-sm font-mono text-title break-all">{secret}</code>
          {otpauthUri.length > 0 && <a href={otpauthUri} className="text-xs text-primary hover:underline break-all">{translate({ key: "settings.twoFactor.otpauthLink" })}</a>}
        </div>
        <input value={code} onChange={(e) => { setCode(e.target.value); }} placeholder={translate({ key: "settings.twoFactor.codePlaceholder" })} className={inputCls} inputMode="numeric" autoComplete="one-time-code" />
        <div className="flex gap-2">
          <button type="button" disabled={busy || code.trim().length === 0} className={btnCls} onClick={() => { void confirmEnable(); }}>{translate({ key: "settings.twoFactor.confirm" })}</button>
          <button type="button" disabled={busy} className={ghostCls} onClick={() => { setPhase("idle"); setCode(""); }}>{translate({ key: "settings.twoFactor.cancel" })}</button>
        </div>
      </div>
    );
  }

  //? Idle (not enrolled).
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-common">{translate({ key: "settings.twoFactor.intro" })}</div>
      <button type="button" disabled={busy} className={`${btnCls} self-start`} onClick={() => { void startSetup(); }}>{translate({ key: "settings.twoFactor.enable" })}</button>
    </div>
  );
}
