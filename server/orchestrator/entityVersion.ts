//? Workspace entity CAS fences for slow/replayable jobs. Capture a version before provider/filesystem work,
//? then apply the completion only if no newer Conductor mutation has advanced that entity in the meantime.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

export const ENTITY_VERSION_KEYS = {
  brandLibrary: 'brand-library',
  stylePresets: 'style-presets',
  projectDocs: 'project-docs',
} as const;

export function projectImageEntityKey(projectId: string): string { return `project-image:${projectId}`; }
export function dockerfileEntityKey(projectId: string): string { return `dockerfile:${projectId}`; }
export function worktreeFileEntityKey(ticketKey: string, filePath: string): string { return `worktree-file:${ticketKey}:${filePath}`; }

export interface EntityVersionRef {
  workspaceId: string;
  entityKey: string;
  expectedVersion: number;
  requestId: string;
  contentHash?: string;
}

export async function readEntityVersion(prisma: PrismaClient, workspaceId: string, entityKey: string): Promise<number> {
  const row = await prisma.workspaceEntityVersion.findUnique({ // luckystack-allow tenant-scope: the composite unique key contains the exact authorized workspaceId.
    where: { workspaceId_entityKey: { workspaceId, entityKey } },
    select: { version: true },
  });
  return row?.version ?? 0;
}

async function commitEntityVersion(prisma: PrismaClient, ref: EntityVersionRef): Promise<boolean> {
  const nextVersion = ref.expectedVersion + 1;
  if (ref.expectedVersion === 0) {
    const [createError] = await tryCatch(() => prisma.workspaceEntityVersion.create({ // luckystack-allow tenant-scope: create data carries the exact workspaceId captured by the typed action.
      data: {
        workspaceId: ref.workspaceId,
        entityKey: ref.entityKey,
        version: nextVersion,
        lastRequestId: ref.requestId,
        contentHash: ref.contentHash ?? null,
      },
    }));
    if (!createError) return true;
  }
  const updated = await prisma.workspaceEntityVersion.updateMany({ // luckystack-allow tenant-scope: CAS where binds workspaceId, entity key and expected version.
    where: { workspaceId: ref.workspaceId, entityKey: ref.entityKey, version: ref.expectedVersion },
    data: { version: nextVersion, lastRequestId: ref.requestId, contentHash: ref.contentHash ?? null },
  });
  return updated.count === 1;
}

export interface EntityCasResult<T> {
  applied: boolean;
  currentVersion: number;
  result?: T;
}

export async function applyEntityCas<T>(
  prisma: PrismaClient,
  ref: EntityVersionRef,
  mutate: () => Promise<T>,
): Promise<EntityCasResult<T>> {
  const currentVersion = await readEntityVersion(prisma, ref.workspaceId, ref.entityKey);
  if (currentVersion !== ref.expectedVersion) return { applied: false, currentVersion };
  const result = await mutate();
  const committed = await commitEntityVersion(prisma, ref);
  if (!committed) throw new Error(`[entity-version] lost CAS after mutation for ${ref.workspaceId}/${ref.entityKey}`);
  return { applied: true, currentVersion: ref.expectedVersion + 1, result };
}
