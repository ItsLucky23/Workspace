//? #123 — PWA install-prompt capture. The browser fires `beforeinstallprompt` once per page load
//? (often before any React component mounts), so we capture + stash it at app boot (main.tsx calls
//? `initInstallPrompt()`), then a settings/mobile button reads `canInstall()` and calls `promptInstall()`.
//? Phone-first users rarely find the browser's native "Add to home screen", so we surface it in-app.

//? Minimal shape of the non-standard event (not in the TS DOM lib).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = (): void => { for (const l of listeners) l(); };

//? Register the app-wide capture once (idempotent). Called from main.tsx at boot.
let inited = false;
export function initInstallPrompt(): void {
  if (inited || typeof globalThis === 'undefined') return;
  inited = true;
  globalThis.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; notify(); });
  globalThis.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

export function canInstall(): boolean { return deferred !== null; }

//? Show the native install prompt; resolves true if the user accepted. The event is single-use.
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const evt = deferred;
  await evt.prompt();
  const choice = await evt.userChoice;
  deferred = null;
  notify();
  return choice.outcome === 'accepted';
}

//? Subscribe to availability changes (for useSyncExternalStore).
export function subscribeInstall(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

//? GAP_SCAN B4 — iOS Safari never fires `beforeinstallprompt`, so `canInstall()` is permanently false there
//? and the phone-first install path silently didn't exist. iOS CAN install (Share → Add to Home Screen) and
//? only delivers web-push to an ALREADY-installed PWA, so the UI needs both facts.
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return iOS && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

//? Already running as an installed app (home-screen / standalone display mode)?
export function isStandalone(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  //? `navigator.standalone` is iOS-only and absent from the TS DOM lib — read it reflectively (no cast).
  const legacyStandalone: unknown = Reflect.get(navigator, 'standalone');
  return globalThis.matchMedia('(display-mode: standalone)').matches || legacyStandalone === true;
}
