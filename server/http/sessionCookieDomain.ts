//? Consumer-side bridge for LuckyStack 0.7.5: ProjectConfig exposes http.sessionCookieDomain, but the
//? server's credentials/session-cookie serializer does not yet emit Domain. Patch only the session cookie
//? header at the Node response boundary; OAuth-state/CSRF cookies stay host-only. Remove after upgrading to
//? a framework release whose buildSessionCookieOptions consumes sessionCookieDomain.

import type { Server as HttpServer, ServerResponse } from 'node:http';

type HeaderValue = number | string | readonly string[];

const COOKIE_DOMAIN = /^\.?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i;

export function withSessionCookieDomain(value: HeaderValue, cookieName: string, domain: string): HeaderValue {
  const append = (cookie: string): string => {
    if (!cookie.startsWith(`${cookieName}=`) || /(?:^|;)\s*Domain=/i.test(cookie)) return cookie;
    return `${cookie}; Domain=${domain}`;
  };
  return Array.isArray(value) ? value.map((item) => append(String(item))) : append(String(value));
}

export function registerSessionCookieDomainBridge(server: HttpServer, input: { cookieName: string; domain?: string }): void {
  const domain = input.domain?.trim();
  if (!domain || !COOKIE_DOMAIN.test(domain)) return;
  server.prependListener('request', (_request, response: ServerResponse) => {
    const setHeader = response.setHeader.bind(response);
    response.setHeader = (name: string, value: number | string | readonly string[]): ServerResponse => {
      const next = name.toLowerCase() === 'set-cookie'
        ? withSessionCookieDomain(value, input.cookieName, domain)
        : value;
      return setHeader(name, next);
    };
  });
}
