//? Workspaces — resolve a PROJECT's forge connection (ADR 0036, A2). Prefers the
//? per-project `ForgeConnection` row (GitLab OR GitHub); falls back to the workspace
//? GitLab fields (`Workspace.forgeType`/`gitlabUrl`/`gitlabTokenEnc`) when a project has
//? none — zero migration for existing single-forge workspaces (FORGE_ABSTRACTION §6
//? Q-FORGE-DATAMODEL). The single decryption point for a forge token besides the
//? GitLab-era `forge.ts` inline path (kept in lockstep). Never throws — returns null
//? only when the workspace/project can't be found.

import type { PrismaClient } from '@prisma/client';

import { decryptSecret } from '../crypto/secretBox';
import type { ForgeType } from './forgeProvider';

export interface ResolvedForge {
  mode: ForgeType;                 // 'gitlab' | 'github'
  base: string;                    // API base ('' for a GitLab workspace that stored none — matches forge.ts)
  token: string | undefined;      // decrypted PAT
  repoPath: string;                // "owner/repo"
  webhookSecret: string | undefined;
}

const asMode = (s: string | null | undefined): ForgeType => (s === 'github' ? 'github' : 'gitlab');
//? Default API base per provider when none is stored (mirrors forge.ts `forgeBase`).
const baseFor = (mode: ForgeType, baseUrl: string | null | undefined): string => {
  const set = (baseUrl ?? '').replace(/\/+$/, '');
  if (set.length > 0) return set;
  return mode === 'github' ? 'https://api.github.com' : '';
};

export async function resolveForge(prisma: PrismaClient, workspaceId: string, projectId: string): Promise<ResolvedForge | null> {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { gitlabPath: true } });
  if (!project) return null;

  //? Per-project ForgeConnection wins (GitLab OR GitHub).
  const conn = await prisma.forgeConnection.findFirst({ where: { projectId } });
  if (conn) {
    const mode = asMode(conn.mode);
    return {
      mode,
      base: baseFor(mode, conn.baseUrl),
      token: conn.tokenEnc ? (decryptSecret(conn.tokenEnc) ?? undefined) : undefined,
      repoPath: conn.repoPath ?? project.gitlabPath,
      webhookSecret: conn.webhookSecret ?? undefined,
    };
  }

  //? Fallback: the workspace GitLab fields (existing single-forge behaviour).
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { forgeType: true, gitlabUrl: true, gitlabTokenEnc: true } });
  if (!ws) return null;
  const mode = asMode(ws.forgeType);
  return {
    mode,
    base: baseFor(mode, ws.gitlabUrl),
    token: ws.gitlabTokenEnc ? (decryptSecret(ws.gitlabTokenEnc) ?? undefined) : undefined,
    repoPath: project.gitlabPath,
    webhookSecret: undefined,
  };
}
