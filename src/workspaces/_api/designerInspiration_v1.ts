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
import { captureUrlScreenshot, extractThemeFromScreenshot, saveThemeProposal, compareDesigns } from '../../../server/designer/inspiration';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; op: string; url?: string; imageUrl?: string; hint?: string; ownUrl?: string; inspirationUrl?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op } = data;
  if (!workspaceId || typeof op !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const prisma = functions.db.prisma;
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  if (op === 'inspire-url') {
    const url = (data.url ?? '').trim();
    if (!/^https?:\/\//.test(url)) return { status: 'error', errorCode: 'api.invalidRequest' };
    const shot = await captureUrlScreenshot(url);
    if (!shot) return { status: 'error', errorCode: 'inspire.captureFailed' };
    const theme = await extractThemeFromScreenshot(workspaceId, shot, data.hint ?? '');
    if (!theme) return { status: 'error', errorCode: 'inspire.extractFailed' };
    const id = await saveThemeProposal(prisma, workspaceId, theme, new URL(url).hostname);
    return { status: 'success', result: { id, name: theme.name, screenshotUrl: shot } };
  }

  if (op === 'inspire-image') {
    const imageUrl = (data.imageUrl ?? '').trim();
    if (!imageUrl.startsWith('/media/')) return { status: 'error', errorCode: 'api.invalidRequest' };
    const theme = await extractThemeFromScreenshot(workspaceId, imageUrl, data.hint ?? '');
    if (!theme) return { status: 'error', errorCode: 'inspire.extractFailed' };
    const id = await saveThemeProposal(prisma, workspaceId, theme, 'upload');
    return { status: 'success', result: { id, name: theme.name, screenshotUrl: imageUrl } };
  }

  if (op === 'compare') {
    //? Each side is EITHER an already-uploaded /media/ screenshot OR a URL we capture first.
    const resolveSide = async (v: string): Promise<string | null> => (v.startsWith('/media/') ? v : (/^https?:\/\//.test(v) ? captureUrlScreenshot(v) : null));
    const own = await resolveSide((data.ownUrl ?? '').trim());
    const insp = await resolveSide((data.inspirationUrl ?? '').trim());
    if (!own || !insp) return { status: 'error', errorCode: 'inspire.captureFailed' };
    const reviewId = await compareDesigns(prisma, workspaceId, own, insp, user.id);
    if (!reviewId) return { status: 'error', errorCode: 'inspire.extractFailed' };
    return { status: 'success', result: { reviewId } };
  }

  return { status: 'error', errorCode: 'api.invalidRequest' };
};
