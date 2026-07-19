//? Workspace builtin provisioning. Authoritative seed writes run only during workspace bootstrap or
//? through the server-only `workspace-builtins-ensure` Conductor op. The read snapshot never calls this.
//? Design-library embeddings are derived after the writer returns, so no external/long I/O holds a
//? workspace lease.

import type { PrismaClient } from '@prisma/client';
import { tryCatch } from '@luckystack/core';

import { ensureBuiltinSkills } from '../ai/skills';
import { ensureStyleGallery } from '../designer/inspiration';
import { DESIGN_LIBRARY_CORPUS, indexDesignArtifact } from '../designer/designLibraryRag';
import { currentWriterScope } from '../orchestrator/writerContext';

export interface WorkspaceBuiltinDesignArtifact {
  id: string;
  kind: string;
  name: string;
  description: string;
}

export interface WorkspaceBuiltinsEnsureResult {
  skillsCreated: number;
  galleryCreated: number;
  designArtifactsToIndex: WorkspaceBuiltinDesignArtifact[];
}

//? DB-only and idempotent. Conductor serialization is the concurrency boundary for existing workspaces;
//? bootstrap creates a brand-new tenant that no other caller can address yet.
export async function ensureWorkspaceBuiltins(prisma: PrismaClient, workspaceId: string): Promise<WorkspaceBuiltinsEnsureResult> {
  const skillsCreated = await ensureBuiltinSkills(prisma, workspaceId);
  const galleryCreated = await ensureStyleGallery(prisma, workspaceId);
  const gallery = await prisma.designArtifact.findMany({
    where: { workspaceId, kind: 'theme', source: 'seed' },
    select: { id: true, kind: true, name: true, description: true },
  });
  const indexed = gallery.length === 0
    ? []
    : await prisma.ragEntry.findMany({
      where: { workspaceId, commitHash: DESIGN_LIBRARY_CORPUS, filePath: { in: gallery.map((artifact) => artifact.id) } },
      select: { filePath: true },
    });
  const indexedIds = new Set(indexed.map((entry) => entry.filePath));
  return {
    skillsCreated,
    galleryCreated,
    designArtifactsToIndex: gallery
      .filter((artifact) => !indexedIds.has(artifact.id))
      .map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        name: artifact.name,
        description: artifact.description ?? '',
      })),
  };
}

function isDesignArtifactTarget(value: unknown): value is WorkspaceBuiltinDesignArtifact {
  return value !== null && typeof value === 'object'
    && 'id' in value && typeof value.id === 'string'
    && 'kind' in value && typeof value.kind === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'description' in value && typeof value.description === 'string';
}

function designArtifactsToIndex(result: unknown): WorkspaceBuiltinDesignArtifact[] {
  if (result === null || typeof result !== 'object' || !('designArtifactsToIndex' in result)
    || !Array.isArray(result.designArtifactsToIndex)) return [];
  return result.designArtifactsToIndex.filter((artifact) => isDesignArtifactTarget(artifact));
}

async function indexBuiltinDerivatives(
  prisma: PrismaClient,
  workspaceId: string,
  artifacts: WorkspaceBuiltinDesignArtifact[],
): Promise<number> {
  if (currentWriterScope() !== null) throw new Error('[workspace-builtins] derived indexing must run outside the writer lease');
  let indexed = 0;
  for (const artifact of artifacts) {
    //? A bootstrap callback can outlive a later delete/backfill. Re-check the exact seed row so stale
    //? captured work never recreates a RAG entry for an artifact that no longer exists.
    const current = await prisma.designArtifact.findFirst({
      where: { id: artifact.id, workspaceId, kind: artifact.kind, name: artifact.name, source: 'seed' },
      select: { id: true, kind: true, name: true, description: true },
    });
    if (!current) continue;
    const [error] = await tryCatch(() => indexDesignArtifact(
      prisma, workspaceId, current.id, current.kind, current.name, current.description ?? '',
    ));
    if (!error) indexed += 1;
  }
  return indexed;
}

//? Bootstrap returns before derived embeddings run. `setTimeout` places this after the current
//? Conductor turn; writerContext's shared active flag is cleared before the callback executes.
export function scheduleWorkspaceBuiltinIndexing(
  prisma: PrismaClient,
  workspaceId: string,
  artifacts: WorkspaceBuiltinDesignArtifact[],
): Promise<number> {
  return new Promise((resolve) => {
    setTimeout(() => {
      void tryCatch(() => indexBuiltinDerivatives(prisma, workspaceId, artifacts)).then(([error, indexed]) => {
        if (error) console.error(`[workspace-builtins] ${workspaceId} bootstrap indexing failed:`, error.message);
        resolve(indexed ?? 0);
      });
    }, 0);
  });
}

export const WORKSPACE_BUILTINS_BACKFILL_MS = 60 * 60 * 1000;

//? Leader-cron entry: a read-only cross-tenant scan queues one stable, server-only action per workspace.
//? Same-bucket concurrent runs share the Conductor dedup key; only the claimant receives the rich result
//? and performs derived indexing after the tenant writer/lease has returned.
export async function runWorkspaceBuiltinsBackfill(
  prisma: PrismaClient,
  now = Date.now(),
  workspaceIds?: readonly string[],
): Promise<{ ensured: number; indexed: number }> {
  const workspaces = await prisma.workspace.findMany({
    ...(workspaceIds === undefined ? {} : { where: { id: { in: [...workspaceIds] } } }),
    select: { id: true },
  });
  const runBucket = Math.floor(now / WORKSPACE_BUILTINS_BACKFILL_MS) * WORKSPACE_BUILTINS_BACKFILL_MS;
  const { enqueueInternalAction } = await import('../orchestrator/internalOps');
  let ensured = 0;
  let indexed = 0;
  for (const workspace of workspaces) {
    const [error, action] = await tryCatch(() => enqueueInternalAction({
      workspaceId: workspace.id,
      op: 'workspace-builtins-ensure',
      target: {},
      payload: {},
      userId: 'workspace-builtins',
      clientRequestId: `workspace-builtins:v1:${String(runBucket)}`,
    }));
    if (error || !action) {
      if (error) console.error(`[workspace-builtins] ${workspace.id} ensure failed:`, error.message);
      continue;
    }
    ensured += 1;
    indexed += await indexBuiltinDerivatives(prisma, workspace.id, designArtifactsToIndex(action.result));
  }
  return { ensured, indexed };
}
