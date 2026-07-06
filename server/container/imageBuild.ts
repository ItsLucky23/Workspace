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
import { workspaceDataDir, repoManifests } from '../git/repoStore';

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

export interface ImageBuildResult { ok: boolean; tag?: string; error?: string }

//? Defense in depth: re-validate the on-disk draft's first FROM before building — the
//? file is Admin-editable between generate and build.
function extendsBase(dockerfile: string): boolean {
  const firstFrom = dockerfile.split('\n').map((l) => l.trim()).find((l) => /^FROM\s/i.test(l));
  return firstFrom?.toLowerCase().startsWith(`from ${BASE_IMAGE.toLowerCase()}`) ?? false;
}

export async function buildProjectImage(prisma: PrismaClient, workspaceId: string): Promise<ImageBuildResult> {
  if (!(await dockerAvailable())) return { ok: false, error: 'docker.unavailable' };
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  if (!project) return { ok: false, error: 'project.notFound' };
  const draftPath = path.join(workspaceDataDir(workspaceId), 'draft.Dockerfile');
  if (!existsSync(draftPath)) return { ok: false, error: 'dockerfile.noDraft' };
  const draft = readFileSync(draftPath);
  if (!extendsBase(draft.toString('utf8'))) return { ok: false, error: 'dockerfile.invalidBase' };

  //? Fold the project lockfile into the hash so a dependency bump rebuilds exactly once.
  const manifests = await repoManifests(workspaceId);
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
  await prisma.project.update({ where: { id: project.id }, data: { baseImageRef: tag } });
  return { ok: true, tag };
}
