//? Workspaces Studio — generate an artifact (landing page / copy / brand kit / strategy) from a
//? brief via the pluggable AI-provider layer. Membership-gated; heavily rate-limited (AI turns are
//? expensive + slow). #168 — ASYNC: creates a 'generating' StudioArtifact placeholder + returns its
//? id immediately, then runs the slow completion detached (flips the row to ready|error + rebroadcasts).

import { randomUUID } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { finishArtifact, isArtifactKind } from '../../../server/studio/generate';
import { broadcastContentDirty } from '../../../server/read/broadcast';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { deterministicObjectId } from '../../../server/orchestrator/actionIds';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

function firstResultKey(result: unknown): string | undefined {
  if (result === null || typeof result !== 'object' || !('keys' in result) || !Array.isArray(result.keys)) return undefined;
  return result.keys.find((key): key is string => typeof key === 'string');
}

function resultError(result: unknown): string | undefined {
  if (result === null || typeof result !== 'object' || !('error' in result) || typeof result.error !== 'string') return undefined;
  return result.error;
}

export interface ApiParams {
  data: { workspaceId: string; briefId: string; kind: string; tweak?: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, briefId, kind, tweak } = data;
  if (!workspaceId || !briefId || !isArtifactKind(kind)) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (!(await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets))) return { status: 'error', errorCode: 'auth.forbidden' };
  //? The typed internal op deliberately accepts only ObjectIds. Preserve the route's domain contract
  //? instead of letting an unknown malformed brief id escape its validator as api.internalServerError.
  if (!/^[a-f\d]{24}$/i.test(briefId)) return { status: 'error', errorCode: 'studio.briefNotFound' };

  //? #168 — create the 'generating' placeholder + return immediately; run the slow completion detached
  //? (it flips the row to ready/error + rebroadcasts). Previously this awaited the full ~240s generation,
  //? freezing the request and the UI button with no in-progress feedback.
  const input = { workspaceId, briefId, kind, ...(tweak ? { tweak } : {}) };
  const suppliedRequestId = data.clientRequestId?.trim();
  const clientRequestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : randomUUID();
  const artifactId = deterministicObjectId(workspaceId, clientRequestId, 'studio-artifact');
  const begun = await enqueueInternalAction({
    workspaceId,
    op: 'studio-artifact-begin',
    target: { artifactId, briefId },
    payload: { kind, ...(tweak ? { tweak } : {}) },
    userId: user.id,
    clientRequestId: `studio-begin:${clientRequestId}`,
  });
  if (firstResultKey(begun.result) !== artifactId) {
    return { status: 'error', errorCode: resultError(begun.result) === 'studio.briefNotFound' ? 'studio.briefNotFound' : 'studio.generateFailed' };
  }
  broadcastContentDirty(workspaceId);
  void functions.tryCatch.tryCatch(() => finishArtifact(functions.db.prisma, artifactId, input, {
    //? AI/provider/RAG work remains outside the lease; only the deterministic completion CAS re-enters.
    complete: async (completedArtifactId, generateInput, update) => {
      const completed = await enqueueInternalAction({
        workspaceId,
        op: 'studio-artifact-complete',
        target: { artifactId: completedArtifactId, briefId: generateInput.briefId },
        payload: {
          kind: generateInput.kind,
          status: update.status,
          ...(update.title === undefined ? {} : { title: update.title }),
          ...(update.content === undefined ? {} : { content: update.content }),
          ...(update.providerId === undefined ? {} : { providerId: update.providerId }),
          ...(update.error === undefined ? {} : { error: update.error }),
        },
        userId: user.id,
        clientRequestId: `studio-complete:${completedArtifactId}`,
      });
      return firstResultKey(completed.result) === completedArtifactId;
    },
  }));
  return { status: 'success', result: { artifactId } };
};
