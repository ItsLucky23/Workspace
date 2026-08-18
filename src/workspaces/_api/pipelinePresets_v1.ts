//? Workspaces — [pipeline-presets] the pipeline presets and the canonical stage blueprints behind them.
//?
//? The tier picked at workspace creation (simple / advanced / professional) decided how many stages the
//? board started with and was then unreachable, and a stage created by hand — or seeded before the
//? defaults carried prompt text — is BLANK: no persona, no instructions, no carry-over template. The
//? pipeline looks configured while its agents run on nothing.
//?
//? Serving the blueprints instead of copying them into `src/` is deliberate: `server/bootstrap/
//? defaultPipeline.ts` is what actually seeds a pipeline, so a second copy in the client would drift the
//? moment either side is edited — and the drift is invisible (the UI would still say "restore defaults").
//?
//? A direct `_api` read, NOT a control-op: it writes nothing. Gated on `editPipeline` — the only
//? reason to read a blueprint is to apply one, and that is the capability applying needs.

/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { pipelinePresetSummary, stageBlueprint, blueprintForStage, defaultStageKeys } from '../../../server/bootstrap/defaultPipeline';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const KINDS = ['refine', 'plan', 'code', 'test', 'review', 'final'] as const;

export interface ApiParams {
  data: { workspaceId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = data.workspaceId;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  //? editPipeline: the only reason to read a blueprint is to apply it, and that is the capability that
  //? applying needs. Nothing here discloses workspace content — these are the framework's own defaults.
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.editPipeline);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  return {
    status: 'success',
    result: {
      presets: pipelinePresetSummary(),
      byKind: Object.fromEntries(KINDS.map((k) => [k, stageBlueprint(k)])),
      byKey: Object.fromEntries(defaultStageKeys().map((key) => [key, blueprintForStage(key, 'code')])),
    },
  };
};
