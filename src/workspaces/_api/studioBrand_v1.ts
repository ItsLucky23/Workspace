//? Workspaces Studio — the central brand library (ADR 0013 G-MKT-2). `op:'save'` upserts the
//? workspace brand (palette/typography/voice/taglines/logos); `op:'promote'` adopts a generated
//? `brand` artifact into the library. Membership-gated; `relaxed` (handler validates below).

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { exportBrandKit, parseBrandKit } from '../../../server/studio/brand';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { ENTITY_VERSION_KEYS, readEntityVersion } from '../../../server/orchestrator/entityVersion';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: {
    workspaceId: string; op: string; artifactId?: string;
    name?: string; palette?: { name: string; hex: string }[]; typography?: { heading: string; body: string };
    voice?: string; taglines?: string[]; logoIdeas?: string[];
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op } = data;
  if (!workspaceId || (op !== 'save' && op !== 'promote')) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  const current = await exportBrandKit(functions.db.prisma, workspaceId) ?? {};
  let kit: unknown;
  if (op === 'promote') {
    if (!data.artifactId) return { status: 'error', errorCode: 'api.invalidRequest' };
    const artifact = await functions.db.prisma.studioArtifact.findFirst({ where: { workspaceId, id: data.artifactId, kind: 'brand' }, select: { content: true } });
    const promoted = parseBrandKit(artifact?.content);
    if (!promoted) return { status: 'error', errorCode: 'studio.notABrand' };
    //? Promotion changes the generated visual/voice fields but retains the library's human-chosen name.
    kit = { ...current, ...promoted, ...(current.name ? { name: current.name } : {}) };
  } else {
    kit = {
      ...current,
      ...(data.name === undefined ? {} : { name: data.name }),
      ...(data.palette === undefined ? {} : { palette: data.palette }),
      ...(data.typography === undefined ? {} : { typography: data.typography }),
      ...(data.voice === undefined ? {} : { voice: data.voice }),
      ...(data.taglines === undefined ? {} : { taglines: data.taglines }),
      ...(data.logoIdeas === undefined ? {} : { logoIdeas: data.logoIdeas }),
    };
  }
  const expectedVersion = await readEntityVersion(functions.db.prisma, workspaceId, ENTITY_VERSION_KEYS.brandLibrary);
  const digest = createHash('sha256').update(JSON.stringify(kit)).digest('hex');
  const applied = await enqueueInternalAction({
    workspaceId,
    op: 'brand-import',
    target: { expectedVersion },
    payload: { kit },
    userId: user.id,
    clientRequestId: `studio-brand:${op}:${digest}`,
  });
  if (applied.result !== null && typeof applied.result === 'object' && 'applied' in applied.result && applied.result.applied === true) return { status: 'success', result: { ok: true } };
  return { status: 'error', errorCode: 'write.superseded' };
};
