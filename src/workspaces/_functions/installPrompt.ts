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
