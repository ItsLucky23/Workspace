//? Promote ladder (ADR 0038, B2) — move a tested build up the fixed dev→staging→prod ladder. The
//? target env deploys the EXACT image the SOURCE env is running (a promoted build, not a fresh branch
//? pull), so what you tested on dev is what ships to prod. `prod` is GATED: it needs an explicit
//? approval (B-23 confirm) + the source env being live (a health signal). A green-CI gate is a hook
//? C1 (quality gates) fills — left as a TODO so B2 doesn't fake a check that doesn't exist yet.

import type { PrismaClient } from '@prisma/client';

import { ensureEnvironment, deployEnvironment, type DeployResult } from './environment';
import { ciGreenForProject, securityBlocksProdPromote } from '../ci/gate';

//? The fixed ladder: dev → staging → prod (§2.4). null = no next stage.
const NEXT_KIND: Record<string, string | undefined> = { dev: 'staging', staging: 'prod' };

//? Promote (project, service) from `fromKind` to the next stage. Returns the target deploy result, or a
//? `status:'blocked'` result when a gate refuses (prod without approval / source not live).
export async function promoteEnvironment(prisma: PrismaClient, workspaceId: string, projectId: string, serviceId: string | null, fromKind: string, opts: { approved?: boolean } = {}): Promise<DeployResult> {
  const toKind = NEXT_KIND[fromKind];
  if (!toKind) return { ok: false, status: 'error', error: 'promote.noNextStage' };

  const source = await prisma.environment.findFirst({ where: { workspaceId, projectId, serviceId: serviceId ?? null, kind: fromKind } });
  if (!source) return { ok: false, status: 'error', error: 'promote.noSource' };
  //? Health gate: only a LIVE source can be promoted (you can't ship a broken build forward).
  if (source.status !== 'live') return { ok: false, status: 'blocked', error: 'promote.sourceNotLive' };
  //? prod gate (ADR 0038/0039): explicit approval (B-23) AND green CI. Green-CI blocks only when the
  //? latest project run actually failed/is running (no CI configured ⇒ green — opt-in).
  if (toKind === 'prod' && opts.approved !== true) return { ok: false, status: 'blocked', error: 'promote.prodNeedsApproval' };
  if (toKind === 'prod' && !(await ciGreenForProject(prisma, workspaceId, projectId, source.deployedCommit))) return { ok: false, status: 'blocked', error: 'promote.needsGreenCi' };
  //? Security gate (ADR 0040): evaluate findings for the exact source revision when available.
  if (toKind === 'prod' && (await securityBlocksProdPromote(prisma, workspaceId, projectId, source.deployedCommit))) return { ok: false, status: 'blocked', error: 'promote.securityFindings' };

  const targetId = await ensureEnvironment(prisma, workspaceId, projectId, serviceId, toKind);
  if (!targetId) return { ok: false, status: 'error', error: 'promote.noTarget' };
  //? Deploy the target with the SOURCE's exact image pinned (the promoted, tested build).
  return deployEnvironment(prisma, workspaceId, targetId, source.imageRef ? { imageRef: source.imageRef } : {});
}
