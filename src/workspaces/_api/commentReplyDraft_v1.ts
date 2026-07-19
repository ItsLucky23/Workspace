/** @docs owner ItsLucky23 */
//? Workspaces — [comment-reply-draft] (GAP_SCAN F5). Drafts a reply to one inbox comment, in the channel's
//? brand voice. A pure READ: it returns TEXT for the user to edit, and posting it is the separate
//? `content-reply-comment` control op — so an AI-written reply can never reach an audience without a human
//? pressing send (B-23). The comment itself is untrusted external text; `draftReply` fences it.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { draftReply } from '../../../server/content/commentActions';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; commentId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : '';
  const commentId = typeof data.commentId === 'string' ? data.commentId : '';
  if (workspaceId.length === 0 || commentId.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };

  const prisma = functions.db.prisma;
  const allowed = await hasCapability(prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  //? Tenant-scoped read: the comment must belong to THIS workspace before any of its text reaches a prompt.
  const comment = await prisma.socialComment.findFirst({
    where: { workspaceId, id: commentId },
    select: { text: true, author: true, channelId: true, contentProjectId: true },
  });
  if (!comment) return { status: 'error', errorCode: 'api.invalidRequest' };

  //? The channel's brand voice + the piece title give the draft its tone and subject.
  const channel = comment.channelId
    ? await prisma.channel.findFirst({ where: { workspaceId, id: comment.channelId }, select: { brandVoice: true } })
    : null;
  const piece = comment.contentProjectId
    ? await prisma.contentProject.findFirst({ where: { workspaceId, id: comment.contentProjectId }, select: { title: true } })
    : null;

  const draft = await draftReply(workspaceId, {
    comment: comment.text,
    author: comment.author,
    ...(channel?.brandVoice ? { brandVoice: channel.brandVoice } : {}),
    ...(piece?.title ? { pieceTitle: piece.title } : {}),
  });

  return { status: 'success', result: { text: draft.text, sentiment: draft.sentiment, stub: draft.stub } };
};
