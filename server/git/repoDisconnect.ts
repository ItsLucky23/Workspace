//? Project-scoped repository disconnect boundary. The Conductor remains the only
//? caller/writer; dependencies make the destructive runtime/filesystem preconditions
//? independently testable without requiring Docker in the business-logic suite.

import type { PrismaClient } from '@prisma/client';
import { tryCatch } from '@luckystack/core';

import { projectHasContainers } from '../container/runtime';
import { isLinked, unlinkProjectRepo, type RepoStatus } from './repoStore';

export interface DisconnectProjectRepoDependencies {
  hasContainers: (workspaceId: string, projectId: string) => Promise<boolean | null>;
  unlink: (workspaceId: string, projectId: string) => RepoStatus;
  linked: (workspaceId: string, projectId: string) => boolean;
}

const defaultDependencies: DisconnectProjectRepoDependencies = {
  hasContainers: projectHasContainers,
  unlink: unlinkProjectRepo,
  linked: isLinked,
};

export async function disconnectProjectRepo(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  dependencies: DisconnectProjectRepoDependencies = defaultDependencies,
): Promise<RepoStatus & { error?: string }> {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true, gitUrl: true } });
  if (!project) return { linked: false, error: 'project.notFound' };
  const inUse = await dependencies.hasContainers(workspaceId, projectId);
  const current = (): RepoStatus => ({ linked: dependencies.linked(workspaceId, projectId), ...(project.gitUrl ? { gitUrl: project.gitUrl } : {}) });
  if (inUse !== false) return { ...current(), error: inUse ? 'repo.inUse' : 'repo.runtimeUnavailable' };
  const [unlinkError, status] = await tryCatch(() => Promise.resolve(dependencies.unlink(workspaceId, projectId)));
  if (unlinkError || !status) return { ...current(), error: unlinkError?.message ?? 'repo.unlinkFailed' };
  const updated = await prisma.project.updateMany({ where: { id: projectId, workspaceId }, data: { gitUrl: null } });
  return updated.count === 1 ? status : { ...current(), error: 'project.notFound' };
}
