//? Build export (ADR 0038, B2; D4 idea-to-outcome) — produce a DOWNLOADABLE artifact of a project so the
//? user can self-host it elsewhere, and (D4) optionally fire a deploy-hook to an external server. Two kinds:
//? `image` = a `docker save` OCI tarball of the whole runnable image; `bundle` = a REAL production build
//? (`npm run build` → dist/) tarred out of a throwaway container from the project image. The artifact is
//? written under the workspace data dir + served over a signed, TTL'd, token-gated link
//? (`/downloads/build/<token>`), never a public path. The Conductor calls this (B-23); best-effort — a
//? docker/space/build failure lands on the BuildArtifact row as `status:'error'`, never throws.

import { mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { tryCatch, tryCatchSync } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { docker, dockerAvailable } from '../container/runtime';
import { workspaceDataDir } from '../git/repoStore';
import { decryptSecret } from '../crypto/secretBox';

//? Download links live for this long (hours) before the artifact is considered expired + prunable.
const EXPORT_TTL_MS = Number(process.env.WS_BUILD_EXPORT_TTL_H ?? '24') * 3_600_000;
//? The in-container production-build command + its output dir (env-overridable so a non-standard project
//? pins its own build step without a code change). Read at call time (not import) so config can change
//? without a restart. Default = a Node app building to dist/.
const buildCmd = (): string => process.env.WS_BUILD_EXPORT_CMD ?? 'cd /app && npm run build';
const buildOutputDir = (): string => process.env.WS_BUILD_EXPORT_DIR ?? '/app/dist';

export interface DeployHookResult { fired: boolean; ok?: boolean; status?: number; error?: string }
export interface BuildExportResult { ok: boolean; artifactId?: string; downloadToken?: string; status: string; error?: string; deployHook?: DeployHookResult }

//? Export a project as a downloadable artifact. `image` → a `docker save` tarball; `bundle` → a real prod
//? build tarball. Creates a BuildArtifact row (building→ready|error) + a signed token, then (D4) fires the
//? configured deploy-hook. `now` is injected (Date.now() is banned in some contexts).
export async function buildExport(prisma: PrismaClient, workspaceId: string, projectId: string, kind: string, now: number): Promise<BuildExportResult> {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { baseImageRef: true } });
  const imageRef = project?.baseImageRef ?? null;
  const token = randomBytes(24).toString('hex');
  const isBundle = kind === 'bundle';
  const artifact = await prisma.buildArtifact.create({
    data: { workspaceId, projectId, kind: isBundle ? 'bundle' : 'image', downloadToken: token, status: 'building', ...(imageRef ? { imageRef } : {}), expiresAt: new Date(now + EXPORT_TTL_MS) },
  });

  if (!imageRef) return failExport(prisma, workspaceId, artifact.id, 'export.noImage');
  if (!(await dockerAvailable())) return failExport(prisma, workspaceId, artifact.id, 'docker.unavailable');

  const dir = path.join(workspaceDataDir(workspaceId), 'exports');
  mkdirSync(dir, { recursive: true });
  const result = isBundle
    ? await exportBundle(prisma, workspaceId, artifact.id, imageRef, dir, token)
    : await exportImage(prisma, workspaceId, artifact.id, imageRef, dir, token);
  if (!result.ok) return result;

  //? D4 — a ready artifact is the deploy input: fire the external deploy-hook (webhook) if configured.
  const deployHook = await postDeployWebhook({ event: 'build-export', workspaceId, projectId, kind: isBundle ? 'bundle' : 'image', artifactId: artifact.id, imageRef, downloadToken: token }, undefined, prisma);
  //? #64 — persist the hook result on the artifact row so the settings UI can surface fired/ok/status.
  await prisma.buildArtifact.update({ where: { id: artifact.id }, data: { deployHookFired: deployHook.fired, ...(deployHook.ok === undefined ? {} : { deployHookOk: deployHook.ok }), ...(deployHook.status === undefined ? {} : { deployHookStatus: deployHook.status }) } });
  return { ...result, deployHook };
}

//? `image` — a `docker save` OCI tarball of the whole runnable image.
async function exportImage(prisma: PrismaClient, workspaceId: string, artifactId: string, imageRef: string, dir: string, token: string): Promise<BuildExportResult> {
  const filePath = path.join(dir, `${token}.tar`);
  const saved = await docker(['save', '-o', filePath, imageRef]);
  if (saved.code !== 0) return failExport(prisma, workspaceId, artifactId, `export.saveFailed: ${saved.err.slice(0, 200)}`);
  return finishExport(prisma, workspaceId, artifactId, filePath, token);
}

//? `bundle` (D4) — run the project's REAL production build inside a throwaway container from its image, tar
//? the build output IN the container (tar/gzip live in the app image), then `docker cp` the single tarball
//? out. Cleans up the container whatever happens. Replaces the old `export.bundleNotImplemented`.
async function exportBundle(prisma: PrismaClient, workspaceId: string, artifactId: string, imageRef: string, dir: string, token: string): Promise<BuildExportResult> {
  //? `token` is randomBytes hex ([0-9a-f]) → already a valid docker object name.
  const name = `ws-export-${token}`;
  const filePath = path.join(dir, `${token}.tgz`);
  const built = await docker(['run', '--name', name, imageRef, 'sh', '-c', `${buildCmd()} && tar -czf /tmp/bundle.tgz -C ${buildOutputDir()} .`]);
  if (built.code !== 0) { await docker(['rm', '-f', name]); return failExport(prisma, workspaceId, artifactId, `export.buildFailed: ${built.err.slice(0, 200)}`); }
  const copied = await docker(['cp', `${name}:/tmp/bundle.tgz`, filePath]);
  await docker(['rm', '-f', name]);
  if (copied.code !== 0) return failExport(prisma, workspaceId, artifactId, `export.copyFailed: ${copied.err.slice(0, 200)}`);
  return finishExport(prisma, workspaceId, artifactId, filePath, token);
}

//? Stamp the artifact ready with its on-disk size. `updateMany` with the workspaceId keeps the write
//? tenant-scoped (H1) — the artifact was created in this workspace's export call.
async function finishExport(prisma: PrismaClient, workspaceId: string, artifactId: string, filePath: string, token: string): Promise<BuildExportResult> {
  const [, stat] = tryCatchSync(() => statSync(filePath));
  const sizeBytes = stat?.size ?? 0;
  await prisma.buildArtifact.updateMany({ where: { id: artifactId, workspaceId }, data: { status: 'ready', filePath, sizeBytes } });
  return { ok: true, artifactId, downloadToken: token, status: 'ready' };
}

async function failExport(prisma: PrismaClient, workspaceId: string, artifactId: string, error: string): Promise<BuildExportResult> {
  await prisma.buildArtifact.updateMany({ where: { id: artifactId, workspaceId }, data: { status: 'error', error } });
  return { ok: false, artifactId, status: 'error', error };
}

//? The descriptor POSTed to the deploy-hook — enough for an external CI/CD to pull + deploy the artifact.
export interface DeployDescriptor {
  event: string;
  workspaceId: string;
  projectId: string;
  kind: string;
  artifactId: string;
  imageRef: string;
  downloadToken: string;
}
//? Injectable so the webhook is unit/e2e-tested without the global fetch (a local receiver in the test).
export type DeployFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

//? #64 — resolve a deploy-hook config value: the PER-WORKSPACE env var (save-env, decrypted if secret)
//? takes precedence over the host-global `process.env`, so each workspace points at its own deploy target
//? without a host restart. A missing prisma or row falls back to the env-global default.
async function resolveDeployConfig(prisma: PrismaClient | undefined, workspaceId: string, key: string): Promise<string> {
  if (prisma) {
    const row = await prisma.envVar.findFirst({ where: { workspaceId, key }, select: { value: true, secret: true } });
    if (row) { const v = row.secret ? (decryptSecret(row.value) ?? '') : row.value; if (v.trim().length > 0) return v.trim(); }
  }
  return (process.env[key] ?? '').trim();
}

//? D4 deploy-hook — POST the artifact descriptor to the configured external endpoint (webhook/CI trigger).
//? Config source (#64): the per-workspace `WS_DEPLOY_WEBHOOK_URL`/`WS_DEPLOY_WEBHOOK_TOKEN` env vars
//? (save-env, settings UI) with a host-global `process.env` fallback. No-op (`fired:false`) when no URL is
//? configured, so export works with or without a target. Best-effort: a network failure is reported on the
//? result, never thrown (a failed hook must not fail the export that already produced a good artifact).
export async function postDeployWebhook(descriptor: DeployDescriptor, fetchImpl?: DeployFetch, prisma?: PrismaClient): Promise<DeployHookResult> {
  const url = await resolveDeployConfig(prisma, descriptor.workspaceId, 'WS_DEPLOY_WEBHOOK_URL');
  if (url.length === 0) return { fired: false };
  const bearer = await resolveDeployConfig(prisma, descriptor.workspaceId, 'WS_DEPLOY_WEBHOOK_TOKEN');
  const doFetch: DeployFetch = fetchImpl ?? ((u, init) => fetch(u, init).then((r) => ({ ok: r.ok, status: r.status })));
  const [err, res] = await tryCatch(() => doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer.length > 0 ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(descriptor),
  }));
  if (err || !res) return { fired: true, ok: false, error: err?.message ?? 'deploy.hookNoResponse' };
  return { fired: true, ok: res.ok, status: res.status };
}
