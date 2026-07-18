/** @docs owner ItsLucky23 */
//? Workspaces Designer — inspiration import (INS, DOCUMENTS_AND_SKILLS). Ops: `inspire-url` (capture
//? a site in a chromium container → vision-extract a theme PROPOSAL into the library, inactive),
//? `inspire-image` (same extraction from an uploaded screenshot), `compare` (our page vs the
//? inspiration → vision analysis outside the writer lease, then exactly one existing `ui-review-create`
//? Conductor op). The whole route requires workTickets; compare never writes a UiReviewRequest directly.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { captureUrlScreenshot, extractThemeFromScreenshot, extractStyleFromScreenshot, saveThemeProposal, saveStyleProposal, compareDesigns, type CaptureViewport } from '../../../server/designer/inspiration';
import { discoverReferenceSites } from '../../../server/designer/webDiscovery';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

type DesignerInspirationData =
  | { workspaceId: string; op: 'discover'; query: string }
  | { workspaceId: string; op: 'inspire-url'; url: string; hint?: string; viewport?: string }
  | { workspaceId: string; op: 'inspire-image'; imageUrl: string; hint?: string }
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

  //? Discovering and importing inspiration only expose a member's own library; comparing creates
  //? a review ticket candidate and therefore alone needs the workTickets capability.
  if (op === 'compare') {
    const allowed = await hasCapability(prisma, workspaceId, user.id, CAP.workTickets);
    if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  } else {
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
    if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
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
    const shot = await captureUrlScreenshot(url, asViewport(data.viewport));
    if (!shot) return { status: 'error', errorCode: 'inspire.captureFailed' };
    const theme = await extractThemeFromScreenshot(workspaceId, shot, str(data.hint));
    if (!theme) return { status: 'error', errorCode: 'inspire.extractFailed' };
    const origin = new URL(url).hostname;
    const id = await saveThemeProposal(prisma, workspaceId, theme, origin);
    //? 3.1 — also extract the full STYLE (radius/shadow/font/motion) so the imported look resembles the
    //? reference once applied, not just its colours. Best-effort — a style-extract miss doesn't fail the import.
    const style = await extractStyleFromScreenshot(workspaceId, shot);
    const styleId = style ? await saveStyleProposal(prisma, workspaceId, style, origin) : null;
    return { status: 'success', result: { id, name: theme.name, screenshotUrl: shot, ...(styleId ? { styleId } : {}) } };
  }

  if (op === 'inspire-image') {
    const imageUrl = str(data.imageUrl);
    if (!imageUrl.startsWith('/media/')) return { status: 'error', errorCode: 'api.invalidRequest' };
    const theme = await extractThemeFromScreenshot(workspaceId, imageUrl, str(data.hint));
    if (!theme) return { status: 'error', errorCode: 'inspire.extractFailed' };
    const id = await saveThemeProposal(prisma, workspaceId, theme, 'upload');
    const style = await extractStyleFromScreenshot(workspaceId, imageUrl);
    const styleId = style ? await saveStyleProposal(prisma, workspaceId, style, 'upload') : null;
    return { status: 'success', result: { id, name: theme.name, screenshotUrl: imageUrl, ...(styleId ? { styleId } : {}) } };
  }

  const clientRequestId = str(data.clientRequestId);
  const projectId = str(data.projectId);
  if (clientRequestId.length === 0 || projectId.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  //? Each side is EITHER an already-uploaded /media/ screenshot OR a URL we capture first (at `viewport`).
  const vp = asViewport(data.viewport);
  const resolveSide = async (v: string): Promise<string | null> => (v.startsWith('/media/') ? v : (/^https?:\/\//.test(v) ? captureUrlScreenshot(v, vp) : null));
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
