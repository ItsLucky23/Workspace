//? Workspaces Studio — generate an artifact (landing page / copy / brand kit / strategy) from a
//? brief via the pluggable AI-provider layer. Membership-gated; heavily rate-limited (AI turns are
//? expensive + slow). #168 — ASYNC: creates a 'generating' StudioArtifact placeholder + returns its
//? id immediately, then runs the slow completion detached (flips the row to ready|error + rebroadcasts).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { beginArtifact, completeArtifact, finishArtifact, ARTIFACT_KINDS, type ArtifactKind } from '../../../server/studio/generate';
import { broadcastContentDirty } from '../../../server/read/broadcast';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueWorkspaceRouteWrite } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const KINDS = new Set<string>(ARTIFACT_KINDS);

export interface ApiParams {
  data: { workspaceId: string; briefId: string; kind: string; tweak?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, briefId, kind, tweak } = data;
  if (!workspaceId || !briefId || !KINDS.has(kind)) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (!(await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets))) return { status: 'error', errorCode: 'auth.forbidden' };

  //? #168 — create the 'generating' placeholder + return immediately; run the slow completion detached
  //? (it flips the row to ready/error + rebroadcasts). Previously this awaited the full ~240s generation,
  //? freezing the request and the UI button with no in-progress feedback.
  const input = { workspaceId, briefId, kind: kind as ArtifactKind, ...(tweak ? { tweak } : {}) };
  const begun = await enqueueWorkspaceRouteWrite(
    workspaceId,
    { kind: 'studio-generate.begin', userId: user.id },
    () => beginArtifact(functions.db.prisma, input),
  );
  if (!begun.ok || begun.artifactId === undefined) return { status: 'error', errorCode: begun.error ?? 'studio.generateFailed' };
  const artifactId = begun.artifactId;
  broadcastContentDirty(workspaceId);
  void functions.tryCatch.tryCatch(() => finishArtifact(functions.db.prisma, artifactId, input, {
    //? AI/provider/RAG work remains outside the lease; only the deterministic completion CAS re-enters.
    complete: (artifactId, generateInput, update) => enqueueWorkspaceRouteWrite(
      workspaceId,
      { kind: 'studio-generate.complete', userId: user.id },
      () => completeArtifact(functions.db.prisma, artifactId, generateInput, update),
    ),
  }));
  return { status: 'success', result: { artifactId } };
};
