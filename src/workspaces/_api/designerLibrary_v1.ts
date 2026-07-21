//? Workspaces Designer — persist the design library + set the workspace's ACTIVE theme/style (ADR
//? 0034). Ops: `save` (upsert a DesignArtifact), `setActive` (mark the active theme/style for its
//? kind → rebuilds the injected `design-system` context-doc the coding agent reads), `delete`.
//? workspaceSettings-gated; every authoritative library mutation executes through the Conductor.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { saveDesignArtifact, setActiveDesignArtifact, deleteDesignArtifact } from '../../../server/designer/library';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueWorkspaceRouteWrite } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 40;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

interface ArtifactInput { id?: string; kind: string; name: string; description?: string; content: unknown; source?: string }

export interface ApiParams {
  data: { workspaceId: string; op: string; artifact?: ArtifactInput; artifactId?: string };
  user: SessionLayout;
  functions: Functions;
}

const KINDS = new Set(['theme', 'style', 'animation']);

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op } = data;
  if (!workspaceId || typeof op !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const prisma = functions.db.prisma;
  if (!(await hasCapability(prisma, workspaceId, user.id, CAP.workspaceSettings))) return { status: 'error', errorCode: 'auth.forbidden' };

  if (op === 'save') {
    const a = data.artifact;
    if (!a || !KINDS.has(a.kind) || typeof a.name !== 'string' || a.name.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
    const id = await enqueueWorkspaceRouteWrite(workspaceId, { kind: 'designer.save', userId: user.id }, () => saveDesignArtifact(prisma, workspaceId, a));
    return { status: 'success', result: { id } };
  }

  if (op === 'setActive') {
    const id = data.artifactId;
    if (!id) return { status: 'error', errorCode: 'api.invalidRequest' };
    const ok = await enqueueWorkspaceRouteWrite(workspaceId, { kind: 'designer.activate', userId: user.id }, () => setActiveDesignArtifact(prisma, workspaceId, id));
    if (!ok) return { status: 'error', errorCode: 'api.notFound' };
    return { status: 'success', result: { id } };
  }

  if (op === 'delete') {
    const id = data.artifactId;
    if (!id) return { status: 'error', errorCode: 'api.invalidRequest' };
    await enqueueWorkspaceRouteWrite(workspaceId, { kind: 'designer.delete', userId: user.id }, async () => { await deleteDesignArtifact(prisma, workspaceId, id); return true; });
    return { status: 'success', result: { id } };
  }

  return { status: 'error', errorCode: 'api.invalidRequest' };
};
