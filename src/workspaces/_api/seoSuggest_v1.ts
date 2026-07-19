/** @docs owner ItsLucky23 */
//? Workspaces — [seo-suggest] (GAP_SCAN F3). Scores a piece's title against THIS workspace's own published
//? view counts and asks the provider for better alternatives. A pure READ: it proposes text, writes nothing
//? (applying a suggestion is the user editing the piece, which goes through the normal content ops), so it
//? is an `_api` route rather than a control-API op — there is no authoritative state to write.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { suggestSeo } from '../../../server/content/seo';

//? An AI round-trip per call, so it is rate-limited like the other generation-adjacent reads.
export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; title: string; platform?: string; description?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : '';
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (workspaceId.length === 0 || title.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };

  const prisma = functions.db.prisma;
  //? Content work — the same bar as generating an asset for the piece this title belongs to.
  const allowed = await hasCapability(prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  const platform = typeof data.platform === 'string' ? data.platform : 'youtube';
  const description = typeof data.description === 'string' ? data.description : '';
  const res = await suggestSeo(prisma, workspaceId, { title, platform, ...(description ? { description } : {}) });

  //? The deterministic SCORE is always returned, even when the provider call failed — a title critique that
  //? needs no key is the half of this feature that must never be unavailable.
  return {
    status: 'success',
    result: {
      score: res.score.score,
      issues: res.score.issues,
      lengthOk: res.score.lengthOk,
      titles: res.suggestion.titles,
      description: res.suggestion.description,
      tags: res.suggestion.tags,
      aiOk: res.ok,
    },
  };
};
