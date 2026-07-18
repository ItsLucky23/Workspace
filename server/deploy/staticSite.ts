//? GAP_SCAN G3 — ship-it-live for Studio / Designer artifacts.
//?
//? Studio could GENERATE a landing page and the Designer a themed UI, and then both dead-ended: the HTML
//? lived in a `StudioArtifact.content` JSON blob with no way to put it in front of a human. `ensureEnvironment`
//? was no help — it deploys a git checkout in a container, which a one-file static page does not need.
//?
//? So this is the small, honest path: persist the artifact's HTML as a PublishedSite and serve it at
//? `/s/<slug>` (plus a subdomain route when a base domain is configured). One click, a real URL, no repo.
//?
//? Security: the HTML is AI-generated and therefore untrusted. It is served with a strict CSP and
//? `X-Frame-Options: DENY`, from a path that carries no session cookie — it can never act as the app.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { baseDomain } from '../proxy';

export const SITE_PREFIX = '/s/';

//? A stable, url-safe slug from the artifact title (+ a short hash so two "Landing page" artifacts do not
//? collide). Deterministic: re-publishing the same artifact updates the same URL instead of leaking a new one.
export function siteSlug(title: string, artifactId: string): string {
  const base = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '').slice(0, 40) || 'site';
  const suffix = createHash('sha256').update(artifactId).digest('hex').slice(0, 6);
  return `${base}-${suffix}`;
}

//? Pull the servable HTML out of an artifact's content blob. Studio landing pages store `{ html }`;
//? anything else (a token set, a copy list) is not a page and is refused rather than rendered as junk.
export function extractHtml(content: unknown): string | null {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  const html = (content as Record<string, unknown>).html;
  if (typeof html !== 'string' || html.trim().length === 0) return null;
  return html;
}

//? The response headers for a published page. The CSP is deliberately tight: the page may style itself and
//? load images, but it cannot run inline script or call out — an AI-authored page is untrusted content, and
//? this is what keeps "publish" from becoming "run whatever the model wrote in my domain".
export function siteHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'public, max-age=60',
  };
}

//? The public origin a published page is reachable on: the configured base domain in a hosted install,
//? localhost in development. Kept here so the Conductor does not have to know about proxy config.
export function publicBaseUrl(): string {
  const domain = baseDomain();
  return domain === 'localhost' ? `http://localhost:${process.env.PORT ?? '3000'}` : `https://${domain}`;
}

export interface PublishSiteResult { ok: boolean; slug?: string; url?: string; error?: string }

//? Publish (or re-publish) an artifact as a live page. Same artifact ⇒ same slug ⇒ same URL, so sharing a
//? link once is enough.
export async function publishArtifactSite(
  prisma: PrismaClient, workspaceId: string, artifactId: string, baseUrl: string,
): Promise<PublishSiteResult> {
  const artifact = await prisma.studioArtifact.findFirst({ where: { workspaceId, id: artifactId }, select: { title: true, content: true, status: true } });
  if (!artifact) return { ok: false, error: 'artifact.notFound' };
  if (artifact.status !== 'ready') return { ok: false, error: 'artifact.notReady' };
  const html = extractHtml(artifact.content);
  if (!html) return { ok: false, error: 'artifact.notAPage' };

  const slug = siteSlug(artifact.title, artifactId);
  const existing = await prisma.publishedSite.findFirst({ where: { workspaceId, slug }, select: { id: true } });
  await (existing
    ? prisma.publishedSite.update({ where: { id: existing.id }, data: { html, title: artifact.title, artifactId } })
    : prisma.publishedSite.create({ data: { workspaceId, slug, html, title: artifact.title, artifactId } }));

  return { ok: true, slug, url: `${baseUrl.replace(/\/+$/, '')}${SITE_PREFIX}${slug}` };
}

export async function unpublishArtifactSite(prisma: PrismaClient, workspaceId: string, slug: string): Promise<{ ok: boolean }> {
  await prisma.publishedSite.deleteMany({ where: { workspaceId, slug } });
  return { ok: true };
}
