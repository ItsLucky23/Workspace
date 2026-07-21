//? L2 per-project image build (07b §1.2, Q-CT-IMAGESEL). Builds the AI-authored draft
//? `.workspaces/Dockerfile` into a content-hash-tagged image `workspaces/proj-<id>:<hash>`
//? and points `Project.baseImageRef` at it so `launchTicketContainer` runs the project
//? image instead of the L1 base. Content hash = SHA-256 over (draft bytes + lockfile bytes)
//? → identical inputs reuse the cached image (one rebuild per Dockerfile/lockfile change,
//? §10). Local daemon only, validated to extend the L1 base (Q-CT-DOCKERFILE-TRUST). The
//? pre-warm dependency layer (§1.2/§8.4) is DEFERRED — the draft builds as-authored.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import { docker, dockerAvailable } from './runtime';
import { repoManifests } from '../git/repoStore';
import { draftPath as projectDraftPath } from './dockerfileDraft';
import { resolveProjectId } from '../orchestrator/projectResolve';

import { extendsAllowedBase } from './baseImages';

const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

export interface ImageBuildResult { ok: boolean; tag?: string; error?: string }
export interface ImageBuildDependencies { persist?: (projectId: string, tag: string) => Promise<void> }

//? Defense in depth: re-validate the on-disk draft's first FROM (must be a `workspaces/base*` family image —
//? S1 relaxed via the shared guard) before building — the file is Admin-editable between generate and build.
const extendsBase = extendsAllowedBase;

export async function buildProjectImage(prisma: PrismaClient, workspaceId: string, projectId?: string, dependencies: ImageBuildDependencies = {}): Promise<ImageBuildResult> {
  if (!(await dockerAvailable())) return { ok: false, error: 'docker.unavailable' };
  //? R3-b — build the ACTIVE/target project (resolveProjectId), not always the first one.
  const resolvedId = await resolveProjectId(prisma, workspaceId, projectId);
  if (!resolvedId) return { ok: false, error: 'project.notFound' };
  const project = { id: resolvedId };
  //? E2 — expert opt-in: a project with `allowCustomBase` may use an arbitrary Dockerfile FROM (the guard is
  //? relaxed). A loud warning is logged since the agent/editor toolchain may be absent in a non-base image.
  const projectRow = await prisma.project.findFirst({ where: { id: resolvedId, workspaceId }, select: { allowCustomBase: true } });
  const allowCustomBase = projectRow?.allowCustomBase === true;
  const dfPath = projectDraftPath(workspaceId, project.id);
  if (!existsSync(dfPath)) return { ok: false, error: 'dockerfile.noDraft' };
  const draft = readFileSync(dfPath);
  if (!extendsBase(draft.toString('utf8'))) {
    if (!allowCustomBase) return { ok: false, error: 'dockerfile.invalidBase' };
    console.warn(`[imageBuild] project ${resolvedId}: custom Dockerfile base (allowCustomBase) — agent/editor toolchain may be degraded in this image.`);
  }

  //? Fold the project lockfile into the hash so a dependency bump rebuilds exactly once.
  const manifests = await repoManifests(workspaceId, project.id);
  const lockfile = manifests.manifests.find((m) => LOCKFILES.has(m.path.toLowerCase().split('/').at(-1) ?? ''));
  const hash = createHash('sha256').update(draft).update(lockfile?.content ?? '').digest('hex').slice(0, 16);
  const tag = `workspaces/proj-${project.id}:${hash}`;

  //? Content-hash cache: identical (Dockerfile+lockfile) ⇒ same tag ⇒ no rebuild.
  const inspect = await docker(['image', 'inspect', tag]);
  if (inspect.code !== 0) {
    //? Minimal, dedicated build context (only the Dockerfile — never the sibling repo.git).
    const ctx = path.join(tmpdir(), `ws-img-${project.id}-${hash}`);
    mkdirSync(ctx, { recursive: true });
    writeFileSync(path.join(ctx, 'Dockerfile'), draft);
    const build = await docker(['build', '-f', path.join(ctx, 'Dockerfile'), '-t', tag, '--label', `org.workspaces.project=${project.id}`, '--label', `org.workspaces.dockerfile-hash=${hash}`, ctx]);
    rmSync(ctx, { recursive: true, force: true });
    if (build.code !== 0) return { ok: false, error: `image.buildFailed: ${build.err.slice(0, 300)}` };
  }
  //? buildProjectImage is the SOLE writer of baseImageRef (dockerfileGen sets only the draft).
  //? ADR 0035: write only the TARGET project (was updateMany over every project → corrupted siblings).
  const persist = dependencies.persist ?? (async (id: string, imageTag: string): Promise<void> => { await prisma.project.updateMany({ where: { workspaceId, id }, data: { baseImageRef: imageTag } }); });
  await persist(project.id, tag);
  return { ok: true, tag };
}
