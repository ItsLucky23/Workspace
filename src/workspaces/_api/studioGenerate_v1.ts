//? Workspaces Studio — generate an artifact (landing page / copy / brand kit / strategy) from a
//? brief via the pluggable AI-provider layer. Membership-gated; heavily rate-limited (AI turns are
//? expensive + slow). #168 — ASYNC: creates a 'generating' StudioArtifact placeholder + returns its
//? id immediately, then runs the slow completion detached (flips the row to ready|error + rebroadcasts).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { beginArtifact, finishArtifact, ARTIFACT_KINDS, type ArtifactKind } from '../../../server/studio/generate';
import { broadcastContentDirty } from '../../../server/read/broadcast';

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
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  //? #168 — create the 'generating' placeholder + return immediately; run the slow completion detached
  //? (it flips the row to ready/error + rebroadcasts). Previously this awaited the full ~240s generation,
  //? freezing the request and the UI button with no in-progress feedback.
  const input = { workspaceId, briefId, kind: kind as ArtifactKind, ...(tweak ? { tweak } : {}) };
  const begun = await beginArtifact(functions.db.prisma, input);
  if (!begun.ok || begun.artifactId === undefined) return { status: 'error', errorCode: begun.error ?? 'studio.generateFailed' };
  broadcastContentDirty(workspaceId);
  void finishArtifact(functions.db.prisma, begun.artifactId, input).catch(() => { /* row stays for the next refetch; finishArtifact already flips to error on completion failure */ });
  return { status: 'success', result: { artifactId: begun.artifactId } };
};
