//? H3 (ads) — the trackable short-link redirect. `GET /l/<slug>` records a click (atomic increment) and
//? 302-redirects to the ShortLink's `targetUrl`, passing THROUGH any UTM query params on the short link (so a
//? campaign's `?utm_source=…` reaches the landing page). Origin-exempt + public (a click has no browser Origin;
//? the slug is the only key). Best-effort: an unknown slug is a clean 404, never a crash.

import { getPrismaClient } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

const PREFIX = '/l/';

//? Parse `/l/<slug>?utm_...=..` → the slug + the raw query string (UTM passthrough). Pure + exported for tests.
export function parseShortLink(rawUrl: string): { slug: string; query: string } {
  const [pathPart, query = ''] = rawUrl.split('?');
  const slug = (pathPart ?? '').slice(PREFIX.length).replace(/\/+$/, '');
  return { slug, query };
}

//? Merge the short link's own target query with the incoming UTM passthrough (the incoming params win, so a
//? per-post `?utm_content=variantB` overrides a default on the target). Pure + exported for tests.
export function buildRedirectUrl(targetUrl: string, query: string): string {
  if (query.length === 0) return targetUrl;
  const [base, targetQuery = ''] = targetUrl.split('?');
  const merged = new URLSearchParams(targetQuery);
  for (const [k, v] of new URLSearchParams(query)) merged.set(k, v);
  const qs = merged.toString();
  return qs.length > 0 ? `${base}?${qs}` : (base ?? targetUrl);
}

export function registerShortLinkRedirect(): void {
  registerOriginExemptPath({ pathPrefix: PREFIX });
  registerCustomRoute(async (req, res) => {
    const rawUrl = req.url ?? '';
    if (!rawUrl.startsWith(PREFIX)) return false;
    const { slug, query } = parseShortLink(rawUrl);
    if (slug.length === 0) { res.statusCode = 404; res.end(); return true; }
    //? luckystack-allow tenant-scope: a public redirect has no session/tenant context — the slug is globally
    //? unique, so this findFirst is cross-tenant by design (same pattern as the tls-ask + download routes).
    const prisma = getPrismaClient();
    const link = await prisma.shortLink.findFirst({ where: { slug }, select: { id: true, targetUrl: true } });
    if (!link) { res.statusCode = 404; res.end(); return true; }
    //? Record the click (atomic increment — a click is the campaign's own conversion signal). Best-effort.
    await prisma.shortLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } }).catch(() => { /* click tracking is best-effort */ });
    res.statusCode = 302;
    res.setHeader('Location', buildRedirectUrl(link.targetUrl, query));
    res.end();
    return true;
  }, { phase: 'pre-params' });
}
