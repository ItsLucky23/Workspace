//? Register-flow C — AI generation of a project's `.workspaces/Dockerfile` (07b §1.2).
//? Runs on the pluggable provider layer (`runAiCompletion('dockerfile-generate')`), so
//? which AI authors it is a per-feature config choice. The result MUST extend the L1 base
//? image (never an arbitrary FROM); we validate that before persisting a DRAFT the user
//? then reviews (Monaco slice) + commits into the repo. The actual L2 `docker build` of
//? the draft is a later slice (P2, 07b §1.2).

import { runAiCompletion } from './registry';
import { repoManifests } from '../git/repoStore';
import { resolveProjectId } from '../orchestrator/projectResolve';
import { extendsAllowedBase } from '../container/baseImages';
import type { PrismaClient } from '@prisma/client';

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';

export interface DockerfileResult { ok: boolean; dockerfile: string; projectId?: string; error?: string }

//? Strip a ```dockerfile ... ``` fence if the model added one despite the instruction.
function extractDockerfile(text: string): string {
  const fence = /```(?:dockerfile)?\s*([\s\S]*?)```/i.exec(text);
  return (fence?.[1] ?? text).trim();
}

//? The Dockerfile's FIRST `FROM` must be a `workspaces/base*` image (07b §1.2 / Q-CT-DOCKERFILE-TRUST:
//? an arbitrary FROM is a supply-chain surface). S1 — relaxed from a single image to the base FAMILY (any stack
//? variant) via the shared guard. A `# syntax=` directive before it is fine.
const extendsBase = extendsAllowedBase;

//? Generate the draft `.workspaces/Dockerfile` from the linked repo's manifests. This slow provider path
//? is READ-ONLY; the route submits the result as a typed CAS completion through the Conductor.
export async function generateDockerfile(prisma: PrismaClient, workspaceId: string, projectId?: string): Promise<DockerfileResult> {
  //? R3-b — generate for the ACTIVE/target project (its own repo + draft slot).
  const resolvedId = await resolveProjectId(prisma, workspaceId, projectId);
  if (!resolvedId) return { ok: false, dockerfile: '', error: 'repo.notLinked' };
  const ctx = await repoManifests(workspaceId, resolvedId);
  if (ctx.tree.length === 0) return { ok: false, dockerfile: '', error: 'repo.notLinked' };
  const system = [
    'You author a .workspaces/Dockerfile so a project\'s per-ticket container has the right toolchain.',
    'Base your answer ONLY on the files listed below. Do NOT read the filesystem or run any tools — your working directory is empty; the repo content is provided inline here.',
    `The Dockerfile MUST begin exactly with: FROM ${BASE_IMAGE}`,
    'That base ALREADY provides: Debian bookworm (glibc), Node 22, git, gh, curl, the DB clients (psql/mysql/mongosh/redis-cli), the Claude CLI, node-pty, and a non-root `agent` user (uid 10001, WORKDIR /work). NEVER reinstall any of these.',
    'Add ONLY what THIS project needs beyond the base (an extra language runtime, system libs, a dependency pre-install). Install system packages as root, then drop back to `USER agent`. If the base already suffices, output just the FROM line plus a one-line comment.',
    'Keep it minimal + reproducible. Output ONLY the Dockerfile content — no prose, no markdown fences.',
    `Repo files: ${ctx.tree.join(', ')}`,
    ...ctx.manifests.map((m) => `--- ${m.path} ---\n${m.content}`),
  ].join('\n');
  const res = await runAiCompletion('dockerfile-generate', { prompt: 'Generate the .workspaces/Dockerfile now.', system, timeoutMs: 120_000 });
  if (!res.ok) return { ok: false, dockerfile: '', error: res.error ?? 'ai.turnFailed' };
  const dockerfile = extractDockerfile(res.text);
  if (dockerfile.length === 0 || !extendsBase(dockerfile)) return { ok: false, dockerfile, error: 'dockerfile.invalidBase' };
  return { ok: true, dockerfile, projectId: resolvedId };
}
