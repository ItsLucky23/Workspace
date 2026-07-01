/* eslint-disable react-refresh/only-export-components */
//? Project-side SessionProvider: owns the fetch + socket lifecycle for
//? the current session and writes into the framework's `SessionContext`
//? (from `@luckystack/core/client`). Framework components consume the
//? session via `useSession()` from the same module — that hook reads
//? this context. The provider also mirrors the active session into
//? `setLatestSession()` so non-React code (notify, language source) can
//? read it.

import { useState, ReactNode, useEffect, useMemo } from 'react';

import { apiRequest } from 'src/_sockets/apiRequest';
import { socket, useSocket } from 'src/_sockets/socketInitializer';
import {
  SessionContext,
  setLatestSession,
  proposeLogin,
  getCurrentSession as coreGetCurrentSession,
  socketEventNames,
} from '@luckystack/core/client';

import { dev, pageTitle, SessionLayout } from 'config';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionLayout | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useSocket(session); //? starts the socket connection

  //? Commit through the vetoable `proposeLogin` entry point so any
  //? registered `preLogin` client hook can abort (suspended account,
  //? feature-flag gate, geo block). Roll local state back to `null` on
  //? veto so the UI doesn't render half-logged-in.
  useEffect(() => {
    if (session === null) {
      setLatestSession(null);
      return;
    }
    const run = { cancelled: false };
    void (async () => {
      const result = await proposeLogin(session);
      if (run.cancelled) return;
      if (!result.committed) {
        if (dev) console.warn('[session] preLogin hook vetoed transition', result.signal);
        setSession(null);
      }
    })();
    return () => { run.cancelled = true; };
  }, [session]);

  //? Hook in client-side error-tracking user context here if you want
  //? Sentry breadcrumbs / issues to know which user they belong to.
  //? `@luckystack/error-tracking` ships server-side (`@sentry/node`).
  //? For browser reporting install `@sentry/react` separately and call
  //? `Sentry.setUser({ id: session.id, email: session.email })` in this
  //? effect.

  useEffect(() => {
    if (dev && session?.email) {
      document.title = `[DEV] ${session.email} - ${pageTitle}`;
      return;
    }
    document.title = dev ? `[DEV] ${pageTitle}` : pageTitle;
  }, [session?.email]);

  useEffect(() => {
    void (async () => {
      const response = await apiRequest({ name: 'system/session', version: 'v1' });
      //? Discriminate on the success branch before reading `.result`: on the
      //? raw union the error branch's `[key: string]: unknown` widens `.result`
      //? to `{}` (a tsc error). A successful response with a null result is the
      //? anonymous session — still mark loaded so Middleware doesn't hang.
      if (response.status !== 'success') return;
      if (response.result) setSession(response.result);
      setSessionLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handler = (data: string) => {
      if (dev) { console.log('updateSession', JSON.parse(data)); }
      const parsed = JSON.parse(data) as SessionLayout;
      setSession(prev => {
        if (!prev) return parsed;
        return {
          ...prev,
          ...parsed,
          avatar: `${parsed.avatar}?v=${String(Date.now())}`,
        };
      });
    };

    socket.on(socketEventNames.updateSession, handler);
    return () => {
      if (!socket) return;
      socket.off(socketEventNames.updateSession, handler);
    };
  }, []);

  const contextValue = useMemo(() => ({
    session, sessionLoaded,
  }), [session, sessionLoaded]);

  return (
    <SessionContext value={contextValue}>
      {children}
    </SessionContext>
  );
}

//? Convenience re-exports so existing app code that imports `useSession`
//? or `getCurrentSession` from this file keeps working. Both ultimately
//? resolve to `@luckystack/core/client`.
export { useSession } from '@luckystack/core/client';
export const getCurrentSession = (): SessionLayout | null =>
  coreGetCurrentSession<SessionLayout>();
