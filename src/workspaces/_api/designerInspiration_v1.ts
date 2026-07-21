/** @docs owner ItsLucky23 */
//? Workspaces Designer — inspiration import (INS, DOCUMENTS_AND_SKILLS). Ops: `inspire-url` (capture
//? a site in a chromium container → vision-extract a theme PROPOSAL into the library, inactive),
//? `inspire-image` (same extraction from an uploaded screenshot), `compare` (our page vs the
//? inspiration → vision analysis outside the writer lease, then exactly one existing `ui-review-create`
//? Conductor op). The whole route requires workTickets; compare never writes a UiReviewRequest directly.

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { captureUrlScreenshot, extractThemeFromScreenshot, extractStyleFromScreenshot, compareDesigns, type CaptureViewport } from '../../../server/designer/inspiration';
import { discoverReferenceSites } from '../../../server/designer/webDiscovery';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { deterministicObjectId } from '../../../server/orchestrator/actionIds';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

type DesignerInspirationData =
  | { workspaceId: string; op: 'discover'; query: string }
  | { workspaceId: string; op: 'inspire-url'; url: string; hint?: string; viewport?: string; clientRequestId?: string }
  | { workspaceId: string; op: 'inspire-image'; imageUrl: string; hint?: string; clientRequestId?: string }
  | { workspaceId: string; op: 'compare'; projectId: string; ownUrl: string; inspirationUrl: string; viewport?: string; clientRequestId: string };

export interface ApiParams {
  data: DesignerInspirationData;
  user: SessionLayout;
  functions: Functions;
}

//? `validation = 'relaxed'` means the declared shape is a contract, not a runtime guarantee — read
//? every field through this guard so a malformed body errors cleanly instead of throwing on `.trim()`.
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

//? 3.2 — the capture viewport (desktop default; 'mobile' for the phone form factor).
const asViewport = (v: string | undefined): CaptureViewport => (v === 'mobile' ? 'mobile' : 'desktop');

function firstResultKey(result: unknown): string | undefined {
  if (result === null || typeof result !== 'object' || !('keys' in result) || !Array.isArray(result.keys)) return undefined;
  return result.keys.find((key): key is string => typeof key === 'string');
}

async function saveInspirationArtifacts(input: {
  workspaceId: string;
  userId: string;
  requestId: string;
  origin: string;
  theme: { name: string; description: string; light: Record<string, string>; dark: Record<string, string> };
  style: Record<string, unknown> | null;
}): Promise<{ id: string; styleId: string | null } | null> {
  const themeRequestId = `inspiration-theme:${input.requestId}`;
  const themeSaved = await enqueueInternalAction({
    workspaceId: input.workspaceId,
    op: 'design-library-write',
    target: { artifactId: deterministicObjectId(input.workspaceId, themeRequestId, 'design-artifact') },
    payload: {
      mode: 'save', kind: 'theme', name: input.theme.name,
      description: `${input.theme.description}${input.origin ? ` (from ${input.origin})` : ''}`,
      content: { light: input.theme.light, dark: input.theme.dark }, source: 'ai',
    },
    userId: input.userId,
    clientRequestId: themeRequestId,
  });
  const id = firstResultKey(themeSaved.result);
  if (!id) return null;
  if (!input.style) return { id, styleId: null };
  const styleName = typeof input.style.name === 'string' && input.style.name.trim().length > 0 ? input.style.name : 'Inspiration style';
  const styleDescription = typeof input.style.description === 'string' ? input.style.description : '';
  const styleRequestId = `inspiration-style:${input.requestId}`;
  const styleSaved = await enqueueInternalAction({
    workspaceId: input.workspaceId,
    op: 'design-library-write',
    target: { artifactId: deterministicObjectId(input.workspaceId, styleRequestId, 'design-artifact') },
    payload: {
      mode: 'save', kind: 'style', name: styleName,
      description: `${styleDescription}${input.origin ? ` (from ${input.origin})` : ''}`,
      content: input.style, source: 'ai',
    },
    userId: input.userId,
    clientRequestId: styleRequestId,
  });
  return { id, styleId: firstResultKey(styleSaved.result) ?? null };
}

export type CompareReviewEnqueueResult =
  | { ok: true; reviewId: string }
  | { ok: false; errorCode: 'api.invalidRequest' | 'auth.forbidden' };

//? Compare's ONLY authoritative write: re-check workTickets after the slow AI call, then enqueue one
//? existing ui-review-create action. The Conductor sanitizes + creates under its writer lease.
export async function enqueueCompareReview(prisma: Functions['db']['prisma'], input: {
  workspaceId: string;
  projectId: string;
  userId: string;
  ownUrl: string;
  inspirationUrl: string;
  notes: string;
  clientRequestId: string;
}): Promise<CompareReviewEnqueueResult> {
  if (input.clientRequestId.trim().length === 0 || input.projectId.trim().length === 0) return { ok: false, errorCode: 'api.invalidRequest' };
  const project = await prisma.project.findFirst({ where: { workspaceId: input.workspaceId, id: input.projectId }, select: { id: true } });
  if (!project) return { ok: false, errorCode: 'api.invalidRequest' };
  const dispatched = await dispatchControlSync({
    op: 'ui-review-create', roomCode: input.workspaceId, userId: input.userId, prisma,
    target: { projectId: project.id },
    payload: { page: 'inspiration-compare', screenshots: [input.ownUrl, input.inspirationUrl], problems: [], notes: input.notes },
    clientRequestId: input.clientRequestId,
  });
  if (!dispatched.ok) return { ok: false, errorCode: dispatched.errorCode === 'auth.forbidden' ? 'auth.forbidden' : 'api.invalidRequest' };
  const result = dispatched.result;
  const reviewId = typeof result === 'object' && result !== null && 'id' in result && typeof result.id === 'string' ? result.id : null;
  return reviewId ? { ok: true, reviewId } : { ok: false, errorCode: 'api.invalidRequest' };
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op } = data;
  if (!workspaceId || typeof op !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const prisma = functions.db.prisma;

  //? Discovery is read-only. Inspiration imports mutate the workspace design library and therefore require
  //? workspaceSettings; comparing creates a review candidate and uses workTickets.
  if (op === 'compare') {
    const allowed = await hasCapability(prisma, workspaceId, user.id, CAP.workTickets);
    if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  } else if (op === 'discover') {
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
    if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  } else if (!(await hasCapability(prisma, workspaceId, user.id, CAP.workspaceSettings))) {
    return { status: 'error', errorCode: 'auth.forbidden' };
  }

  if (op === 'discover') {
    //? 3.5 — find candidate reference sites from a brief; the user picks one → inspire-url captures it.
    const query = str(data.query);
    if (query.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
    const sites = await discoverReferenceSites(query, 6, workspaceId);
    return { status: 'success', result: { sites } };
  }

  if (op === 'inspire-url') {
    const url = str(data.url);
    if (!/^https?:\/\//.test(url)) return { status: 'error', errorCode: 'api.invalidRequest' };
    const shot = await captureUrlScreenshot(url, asViewport(data.viewport), workspaceId);
    if (!shot) return { status: 'error', errorCode: 'inspire.captureFailed' };
    const theme = await extractThemeFromScreenshot(workspaceId, shot, str(data.hint));
    if (!theme) return { status: 'error', errorCode: 'inspire.extractFailed' };
    const origin = new URL(url).hostname;
    //? Both slow vision calls finish before the lease. Their bounded outputs become independently replayable
    //? typed library writes, each with a stable content-derived request identity.
    const style = await extractStyleFromScreenshot(workspaceId, shot);
    const requestId = str(data.clientRequestId) || createHash('sha256').update(shot).update(JSON.stringify(theme)).update(JSON.stringify(style)).digest('hex');
    const saved = await saveInspirationArtifacts({ workspaceId, userId: user.id, requestId, origin, theme, style });
    if (!saved) return { status: 'error', errorCode: 'api.invalidRequest' };
    const { id, styleId } = saved;
    return { status: 'success', result: { id, name: theme.name, screenshotUrl: shot, ...(styleId ? { styleId } : {}) } };
  }

  if (op === 'inspire-image') {
    const imageUrl = str(data.imageUrl);
    if (!imageUrl.startsWith('/media/')) return { status: 'error', errorCode: 'api.invalidRequest' };
    const theme = await extractThemeFromScreenshot(workspaceId, imageUrl, str(data.hint));
    if (!theme) return { status: 'error', errorCode: 'inspire.extractFailed' };
    const style = await extractStyleFromScreenshot(workspaceId, imageUrl);
    const requestId = str(data.clientRequestId) || createHash('sha256').update(imageUrl).update(JSON.stringify(theme)).update(JSON.stringify(style)).digest('hex');
    const saved = await saveInspirationArtifacts({ workspaceId, userId: user.id, requestId, origin: 'upload', theme, style });
    if (!saved) return { status: 'error', errorCode: 'api.invalidRequest' };
    const { id, styleId } = saved;
    return { status: 'success', result: { id, name: theme.name, screenshotUrl: imageUrl, ...(styleId ? { styleId } : {}) } };
  }

  const clientRequestId = str(data.clientRequestId);
  const projectId = str(data.projectId);
  if (clientRequestId.length === 0 || projectId.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  //? Each side is EITHER an already-uploaded /media/ screenshot OR a URL we capture first (at `viewport`).
  const vp = asViewport(data.viewport);
  const resolveSide = async (v: string): Promise<string | null> => (v.startsWith('/media/') ? v : (/^https?:\/\//.test(v) ? captureUrlScreenshot(v, vp, workspaceId) : null));
  const own = await resolveSide(str(data.ownUrl));
  const insp = await resolveSide(str(data.inspirationUrl));
  if (!own || !insp) return { status: 'error', errorCode: 'inspire.captureFailed' };
  const notes = await compareDesigns(workspaceId, own, insp);
  if (notes === null) return { status: 'error', errorCode: 'inspire.extractFailed' };
  const enqueued = await enqueueCompareReview(prisma, {
    workspaceId, projectId, userId: user.id, ownUrl: own, inspirationUrl: insp, notes, clientRequestId,
  });
  if (!enqueued.ok) return { status: 'error', errorCode: enqueued.errorCode };
  return { status: 'success', result: { reviewId: enqueued.reviewId } };
};
