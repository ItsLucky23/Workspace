//? GAP_SCAN G3 — the public route that serves a published Studio/Designer page: `GET /s/<slug>`.
//?
//? Origin-exempt and session-less by design: a shared landing page is opened by strangers, and it must
//? never carry the app's auth context. The strict CSP from `staticSite.ts` is what makes serving
//? AI-generated HTML from our own domain safe — no script, no outbound calls, no framing.

import { getPrismaClient } from '@luckystack/core';
import { registerCustomRoute, registerOriginExemptPath } from '@luckystack/server';

import { SITE_PREFIX, siteHeaders } from './staticSite';

//? `/s/<slug>` → the slug (query + trailing slashes stripped). Pure + exported for tests.
export function parseSitePath(rawUrl: string): string {
  const [pathPart] = rawUrl.split('?');
  return (pathPart ?? '').slice(SITE_PREFIX.length).replace(/\/+$/, '').toLowerCase();
}

export function registerPublishedSiteRoute(): void {
  registerOriginExemptPath({ pathPrefix: SITE_PREFIX });
  registerCustomRoute(async (req, res) => {
    const rawUrl = req.url ?? '';
    if (!rawUrl.startsWith(SITE_PREFIX)) return false;
    const slug = parseSitePath(rawUrl);
    //? A slug is `[a-z0-9-]` by construction; refusing anything else keeps this off the DB for junk paths.
    if (slug.length === 0 || !/^[a-z0-9-]+$/.test(slug)) { res.statusCode = 404; res.end(); return true; }
    //? luckystack-allow tenant-scope: a public page has no session/tenant context — the slug is globally
    //? unique, so this findFirst is cross-tenant by design (same pattern as the shortlink + download routes).
    const site = await getPrismaClient().publishedSite.findFirst({ where: { slug }, select: { html: true } });
    if (!site) { res.statusCode = 404; res.end(); return true; }
    for (const [header, value] of Object.entries(siteHeaders())) res.setHeader(header, value);
    res.statusCode = 200;
    res.end(site.html);
    return true;
  }, { phase: 'pre-params' });
}
