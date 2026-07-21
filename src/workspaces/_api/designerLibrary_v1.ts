//? Workspaces Designer — persist the design library + set the workspace's ACTIVE theme/style (ADR
//? 0034). Ops: `save` (upsert a DesignArtifact), `setActive` (mark the active theme/style for its
//? kind → rebuilds the injected `design-system` context-doc the coding agent reads), `delete`.
//? workspaceSettings-gated; every authoritative library mutation executes through the Conductor.

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { deterministicObjectId } from '../../../server/orchestrator/actionIds';

export const rateLimit: number | false = 40;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

interface ArtifactInput { id?: string; kind: string; name: string; description?: string; content: unknown; source?: string }

export interface ApiParams {
  data: { workspaceId: string; op: string; artifact?: ArtifactInput; artifactId?: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

const KINDS = new Set(['theme', 'style', 'animation']);
const isObjectId = (value: string): boolean => /^[a-f\d]{24}$/i.test(value);

function firstResultKey(result: unknown): string | undefined {
  if (result === null || typeof result !== 'object' || !('keys' in result) || !Array.isArray(result.keys)) return undefined;
  return result.keys.find((key): key is string => typeof key === 'string');
}

function routeRequestId(value: string | undefined, fallback: string): string {
  const supplied = value?.trim();
  return supplied !== undefined && supplied.length > 0 ? supplied : fallback;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op } = data;
  if (!workspaceId || typeof op !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const prisma = functions.db.prisma;
  if (!(await hasCapability(prisma, workspaceId, user.id, CAP.workspaceSettings))) return { status: 'error', errorCode: 'auth.forbidden' };

  if (op === 'save') {
    const a = data.artifact;
    if (!a || !KINDS.has(a.kind) || typeof a.name !== 'string' || a.name.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
    if (a.id && !isObjectId(a.id)) return { status: 'error', errorCode: 'api.notFound' };
    const requestId = routeRequestId(data.clientRequestId, createHash('sha256').update(JSON.stringify(a)).digest('hex'));
    const artifactId = a.id ?? deterministicObjectId(workspaceId, requestId, 'design-artifact');
    const saved = await enqueueInternalAction({
      workspaceId,
      op: 'design-library-write',
      target: { artifactId },
      payload: { mode: 'save', kind: a.kind, name: a.name, ...(a.description === undefined ? {} : { description: a.description }), content: a.content, ...(a.source === undefined ? {} : { source: a.source }) },
      userId: user.id,
      clientRequestId: `design-save:${requestId}`,
    });
    const id = firstResultKey(saved.result);
    if (!id) return { status: 'error', errorCode: 'api.invalidRequest' };
    return { status: 'success', result: { id } };
  }

  if (op === 'setActive') {
    const id = data.artifactId;
    if (!id) return { status: 'error', errorCode: 'api.invalidRequest' };
    if (!isObjectId(id)) return { status: 'error', errorCode: 'api.notFound' };
    const activated = await enqueueInternalAction({
      workspaceId, op: 'design-library-write', target: { artifactId: id }, payload: { mode: 'activate' }, userId: user.id,
      clientRequestId: `design-activate:${routeRequestId(data.clientRequestId, id)}`,
    });
    if (firstResultKey(activated.result) !== id) return { status: 'error', errorCode: 'api.notFound' };
    return { status: 'success', result: { id } };
  }

  if (op === 'delete') {
    const id = data.artifactId;
    if (!id) return { status: 'error', errorCode: 'api.invalidRequest' };
    if (!isObjectId(id)) return { status: 'error', errorCode: 'api.notFound' };
    await enqueueInternalAction({
      workspaceId, op: 'design-library-write', target: { artifactId: id }, payload: { mode: 'delete' }, userId: user.id,
      clientRequestId: `design-delete:${routeRequestId(data.clientRequestId, id)}`,
    });
    return { status: 'success', result: { id } };
  }

  return { status: 'error', errorCode: 'api.invalidRequest' };
};
