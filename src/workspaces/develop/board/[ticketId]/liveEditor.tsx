//? Shared live-editor plumbing for a ticket: launching openvscode-server INSIDE the ticket container
//? (workspaces/openEditor, ADR 0010) + the lazy iframe host. Used by BOTH the in-ticket Code tab's "live"
//? mode (CodePanel) and the dedicated full-page editor route ([ticketId]/editor/page.tsx), so the launch
//? state machine lives in one place instead of being duplicated across the two surfaces.

/* eslint-disable react-refresh/only-export-components -- shared plumbing module: the lazy VS Code embed is co-located with the useLiveEditor hook by design (both are the reused live-editor bits; dev-only fast-refresh rule) */
import { lazy, useCallback, useState } from 'react';

import { apiRequest, tryCatch } from '@luckystack/core/client';

//? Lazy so the iframe host (+ its deps) only loads when the live editor is actually opened.
export const LazyVsCodeEmbed = lazy(() => import('src/_components/editor/VsCodeEmbed').then((m) => ({ default: m.VsCodeEmbed })));

// luckystack-allow i18n-jsx: "Promise" below is a TypeScript return type, not user-facing JSX text.
export interface LiveEditor {
  liveUrl: string | null;
  launching: boolean;
  err: string | null;
  launch: () => Promise<void>;
}

//? The openEditor launch lifecycle: POST workspaces/openEditor → { url } or an error code. `launch` is
//? stable per (workspaceId, ticketKey) so the full-page route can fire it from an effect without re-running.
//? Callers own their own view chrome (mode switch, full-page layout); this only owns the launch state.
export function useLiveEditor(workspaceId: string, ticketKey: string): LiveEditor {
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const launch = useCallback(async (): Promise<void> => {
    setLaunching(true); setErr(null);
    const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/openEditor', version: 'v1', data: { workspaceId, ticketKey } }));
    setLaunching(false);
    if (error || res?.status !== 'success' || !res.result.ok || !res.result.url) {
      const code = res?.status === 'error' ? res.errorCode : (res?.status === 'success' ? res.result.error : undefined);
      setErr(code ?? 'editor.launchFailed');
      return;
    }
    setLiveUrl(res.result.url);
  }, [workspaceId, ticketKey]);
  return { liveUrl, launching, err, launch };
}
