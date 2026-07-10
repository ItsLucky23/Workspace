//? D3 — the Caddy on-demand-TLS "ask" endpoint. Before Caddy issues a TLS certificate for a hostname, it GETs
//? this endpoint with `?domain=<host>`; a 200 authorizes issuance, anything else refuses. This is the
//? SSRF/mis-issue GUARD: we authorize ONLY a domain that is a known `Environment.customDomain` in our DB, so an
//? attacker pointing arbitrary DNS at our IP can't make us mint certs for hostnames we don't serve. Origin-exempt
//? (Caddy calls it server-to-server, no session/cookie). Wire Caddy's `apps.tls.automation.on_demand.ask` to
//? `http://<app-host>/proxy/tls-ask` (see docs/HOSTING.md).

import { getPrismaClient } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

export const TLS_ASK_PATH = '/proxy/tls-ask';

//? Extract the `domain` query param from a raw request url, lowercased + trimmed. Pure + exported for tests.
export function parseAskDomain(rawUrl: string): string {
  const q = rawUrl.split('?')[1] ?? '';
  return (new URLSearchParams(q).get('domain') ?? '').trim().toLowerCase();
}

export function registerTlsAsk(): void {
  registerOriginExemptPath({ pathPrefix: TLS_ASK_PATH });
  registerCustomRoute(async (req, res) => {
    const url = req.url ?? '';
    if (!url.startsWith(TLS_ASK_PATH)) return false;
    const domain = parseAskDomain(url);
    //? luckystack-allow tenant-scope: the ask-endpoint is a GLOBAL issuance gate — it must recognise a custom
    //? domain registered by ANY workspace (Caddy has no tenant context), so this findFirst is cross-tenant by design.
    const known = domain.length > 0 && (await getPrismaClient().environment.findFirst({ where: { customDomain: domain }, select: { id: true } })) !== null;
    res.statusCode = known ? 200 : 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end(known ? 'ok' : 'unknown domain');
    return true;
  }, { phase: 'pre-params' });
}
