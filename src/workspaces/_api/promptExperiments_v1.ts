/** @docs owner ItsLucky23 */
//? Workspaces — [prompt-experiments] (GAP_SCAN G7). Lists this workspace's prompt A/B experiments with
//? their CURRENT verdict (trials per arm, means, lift, and whether there is enough evidence to call a
//? winner at all). A read: scoring runs a count query per experiment, which is why it is an on-demand API
//? rather than part of every workspace snapshot.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { experimentReport } from '../../../server/ai/promptExperiment';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = typeof data.workspaceId === 'string' ? data.workspaceId : '';
  if (workspaceId.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };

  const prisma = functions.db.prisma;
  //? Prompts steer every AI run in the workspace — same bar as the other workspace settings.
  const allowed = await hasCapability(prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  const rows = await prisma.promptExperiment.findMany({
    where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, feature: true, name: true, variantA: true, variantB: true, status: true, createdAt: true },
  });

  const experiments = await Promise.all(rows.map(async (row) => {
    const report = await experimentReport(prisma, workspaceId, row.id);
    return {
      id: row.id, feature: row.feature, name: row.name, status: row.status,
      variantA: row.variantA, variantB: row.variantB, createdAt: row.createdAt.getTime(),
      trialsA: report.trialsA, trialsB: report.trialsB,
      meanA: Math.round(report.meanA * 100) / 100, meanB: Math.round(report.meanB * 100) / 100,
      lift: Math.round(report.lift * 100) / 100,
      winner: report.winner ?? '', verdict: report.verdict,
    };
  }));

  return { status: 'success', result: { experiments } };
};
