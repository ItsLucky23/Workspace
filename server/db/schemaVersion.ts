//? F51 — versioned schema upgrades for EXISTING installs.
//?
//? There is no `prisma/migrations/` and there cannot be one in the usual sense: the MongoDB connector has
//? no `migrate deploy`. `prisma db push` reshapes indexes, and that is all it does — it never backfills.
//? So every field this project has added (`Ticket.projectId`, `PublishJob.attempts`,
//? `ContentProject.captionStyle`, …) landed with existing rows simply lacking it, and each one was papered
//? over at read time with a `?? default`. That works until a query FILTERS on the field, at which point old
//? rows quietly vanish from results.
//?
//? This is the missing half: a numbered, idempotent, forward-only backfill runner with a persisted
//? watermark. Each step declares what it fixes and runs at most once per install.
//?
//? Deliberately NOT a general migration framework. It backfills data; schema shape stays `db push`'s job.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

export interface BackfillStep {
  version: number;
  name: string;
  //? Must be safe to run twice: the watermark protects the normal path, but a crash mid-step must not
  //? leave the install unrepairable.
  run: (prisma: PrismaClient) => Promise<number>;
}

//? The ordered steps. Append only — a released version number is never reused or reordered, because an
//? install that already passed it will never run it again.
export const BACKFILL_STEPS: BackfillStep[] = [
  {
    version: 1,
    name: 'publish-job-attempts',
    //? A3 added `attempts` with a default; rows written before it have no field at all, so a
    //? `attempts: { lt: 3 }` retry query would skip exactly the oldest failures.
    run: async (prisma) => {
      const res = await prisma.publishJob.updateMany({ where: { attempts: { equals: undefined } }, data: { attempts: 0 } });
      return res.count;
    },
  },
  {
    version: 2,
    name: 'document-archived-flag',
    //? C7 added `archived`; the documents list filters on it, so pre-C7 documents would disappear from a
    //? `archived: false` query in some drivers.
    run: async (prisma) => {
      const res = await prisma.document.updateMany({ where: { archived: { equals: undefined } }, data: { archived: false } });
      return res.count;
    },
  },
  {
    version: 3,
    name: 'workspace-preset-key',
    //? G5 made `presetKey` load-bearing (it decides the seeded pipeline). Old workspaces predate it.
    run: async (prisma) => {
      const res = await prisma.workspace.updateMany({ where: { presetKey: { equals: undefined } }, data: { presetKey: 'professional' } });
      return res.count;
    },
  },
  {
    version: 4,
    name: 'ci-service-scope',
    //? Per-service CI added a nullable `serviceId` to Pipeline / PipelineRun / BuildArtifact, where `null`
    //? means "the project root unit" — a first-class value, not a missing one. Every pre-existing row has
    //? the field ABSENT, and on MongoDB an absent field does not match a `serviceId: null` filter
    //? (lesson 0014), so without this backfill every existing pipeline becomes invisible to the very
    //? queries that gate merges and promotions. Writing it explicitly is the whole fix.
    run: async (prisma) => {
      //? A schema backfill is host-wide by definition: it repairs every workspace's rows once, and
      //? scoping it to one tenant would leave every other tenant permanently broken.
      const results = await Promise.all([
        prisma.pipeline.updateMany({ where: { serviceId: { equals: undefined } }, data: { serviceId: null } }), // luckystack-allow tenant-scope: host-wide schema backfill
        prisma.pipelineRun.updateMany({ where: { serviceId: { equals: undefined } }, data: { serviceId: null } }), // luckystack-allow tenant-scope: host-wide schema backfill
        prisma.buildArtifact.updateMany({ where: { serviceId: { equals: undefined } }, data: { serviceId: null } }), // luckystack-allow tenant-scope: host-wide schema backfill
      ]);
      return results.reduce((total, res) => total + res.count, 0);
    },
  },
  {
    version: 5,
    name: 'ticket-service-scope',
    //? Same absent-vs-null reasoning as step 4, for `Ticket.serviceId` (which unit a ticket's work — and
    //? therefore its preview and its CI gate — belongs to). Its own step rather than an edit to step 4:
    //? a step that has already run is never re-run, so growing a released step silently skips the addition.
    run: async (prisma) => {
      const res = await prisma.ticket.updateMany({ where: { serviceId: { equals: undefined } }, data: { serviceId: null } }); // luckystack-allow tenant-scope: host-wide schema backfill, same reasoning as step 4
      return res.count;
    },
  },
  {
    version: 6,
    name: 'consolidate-workflow-skills',
    //? InfoSource(mode=skill) was a second skill store for workflow capabilities. Preserve its exact stage,
    //? kind/model and enabled state in canonical Skill rows, then remove only the migrated source row.
    run: async (prisma) => {
      const normalized = await prisma.skill.updateMany({ where: { skillType: { equals: undefined } }, data: { skillType: 'instruction' } }); // luckystack-allow tenant-scope: host-wide schema normalization before the canonical-model migration
      const legacy = await prisma.infoSource.findMany({ where: { mode: 'skill' } }); // luckystack-allow tenant-scope: host-wide one-time migration enumerates every legacy skill, then preserves its workspaceId
      let migrated = 0;
      for (const source of legacy) {
        const existing = await prisma.skill.findFirst({ where: { legacyInfoSourceId: source.id }, select: { id: true } }); // luckystack-allow tenant-scope: globally unique legacy ObjectId lookup during host-wide migration
        if (!existing) {
          await prisma.skill.create({ // luckystack-allow tenant-scope: workspaceId is copied exactly from the source row during host-wide migration
            data: {
              workspaceId: source.workspaceId,
              projectId: source.projectId,
              slug: `capability-${source.id}`,
              name: source.name,
              description: source.summary,
              status: source.summary,
              instruction: source.content ?? '',
              examples: '',
              applyPoints: [],
              skillType: 'capability',
              usedByStages: source.usedByStages,
              kind: source.kind,
              model: source.model,
              legacyInfoSourceId: source.id,
              enabled: source.enabled,
              builtin: source.note === 'starter',
            },
          });
        }
        await prisma.infoSource.deleteMany({ where: { id: source.id, mode: 'skill' } }); // luckystack-allow tenant-scope: deletes only the globally enumerated legacy row after its canonical Skill exists
        migrated += 1;
      }
      return normalized.count + migrated;
    },
  },
];

export const CURRENT_SCHEMA_VERSION = Math.max(0, ...BACKFILL_STEPS.map((s) => s.version));

//? The watermark lives in its own single-row collection, not in an env var or a file: it must survive a
//? container rebuild and be visible to every instance.
export async function readSchemaVersion(prisma: PrismaClient): Promise<number> {
  const [, row] = await tryCatch(() => prisma.schemaVersion.findFirst({ orderBy: { version: 'desc' }, select: { version: true } }));
  return row?.version ?? 0;
}

export interface UpgradeOutcome { from: number; to: number; applied: { name: string; rows: number }[]; failed?: string }

//? Run every step newer than the watermark, in order, stopping at the first failure. Stopping matters:
//? steps may depend on each other, and continuing past a failure would apply step 5 to data step 4 never
//? fixed. The watermark only advances past a step that actually succeeded.
export async function runSchemaUpgrade(prisma: PrismaClient): Promise<UpgradeOutcome> {
  const from = await readSchemaVersion(prisma);
  const applied: { name: string; rows: number }[] = [];
  let reached = from;

  for (const step of BACKFILL_STEPS.filter((s) => s.version > from).toSorted((a, b) => a.version - b.version)) {
    const [error, rows] = await tryCatch(() => step.run(prisma));
    if (error) return { from, to: reached, applied, failed: `${step.name}: ${error.message}` };
    applied.push({ name: step.name, rows: rows ?? 0 });
    reached = step.version;
    await tryCatch(() => prisma.schemaVersion.create({ data: { version: step.version, name: step.name, rows: rows ?? 0 } }));
  }

  return { from, to: reached, applied };
}

//? Is this install behind? Used by the boot path to decide whether to run the upgrade at all, and by a
//? health surface to say so out loud.
export async function schemaUpgradePending(prisma: PrismaClient): Promise<boolean> {
  return (await readSchemaVersion(prisma)) < CURRENT_SCHEMA_VERSION;
}
