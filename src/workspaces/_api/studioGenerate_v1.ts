//? Workspaces Studio — generate an artifact (landing page / copy / brand kit / strategy) from a
//? brief via the pluggable AI-provider layer. Membership-gated; heavily rate-limited (AI turns are
//? expensive + slow). Runs synchronously — the client shows a generating state and awaits the
//? artifact id. The AI output is stored as a StudioArtifact (status ready|error).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateArtifact, ARTIFACT_KINDS, type ArtifactKind } from '../../../server/studio/generate';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const KINDS = new Set<string>(ARTIFACT_KINDS);

export interface ApiParams {
  data: { workspaceId: string; briefId: string; kind: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, briefId, kind } = data;
  if (!workspaceId || !briefId || !KINDS.has(kind)) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  const res = await generateArtifact(functions.db.prisma, { workspaceId, briefId, kind: kind as ArtifactKind });
  if (!res.ok) return { status: 'error', errorCode: res.error ?? 'studio.generateFailed' };
  return { status: 'success', result: { artifactId: res.artifactId ?? '' } };
};
