//? Build export (ADR 0038, B2) — produce a DOWNLOADABLE artifact of a project's pipeline-built image so
//? the user can self-host it elsewhere. `kind:'image'` = a `docker save` OCI tarball (the whole runnable
//? image); the artifact is written under the workspace data dir and served over a signed, TTL'd,
//? token-gated link (`/downloads/build/<token>`), never a public path. The Conductor calls this (B-23);
//? best-effort — a docker/space failure lands on the BuildArtifact row as `status:'error'`, never throws.

import { mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { tryCatchSync } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { docker, dockerAvailable } from '../container/runtime';
import { workspaceDataDir } from '../git/repoStore';

//? Download links live for this long (hours) before the artifact is considered expired + prunable.
const EXPORT_TTL_MS = Number(process.env.WS_BUILD_EXPORT_TTL_H ?? '24') * 3_600_000;

export interface BuildExportResult { ok: boolean; artifactId?: string; downloadToken?: string; status: string; error?: string }

//? Export the project's built image as a downloadable `docker save` tarball. Creates a BuildArtifact row
//? (building→ready|error) + a signed token. `now` is injected (Date.now() is banned in some contexts).
export async function buildExport(prisma: PrismaClient, workspaceId: string, projectId: string, kind: string, now: number): Promise<BuildExportResult> {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { baseImageRef: true } });
  const imageRef = project?.baseImageRef ?? null;
  const token = randomBytes(24).toString('hex');
  const artifact = await prisma.buildArtifact.create({
    data: { workspaceId, projectId, kind: kind === 'bundle' ? 'bundle' : 'image', downloadToken: token, status: 'building', ...(imageRef ? { imageRef } : {}), expiresAt: new Date(now + EXPORT_TTL_MS) },
  });

  if (kind === 'bundle') {
    //? A built-dist bundle export needs the app's build output (a container build step) — deferred to
    //? the build-into-image work; for now only the image tarball is produced (documented in the ADR).
    await prisma.buildArtifact.update({ where: { id: artifact.id }, data: { status: 'error', error: 'export.bundleNotImplemented' } });
    return { ok: false, artifactId: artifact.id, status: 'error', error: 'export.bundleNotImplemented' };
  }
  if (!imageRef) return failExport(prisma, artifact.id, 'export.noImage');
  if (!(await dockerAvailable())) return failExport(prisma, artifact.id, 'docker.unavailable');

  const dir = path.join(workspaceDataDir(workspaceId), 'exports');
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${token}.tar`);
  const saved = await docker(['save', '-o', filePath, imageRef]);
  if (saved.code !== 0) return failExport(prisma, artifact.id, `export.saveFailed: ${saved.err.slice(0, 200)}`);

  const [, stat] = tryCatchSync(() => statSync(filePath));
  const sizeBytes = stat?.size ?? 0;
  await prisma.buildArtifact.update({ where: { id: artifact.id }, data: { status: 'ready', filePath, sizeBytes } });
  return { ok: true, artifactId: artifact.id, downloadToken: token, status: 'ready' };
}

async function failExport(prisma: PrismaClient, artifactId: string, error: string): Promise<BuildExportResult> {
  await prisma.buildArtifact.update({ where: { id: artifactId }, data: { status: 'error', error } });
  return { ok: false, artifactId, status: 'error', error };
}
