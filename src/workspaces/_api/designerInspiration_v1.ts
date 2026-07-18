/** @docs owner ItsLucky23 */
//? Workspaces Designer — inspiration import (INS, DOCUMENTS_AND_SKILLS). Ops: `inspire-url` (capture
//? a site in a chromium container → vision-extract a theme PROPOSAL into the library, inactive),
//? `inspire-image` (same extraction from an uploaded screenshot), `compare` (our page vs the
//? inspiration → a vision difference-analysis stored as a UiReviewRequest so the existing inbox +
//? ui-review-to-ticket flow drives the redesign). Membership-gated feature content (like
//? designerLibrary — not board/git, so B-23 Conductor routing does not apply; activation of a
//? proposal stays the user's explicit setActive step).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { captureUrlScreenshot, extractThemeFromScreenshot, extractStyleFromScreenshot, saveThemeProposal, saveStyleProposal, compareDesigns, type CaptureViewport } from '../../../server/designer/inspiration';
import { discoverReferenceSites } from '../../../server/designer/webDiscovery';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; op: string; url?: string; imageUrl?: string; hint?: string; ownUrl?: string; inspirationUrl?: string; viewport?: string; query?: string };
  user: SessionLayout;
  functions: Functions;
}

//? 3.2 — the capture viewport (desktop default; 'mobile' for the phone form factor).
const asViewport = (v: string | undefined): CaptureViewport => (v === 'mobile' ? 'mobile' : 'desktop');

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op } = data;
  if (!workspaceId || typeof op !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const prisma = functions.db.prisma;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  if (op === 'discover') {
    //? 3.5 — find candidate reference sites from a brief; the user picks one → inspire-url captures it.
    const query = (data.query ?? '').trim();
    if (query.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
    const sites = await discoverReferenceSites(query, 6);
    return { status: 'success', result: { sites } };
  }

  if (op === 'inspire-url') {
    const url = (data.url ?? '').trim();
    if (!/^https?:\/\//.test(url)) return { status: 'error', errorCode: 'api.invalidRequest' };
    const shot = await captureUrlScreenshot(url, asViewport(data.viewport));
    if (!shot) return { status: 'error', errorCode: 'inspire.captureFailed' };
    const theme = await extractThemeFromScreenshot(workspaceId, shot, data.hint ?? '');
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
    const imageUrl = (data.imageUrl ?? '').trim();
    if (!imageUrl.startsWith('/media/')) return { status: 'error', errorCode: 'api.invalidRequest' };
    const theme = await extractThemeFromScreenshot(workspaceId, imageUrl, data.hint ?? '');
    if (!theme) return { status: 'error', errorCode: 'inspire.extractFailed' };
    const id = await saveThemeProposal(prisma, workspaceId, theme, 'upload');
    const style = await extractStyleFromScreenshot(workspaceId, imageUrl);
    const styleId = style ? await saveStyleProposal(prisma, workspaceId, style, 'upload') : null;
    return { status: 'success', result: { id, name: theme.name, screenshotUrl: imageUrl, ...(styleId ? { styleId } : {}) } };
  }

  if (op === 'compare') {
    //? Each side is EITHER an already-uploaded /media/ screenshot OR a URL we capture first (at `viewport`).
    const vp = asViewport(data.viewport);
    const resolveSide = async (v: string): Promise<string | null> => (v.startsWith('/media/') ? v : (/^https?:\/\//.test(v) ? captureUrlScreenshot(v, vp) : null));
    const own = await resolveSide((data.ownUrl ?? '').trim());
    const insp = await resolveSide((data.inspirationUrl ?? '').trim());
    if (!own || !insp) return { status: 'error', errorCode: 'inspire.captureFailed' };
    const reviewId = await compareDesigns(prisma, workspaceId, own, insp, user.id);
    if (!reviewId) return { status: 'error', errorCode: 'inspire.extractFailed' };
    return { status: 'success', result: { reviewId } };
  }

  return { status: 'error', errorCode: 'api.invalidRequest' };
};
